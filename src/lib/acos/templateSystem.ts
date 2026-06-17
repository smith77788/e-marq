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
    .from("bootstrap_facts")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("fact_kind", "template")
    .order("created_at", { ascending: false });

  const { data } = await query;

  return (data ?? [])
    .map((row) => {
      const v = (row.value ?? {}) as Record<string, unknown>;
      return {
        id: row.id,
        tenant_id: row.tenant_id,
        name: (v.name as string) ?? "",
        type: (v.type as string) ?? "",
        subject: v.subject as string | undefined,
        body: (v.body as string) ?? "",
        variables: (v.variables as string[]) ?? [],
        created_at: row.created_at,
      } satisfies Template;
    })
    .filter((t) => !type || t.type === type);
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
    .from("bootstrap_facts")
    .insert({
      fact_key: `template_${tenantId}_${name}`,
      fact_kind: "template",
      tenant_id: tenantId,
      confidence: 1.0,
      source: "template_system",
      value: {
        name,
        type,
        subject: options?.subject,
        body,
        variables: options?.variables ?? [],
      } as never,
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
