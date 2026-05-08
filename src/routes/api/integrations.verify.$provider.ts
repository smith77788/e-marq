/**
 * POST /api/integrations/verify/{provider}
 *
 * Робить мінімальний пробний виклик зовнішнього API для перевірки credentials.
 * НЕ пише в БД, НЕ створює import_job — лише підтверджує, що ключ робочий.
 *
 * Body: { tenantId: string, credentials?: string, config?: object }
 *   - якщо credentials/config не задані — беремо з tenant_integrations
 *
 * Returns: { ok: true, sample: number } або { ok: false, error: string }
 */
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { CORS_HEADERS, withCors } from "@/lib/http/cors";
import {
  isConnectorSupported,
  runConnectorPull,
  verifyDnTradeKey,
} from "@/lib/integrations/connectors";

const BodySchema = z.object({
  tenantId: z.string().uuid(),
  credentials: z.string().min(1).max(2000).optional(),
  config: z.record(z.string().min(1).max(64), z.unknown()).optional(),
  entityKind: z.enum(["products", "customers", "orders"]).default("customers"),
});

function jsonResponse(body: unknown, status = 200) {
  return withCors(new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  }));
}

export const Route = createFileRoute("/api/integrations/verify/$provider")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS_HEADERS }),
      POST: async ({ request, params }) => {
        try {
          const provider = String(params.provider).slice(0, 64);
          if (!isConnectorSupported(provider)) {
            return jsonResponse(
              { ok: false, error: `Конектор "${provider}" не має авто-перевірки.` },
              400,
            );
          }

          const authHeader = request.headers.get("authorization") ?? "";
          if (!authHeader.startsWith("Bearer ")) {
            return jsonResponse({ ok: false, error: "Unauthorized" }, 401);
          }
          const token = authHeader.slice(7);
          const SUPABASE_URL = process.env.SUPABASE_URL!;
          const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY!;
          const userClient = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
            global: { headers: { Authorization: `Bearer ${token}` } },
            auth: { persistSession: false, autoRefreshToken: false },
          });
          const { data: userData, error: userErr } = await userClient.auth.getUser(token);
          if (userErr || !userData?.user?.id) {
            return jsonResponse({ ok: false, error: "Invalid token" }, 401);
          }

          const raw = await request.json().catch(() => null);
          const parsed = BodySchema.safeParse(raw);
          if (!parsed.success) {
            return jsonResponse({ ok: false, error: "Invalid payload" }, 400);
          }
          const { tenantId, entityKind } = parsed.data;
          let { credentials, config } = parsed.data;

          // Guard: self-serve tenants may be pending immediately after onboarding.
          const { data: tenant } = await supabaseAdmin
            .from("tenants")
            .select("status")
            .eq("id", tenantId)
            .maybeSingle();
          if (tenant && !["active", "pending"].includes(tenant.status)) {
            return jsonResponse(
              {
                ok: false,
                error:
                  "Бренд заблоковано або архівовано. Підключення недоступне для цього статусу.",
              },
              403,
            );
          }

          // Якщо credentials/config не передані — беремо з БД (RLS перевірить доступ).
          if (!credentials || !config) {
            const { data: integ, error: integErr } = await userClient
              .from("tenant_integrations")
              .select("credentials_encrypted, config")
              .eq("tenant_id", tenantId)
              .eq("provider", provider)
              .maybeSingle();
            if (integErr)
              return jsonResponse({ ok: false, error: "Немає доступу до інтеграції" }, 403);
            if (!integ && !credentials)
              return jsonResponse(
                {
                  ok: false,
                  error: "Введіть ключ для перевірки. Інтеграцію ще не збережено.",
                },
                400,
              );
            if (integ) {
              credentials = credentials ?? integ.credentials_encrypted ?? undefined;
              config = config ?? (integ.config as Record<string, unknown>) ?? {};
            }
          }

          // DN Trade — окремий легкий verify через /products/stores (без pull).
          if (provider === "dntrade") {
            if (!credentials) {
              return jsonResponse({ ok: false, error: "Введіть ApiKey DN Trade." }, 400);
            }
            const r = await verifyDnTradeKey(credentials);
            if (r.ok) return jsonResponse({ ok: true, sample: 1 });
            return jsonResponse(
              {
                ok: false,
                error:
                  "Сервер DN Trade відхилив ключ. Перевірте, що це ApiKey з правами читання. " +
                  (r.error ?? ""),
              },
              200,
            );
          }

          // Робимо пробний pull з limit=1.
          try {
            const result = await runConnectorPull({
              provider,
              entityKind,
              credentials: credentials ?? null,
              config: config ?? {},
              limit: 1,
            });
            return jsonResponse({ ok: true, sample: result.rows.length });
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            return jsonResponse({ ok: false, error: msg }, 200);
          }
        } catch (e) {
          return jsonResponse(
            { ok: false, error: e instanceof Error ? e.message : "internal error" },
            500,
          );
        }
      },
    },
  },
});
