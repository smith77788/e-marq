/**
 * Bootstrap Agent: Channel Discovery
 *
 * Дивиться які канали реально активні / неактивні для tenant:
 *   - storefront (кількість content_viewed events за 7 днів)
 *   - telegram (telegram_chat_routing + outbound_messages останні 30 днів)
 *   - email (customers з email + outbound email останні 30 днів)
 *   - external integrations (tenant_integrations active)
 * Пише bootstrap_facts(channel_inventory) — owner-playbook та notification-router
 * вирішують куди слати на основі цих даних.
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
  type AgentInsightInput,
} from "@/lib/acos/agentRuntime";
import { upsertBootstrapFacts } from "@/lib/acos/bootstrapFacts";

const AGENT_ID = "channel_discovery";

export const Route = createFileRoute("/hooks/agents/channel-discovery")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const token = (request.headers.get("authorization") ?? "")
          .replace(/^Bearer\s+/i, "")
          .trim();
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

        const handle = await startAgentRun(AGENT_ID, tenantId, ctx);
        try {
          const since7 = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
          const since30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

          const [
            tenantRes,
            storefrontRes,
            tgRoutingRes,
            tgOutRes,
            emailCustomersRes,
            emailOutRes,
            integrationsRes,
          ] = await Promise.all([
            supabaseAdmin.from("tenants").select("slug").eq("id", tenantId).maybeSingle(),
            supabaseAdmin
              .from("events")
              .select("id", { count: "exact", head: true })
              .eq("tenant_id", tenantId)
              .in("type", [
                "page_viewed",
                "product_viewed",
                "add_to_cart",
                "checkout_started",
                "purchase_completed",
              ])
              .gte("created_at", since7),
            supabaseAdmin
              .from("telegram_chat_routing")
              .select("chat_id", { count: "exact", head: true })
              .eq("tenant_id", tenantId),
            supabaseAdmin
              .from("outbound_messages")
              .select("id", { count: "exact", head: true })
              .eq("tenant_id", tenantId)
              .eq("channel", "telegram")
              .gte("created_at", since30),
            supabaseAdmin
              .from("customers")
              .select("id", { count: "exact", head: true })
              .eq("tenant_id", tenantId)
              .not("email", "is", null),
            supabaseAdmin
              .from("outbound_messages")
              .select("id", { count: "exact", head: true })
              .eq("tenant_id", tenantId)
              .eq("channel", "email")
              .gte("created_at", since30),
            supabaseAdmin
              .from("tenant_integrations")
              .select("provider, is_active, last_sync_status")
              .eq("tenant_id", tenantId)
              .limit(100),
          ]);

          const slug = tenantRes.data?.slug ?? "";
          const channels = {
            storefront: {
              ready: (storefrontRes.count ?? 0) > 0,
              events_7d: storefrontRes.count ?? 0,
              url: slug ? `/s/${slug}` : null,
            },
            telegram: {
              ready: (tgRoutingRes.count ?? 0) > 0,
              chats: tgRoutingRes.count ?? 0,
              outbound_30d: tgOutRes.count ?? 0,
            },
            email: {
              ready: (emailCustomersRes.count ?? 0) > 0,
              customers_with_email: emailCustomersRes.count ?? 0,
              outbound_30d: emailOutRes.count ?? 0,
            },
            integrations: (integrationsRes.data ?? []).map((i) => ({
              provider: i.provider,
              active: i.is_active,
              last_sync_status: i.last_sync_status,
            })),
          };
          const readyCount = [
            channels.storefront.ready,
            channels.telegram.ready,
            channels.email.ready,
          ].filter(Boolean).length;

          await upsertBootstrapFacts([
            {
              tenant_id: tenantId,
              fact_kind: "channel_inventory",
              value: { ...channels, ready_count: readyCount, total_count: 3 },
              confidence: 0.95,
            },
          ]);

          const insights: AgentInsightInput[] = [];
          if (!channels.telegram.ready) {
            insights.push({
              tenant_id: tenantId,
              insight_type: "bootstrap_no_telegram_channel",
              affected_layer: "channels",
              title: "Telegram-канал не підключений",
              description:
                "Без Telegram win-back, abandoned-cart та reorder агенти не мають як зв'язатися з клієнтами. Це найшвидший канал, який можна підключити за 2 хвилини.",
              expected_impact: "Активує 24/7 sales-bot + 5 повідомлень-агентів",
              confidence: 1,
              risk_level: "high",
              metrics: { slug, action: "connect_telegram" },
              dedup_key: "channel_no_telegram",
            });
          }
          if (!channels.email.ready) {
            insights.push({
              tenant_id: tenantId,
              insight_type: "bootstrap_no_email_channel",
              affected_layer: "channels",
              title: "Email-адреси не зібрані",
              description:
                "Email-канал недоступний — broadcast-composer не зможе відправляти масові розсилки. Додайте поле email на checkout.",
              expected_impact: "Подвоює доступну аудиторію для розсилок",
              confidence: 0.9,
              risk_level: "medium",
              metrics: { action: "edit_checkout_form" },
              dedup_key: "channel_no_email",
            });
          }

          const created = await insertInsightsDedup(insights);
          await finishAgentRun(handle, created, {
            ready_count: readyCount,
            integrations_count: integrationsRes.data?.length ?? 0,
          });
          return jsonOk({ run_id: handle.runId, insights_created: created, channels });
        } catch (e) {
          await failAgentRun(handle, e);
          return jsonError("Channel discovery failed", 500, {
            details: e instanceof Error ? e.message : String(e),
          });
        }
      },
    },
  },
});
