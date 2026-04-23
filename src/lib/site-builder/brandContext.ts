/**
 * Brand context loader & validator for the Site Builder (Sprint 11.5).
 *
 * Pure server-side helpers — uses `supabaseAdmin` to read brand profile + tenant
 * config without RLS. We only return public-safe fields (no payment private
 * keys, no secrets) to be embedded in generated archives.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type SafeBrandContext = {
  template: {
    id: string;
    key: string;
    name: string;
    source_project_id: string | null;
    source_commit: string | null;
  };
  tenant: {
    id: string;
    name: string;
    slug: string;
  };
  profile: {
    brand_name: string;
    tagline: string | null;
    description: string | null;
    logo_url: string | null;
    favicon_url: string | null;
    og_image_url: string | null;
    primary_color: string;
    accent_color: string;
    font_family: string;
    contact_email: string | null;
    contact_phone: string | null;
    social_links: Record<string, unknown>;
    custom_domain: string | null;
    locale: string;
    currency: string;
    legal_entity: string | null;
    address: string | null;
    hero_copy: string | null;
    about_copy: string | null;
    legal_pages: Record<string, unknown>;
    niche_profile: Record<string, unknown>;
  };
};

export type ValidationError = { field: string; message: string };

export async function loadSafeBrandContext(
  tenantId: string,
  templateId: string,
): Promise<SafeBrandContext | null> {
  const { data: template, error: tErr } = await supabaseAdmin
    .from("site_templates")
    .select("id, template_key, name, source_project_id, source_commit, is_active")
    .eq("id", templateId)
    .maybeSingle();
  if (tErr || !template || !template.is_active) return null;

  const { data: tenant, error: tnErr } = await supabaseAdmin
    .from("tenants")
    .select("id, name, slug")
    .eq("id", tenantId)
    .maybeSingle();
  if (tnErr || !tenant) return null;

  const { data: profile, error: pErr } = await supabaseAdmin
    .from("site_brand_profiles")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("template_id", templateId)
    .maybeSingle();
  if (pErr || !profile) return null;

  return {
    template: {
      id: template.id,
      key: template.template_key,
      name: template.name,
      source_project_id: template.source_project_id ?? null,
      source_commit: template.source_commit ?? null,
    },
    tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug },
    profile: {
      brand_name: profile.brand_name,
      tagline: profile.tagline,
      description: profile.description,
      logo_url: profile.logo_url,
      favicon_url: profile.favicon_url,
      og_image_url: profile.og_image_url,
      primary_color: profile.primary_color,
      accent_color: profile.accent_color,
      font_family: profile.font_family,
      contact_email: profile.contact_email,
      contact_phone: profile.contact_phone,
      social_links: (profile.social_links ?? {}) as Record<string, unknown>,
      custom_domain: profile.custom_domain,
      locale: profile.locale,
      currency: profile.currency,
      legal_entity: profile.legal_entity,
      address: profile.address,
      hero_copy: profile.hero_copy,
      about_copy: profile.about_copy,
      legal_pages: (profile.legal_pages ?? {}) as Record<string, unknown>,
      niche_profile: ((profile as { niche_profile?: unknown }).niche_profile ?? {}) as Record<
        string,
        unknown
      >,
    },
  };
}

export function validateBrandContext(ctx: SafeBrandContext): ValidationError[] {
  const errors: ValidationError[] = [];
  if (!ctx.profile.brand_name.trim()) {
    errors.push({ field: "brand_name", message: "Brand name is required" });
  }
  if (
    !ctx.profile.primary_color.startsWith("oklch") &&
    !ctx.profile.primary_color.startsWith("#")
  ) {
    errors.push({
      field: "primary_color",
      message: "Primary color must be oklch(...) or #hex",
    });
  }
  if (!ctx.profile.contact_email) {
    errors.push({ field: "contact_email", message: "Contact email is required" });
  } else if (!/^\S+@\S+\.\S+$/.test(ctx.profile.contact_email)) {
    errors.push({ field: "contact_email", message: "Invalid email format" });
  }
  if (!ctx.profile.locale) {
    errors.push({ field: "locale", message: "Locale is required" });
  }
  return errors;
}

/**
 * Slugify the brand name for use in archive filenames / folder names.
 * Lowercased, ASCII-only, dashes between words.
 */
export function slugifyBrand(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "brand-site"
  );
}
