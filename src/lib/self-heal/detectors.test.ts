import { beforeEach, describe, expect, it, vi } from "vitest";

const fromMock = vi.hoisted(() => vi.fn());
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: fromMock },
}));

import { detectOutreachFailures } from "./detectors/outreachFailures";
import { detectAgentRunsStuck } from "./detectors/agentRunsStuck";
import { detectAgentRunsFailing } from "./detectors/agentRunsFailing";
import { detectStaleNotifications } from "./detectors/staleNotifications";
import { detectOrdersStuck } from "./detectors/ordersStuck";
import { routeTables } from "./supabaseTestMock";

beforeEach(() => fromMock.mockReset());

describe("detectOutreachFailures", () => {
  it("returns nothing without a tenant", async () => {
    expect(await detectOutreachFailures({ tenantId: null })).toEqual([]);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("returns nothing when there are no failed actions", async () => {
    fromMock.mockImplementation(routeTables({ outreach_actions: { data: [] } }));
    expect(await detectOutreachFailures({ tenantId: "t1" })).toEqual([]);
  });

  it("ignores permanent failures (only reschedules transient ones)", async () => {
    fromMock.mockImplementation(
      routeTables({
        outreach_actions: {
          data: [
            { id: "a1", channel: "tg", retry_count: 1, failed_reason: "rate_limit_exceeded" },
            { id: "a2", channel: "tg", retry_count: 0, failed_reason: "user banned forever" },
          ],
        },
      }),
    );
    expect(await detectOutreachFailures({ tenantId: "t1" })).toEqual([]);
  });

  it("builds a reschedule draft for transient failures", async () => {
    fromMock.mockImplementation(
      routeTables({
        outreach_actions: {
          data: [
            { id: "a1", channel: "tg", retry_count: 1, failed_reason: "network timeout" },
            { id: "a2", channel: "email", retry_count: 0, failed_reason: null },
            { id: "a3", channel: "tg", retry_count: 2, failed_reason: "token_invalid" }, // permanent
          ],
        },
      }),
    );
    const [draft] = await detectOutreachFailures({ tenantId: "t1" });
    expect(draft.detector).toBe("outreach_failures");
    expect(draft.severity).toBe("p2");
    expect(draft.fingerprint).toBe("outreach_failures:t1");
    expect(draft.regression_risk).toBe("low");
    expect(draft.scope.channels).toEqual(expect.arrayContaining(["tg", "email"]));
    expect(draft.proposed_actions).toHaveLength(1);
    const action = draft.proposed_actions[0];
    expect(action.kind).toBe("reschedule_outreach");
    expect(action.payload.action_ids).toEqual(["a1", "a2"]); // a3 excluded
    expect(action.reversible).toBe(true);
  });

  it("escalates severity to p1 above 20 transient failures", async () => {
    const data = Array.from({ length: 21 }, (_, i) => ({
      id: `a${i}`,
      channel: "tg",
      retry_count: 0,
      failed_reason: "timeout",
    }));
    fromMock.mockImplementation(routeTables({ outreach_actions: { data } }));
    const [draft] = await detectOutreachFailures({ tenantId: "t1" });
    expect(draft.severity).toBe("p1");
  });
});

describe("detectAgentRunsStuck", () => {
  it("returns nothing when no runs are stuck", async () => {
    fromMock.mockImplementation(routeTables({ acos_agent_runs: { data: [] } }));
    expect(await detectAgentRunsStuck({ tenantId: null })).toEqual([]);
  });

  it("groups stuck runs by tenant and maps 'system' to null tenant", async () => {
    fromMock.mockImplementation(
      routeTables({
        acos_agent_runs: {
          data: [
            { id: "r1", agent_id: "tick", tenant_id: null, started_at: "2026-01-01T00:00:00Z" },
            { id: "r2", agent_id: "seo", tenant_id: "t1", started_at: "2026-01-01T00:00:00Z" },
            { id: "r3", agent_id: "seo", tenant_id: "t1", started_at: "2026-01-01T00:00:00Z" },
          ],
        },
      }),
    );
    const drafts = await detectAgentRunsStuck({ tenantId: null });
    expect(drafts).toHaveLength(2);
    const system = drafts.find((d) => d.fingerprint === "agent_runs_stuck:system");
    expect(system?.tenant_id).toBeNull();
    const t1 = drafts.find((d) => d.fingerprint === "agent_runs_stuck:t1");
    expect(t1?.tenant_id).toBe("t1");
    expect(t1?.scope.count).toBe(2);
    expect(t1?.proposed_actions[0].kind).toBe("reset_stuck_agent_run");
    expect(t1?.proposed_actions[0].payload.run_ids).toEqual(["r2", "r3"]);
    expect(t1?.proposed_actions[0].reversible).toBe(false);
  });

  it("uses p1 severity above 5 stuck runs", async () => {
    const data = Array.from({ length: 6 }, (_, i) => ({
      id: `r${i}`,
      agent_id: "x",
      tenant_id: "t1",
      started_at: "2026-01-01T00:00:00Z",
    }));
    fromMock.mockImplementation(routeTables({ acos_agent_runs: { data } }));
    const [draft] = await detectAgentRunsStuck({ tenantId: "t1" });
    expect(draft.severity).toBe("p1");
  });
});

describe("detectAgentRunsFailing", () => {
  it("returns nothing without a tenant", async () => {
    expect(await detectAgentRunsFailing({ tenantId: null })).toEqual([]);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("does not flag agents below the 5-failure / 80% threshold", async () => {
    fromMock.mockImplementation(
      routeTables({
        acos_agent_runs: {
          data: [
            // 4 failures only
            ...Array.from({ length: 4 }, () => ({ agent_id: "a", status: "failed", started_at: "z" })),
            // 5 failures but 50% rate
            ...Array.from({ length: 5 }, () => ({ agent_id: "b", status: "failed", started_at: "z" })),
            ...Array.from({ length: 5 }, () => ({ agent_id: "b", status: "ok", started_at: "z" })),
          ],
        },
      }),
    );
    expect(await detectAgentRunsFailing({ tenantId: "t1" })).toEqual([]);
  });

  it("flags a kill-switch candidate at >=5 failures and >=80% fail rate", async () => {
    fromMock.mockImplementation(
      routeTables({
        acos_agent_runs: {
          data: [
            ...Array.from({ length: 9 }, () => ({ agent_id: "bad", status: "failed", started_at: "z" })),
            { agent_id: "bad", status: "ok", started_at: "z" },
          ],
        },
      }),
    );
    const [draft] = await detectAgentRunsFailing({ tenantId: "t1" });
    expect(draft.severity).toBe("p1");
    expect(draft.regression_risk).toBe("medium");
    expect(draft.fingerprint).toBe("agent_failing:t1:bad");
    expect(draft.proposed_actions[0].kind).toBe("kill_failing_agent");
    expect(draft.proposed_actions[0].payload).toMatchObject({ tenant_id: "t1", agent_id: "bad" });
    expect(draft.scope).toMatchObject({ fail: 9, total: 10 });
  });
});

describe("detectStaleNotifications", () => {
  it("returns nothing without a tenant", async () => {
    expect(await detectStaleNotifications({ tenantId: null })).toEqual([]);
  });

  it("returns nothing below 50 stale notifications", async () => {
    fromMock.mockImplementation(routeTables({ owner_notifications: { count: 49 } }));
    expect(await detectStaleNotifications({ tenantId: "t1" })).toEqual([]);
  });

  it("builds a cleanup draft at >=50 stale notifications", async () => {
    fromMock.mockImplementation(routeTables({ owner_notifications: { count: 73 } }));
    const [draft] = await detectStaleNotifications({ tenantId: "t1" });
    expect(draft.severity).toBe("p3");
    expect(draft.scope.count).toBe(73);
    const action = draft.proposed_actions[0];
    expect(action.kind).toBe("cleanup_expired_notifications");
    expect(action.payload.tenant_id).toBe("t1");
    expect(typeof action.payload.older_than_iso).toBe("string");
    expect(action.reversible).toBe(false);
  });
});

describe("detectOrdersStuck", () => {
  it("returns nothing without a tenant", async () => {
    expect(await detectOrdersStuck({ tenantId: null })).toEqual([]);
  });

  it("skips pilot tenants", async () => {
    fromMock.mockImplementation(routeTables({ tenants: { data: { is_pilot: true } } }));
    expect(await detectOrdersStuck({ tenantId: "pilot" })).toEqual([]);
  });

  it("returns nothing when no orders are stuck", async () => {
    fromMock.mockImplementation(
      routeTables({
        tenants: { data: { is_pilot: false } },
        orders: { data: [], count: 0 },
      }),
    );
    expect(await detectOrdersStuck({ tenantId: "t1" })).toEqual([]);
  });

  it("always PROPOSEs (high regression risk) for stuck orders", async () => {
    const orders = Array.from({ length: 12 }, (_, i) => ({ id: `o${i}`, created_at: "z" }));
    fromMock.mockImplementation(
      routeTables({
        tenants: { data: { is_pilot: false } },
        orders: { data: orders, count: 12 },
      }),
    );
    const [draft] = await detectOrdersStuck({ tenantId: "t1" });
    expect(draft.severity).toBe("p1"); // >10
    expect(draft.regression_risk).toBe("high");
    expect(draft.proposed_actions[0].kind).toBe("flag_stuck_order");
    expect((draft.scope.sample_ids as string[]).length).toBe(10); // capped at 10
    expect(draft.fingerprint).toBe("orders_stuck:t1");
  });
});
