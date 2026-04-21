/**
 * Helpers for uploading product images to the public `product-images` bucket.
 * Path scheme: `{tenantId}/{productId}/{uuid}.{ext}` — keeps a clean scope per
 * tenant and lets us delete an entire product's media by prefix.
 */
import { supabase } from "@/integrations/supabase/client";

const BUCKET = "product-images";

function extOf(filename: string): string {
  const i = filename.lastIndexOf(".");
  return i >= 0 ? filename.slice(i + 1).toLowerCase() : "bin";
}

export async function uploadProductImage(
  tenantId: string,
  productId: string,
  file: File,
): Promise<string> {
  const path = `${tenantId}/${productId}/${crypto.randomUUID()}.${extOf(file.name)}`;
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { upsert: false, contentType: file.type || undefined });
  if (error) throw error;
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

/**
 * Given a public URL produced by `uploadProductImage`, derive the storage path
 * so we can delete the underlying object.
 */
export function pathFromPublicUrl(publicUrl: string): string | null {
  const marker = `/object/public/${BUCKET}/`;
  const i = publicUrl.indexOf(marker);
  return i >= 0 ? publicUrl.slice(i + marker.length) : null;
}

export async function deleteProductImage(publicUrl: string): Promise<void> {
  const path = pathFromPublicUrl(publicUrl);
  if (!path) return;
  await supabase.storage.from(BUCKET).remove([path]);
}
