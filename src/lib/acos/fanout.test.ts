import { afterEach, describe, expect, it, vi } from "vitest";

import { allSettledWithConcurrency, callHook, isTotalFailure } from "./fanout";

describe("allSettledWithConcurrency", () => {
  it("preserves item order in results", async () => {
    const items = [50, 10, 30, 0, 20];
    const results = await allSettledWithConcurrency(items, 2, async (ms) => {
      await new Promise((r) => setTimeout(r, ms));
      return ms * 2;
    });
    expect(results.map((r) => (r.status === "fulfilled" ? r.value : null))).toEqual([
      100, 20, 60, 0, 40,
    ]);
  });

  it("never runs more than `limit` calls at once", async () => {
    let active = 0;
    let maxActive = 0;
    await allSettledWithConcurrency(
      Array.from({ length: 20 }, (_, i) => i),
      3,
      async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((r) => setTimeout(r, 5));
        active -= 1;
      },
    );
    expect(maxActive).toBeLessThanOrEqual(3);
    expect(maxActive).toBeGreaterThan(1);
  });

  it("captures rejections without stopping other items", async () => {
    const results = await allSettledWithConcurrency([1, 2, 3], 2, async (n) => {
      if (n === 2) throw new Error("boom");
      return n;
    });
    expect(results[0]).toEqual({ status: "fulfilled", value: 1 });
    expect(results[1].status).toBe("rejected");
    expect(results[2]).toEqual({ status: "fulfilled", value: 3 });
  });

  it("handles empty input and limit larger than item count", async () => {
    expect(await allSettledWithConcurrency([], 5, async () => 1)).toEqual([]);
    const results = await allSettledWithConcurrency([1, 2], 100, async (n) => n);
    expect(results).toHaveLength(2);
  });
});

describe("callHook", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns parsed body and ok=true on 200", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ success: true, insights_created: 3 }), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const out = await callHook("https://app.example", "agents/stockout", "tok", {
      tenant_id: "t1",
    });
    expect(out.ok).toBe(true);
    expect(out.status).toBe(200);
    expect(out.body.insights_created).toBe(3);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://app.example/hooks/agents/stockout");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("returns ok=false with status on 500 and tolerates non-JSON body", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("oops", { status: 500 })));
    const out = await callHook("https://app.example", "agents/stockout", "tok", {});
    expect(out.ok).toBe(false);
    expect(out.status).toBe(500);
    expect(out.body).toEqual({});
  });

  it("never throws: network errors and timeouts become { ok: false, error }", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("socket hang up")));
    const out = await callHook("https://app.example", "agents/stockout", "tok", {});
    expect(out.ok).toBe(false);
    expect(out.status).toBe(0);
    expect(out.error).toContain("socket hang up");
  });
});

describe("isTotalFailure", () => {
  it("is false for empty outcome list (nothing to run is not an outage)", () => {
    expect(isTotalFailure([])).toBe(false);
  });

  it("is true only when every call failed", () => {
    expect(isTotalFailure([{ ok: false }, { ok: false }])).toBe(true);
    expect(isTotalFailure([{ ok: false }, { ok: true }])).toBe(false);
    expect(isTotalFailure([{ ok: true }])).toBe(false);
  });
});
