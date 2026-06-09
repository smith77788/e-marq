/**
 * Shared runtime for ACOS agents.
 *
 * Provides:
 *  - bearer auth (cron via SUPABASE_PUBLISHABLE_KEY OR user JWT with super_admin / tenant member)
 *  - acos_agent_runs lifecycle (running → success/failed)
 *  - dedup helper for ai_insights
 *  - typed insight insert helper
 */
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Database } from "@/integrations/supabase/types";
import { buildInsightCopy } from "@/lib/acos/insightCopy";
import { isCronToken } from "@/lib/acos/cronAuth";

export type AgentInsightInput = {
  tenant_id: string;
  insight_type: string;
  affected_layer: string;
  title: string;
  description: string;
  expected_impact?: string;
  confidence: number; // 0..1
  risk_level: "low" | "medium" | "high";
  metrics: Record<string, unknown>;
  /** Stable key to dedupe within a 7-day window. */
  dedup_key: string;
};

export type AuthContext = { kind: "cron" } | { kind: "user"; userId: string };

/**
 * Verify bearer token. Cron uses anon key; user must be super_admin or member of tenant.
 */
export async function authorizeAgentRequest(
  token: string,
  tenantId: string,
): Promise<AuthContext | { error: string; status: number }> {
  if (!token) return { error: "Missing bearer token", status: 401 };

  if (isCronToken(token)) {
    return { kind: "cron" };
  }

  const url = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !anon) return { error: "Server not configured", status: 500 };
  const sb = createClient<Database>(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
  });
  // `getClaims()` can fail in the Worker runtime depending on JWT/JWKS cache
  // state, even when the user's bearer token is valid. `getUser(token)` asks
  // the auth service directly and is the stable path for owner-triggered
  // integration actions such as DN Trade verify/sync/dry-run.
  const { data, error } = await sb.auth.getUser(token);
  if (error || !data?.user?.id) return { error: "Invalid token", status: 401 };
  const userId = data.user.id;
  const [roleRes, memberRes] = await Promise.all([
    supabaseAdmin.from("user_roles").select("role").eq("user_id", userId).eq("role", "super_admin"),
    supabaseAdmin
      .from("tenant_memberships")
      .select("role")
      .eq("user_id", userId)
      .eq("tenant_id", tenantId),
  ]);
  if ((roleRes.data ?? []).length > 0) return { kind: "user", userId };
  if ((memberRes.data ?? []).length > 0) return { kind: "user", userId };
  return { error: "Forbidden", status: 403 };
}

export type RunHandle = { runId: string; trigger: "cron" | "manual" };

export async function startAgentRun(
  agentId: string,
  tenantId: string,
  ctx: AuthContext,
): Promise<RunHandle> {
  const trigger = ctx.kind === "cron" ? "cron" : "manual";
  const { data, error } = await supabaseAdmin
    .from("acos_agent_runs")
    .insert({
      tenant_id: tenantId,
      agent_id: agentId,
      status: "running",
      metadata: { trigger },
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`Failed to start agent run: ${error?.message}`);
  return { runId: data.id, trigger };
}

export async function finishAgentRun(
  handle: RunHandle,
  insightsCreated: number,
  extra: Record<string, unknown> = {},
) {
  const { error } = await supabaseAdmin
    .from("acos_agent_runs")
    .update({
      status: "success",
      finished_at: new Date().toISOString(),
      insights_created: insightsCreated,
      metadata: { trigger: handle.trigger, ...extra },
    })
    .eq("id", handle.runId);
  if (error) console.error("finishAgentRun update failed:", error.message);
}

export async function failAgentRun(handle: RunHandle, err: unknown) {
  // Normalise any error shape into a useful string. Supabase errors are plain
  // objects and used to serialise as "[object Object]" — losing the cause and
  // making /agents.live useless.
  let msg: string;
  if (err instanceof Error) {
    msg = err.message;
  } else if (err && typeof err === "object") {
    const e = err as { message?: unknown; code?: unknown; details?: unknown; hint?: unknown };
    const parts = [
      typeof e.message === "string" ? e.message : null,
      typeof e.code === "string" ? `code=${e.code}` : null,
      typeof e.details === "string" ? `details=${e.details}` : null,
      typeof e.hint === "string" ? `hint=${e.hint}` : null,
    ].filter(Boolean);
    msg = parts.length > 0 ? parts.join(" | ") : JSON.stringify(err).slice(0, 500);
  } else {
    msg = String(err);
  }
  await supabaseAdmin
    .from("acos_agent_runs")
    .update({
      status: "failed",
      finished_at: new Date().toISOString(),
      error: msg,
    })
    .eq("id", handle.runId);
}

/**
 * Insert insights with 7-day dedup window keyed by `dedup_bucket`.
 * dedup_bucket = stable hash of (insight_type + dedup_key) so the same finding
 * is not re-queued every day.
 */
export async function insertInsightsDedup(rows: AgentInsightInput[]): Promise<number> {
  if (rows.length === 0) return 0;
  const tenantId = rows[0].tenant_id;

  // Compute dedup buckets
  const withBucket = rows.map((r) => ({
    ...r,
    bucket: hashToBigInt(`${r.insight_type}::${r.dedup_key}`),
  }));

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const buckets = withBucket.map((r) => r.bucket);
  const { data: existing } = await supabaseAdmin
    .from("ai_insights")
    .select("dedup_bucket")
    .eq("tenant_id", tenantId)
    .in("status", ["new", "in_review", "approved"])
    .gte("created_at", sevenDaysAgo)
    .in("dedup_bucket", buckets);
  const taken = new Set<string>();
  for (const e of existing ?? []) {
    if (e.dedup_bucket != null) taken.add(String(e.dedup_bucket));
  }

  const fresh = withBucket.filter((r) => !taken.has(String(r.bucket)));
  if (fresh.length === 0) return 0;

  const insertRows = fresh.map((r) => {
    // Прикріплюємо людську версію (UA + EN) до metrics, щоб UI міг показати
    // власнику зрозумілий headline/why/what_to_do замість сирого тексту.
    const copy = buildInsightCopy(r.insight_type, r.metrics);
    const enrichedMetrics = copy ? { ...r.metrics, _copy: copy } : r.metrics;
    return {
      tenant_id: r.tenant_id,
      insight_type: r.insight_type,
      affected_layer: r.affected_layer,
      title: r.title,
      description: r.description,
      expected_impact: r.expected_impact ?? null,
      confidence: r.confidence,
      risk_level: r.risk_level,
      status: "new",
      metrics: enrichedMetrics as never,
      dedup_bucket: r.bucket,
    };
  });

  let inserted = 0;
  for (let i = 0; i < insertRows.length; i += 100) {
    const chunk = insertRows.slice(i, i + 100);
    const { error } = await supabaseAdmin.from("ai_insights").insert(chunk);
    if (error) throw error;
    inserted += chunk.length;
  }
  return inserted;
}

/** djb2-like hash → fits in PG bigint (signed 64-bit, but we keep positive). */
function hashToBigInt(s: string): number {
  let h = 5381n;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5n) + h + BigInt(s.charCodeAt(i))) & 0x7fffffffffffffffn;
  }
  // JS number safe range is 2^53; truncate
  return Number(h % 9007199254740881n);
}

export function jsonError(message: string, status: number, extra: Record<string, unknown> = {}) {
  return new Response(JSON.stringify({ error: message, ...extra }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function jsonOk(payload: Record<string, unknown>) {
  return new Response(JSON.stringify({ success: true, ...payload }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

export async function readTenantId(request: Request): Promise<string | null> {
  try {
    const body = (await request.json()) as { tenant_id?: string };
    return body.tenant_id && typeof body.tenant_id === "string" ? body.tenant_id : null;
  } catch {
    return null;
  }
}
