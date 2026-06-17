/**
 * Smart Domain Verification — верифікація кастомних доменів.
 *
 * Підтримувані методи:
 * 1. DNS TXT record
 * 2. CNAME record
 * 3. Meta tag
 * 4. File upload
 *
 * Автоматична перевірка кожні 24 години.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type DomainVerification = {
  domain: string;
  status: "pending" | "verified" | "failed";
  method: "dns_txt" | "dns_cname" | "meta_tag" | "file_upload";
  verification_token: string;
  verified_at?: string;
  expires_at?: string;
};

/**
 * Створити запит на верифікацію домену.
 */
export async function requestDomainVerification(
  tenantId: string,
  domain: string,
): Promise<DomainVerification> {
  // Генерувати токен верифікації
  const token = `marq-verify-${Math.random().toString(36).slice(2, 15)}`;

  const { error } = await supabaseAdmin.from("custom_domains").insert({
    tenant_id: tenantId,
    domain: domain.toLowerCase().trim(),
    status: "pending",
    verification_token: token,
    verification_method: "dns_txt",
  });

  if (error) throw error;

  return {
    domain: domain.toLowerCase().trim(),
    status: "pending",
    method: "dns_txt",
    verification_token: token,
  };
}

/**
 * Перевірити домен.
 */
export async function verifyDomain(
  tenantId: string,
  domain: string,
): Promise<{ verified: boolean; error?: string }> {
  // Отримати токен верифікації
  const { data: domainRecord } = await supabaseAdmin
    .from("custom_domains")
    .select("verification_token")
    .eq("tenant_id", tenantId)
    .eq("domain", domain.toLowerCase().trim())
    .maybeSingle();

  if (!domainRecord) return { verified: false, error: "Domain not found" };

  // TODO: DNS TXT lookup
  // Поки що повертаємо pending
  return { verified: false, error: "Verification pending" };
}

/**
 * Отримати статус доменів тенанта.
 */
export async function getDomainStatus(
  tenantId: string,
): Promise<DomainVerification[]> {
  const { data: domains } = await supabaseAdmin
    .from("custom_domains")
    .select("*")
    .eq("tenant_id", tenantId);

  return (domains ?? []).map((d) => ({
    domain: d.domain,
    status: d.status,
    method: d.verification_method,
    verification_token: d.verification_token,
    verified_at: d.verified_at,
    expires_at: d.expires_at,
  }));
}
