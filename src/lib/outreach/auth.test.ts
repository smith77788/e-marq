/**
 * Regression tests for outreach/lead auth — ensure cron path uses isCronToken
 * (not direct anon-key compare). Bug 2026-05-05: after CRON_SECRET rollout,
 * outreach hooks returned 401 because they bypassed isCronToken.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { isCronToken } from "@/lib/acos/cronAuth";

describe("cron auth — outreach/lead regression", () => {
  const originalEnv = { ...process.env };
  beforeEach(() => {
    process.env = { ...originalEnv };
  });
  afterEach(() => {
    process.env = originalEnv;
  });

  it("accepts CRON_SECRET when configured", () => {
    process.env.CRON_SECRET = "x".repeat(32);
    process.env.SUPABASE_PUBLISHABLE_KEY = "anon-key";
    expect(isCronToken("x".repeat(32))).toBe(true);
    expect(isCronToken("anon-key")).toBe(false);
  });

  it("rejects empty / missing token", () => {
    process.env.CRON_SECRET = "x".repeat(32);
    expect(isCronToken("")).toBe(false);
    expect(isCronToken(null)).toBe(false);
    expect(isCronToken(undefined)).toBe(false);
  });

  it("falls back to anon when CRON_SECRET missing and CRON_ALLOW_ANON not false", () => {
    delete process.env.CRON_SECRET;
    process.env.SUPABASE_PUBLISHABLE_KEY = "anon-key";
    delete process.env.CRON_ALLOW_ANON;
    expect(isCronToken("anon-key")).toBe(true);
  });

  it("blocks anon fallback when CRON_ALLOW_ANON=false", () => {
    delete process.env.CRON_SECRET;
    process.env.SUPABASE_PUBLISHABLE_KEY = "anon-key";
    process.env.CRON_ALLOW_ANON = "false";
    expect(isCronToken("anon-key")).toBe(false);
  });
});
