import { beforeEach, describe, expect, it, vi } from "vitest";

const fromMock = vi.hoisted(() => vi.fn());
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: fromMock },
}));

import { FANOUT_TENANT_STATUSES, loadFanoutTenantIds } from "./fanoutTenants";
import { routeTables, type Call } from "../self-heal/supabaseTestMock";

beforeEach(() => fromMock.mockReset());

describe("FANOUT_TENANT_STATUSES", () => {
  it("includes both active and pending (pending tenants are live)", () => {
    expect([...FANOUT_TENANT_STATUSES]).toEqual(["active", "pending"]);
  });
});

describe("loadFanoutTenantIds", () => {
  it("queries tenants by active+pending status and maps to ids", async () => {
    const calls: Call[] = [];
    fromMock.mockImplementation(
      routeTables({ tenants: { data: [{ id: "t1" }, { id: "t2" }] } }, calls),
    );

    const ids = await loadFanoutTenantIds();
    expect(ids).toEqual(["t1", "t2"]);

    const statusFilter = calls.find((c) => c.method === "in");
    expect(statusFilter?.args[0]).toBe("status");
    expect(statusFilter?.args[1]).toEqual(["active", "pending"]);
    // never narrows to active-only (the bug this guards against)
    expect(calls.some((c) => c.method === "eq")).toBe(false);
  });

  it("returns [] when the query yields no rows", async () => {
    fromMock.mockImplementation(routeTables({ tenants: { data: null } }));
    expect(await loadFanoutTenantIds()).toEqual([]);
  });

  it("passes the limit through", async () => {
    const calls: Call[] = [];
    fromMock.mockImplementation(routeTables({ tenants: { data: [] } }, calls));
    await loadFanoutTenantIds(25);
    expect(calls.find((c) => c.method === "limit")?.args[0]).toBe(25);
  });
});
