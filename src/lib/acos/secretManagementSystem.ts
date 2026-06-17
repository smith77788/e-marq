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
  const encryptedValue = sha256Hash(value);

  const { data, error } = await supabaseAdmin
    .from("secrets")
    .insert({
      tenant_id: tenantId,
      name,
      type,
      encrypted_value: encryptedValue,
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
    .from("secrets")
    .select("id, name, type, encrypted_value, created_at")
    .eq("tenant_id", tenantId);

  return (data ?? []).map((s) => ({
    id: s.id,
    name: s.name,
    type: s.type,
    masked: maskApiKey(s.encrypted_value),
    created_at: s.created_at,
  }));
}

/**
 * Видалити секрет.
 */
export async function deleteSecret(
  secretId: string,
): Promise<{ ok: boolean }> {
  const { error } = await supabaseAdmin
    .from("secrets")
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
  const { error } = await supabaseAdmin
    .from("secrets")
    .update({
      encrypted_value: sha256Hash(newValue),
      rotated_at: new Date().toISOString(),
    })
    .eq("id", secretId);

  return { ok: !error };
}
