/**
 * Smart Template System — централізована система шаблонів.
 *
 * Типи шаблонів:
 * 1. Email Templates — шаблони листів
 * 2. Report Templates — шаблони звітів
 * 3. Invoice Templates — шаблони рахунків
 * 4. Notification Templates — шаблони сповіщень
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type Template = {
  id: string;
  tenant_id: string;
  name: string;
  type: string;
  subject?: string;
  body: string;
  variables: string[];
  created_at: string;
};

/**
 * Отримати шаблони тенанта.
 */
export async function getTemplates(
  tenantId: string,
  type?: string,
): Promise<Template[]> {
  let query = supabaseAdmin
    .from("templates")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false });

  if (type) {
    query = query.eq("type", type);
  }

  const { data } = await query;
  return (data ?? []) as Template[];
}

/**
 * Створити шаблон.
 */
export async function createTemplate(
  tenantId: string,
  name: string,
  type: string,
  body: string,
  options?: { subject?: string; variables?: string[] },
): Promise<{ ok: boolean; id?: string }> {
  const { data, error } = await supabaseAdmin
    .from("templates")
    .insert({
      tenant_id: tenantId,
      name,
      type,
      subject: options?.subject,
      body,
      variables: options?.variables ?? [],
    })
    .select("id")
    .single();

  if (error) return { ok: false };
  return { ok: true, id: data.id };
}

/**
 * Заповнити шаблон змінними.
 */
export function renderTemplate(
  template: string,
  variables: Record<string, string>,
): string {
  let result = template;
  for (const [key, value] of Object.entries(variables)) {
    result = result.replace(new RegExp(`{{${key}}}`, "g"), value);
  }
  return result;
}
