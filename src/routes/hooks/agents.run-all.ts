/**
 * ACOS Orchestrator: runs all agents for a tenant in parallel.
 * Body: { tenant_id }
 */
import { createFileRoute } from "@tanstack/react-router";
import {
  authorizeAgentRequest,
  jsonError,
  jsonOk,
} from "@/lib/acos/agentRuntime";

const AGENTS = [
  "churn-risk",
  "stockout",
  "aov-leak",
  "search-gap",
  "aov-optimizer",
  "price-optimizer",
  "price-revert",
  "bot-quality",
  "segmentation",
  "memory-feedback",
] as const;

export const Route = createFileRoute("/hooks/agents/run-all")({
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

        const origin = new URL(request.url).origin;
        const results = await Promise.allSettled(
          AGENTS.map(async (a) => {
            const res = await fetch(`${origin}/hooks/agents/${a}`, {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
              body: JSON.stringify({ tenant_id: tenantId }),
            });
            const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
            return { agent: a, ok: res.ok, ...json };
          }),
        );

        const summary = results.map((r, i) =>
          r.status === "fulfilled" ? r.value : { agent: AGENTS[i], ok: false, error: String(r.reason) },
        );
        const totalCreated = summary.reduce((s, r) => {
          const v = (r as Record<string, unknown>).insights_created;
          return s + (typeof v === "number" ? v : 0);
        }, 0);

        return jsonOk({ insights_created: totalCreated, agents: summary });
      },
    },
  },
});
