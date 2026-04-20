/**
 * ACOS Agent: Churn Risk Predictor
 *
 * Triggered manually from admin UI or by cron.
 * For a given tenant_id, scans paid orders, identifies VIP customers (>=4 orders),
 * computes recency drift (days since last order ÷ avg interval between orders),
 * and writes insights into ai_insights for those whose drift > 1.5×.
 *
 * Authorization:
 *   - Bearer <SUPABASE_PUBLISHABLE_KEY> (used by pg_cron / external triggers)
 *   - OR Bearer <user JWT> where user is super_admin or tenant_admin
 *
 * Body: { tenant_id: string }
 */
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Database } from "@/integrations/supabase/types";

type OrderRow = {
  id: string;
  customer_email: string | null;
  customer_name: string | null;
  total_cents: number;
  created_at: string;
  metadata: { cohort?: string; synth_customer_id?: string } | null;
};

type CustomerStats = {
  email: string;
  name: string | null;
  orderCount: number;
  totalSpentCents: number;
  firstOrderAt: Date;
  lastOrderAt: Date;
  avgIntervalDays: number;
  recencyDays: number;
  driftRatio: number;
  cohort: string | null;
};

const AGENT_ID = "churn_risk_predictor";

function isAuthorized(token: string): boolean {
  // Cron / service trigger uses anon publishable key
  return token === process.env.SUPABASE_PUBLISHABLE_KEY;
}

async function verifyUserAuthorized(token: string, tenantId: string): Promise<boolean> {
  const url = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !anon) return false;
  const sb = createClient<Database>(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
  });
  const { data, error } = await sb.auth.getClaims(token);
  if (error || !data?.claims?.sub) return false;
  const userId = data.claims.sub;
  // Check super_admin or tenant member
  const [roleRes, memberRes] = await Promise.all([
    supabaseAdmin.from("user_roles").select("role").eq("user_id", userId).eq("role", "super_admin"),
    supabaseAdmin.from("tenant_memberships").select("role").eq("user_id", userId).eq("tenant_id", tenantId),
  ]);
  if ((roleRes.data ?? []).length > 0) return true;
  if ((memberRes.data ?? []).length > 0) return true;
  return false;
}

export const Route = createFileRoute("/hooks/agents/churn-risk")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authHeader = request.headers.get("authorization") ?? "";
        const token = authHeader.replace(/^Bearer\s+/i, "").trim();
        if (!token) {
          return new Response(JSON.stringify({ error: "Missing bearer token" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          });
        }

        let body: { tenant_id?: string };
        try {
          body = (await request.json()) as { tenant_id?: string };
        } catch {
          return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }
        const tenantId = body.tenant_id;
        if (!tenantId || typeof tenantId !== "string") {
          return new Response(JSON.stringify({ error: "tenant_id required" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }

        // AuthZ
        const cronOk = isAuthorized(token);
        const userOk = cronOk ? false : await verifyUserAuthorized(token, tenantId);
        if (!cronOk && !userOk) {
          return new Response(JSON.stringify({ error: "Forbidden" }), {
            status: 403,
            headers: { "Content-Type": "application/json" },
          });
        }

        // Start agent run
        const { data: runRow, error: runErr } = await supabaseAdmin
          .from("acos_agent_runs")
          .insert({
            tenant_id: tenantId,
            agent_id: AGENT_ID,
            status: "running",
            metadata: { trigger: cronOk ? "cron" : "manual" },
          })
          .select("id")
          .single();
        if (runErr || !runRow) {
          return new Response(JSON.stringify({ error: "Failed to start run", details: runErr?.message }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
        const runId = runRow.id;

        try {
          // Fetch paid orders, last 180 days
          const since = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString();
          const { data: orders, error: ordersErr } = await supabaseAdmin
            .from("orders")
            .select("id, customer_email, customer_name, total_cents, created_at, metadata")
            .eq("tenant_id", tenantId)
            .eq("status", "paid")
            .gte("created_at", since)
            .order("created_at", { ascending: true })
            .limit(5000);
          if (ordersErr) throw ordersErr;

          // Group by customer_email
          const byCustomer = new Map<string, OrderRow[]>();
          for (const o of (orders ?? []) as OrderRow[]) {
            if (!o.customer_email) continue;
            const arr = byCustomer.get(o.customer_email) ?? [];
            arr.push(o);
            byCustomer.set(o.customer_email, arr);
          }

          const now = Date.now();
          const candidates: CustomerStats[] = [];
          for (const [email, list] of byCustomer.entries()) {
            if (list.length < 4) continue; // VIP threshold
            list.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
            const first = new Date(list[0].created_at);
            const last = new Date(list[list.length - 1].created_at);
            const intervals: number[] = [];
            for (let i = 1; i < list.length; i++) {
              const dt = (new Date(list[i].created_at).getTime() - new Date(list[i - 1].created_at).getTime()) / 86400000;
              intervals.push(dt);
            }
            const avg = intervals.reduce((s, x) => s + x, 0) / intervals.length;
            const recency = (now - last.getTime()) / 86400000;
            const drift = avg > 0 ? recency / avg : 0;
            const totalSpent = list.reduce((s, o) => s + (o.total_cents ?? 0), 0);
            if (drift > 1.5 && recency >= 14) {
              candidates.push({
                email,
                name: list[list.length - 1].customer_name,
                orderCount: list.length,
                totalSpentCents: totalSpent,
                firstOrderAt: first,
                lastOrderAt: last,
                avgIntervalDays: avg,
                recencyDays: recency,
                driftRatio: drift,
                cohort: list[list.length - 1].metadata?.cohort ?? null,
              });
            }
          }

          // Sort by impact (totalSpent × drift) desc, take top 30
          candidates.sort((a, b) => b.totalSpentCents * b.driftRatio - a.totalSpentCents * a.driftRatio);
          const top = candidates.slice(0, 30);

          // Dedup: skip if there's already a 'new' or 'in_review' churn_risk insight for same email in last 7d
          const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
          const { data: existing } = await supabaseAdmin
            .from("ai_insights")
            .select("metrics, status")
            .eq("tenant_id", tenantId)
            .eq("insight_type", "churn_risk")
            .in("status", ["new", "in_review"])
            .gte("created_at", sevenDaysAgo);
          const existingEmails = new Set<string>();
          for (const e of existing ?? []) {
            const m = e.metrics as { email?: string } | null;
            if (m?.email) existingEmails.add(m.email);
          }

          const toInsert = top.filter((c) => !existingEmails.has(c.email));
          let insightsCreated = 0;
          if (toInsert.length > 0) {
            const rows = toInsert.map((c) => {
              const expectedRevenueCents = Math.round(c.totalSpentCents / Math.max(c.orderCount, 1));
              const confidence = Math.min(0.95, 0.5 + Math.min(c.driftRatio - 1.5, 1.5) * 0.2);
              const risk = c.driftRatio > 3 ? "high" : c.driftRatio > 2 ? "medium" : "low";
              return {
                tenant_id: tenantId,
                insight_type: "churn_risk",
                affected_layer: "crm",
                title: `${c.name ?? c.email} likely to churn — ${c.recencyDays.toFixed(0)}d silent vs ${c.avgIntervalDays.toFixed(0)}d avg`,
                description: `VIP customer with ${c.orderCount} orders (lifetime $${(c.totalSpentCents / 100).toFixed(2)}) hasn't ordered in ${c.recencyDays.toFixed(0)} days. Their typical interval is ${c.avgIntervalDays.toFixed(0)} days — drift ratio ${c.driftRatio.toFixed(2)}×. Recommend a winback touch (15% off + free shipping) to recover.`,
                expected_impact: `Recover ~$${(expectedRevenueCents / 100).toFixed(2)} of next order revenue`,
                confidence,
                risk_level: risk,
                status: "new",
                metrics: {
                  email: c.email,
                  customer_name: c.name,
                  order_count: c.orderCount,
                  total_spent_cents: c.totalSpentCents,
                  avg_interval_days: Number(c.avgIntervalDays.toFixed(2)),
                  recency_days: Number(c.recencyDays.toFixed(2)),
                  drift_ratio: Number(c.driftRatio.toFixed(3)),
                  cohort: c.cohort,
                  suggested_action: "winback_touch",
                  suggested_discount_pct: 15,
                },
              };
            });
            // Insert in chunks
            for (let i = 0; i < rows.length; i += 100) {
              const chunk = rows.slice(i, i + 100);
              const { error: insErr } = await supabaseAdmin.from("ai_insights").insert(chunk);
              if (insErr) throw insErr;
              insightsCreated += chunk.length;
            }
          }

          // Finish run
          await supabaseAdmin
            .from("acos_agent_runs")
            .update({
              status: "success",
              finished_at: new Date().toISOString(),
              insights_created: insightsCreated,
              metadata: {
                trigger: cronOk ? "cron" : "manual",
                customers_analyzed: byCustomer.size,
                vip_count: candidates.length,
                inserted: insightsCreated,
                skipped_dedup: top.length - insightsCreated,
              },
            })
            .eq("id", runId);

          return new Response(
            JSON.stringify({
              success: true,
              run_id: runId,
              customers_analyzed: byCustomer.size,
              vip_at_risk: candidates.length,
              insights_created: insightsCreated,
              skipped_dedup: top.length - insightsCreated,
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          await supabaseAdmin
            .from("acos_agent_runs")
            .update({
              status: "failed",
              finished_at: new Date().toISOString(),
              error: msg,
            })
            .eq("id", runId);
          return new Response(JSON.stringify({ error: "Agent failed", details: msg }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
