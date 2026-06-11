import { beforeEach, describe, expect, it, vi } from "vitest";

const fromMock = vi.hoisted(() => vi.fn());
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: fromMock },
}));

import { applyAction, revertAction } from "./actions";
import { routeTables, type Call } from "./supabaseTestMock";

let calls: Call[];
beforeEach(() => {
  fromMock.mockReset();
  calls = [];
});

function find(table: string, method: string) {
  return calls.find((c) => c.table === table && c.method === method);
}

describe("applyAction", () => {
  it("reschedule_outreach: no ids → noop success", async () => {
    fromMock.mockImplementation(routeTables({}, calls));
    const res = await applyAction("reschedule_outreach", { action_ids: [] });
    expect(res).toEqual({ ok: true, message: "no ids", affected: 0 });
    expect(find("outreach_actions", "update")).toBeUndefined();
  });

  it("reschedule_outreach: reschedules to pending_review", async () => {
    fromMock.mockImplementation(routeTables({ outreach_actions: { error: null } }, calls));
    const res = await applyAction("reschedule_outreach", { action_ids: ["a1", "a2"] });
    expect(res.ok).toBe(true);
    expect(res.affected).toBe(2);
    const upd = find("outreach_actions", "update");
    expect((upd?.args[0] as Record<string, unknown>).status).toBe("pending_review");
    expect(typeof (upd?.args[0] as Record<string, unknown>).scheduled_for).toBe("string");
  });

  it("reschedule_outreach: surfaces supabase errors", async () => {
    fromMock.mockImplementation(
      routeTables({ outreach_actions: { error: { message: "db down" } } }, calls),
    );
    const res = await applyAction("reschedule_outreach", { action_ids: ["a1"] });
    expect(res).toEqual({ ok: false, message: "db down", affected: 0 });
  });

  it("reset_stuck_agent_run: marks runs failed", async () => {
    fromMock.mockImplementation(routeTables({ acos_agent_runs: { error: null } }, calls));
    const res = await applyAction("reset_stuck_agent_run", { run_ids: ["r1", "r2", "r3"] });
    expect(res.affected).toBe(3);
    expect((find("acos_agent_runs", "update")?.args[0] as Record<string, unknown>).status).toBe(
      "failed",
    );
  });

  it("kill_failing_agent: requires both ids", async () => {
    fromMock.mockImplementation(routeTables({}, calls));
    const res = await applyAction("kill_failing_agent", { tenant_id: "t1" });
    expect(res.ok).toBe(false);
    expect(find("agent_permissions", "upsert")).toBeUndefined();
  });

  it("kill_failing_agent: upserts mode=off", async () => {
    fromMock.mockImplementation(routeTables({ agent_permissions: { error: null } }, calls));
    const res = await applyAction("kill_failing_agent", { tenant_id: "t1", agent_id: "seo" });
    expect(res).toEqual({ ok: true, message: "Killed agent seo", affected: 1 });
    expect((find("agent_permissions", "upsert")?.args[0] as Record<string, unknown>).mode).toBe(
      "off",
    );
  });

  it("cleanup_expired_notifications: deletes and reports count", async () => {
    fromMock.mockImplementation(
      routeTables({ owner_notifications: { error: null, count: 42 } }, calls),
    );
    const res = await applyAction("cleanup_expired_notifications", {
      tenant_id: "t1",
      older_than_iso: "2026-01-01T00:00:00Z",
    });
    expect(res.affected).toBe(42);
    expect(find("owner_notifications", "delete")).toBeDefined();
  });

  it("pause_unhealthy_channel: disables posting setting", async () => {
    fromMock.mockImplementation(routeTables({ outreach_settings: { error: null } }, calls));
    const res = await applyAction("pause_unhealthy_channel", { tenant_id: "t1", channel: "telegram" });
    expect(res.ok).toBe(true);
    const upserted = find("outreach_settings", "upsert")?.args[0] as Record<string, unknown>;
    expect(upserted.key).toBe("telegram_posting_enabled");
    expect(upserted.value).toBe(false);
  });

  it("manual kinds are no-ops", async () => {
    fromMock.mockImplementation(routeTables({}, calls));
    for (const kind of ["flag_stuck_order", "notify_balance_low", "rerun_dntrade_sync"] as const) {
      const res = await applyAction(kind, {});
      expect(res).toEqual({ ok: true, message: "noop (manual action)", affected: 0 });
    }
    expect(calls).toHaveLength(0);
  });

  it("unknown kind fails", async () => {
    fromMock.mockImplementation(routeTables({}, calls));
    const res = await applyAction("nonsense" as never, {});
    expect(res.ok).toBe(false);
  });
});

describe("revertAction", () => {
  it("reschedule_outreach: restores the given status", async () => {
    fromMock.mockImplementation(routeTables({ outreach_actions: { error: null } }, calls));
    const res = await revertAction("reschedule_outreach", {
      action_ids: ["a1"],
      restore_status: "failed",
    });
    expect(res.affected).toBe(1);
    expect((find("outreach_actions", "update")?.args[0] as Record<string, unknown>).status).toBe(
      "failed",
    );
  });

  it("kill_failing_agent: re-enables mode=auto", async () => {
    fromMock.mockImplementation(routeTables({ agent_permissions: { error: null } }, calls));
    const res = await revertAction("kill_failing_agent", { tenant_id: "t1", agent_id: "seo" });
    expect(res.ok).toBe(true);
    expect((find("agent_permissions", "upsert")?.args[0] as Record<string, unknown>).mode).toBe(
      "auto",
    );
  });

  it("pause_unhealthy_channel: re-enables posting", async () => {
    fromMock.mockImplementation(routeTables({ outreach_settings: { error: null } }, calls));
    const res = await revertAction("pause_unhealthy_channel", { tenant_id: "t1", channel: "tg" });
    expect(res.ok).toBe(true);
    expect((find("outreach_settings", "upsert")?.args[0] as Record<string, unknown>).value).toBe(
      true,
    );
  });

  it("non-reversible kinds report not reversible", async () => {
    fromMock.mockImplementation(routeTables({}, calls));
    const res = await revertAction("reset_stuck_agent_run", {});
    expect(res).toEqual({ ok: false, message: "not reversible", affected: 0 });
  });
});
