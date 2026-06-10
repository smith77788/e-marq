import { afterEach, describe, expect, it, vi } from "vitest";
import { queuePostImportAgents, resolveAppOrigin, triggerPostImportAgents } from "./postImport";

describe("resolveAppOrigin", () => {
  const env = { ...process.env };

  afterEach(() => {
    process.env = { ...env };
  });

  it("prefers configured app origin and trims trailing slash", () => {
    process.env.APP_BASE_URL = "https://admin.example.com/";
    expect(resolveAppOrigin("https://request.example.com")).toBe("https://admin.example.com");
  });

  it("falls back to request origin when env vars are absent", () => {
    delete process.env.APP_BASE_URL;
    delete process.env.PUBLIC_APP_URL;
    delete process.env.VITE_PUBLIC_APP_URL;
    expect(resolveAppOrigin("https://request.example.com/")).toBe("https://request.example.com");
  });
});

describe("triggerPostImportAgents", () => {
  const env = { ...process.env };

  afterEach(() => {
    process.env = { ...env };
  });

  it("calls both follow-up agents with cron auth", async () => {
    process.env.CRON_SECRET = "1234567890abcdef";
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200 });

    await triggerPostImportAgents({
      tenantId: "tenant-1",
      requestOrigin: "https://request.example.com",
      fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      "https://request.example.com/hooks/agents/integration-scout",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer 1234567890abcdef",
        }),
        body: JSON.stringify({ tenant_id: "tenant-1" }),
      }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      "https://request.example.com/hooks/agents/data-gap-auditor",
      expect.any(Object),
    );
  });

  it("returns early when no internal cron token exists", async () => {
    delete process.env.CRON_SECRET;
    delete process.env.SUPABASE_PUBLISHABLE_KEY;
    const fetchImpl = vi.fn();

    await triggerPostImportAgents({
      tenantId: "tenant-1",
      requestOrigin: "https://request.example.com",
      fetchImpl,
    });

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("queue helper swallows downstream failures", async () => {
    process.env.CRON_SECRET = "1234567890abcdef";
    const fetchImpl = vi.fn().mockRejectedValue(new Error("boom"));

    expect(() =>
      queuePostImportAgents({
        tenantId: "tenant-1",
        requestOrigin: "https://request.example.com",
        fetchImpl,
      }),
    ).not.toThrow();

    await Promise.resolve();
  });
});
