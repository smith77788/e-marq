/**
 * Public proxy для Nova Poshta API.
 *
 * Чому public: пошук міст/відділень потрібен для анонімних покупців у чекауті.
 * Захист: rate limit per-IP, дозволені тільки конкретні model+method.
 *
 * Використання з клієнта:
 *   POST /api/public/shipping/np
 *   { kind: "cities", query: "Київ" }
 *   { kind: "warehouses", cityRef: "<ref>", query?: "1" }
 */
import { createFileRoute } from "@tanstack/react-router";

const NP_URL = "https://api.novaposhta.ua/v2.0/json/";

type Body =
  | { kind: "cities"; query: string }
  | { kind: "warehouses"; cityRef: string; query?: string };

const RATE_LIMIT = 30; // запитів за хвилину з одного IP
const ipBuckets = new Map<string, { count: number; reset: number }>();

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const bucket = ipBuckets.get(ip);
  if (!bucket || bucket.reset < now) {
    ipBuckets.set(ip, { count: 1, reset: now + 60_000 });
    return true;
  }
  if (bucket.count >= RATE_LIMIT) return false;
  bucket.count += 1;
  return true;
}

function clientIp(req: Request): string {
  return (
    req.headers.get("cf-connecting-ip") ||
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"
  );
}

async function callNP(
  apiKey: string,
  model: string,
  method: string,
  props: Record<string, unknown>,
) {
  const res = await fetch(NP_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      apiKey,
      modelName: model,
      calledMethod: method,
      methodProperties: props,
    }),
  });
  if (!res.ok) throw new Error(`NP HTTP ${res.status}`);
  return (await res.json()) as { success: boolean; data: unknown[]; errors?: string[] };
}

export const Route = createFileRoute("/api/public/shipping/np")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const ip = clientIp(request);
        if (!checkRateLimit(ip)) {
          return new Response(JSON.stringify({ error: "rate_limited" }), {
            status: 429,
            headers: { "Content-Type": "application/json" },
          });
        }

        const apiKey = process.env.NOVA_POSHTA_API_KEY;
        if (!apiKey) {
          return new Response(JSON.stringify({ error: "not_configured" }), {
            status: 503,
            headers: { "Content-Type": "application/json" },
          });
        }

        let body: Body;
        try {
          body = (await request.json()) as Body;
        } catch {
          return new Response(JSON.stringify({ error: "bad_json" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }

        try {
          if (body.kind === "cities") {
            const q = (body.query || "").trim();
            if (q.length < 2 || q.length > 100) {
              return new Response(JSON.stringify({ data: [] }), {
                status: 200,
                headers: { "Content-Type": "application/json" },
              });
            }
            const json = await callNP(apiKey, "Address", "searchSettlements", {
              CityName: q,
              Limit: 20,
            });
            // searchSettlements повертає [{ Addresses: [...] }]
            const addresses =
              (json.data?.[0] as { Addresses?: unknown[] } | undefined)?.Addresses ?? [];
            const cities = (addresses as Array<Record<string, unknown>>).map((a) => ({
              ref: String(a.DeliveryCity ?? a.Ref ?? ""),
              name: String(a.MainDescription ?? a.Present ?? ""),
              area: String(a.Area ?? ""),
              region: String(a.Region ?? ""),
              present: String(a.Present ?? ""),
            }));
            return new Response(JSON.stringify({ data: cities }), {
              status: 200,
              headers: {
                "Content-Type": "application/json",
                "Cache-Control": "public, max-age=300",
              },
            });
          }

          if (body.kind === "warehouses") {
            const ref = (body.cityRef || "").trim();
            if (!ref || ref.length > 100) {
              return new Response(JSON.stringify({ error: "bad_city_ref" }), {
                status: 400,
                headers: { "Content-Type": "application/json" },
              });
            }
            const props: Record<string, unknown> = {
              CityRef: ref,
              Limit: 200,
            };
            const q = (body.query || "").trim();
            if (q && q.length <= 50) props.FindByString = q;

            const json = await callNP(apiKey, "Address", "getWarehouses", props);
            const warehouses = (json.data as Array<Record<string, unknown>>).map((w) => ({
              ref: String(w.Ref ?? ""),
              number: String(w.Number ?? ""),
              description: String(w.Description ?? ""),
              shortAddress: String(w.ShortAddress ?? ""),
              typeOfWarehouse: String(w.TypeOfWarehouse ?? ""),
              categoryOfWarehouse: String(w.CategoryOfWarehouse ?? ""),
            }));
            return new Response(JSON.stringify({ data: warehouses }), {
              status: 200,
              headers: {
                "Content-Type": "application/json",
                "Cache-Control": "public, max-age=300",
              },
            });
          }

          return new Response(JSON.stringify({ error: "bad_kind" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        } catch (e) {
          console.error("[shipping.np] upstream error", e instanceof Error ? e.message : e);
          return new Response(
            JSON.stringify({ error: "external_api_error" }),
            { status: 502, headers: { "Content-Type": "application/json" } },
          );
        }
      },
    },
  },
});
