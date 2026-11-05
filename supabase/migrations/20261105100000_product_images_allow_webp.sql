-- Allow image/webp in the public product-images bucket (egress: WebP is ~25-50% lighter than the JPEGs served today).
-- Additive and idempotent: only appends the MIME type when missing; existing objects are untouched.
-- NOT applied by the branch perf/storage-egress-images: applying it to production is a separate, explicit step.
-- After applying, flip PRODUCT_IMAGES_FORMAT to 'image/webp' in src/lib/imageStorage.js (and deploy).
--
-- Rollback (only if no .webp object was uploaded since; otherwise they keep being served, new uploads fail):
-- UPDATE storage.buckets SET allowed_mime_types = array_remove(allowed_mime_types, 'image/webp') WHERE id = 'product-images';

UPDATE storage.buckets
SET allowed_mime_types = array_append(allowed_mime_types, 'image/webp')
WHERE id = 'product-images'
  AND allowed_mime_types IS NOT NULL
  AND NOT ('image/webp' = ANY (allowed_mime_types));
