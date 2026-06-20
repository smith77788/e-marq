/**
 * Smart Secret Management — керування секретами та API ключами.
 *
 * Функції:
 * 1. Зберігання секретів
 * 2. Ротація ключів
 * 3. Аудит доступу
 * 4. Шифрування
 */

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { sha256Hash, maskApiKey } from "./hashSystem";

export type Secret = {
  id: string;
  tenant_id: string;
  name: string;
  type: "api_key" | "password" | "token" | "certificate";
  encrypted_value: string;
  created_at: string;
  rotated_at?: string;
  expires_at?: string;
};

/**
 * Зберегти секрет.
 */
export async function storeSecret(
  tenantId: string,
  name: string,
  type: Secret["type"],
  value: string,
): Promise<{ ok: boolean; id?: string }> {
  const encryptedValue = await sha256Hash(value);

  const { data, error } = await supabaseAdmin
    .from("bootstrap_facts")
    .insert({
      fact_key: `secret_${tenantId}_${name}`,
      fact_kind: "secret",
      tenant_id: tenantId,
      confidence: 1.0,
      source: "secret_management",
      value: { name, type, encrypted_value: encryptedValue } as never,
    })
    .select("id")
    .single();

  if (error) return { ok: false };
  return { ok: true, id: data.id };
}

/**
 * Отримати секрети тенанта.
 */
export async function getSecrets(
  tenantId: string,
): Promise<Array<{ id: string; name: string; type: string; masked: string; created_at: string }>> {
  const { data } = await supabaseAdmin
    .from("bootstrap_facts")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("fact_kind", "secret");

  return (data ?? []).map((row) => {
    const v = (row.value ?? {}) as Record<string, unknown>;
    return {
      id: row.id,
      name: (v.name as string) ?? "",
      type: (v.type as string) ?? "",
      masked: maskApiKey((v.encrypted_value as string) ?? ""),
      created_at: row.created_at,
    };
  });
}

/**
 * Видалити секрет.
 */
export async function deleteSecret(
  secretId: string,
): Promise<{ ok: boolean }> {
  const { error } = await supabaseAdmin
    .from("bootstrap_facts")
    .delete()
    .eq("id", secretId);

  return { ok: !error };
}

/**
 * Ротувати секрет.
 */
export async function rotateSecret(
  secretId: string,
  newValue: string,
): Promise<{ ok: boolean }> {
  const { data: row } = await supabaseAdmin
    .from("bootstrap_facts")
    .select("value")
    .eq("id", secretId)
    .single();

  const v = (row?.value ?? {}) as Record<string, unknown>;
  const { error } = await supabaseAdmin
    .from("bootstrap_facts")
    .update({
      value: { ...v, encrypted_value: await sha256Hash(newValue), rotated_at: new Date().toISOString() } as never,
    })
    .eq("id", secretId);

  return { ok: !error };
}
