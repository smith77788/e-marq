/**
 * Cron authentication helper.
 *
 * Background: previously, all agent / engine cron endpoints accepted the
 * Supabase publishable (anon) key as a cron token. That key is shipped in
 * the client JS bundle, so anyone could trigger cross-tenant agent runs by
 * scraping it from DevTools. This helper centralises the auth check and
 * prefers a dedicated `CRON_SECRET` env var that is never sent to clients.
 *
 * Migration plan:
 *  1. Set `CRON_SECRET` in Lovable Cloud secrets (any random string).
 *  2. Update pg_cron jobs to use `CRON_SECRET` in the Authorization header.
 *  3. Once verified, set `CRON_ALLOW_ANON=false` (default `true` during
 *     transition) to block the legacy anon-key fallback.
 *
 * Until step 3, we still accept the anon key BUT only when CRON_SECRET is
 * unset, so a single secret rotation closes the hole instantly.
 */

const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);

function envBool(name: string, defaultValue: boolean): boolean {
  const raw = process.env[name];
  if (raw == null) return defaultValue;
  return TRUE_VALUES.has(raw.trim().toLowerCase());
}

/**
 * Return true if the bearer token is a valid cron credential.
 *
 * Order:
 *  - If CRON_SECRET is configured → token MUST equal it. The anon-key path
 *    is fully disabled (closes the bundle-leak vector).
 *  - If CRON_SECRET is NOT configured AND CRON_ALLOW_ANON is not "false":
 *    fall back to the legacy anon-key match so existing pg_cron jobs keep
 *    running until the operator rotates them.
 *  - Otherwise → reject.
 */
export function isCronToken(token: string | undefined | null): boolean {
  if (!token) return false;
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && cronSecret.length >= 16) {
    return token === cronSecret;
  }
  // Anon-key fallback is disabled by default (CRON_SECRET must be set).
  // Set CRON_ALLOW_ANON=true only during migration to the new secret.
  const allowAnon = envBool("CRON_ALLOW_ANON", false);
  if (!allowAnon) return false;
  const anon = process.env.SUPABASE_PUBLISHABLE_KEY;
  return !!anon && token === anon;
}

/**
 * For places that emit cron headers internally (e.g. cron-all → cron-chunk
 * fan-out). Prefer the new secret if configured.
 */
export function getInternalCronToken(): string {
  return process.env.CRON_SECRET ?? process.env.SUPABASE_PUBLISHABLE_KEY ?? "";
}
