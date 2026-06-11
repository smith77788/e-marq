import { beforeEach, describe, expect, it, vi } from "vitest";

const fromMock = vi.hoisted(() => vi.fn());
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: fromMock },
}));

import { applyProposal, revertAppliedAction, runSelfHealCycle } from "./engine";
import { routeTables, type Call } from "./supabaseTestMock";

let calls: Call[];
beforeEach(() => {
  fromMock.mockReset();
  calls = [];
});

describe("runSelfHealCycle", () => {
  it("runs all detectors and creates no incidents when everything is healthy", async () => {
    fromMock.mockImplementation(
      routeTables({
        self_heal_settings: { data: [] }, // defaults: auto on, threshold p2
        outreach_actions: { data: [] },
        acos_agent_runs: { data: [] },
        owner_notifications: { count: 0 },
        tenants: { data: { is_pilot: false } },
        orders: { data: [], count: 0 },
      }),
    );

    const summary = await runSelfHealCycle("t1");

    expect(summary.detectors_run).toBe(5);
    expect(summary.incidents_created).toBe(0);
    expect(summary.actions_applied).toBe(0);
    expect(summary.errors).toEqual([]);
  });

  it("detector → incident → auto-apply for a whitelisted low-risk action", async () => {
    fromMock.mockImplementation(
      routeTables(
        {
          self_heal_settings: { data: [] },
          outreach_actions: [
            // 1st call: detector read → 3 transient failures
            {
              data: [
                { id: "a1", channel: "tg", retry_count: 0, failed_reason: "network timeout" },
                { id: "a2", channel: "tg", retry_count: 1, failed_reason: "timeout" },
                { id: "a3", channel: "email", retry_count: 0, failed_reason: null },
              ],
            },
            // 2nd call: applyAction reschedule update
            { error: null },
          ],
          acos_agent_runs: { data: [] },
          owner_notifications: { count: 0 },
          tenants: { data: { is_pilot: false } },
          orders: { data: [], count: 0 },
          // upsert(select none) → insert → markIncidentFixed update
          self_heal_incidents: [{ data: null }, { data: { id: "inc-1" } }, { error: null }],
          // persistAction insert → markActionResult update
          self_heal_actions: [{ data: { id: "act-1" } }, { error: null }],
        },
        calls,
      ),
    );

    const summary = await runSelfHealCycle("t1");

    expect(summary.detectors_run).toBe(5);
    expect(summary.incidents_created).toBe(1);
    expect(summary.incidents_updated).toBe(0);
    expect(summary.actions_applied).toBe(1);
    expect(summary.actions_proposed).toBe(0);
    expect(summary.actions_blocked).toBe(0);

    // Incident was inserted and then marked fixed.
    expect(calls.some((c) => c.table === "self_heal_incidents" && c.method === "insert")).toBe(true);
    // The outreach update (the actual heal) ran.
    expect(calls.some((c) => c.table === "outreach_actions" && c.method === "update")).toBe(true);
  });
});

describe("applyProposal", () => {
  it("fails when the action does not exist", async () => {
    fromMock.mockImplementation(routeTables({ self_heal_actions: { data: null } }, calls));
    const res = await applyProposal("missing", "user-1");
    expect(res).toEqual({ ok: false, message: "action not found", affected: 0 });
  });

  it("refuses to re-apply an already-applied action", async () => {
    fromMock.mockImplementation(
      routeTables(
        {
          self_heal_actions: {
            data: { id: "act-1", kind: "reschedule_outreach", payload_json: {}, status: "applied" },
          },
        },
        calls,
      ),
    );
    const res = await applyProposal("act-1", "user-1");
    expect(res).toEqual({ ok: false, message: "already applied", affected: 0 });
  });

  it("applies a pending proposal and marks the incident fixed", async () => {
    fromMock.mockImplementation(
      routeTables(
        {
          self_heal_actions: [
            {
              data: {
                id: "act-1",
                kind: "reschedule_outreach",
                payload_json: { action_ids: ["a1"] },
                status: "pending",
                incident_id: "inc-1",
              },
            },
            { error: null }, // status update
          ],
          outreach_actions: { error: null },
          self_heal_incidents: { error: null },
        },
        calls,
      ),
    );
    const res = await applyProposal("act-1", "user-1");
    expect(res.ok).toBe(true);
    expect(res.affected).toBe(1);
    expect(calls.some((c) => c.table === "self_heal_incidents" && c.method === "update")).toBe(true);
  });
});

describe("revertAppliedAction", () => {
  it("fails when the action does not exist", async () => {
    fromMock.mockImplementation(routeTables({ self_heal_actions: { data: null } }, calls));
    const res = await revertAppliedAction("missing", "user-1");
    expect(res).toEqual({ ok: false, message: "action not found", affected: 0 });
  });

  it("refuses to revert a non-reversible action", async () => {
    fromMock.mockImplementation(
      routeTables(
        {
          self_heal_actions: {
            data: { id: "act-1", kind: "reset_stuck_agent_run", reversible: false, status: "applied" },
          },
        },
        calls,
      ),
    );
    const res = await revertAppliedAction("act-1", "user-1");
    expect(res).toEqual({ ok: false, message: "not reversible", affected: 0 });
  });

  it("refuses to revert an action that was never applied", async () => {
    fromMock.mockImplementation(
      routeTables(
        {
          self_heal_actions: {
            data: { id: "act-1", kind: "reschedule_outreach", reversible: true, status: "pending" },
          },
        },
        calls,
      ),
    );
    const res = await revertAppliedAction("act-1", "user-1");
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/only applied/);
  });

  it("reverts an applied reversible action", async () => {
    fromMock.mockImplementation(
      routeTables(
        {
          self_heal_actions: [
            {
              data: {
                id: "act-1",
                kind: "reschedule_outreach",
                revert_payload: { action_ids: ["a1"], restore_status: "failed" },
                reversible: true,
                status: "applied",
              },
            },
            { error: null },
          ],
          outreach_actions: { error: null },
        },
        calls,
      ),
    );
    const res = await revertAppliedAction("act-1", "user-1");
    expect(res.ok).toBe(true);
    expect(calls.some((c) => c.table === "outreach_actions" && c.method === "update")).toBe(true);
  });
});
