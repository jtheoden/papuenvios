-- ============================================================================
-- F-1b: Scope the generic storage.objects owner UPDATE/DELETE policies
-- ============================================================================
-- Problem
--   "Users Can Update/Delete Their Own Files 16wiy3a_0" apply to EVERY bucket
--   (USING auth.uid() = owner, no bucket_id). Any authenticated user could
--   therefore overwrite or delete their own uploads in buckets where that must
--   not be possible, e.g. the public order-documents bucket (payment proofs
--   are uploaded there, and deleting/replacing the file after the admin has
--   validated the payment destroys the audit evidence).
--
-- Evidence for the allowed buckets (frontend usage of UPDATE/DELETE semantics)
--   product-images
--     src/lib/storage.js: deleteProductImage -> .remove() (~L67) and
--     uploadProductImage -> .upload(..., { upsert: true }) (~L41), which needs
--     UPDATE when the object already exists. Used by ProductsPage.jsx.
--   remittance-delivery-proofs
--     src/components/AdminRemittancesTab.jsx (~L436-438): .upload(..., { upsert: true })
--     by the admin that originally uploaded the file; no other policy grants
--     UPDATE on this bucket.
--
-- Buckets that LOSE the generic owner UPDATE/DELETE (all covered elsewhere or
-- never updated/deleted by the frontend)
--   order-documents        upload only (orderService.js ~L1572, upsert: false)
--   order-payments         no frontend usage of update/delete
--   order-deliveries       no frontend usage of update/delete
--   remittance-deliveries  no frontend usage of update/delete
--   order-delivery-proofs  upload only (upsert: false); own folder-scoped DELETE policy exists
--   remittance-proofs      own folder-scoped UPDATE/DELETE policies exist
--   publications           admin-only UPDATE/DELETE policies exist
--
-- Not changed here (out of scope): "Authenticated Users Can Upload 16wiy3a_0"
-- still lets any authenticated user INSERT into product-images.
--
-- ROLLBACK (restores the original unscoped policies; run in this order)
-- DROP POLICY IF EXISTS "Owners can update own files in scoped buckets" ON storage.objects;
-- DROP POLICY IF EXISTS "Owners can delete own files in scoped buckets" ON storage.objects;
-- CREATE POLICY "Users Can Update Their Own Files 16wiy3a_0" ON storage.objects
--   FOR UPDATE TO authenticated USING (auth.uid() = owner);
-- CREATE POLICY "Users Can Delete Their Own Files 16wiy3a_0" ON storage.objects
--   FOR DELETE TO authenticated USING (auth.uid() = owner);
-- ============================================================================

DROP POLICY IF EXISTS "Users Can Update Their Own Files 16wiy3a_0" ON storage.objects;
DROP POLICY IF EXISTS "Users Can Delete Their Own Files 16wiy3a_0" ON storage.objects;

DROP POLICY IF EXISTS "Owners can update own files in scoped buckets" ON storage.objects;
CREATE POLICY "Owners can update own files in scoped buckets" ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id IN ('product-images', 'remittance-delivery-proofs')
    AND auth.uid() = owner
  )
  WITH CHECK (
    bucket_id IN ('product-images', 'remittance-delivery-proofs')
    AND auth.uid() = owner
  );

DROP POLICY IF EXISTS "Owners can delete own files in scoped buckets" ON storage.objects;
CREATE POLICY "Owners can delete own files in scoped buckets" ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id IN ('product-images', 'remittance-delivery-proofs')
    AND auth.uid() = owner
  );
