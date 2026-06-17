import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { isCronToken } from "./cronAuth";

describe("isCronToken", () => {
  const originalEnv = { ...process.env };
  beforeEach(() => {
    delete process.env.CRON_SECRET;
    delete process.env.CRON_ALLOW_ANON;
    delete process.env.SUPABASE_PUBLISHABLE_KEY;
  });
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("rejects empty/null token", () => {
    expect(isCronToken("")).toBe(false);
    expect(isCronToken(null)).toBe(false);
    expect(isCronToken(undefined)).toBe(false);
  });

  it("when CRON_SECRET set: only accepts that secret, anon-fallback closed", () => {
    process.env.CRON_SECRET = "super-secret-min-16chars";
    process.env.SUPABASE_PUBLISHABLE_KEY = "anon-key-xyz";
    expect(isCronToken("super-secret-min-16chars")).toBe(true);
    expect(isCronToken("anon-key-xyz")).toBe(false);
    expect(isCronToken("wrong")).toBe(false);
  });

  it("ignores too-short CRON_SECRET (<16 chars), rejects all by default", () => {
    process.env.CRON_SECRET = "tooshort";
    process.env.SUPABASE_PUBLISHABLE_KEY = "anon-key";
    // anon fallback is disabled by default (CRON_ALLOW_ANON defaults false)
    expect(isCronToken("anon-key")).toBe(false);
    expect(isCronToken("tooshort")).toBe(false);
  });

  it("ignores too-short CRON_SECRET, accepts anon when CRON_ALLOW_ANON=true", () => {
    process.env.CRON_SECRET = "tooshort";
    process.env.CRON_ALLOW_ANON = "true";
    process.env.SUPABASE_PUBLISHABLE_KEY = "anon-key";
    expect(isCronToken("anon-key")).toBe(true);
    expect(isCronToken("tooshort")).toBe(false);
  });

  it("when CRON_ALLOW_ANON=false and no CRON_SECRET: rejects all", () => {
    process.env.CRON_ALLOW_ANON = "false";
    process.env.SUPABASE_PUBLISHABLE_KEY = "anon-key";
    expect(isCronToken("anon-key")).toBe(false);
  });

  it("default: rejects anon key when no CRON_SECRET (CRON_ALLOW_ANON defaults false)", () => {
    process.env.SUPABASE_PUBLISHABLE_KEY = "anon-key";
    expect(isCronToken("anon-key")).toBe(false);
    expect(isCronToken("other")).toBe(false);
  });

  it("accepts anon key when CRON_ALLOW_ANON=true and no CRON_SECRET", () => {
    process.env.CRON_ALLOW_ANON = "true";
    process.env.SUPABASE_PUBLISHABLE_KEY = "anon-key";
    expect(isCronToken("anon-key")).toBe(true);
    expect(isCronToken("other")).toBe(false);
  });
});
