import { describe, it, expect } from "vitest";
import { jsonError, jsonOk, readTenantId } from "./agentRuntime";

describe("jsonError / jsonOk", () => {
  it("jsonError returns proper status + JSON body", async () => {
    const r = jsonError("nope", 403, { code: "x" });
    expect(r.status).toBe(403);
    expect(r.headers.get("Content-Type")).toBe("application/json");
    const body = await r.json();
    expect(body).toEqual({ error: "nope", code: "x" });
  });

  it("jsonOk returns 200 + success:true", async () => {
    const r = jsonOk({ count: 3 });
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body).toEqual({ success: true, count: 3 });
  });
});

describe("readTenantId", () => {
  const mk = (body: unknown) =>
    new Request("https://x.test", { method: "POST", body: JSON.stringify(body) });

  it("reads tenant_id when present and string", async () => {
    expect(await readTenantId(mk({ tenant_id: "abc" }))).toBe("abc");
  });
  it("returns null when missing", async () => {
    expect(await readTenantId(mk({}))).toBeNull();
  });
  it("returns null when wrong type", async () => {
    expect(await readTenantId(mk({ tenant_id: 123 }))).toBeNull();
  });
  it("returns null on invalid JSON", async () => {
    const req = new Request("https://x.test", { method: "POST", body: "not-json" });
    expect(await readTenantId(req)).toBeNull();
  });
});
