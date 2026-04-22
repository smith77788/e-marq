/**
 * Promo Portfolio (ported from MFD `acos-promo-portfolio`).
 *
 * Аналізує всі активні промо як портфель: чи не каннібалізуються між собою,
 * чи покривають усі сегменти (new / repeat / vip), і чи нема overlap по продуктах.
 *
 * Body: { tenant_id }
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  authorizeAgentRequest,
  failAgentRun,
  finishAgentRun,
  insertInsightsDedup,
  jsonError,
  jsonOk,
  startAgentRun,
} from "@/lib/acos/agentRuntime";
import { loadEffectiveGeoTargets } from "@/lib/acos/loadGeoTargets";
import { summarizeGeo } from "@/lib/acos/geoTargets";

const AGENT_ID = "promo-portfolio";

export const Route = createFileRoute("/hooks/agents/promo-portfolio")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authHeader = request.headers.get("authorization") ?? "";
        const token = authHeader.replace(/^Bearer\s+/i, "").trim();
        let tenantId: string | null = null;
        try {
          const body = (await request.json()) as { tenant_id?: string };
          tenantId = body.tenant_id ?? null;
        } catch {
          return jsonError("Invalid JSON body", 400);
        }
        if (!tenantId) return jsonError("tenant_id required", 400);

        const ctx = await authorizeAgentRequest(token, tenantId);
        if ("error" in ctx) return jsonError(ctx.error, ctx.status);

        const handle = await startAgentRun("promo-portfolio", tenantId, ctx);
        try {
          const { data: promos } = await supabaseAdmin
            .from("promotions")
            .select("id, name, applies_to_segment, applies_to_product_ids, value, promo_type")
            .eq("tenant_id", tenantId)
            .eq("is_active", true);

          if (!promos?.length) {
            await finishAgentRun(handle, 0, { reason: "no_active_promos" });
            return jsonOk({ insights_created: 0 });
          }

          const insights = [];

          // Check 1: segments coverage
          const segments = new Set(promos.map((p) => p.applies_to_segment).filter(Boolean));
          const expected = ["new", "repeat", "vip"];
          const missing = expected.filter((s) => !segments.has(s));
          if (missing.length > 0 && promos.length >= 2) {
            insights.push({
              tenant_id: tenantId,
              insight_type: "promo_segment_gap",
              affected_layer: "marketing",
              title: `Промо не покривають сегменти: ${missing.join(", ")}`,
              description: `Активних промо ${promos.length}, але жодна не таргетує: ${missing.join(", ")}.`,
              expected_impact: `Окрема промо для ${missing[0]} підніме конверсію цього сегменту на 10-20%.`,
              confidence: 0.7,
              risk_level: "low" as const,
              metrics: {
                missing_segments: missing,
                covered_segments: [...segments],
                total_promos: promos.length,
              },
              dedup_key: `promo_gap::${missing.sort().join(":")}`,
            });
          }

          // Check 2: product overlap (cannibalization)
          const productPromos = new Map<string, string[]>();
          for (const p of promos) {
            for (const pid of p.applies_to_product_ids ?? []) {
              const list = productPromos.get(pid) ?? [];
              list.push(p.name);
              productPromos.set(pid, list);
            }
          }
          const overlapping = [...productPromos.entries()].filter(([, names]) => names.length > 1);
          if (overlapping.length > 0) {
            insights.push({
              tenant_id: tenantId,
              insight_type: "promo_overlap",
              affected_layer: "marketing",
              title: `${overlapping.length} продуктів під 2+ активними промо`,
              description: `Канібалізація: ті самі товари входять у декілька знижок одночасно.`,
              expected_impact: `Прибрати overlap → +5-10% маржі без втрати конверсії.`,
              confidence: 0.75,
              risk_level: "medium" as const,
              metrics: {
                overlapping_count: overlapping.length,
                examples: overlapping
                  .slice(0, 5)
                  .map(([pid, names]) => ({ product_id: pid, promos: names })),
              },
              dedup_key: `promo_overlap::${overlapping.length}`,
            });
          }

          // Check 3: too many promos (dilution)
          if (promos.length > 8) {
            insights.push({
              tenant_id: tenantId,
              insight_type: "promo_too_many",
              affected_layer: "marketing",
              title: `Забагато активних промо (${promos.length})`,
              description: `Понад 8 одночасних знижок → клієнт перестає сприймати "знижка" як подію.`,
              expected_impact: `Залишити 3-4 найефективніших → той самий виторг при меншій маржі знижки.`,
              confidence: 0.7,
              risk_level: "medium" as const,
              metrics: { active_promos: promos.length, recommended_max: 4 },
              dedup_key: `promo_too_many::${promos.length}`,
            });
          }

          const created = await insertInsightsDedup(insights);
          await finishAgentRun(handle, created, { promos_total: promos.length });
          return jsonOk({ insights_created: created });
        } catch (err) {
          await failAgentRun(handle, err);
          return jsonError("Promo portfolio failed", 500, {
            details: err instanceof Error ? err.message : String(err),
          });
        }
      },
    },
  },
});
