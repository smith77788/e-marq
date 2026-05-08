import { supabase } from "@/integrations/supabase/client";

/**
 * Resilient session fetch — Supabase's getSession() occasionally returns
 * `null` while the JWT is being refreshed in the background, even when the
 * user is fully logged in. Retry briefly and try refreshSession() before
 * surrendering — this prevents spurious "Сесія ще відновлюється" errors
 * during onboarding.
 */
export async function ensureAuthenticatedSession() {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data, error } = await supabase.auth.getSession();
    if (!error && data.session?.access_token) {
      const { data: userData } = await supabase.auth.getUser();
      if (userData.user) {
        return { user: userData.user, session: data.session };
      }
    }
    if (attempt === 1) {
      try {
        await supabase.auth.refreshSession();
      } catch {
        /* ignore */
      }
    }
    await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
  }

  const { data: finalSession } = await supabase.auth.getSession();
  if (finalSession.session?.access_token) {
    const { data: userData } = await supabase.auth.getUser();
    if (userData.user) {
      return { user: userData.user, session: finalSession.session };
    }
  }
  throw new Error("Сесія не активна. Оновіть сторінку, увійдіть ще раз і повторіть дію.");
}

export async function authHeaders(): Promise<Record<string, string>> {
  const { session } = await ensureAuthenticatedSession();
  return { Authorization: `Bearer ${session.access_token}` };
}
