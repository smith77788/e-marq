/**
 * Outreach Memory — patterns у public.ai_memory (per-tenant).
 *
 * pattern_key format: outreach:{channel}:{kind}:{value}
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const AGENT = "outreach";

export type LengthBucket = "short" | "medium" | "long";

export function bucketLength(text: string): LengthBucket {
  const n = (text ?? "").length;
  if (n <= 120) return "short";
  if (n <= 220) return "medium";
  return "long";
}

export function bucketTone(text: string): "question" | "statement" {
  return /\?/.test(text ?? "") ? "question" : "statement";
}

export function patternKey(channel: string, kind: string, value: string): string {
  return `outreach:${channel}:${kind}:${value}`.toLowerCase().slice(0, 200);
}

export function ruleForPattern(
  channel: string,
  kind: string,
  value: string,
  outcome: "success" | "failure",
): string {
  const action = outcome === "success" ? "працює" : "не працює";
  switch (kind) {
    case "length":
      return `Для ${channel} довжина "${value}" зазвичай ${action} (${outcome}).`;
    case "tone":
      return `Для ${channel} тон "${value}" зазвичай ${action}.`;
    case "source":
      return `Канал-джерело "${value}" в ${channel} ${action}.`;
    default:
      return `${channel}/${kind}=${value} ${action}.`;
  }
}

export interface PatternUpdate {
  tenant_id: string;
  pattern_key: string;
  category: string;
  learned_rule: string;
  outcome: "success" | "failure";
  impact?: number;
  evidence?: Record<string, unknown>;
}

export async function recordPattern(u: PatternUpdate): Promise<void> {
  try {
    const { data: existing } = await supabaseAdmin
      .from("ai_memory")
      .select("id, success_count, failure_count, avg_impact, evidence")
      .eq("tenant_id", u.tenant_id)
      .eq("agent", AGENT)
      .eq("pattern_key", u.pattern_key)
      .maybeSingle();

    const newImpact = u.impact ?? 0;
    if (existing) {
      const total = (existing.success_count ?? 0) + (existing.failure_count ?? 0) + 1;
      const w = total <= 10 ? 1 / total : 0.1;
      const avg = (1 - w) * Number(existing.avg_impact ?? 0) + w * newImpact;
      const conf = Math.min(0.95, total / 30);
      await supabaseAdmin
        .from("ai_memory")
        .update({
          success_count: (existing.success_count ?? 0) + (u.outcome === "success" ? 1 : 0),
          failure_count: (existing.failure_count ?? 0) + (u.outcome === "failure" ? 1 : 0),
          avg_impact: avg,
          confidence: conf,
          last_observed_at: new Date().toISOString(),
          learned_rule: u.learned_rule.slice(0, 500),
          evidence: { ...((existing.evidence as Record<string, unknown>) ?? {}), last: u.evidence ?? {} } as never,
          is_active: conf >= 0.2,
        })
        .eq("id", existing.id);
    } else {
      await supabaseAdmin.from("ai_memory").insert({
        tenant_id: u.tenant_id,
        agent: AGENT,
        pattern_key: u.pattern_key,
        category: u.category,
        learned_rule: u.learned_rule.slice(0, 500),
        success_count: u.outcome === "success" ? 1 : 0,
        failure_count: u.outcome === "failure" ? 1 : 0,
        avg_impact: newImpact,
        confidence: 0.05,
        evidence: { first: u.evidence ?? {} },
        is_active: false,
      });
    }
  } catch (e) {
    console.warn("[outreach-memory] record failed:", String((e as Error)?.message ?? e));
  }
}

export interface ChannelHints {
  positive: string[];
  negative: string[];
  prefer_length?: LengthBucket;
  prefer_tone?: "question" | "statement";
}

export async function getChannelHints(tenantId: string, channel: string): Promise<ChannelHints> {
  try {
    const { data } = await supabaseAdmin
      .from("ai_memory")
      .select("pattern_key, learned_rule, success_count, failure_count, avg_impact, confidence, is_active")
      .eq("tenant_id", tenantId)
      .eq("agent", AGENT)
      .ilike("pattern_key", `outreach:${channel}:%`)
      .limit(50);
    const rows = data ?? [];
    type Row = {
      pattern_key: string;
      learned_rule: string;
      success_count: number | null;
      failure_count: number | null;
      avg_impact: number | null;
      confidence: number | null;
      is_active: boolean | null;
    };
    const scored = (rows as Row[]).map((r) => {
      const total = (r.success_count ?? 0) + (r.failure_count ?? 0);
      const sr = total > 0 ? (r.success_count ?? 0) / total : 0;
      const rank = sr * Number(r.confidence ?? 0) * (1 + Math.log(1 + Number(r.avg_impact ?? 0)));
      return { ...r, sr, rank };
    });
    const positive = scored
      .filter((r) => r.is_active && r.sr >= 0.5)
      .sort((a, b) => b.rank - a.rank)
      .slice(0, 3)
      .map((r) => r.learned_rule);
    const negative = scored
      .filter((r) => (r.failure_count ?? 0) >= 2 && r.sr < 0.3)
      .sort((a, b) => (b.failure_count ?? 0) - (a.failure_count ?? 0))
      .slice(0, 3)
      .map((r) => r.learned_rule);
    const lengthRow = scored
      .filter((r) => r.pattern_key.includes(":length:") && r.is_active)
      .sort((a, b) => b.rank - a.rank)[0];
    const toneRow = scored
      .filter((r) => r.pattern_key.includes(":tone:") && r.is_active)
      .sort((a, b) => b.rank - a.rank)[0];
    const prefer_length = lengthRow ? (lengthRow.pattern_key.split(":").pop() as LengthBucket) : undefined;
    const prefer_tone = toneRow
      ? (toneRow.pattern_key.split(":").pop() as "question" | "statement")
      : undefined;
    return { positive, negative, prefer_length, prefer_tone };
  } catch (e) {
    console.warn("[outreach-memory] hints failed:", String((e as Error)?.message ?? e));
    return { positive: [], negative: [] };
  }
}
