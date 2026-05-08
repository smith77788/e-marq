import { supabase } from "@/integrations/supabase/client";

export async function ensureAuthenticatedSession() {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError || !sessionData.session?.access_token) {
    throw new Error("Сесія ще відновлюється. Зачекайте кілька секунд і повторіть дію.");
  }

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    throw new Error("Сесія не знайдена. Оновіть сторінку, увійдіть ще раз і повторіть дію.");
  }

  return { user: userData.user, session: sessionData.session };
}

export async function authHeaders(): Promise<Record<string, string>> {
  const { session } = await ensureAuthenticatedSession();
  return { Authorization: `Bearer ${session.access_token}` };
}