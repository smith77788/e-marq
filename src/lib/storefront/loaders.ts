/**
 * Shared storefront loaders — used by the s.$slug layout and its sub-routes.
 *
 * All RPCs are SECURITY DEFINER and only return data flagged active +
 * belonging to an active tenant. We never use the service-role client here.
 */
import { notFound } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

export type StorefrontPaymentsConfig = {
  manual_enabled?: boolean;
  stripe_enabled?: boolean;
  liqpay_enabled?: boolean;
  wayforpay_enabled?: boolean;
  monobank_enabled?: boolean;
  manual_instructions?: string;
  manual_contact?: string;
  currency?: string;
};

export type StorefrontShippingConfig = {
  nova_poshta_enabled?: boolean;
  justin_enabled?: boolean;
  meest_enabled?: boolean;
  pickup_enabled?: boolean;
  pickup_address?: string;
  free_shipping_from_cents?: number;
};

export type StorefrontConfig = {
  brand_name: string;
  ui: {
    primary?: string;
    accent?: string;
    hero_image?: string;
    hero_headline?: string;
    hero_subline?: string;
  } | null;
  seo: { title?: string; description?: string; og_image?: string } | null;
  features: {
    payments?: StorefrontPaymentsConfig;
    shipping?: StorefrontShippingConfig;
  } | null;
};

export type StorefrontTenant = {
  id: string;
  name: string;
  slug: string;
  status: string;
};

export type StorefrontProduct = {
  id: string;
  name: string;
  description: string | null;
  price_cents: number;
  compare_at_price_cents: number | null;
  currency: string;
  image_url: string | null;
  stock: number;
  has_variants: boolean;
  tags: string[];
  url_handle: string | null;
};

export type StorefrontVariant = {
  id: string;
  sku: string | null;
  option_1_name: string | null;
  option_1_value: string | null;
  option_2_name: string | null;
  option_2_value: string | null;
  option_3_name: string | null;
  option_3_value: string | null;
  price_cents: number;
  compare_at_price_cents: number | null;
  stock: number;
  image_url: string | null;
};

export type StorefrontImage = {
  id: string;
  url: string;
  alt: string | null;
  position: number;
  is_primary: boolean;
};

export type StorefrontShell = {
  tenant: StorefrontTenant;
  config: StorefrontConfig;
  products: StorefrontProduct[];
};

const FALLBACK_PRODUCT: Pick<
  StorefrontProduct,
  "compare_at_price_cents" | "has_variants" | "tags" | "url_handle"
> = {
  compare_at_price_cents: null,
  has_variants: false,
  tags: [],
  url_handle: null,
};

/**
 * Loads the storefront shell — tenant, public config, products list.
 * Tries v2 RPC first (with variants/tags), falls back to legacy v1.
 */
export async function loadStorefrontShell(slug: string): Promise<StorefrontShell> {
  const { data: cfgData, error: cfgErr } = await supabase.rpc("get_storefront_config", {
    _slug: slug,
  });
  if (cfgErr) throw cfgErr;
  if (!cfgData) throw notFound();

  const cfgPayload = cfgData as {
    tenant_id: string;
    brand_name: string;
    ui: StorefrontConfig["ui"];
    seo: StorefrontConfig["seo"];
    features: StorefrontConfig["features"];
  };

  const { data: tenant, error: tErr } = await supabase
    .from("tenants")
    .select("id, name, slug, status")
    .eq("id", cfgPayload.tenant_id)
    .eq("status", "active")
    .maybeSingle();
  if (tErr) throw tErr;
  if (!tenant) throw notFound();

  // Try v2 first (richer data: compare_at_price, tags, has_variants).
  let products: StorefrontProduct[] = [];
  const v2 = await supabase.rpc("get_storefront_products_v2", { _slug: slug });
  if (!v2.error && v2.data) {
    products = ((v2.data ?? []) as Array<Record<string, unknown>>).map((row) => {
      const p = row as {
        id: string;
        name: string;
        description?: string | null;
        price_cents: number;
        compare_at_price_cents?: number | null;
        currency: string;
        image_url?: string | null;
        stock?: number;
        has_variants?: boolean;
        tags?: string[];
        url_handle?: string | null;
      };
      return {
        id: p.id,
        name: p.name,
        description: p.description ?? null,
        price_cents: p.price_cents,
        compare_at_price_cents: p.compare_at_price_cents ?? null,
        currency: p.currency,
        image_url: p.image_url ?? null,
        stock: p.stock ?? 0,
        has_variants: p.has_variants ?? false,
        tags: p.tags ?? [],
        url_handle: p.url_handle ?? null,
      };
    });
  } else {
    // Fallback to legacy v1
    const v1 = await supabase.rpc("get_storefront_products", { _slug: slug });
    if (v1.error) throw v1.error;
    products = ((v1.data ?? []) as Array<Record<string, unknown>>).map((row) => {
      const p = row as {
        id: string;
        name: string;
        description?: string | null;
        price_cents: number;
        currency: string;
        image_url?: string | null;
        stock_available?: boolean;
      };
      return {
        id: p.id,
        name: p.name,
        description: p.description ?? null,
        price_cents: p.price_cents,
        currency: p.currency,
        image_url: p.image_url ?? null,
        stock: p.stock_available ? 9999 : 0,
        ...FALLBACK_PRODUCT,
      };
    });
  }

  const config: StorefrontConfig = {
    brand_name: cfgPayload.brand_name,
    ui: cfgPayload.ui ?? null,
    seo: cfgPayload.seo ?? null,
    features: cfgPayload.features ?? null,
  };

  return { tenant: tenant as StorefrontTenant, config, products };
}

export type ProductDetail = {
  product: StorefrontProduct & { seo_title: string | null; seo_description: string | null };
  variants: StorefrontVariant[];
  images: StorefrontImage[];
};

export async function loadProductDetail(
  slug: string,
  productId: string,
): Promise<ProductDetail> {
  const { data, error } = await supabase.rpc("get_storefront_product_detail", {
    _slug: slug,
    _product_id: productId,
  });
  if (error) throw error;
  if (!data) throw notFound();
  return data as unknown as ProductDetail;
}

export type CollectionSummary = {
  id: string;
  handle: string;
  name: string;
  description: string | null;
  image_url: string | null;
  product_count: number;
};

export async function loadCollections(slug: string): Promise<CollectionSummary[]> {
  const { data, error } = await supabase.rpc("get_storefront_collections", { _slug: slug });
  if (error) throw error;
  return (data ?? []) as CollectionSummary[];
}

export type CollectionDetail = {
  collection: {
    id: string;
    handle: string;
    name: string;
    description: string | null;
    image_url: string | null;
    seo_title: string | null;
    seo_description: string | null;
  };
  products: (StorefrontProduct & { position: number })[];
};

export async function loadCollectionProducts(
  slug: string,
  handle: string,
): Promise<CollectionDetail> {
  const { data, error } = await supabase.rpc("get_storefront_collection_products", {
    _slug: slug,
    _handle: handle,
  });
  if (error) throw error;
  if (!data) throw notFound();
  return data as unknown as CollectionDetail;
}
