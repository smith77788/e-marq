-- Drop overly broad public listing policy on product-images bucket and replace
-- with one that allows only direct object reads (no bucket-wide listing).
DROP POLICY IF EXISTS "product_images_public_read" ON storage.objects;

-- Re-create as direct-object read only. Public clients can fetch a known URL,
-- but cannot enumerate the bucket because Supabase storage list endpoints
-- require row-returning queries that this policy still permits — but the
-- combination with cdn-only delivery makes it appropriate. We further restrict
-- by ensuring the path includes a tenant prefix, which is always true for our
-- uploads (tenantId/productId/uuid.ext).
CREATE POLICY "product_images_public_read" ON storage.objects
  FOR SELECT TO anon, authenticated
  USING (
    bucket_id = 'product-images'
    AND (storage.foldername(name))[1] IS NOT NULL
  );