-- ============================================================================
-- OLA 2a: private order payment proofs (bucket `order-documents`)
-- ============================================================================
-- STATUS: PREPARED, NOT APPLIED. Applying to the remote project is a separate
-- action that needs the owner's explicit approval.
--
-- WHY
--   Bucket `order-documents` is public and policy "Anyone can view payment proofs"
--   (SELECT to public) lets anyone holding the anon key list and download every
--   customer payment proof (objects `payment-proofs/payment-proof-<orderId>-<ts>.<ext>`).
--   Verified read-only in production: 120 objects, all matching that naming, no
--   file_size_limit, no allowed_mime_types, no UPDATE/DELETE policy for the bucket.
--
-- WHAT
--   (a) bucket -> private, 5 MB, image/jpeg + image/png + image/webp (same limit as
--       `remittance-proofs`; CartPage only ever allowed JPG/PNG/WebP). Upsert so the
--       migration is idempotent and also works where the bucket does not exist yet.
--   (b) DROP "Anyone can view payment proofs".
--   (c) SELECT for authenticated: the order owner reads THEIR proof, admins read all,
--       anonymous reads nothing. The owner is derived from the orderId embedded in the
--       object name, NOT from orders.payment_proof_url (the owner can write that column,
--       see 20261014160000_orders_owner_guards.sql, and could point it at someone else's file).
--   (d) INSERT narrowed: "Users can upload payment proofs" let ANY authenticated user write
--       anywhere under payment-proofs/. Replaced by an owner-of-the-order check on the name.
--   No UPDATE/DELETE policy exists for this bucket (generic ones were scoped away in
--   20261014160100), so overwrite/delete stays denied. Nothing to change there.
--
-- The 120 existing objects are NOT moved or rewritten. orders.payment_proof_url keeps the
-- legacy public URLs; the frontend (src/lib/paymentProofUrl.js) converts them to a storage
-- path and signs it (createSignedUrl, 300 s). New rows store the raw path.
--
-- DEPLOY ORDER
--   1. Merge and deploy the frontend (works with the bucket public AND private).
--   2. Verify in preview/production that an admin sees a proof through a signed URL.
--   3. Apply this migration (separate approval).
--   4. Verify (SELECTs below + manual check): anon cannot list/read, owner reads own and not
--      another's, admin reads all.
--
-- EFFECTS TO ACCEPT
--   Public links already sent outside the app (emails, WhatsApp, activity_logs metadata)
--   stop opening. A browser tab running the old frontend shows a broken image until reload.
--
-- ROLLBACK (exact; run in this order)
--   BEGIN;
--   UPDATE storage.buckets SET public = true, file_size_limit = NULL, allowed_mime_types = NULL
--    WHERE id = 'order-documents';
--   DROP POLICY IF EXISTS "Owners and admins can view order payment proofs" ON storage.objects;
--   DROP POLICY IF EXISTS "Owners can upload order payment proofs" ON storage.objects;
--   CREATE POLICY "Anyone can view payment proofs" ON storage.objects
--     FOR SELECT TO public USING (bucket_id = 'order-documents');
--   CREATE POLICY "Users can upload payment proofs" ON storage.objects
--     FOR INSERT TO authenticated
--     WITH CHECK (bucket_id = 'order-documents' AND (storage.foldername(name))[1] = 'payment-proofs');
--   COMMIT;
--
-- PRODUCTION CHECKS (read-only SELECTs)
--   SELECT id, public, file_size_limit, allowed_mime_types FROM storage.buckets WHERE id = 'order-documents';
--   SELECT policyname, cmd, roles, qual, with_check FROM pg_policies
--    WHERE schemaname = 'storage' AND tablename = 'objects'
--      AND (qual ILIKE '%order-documents%' OR with_check ILIKE '%order-documents%');
--   SELECT count(*) AS total,
--          count(*) FILTER (WHERE name ~ '^payment-proofs/payment-proof-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[0-9]+\.[A-Za-z0-9]+$') AS matching
--     FROM storage.objects WHERE bucket_id = 'order-documents';   -- total = matching expected
-- ============================================================================

BEGIN;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'order-documents', 'order-documents', false, 5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE
  SET public = false,
      file_size_limit = 5242880,
      allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp'];

DROP POLICY IF EXISTS "Anyone can view payment proofs" ON storage.objects;
DROP POLICY IF EXISTS "Users can upload payment proofs" ON storage.objects;

-- The order id is compared as TEXT (no cast), so a malformed name can never raise inside a policy.
DROP POLICY IF EXISTS "Owners and admins can view order payment proofs" ON storage.objects;
CREATE POLICY "Owners and admins can view order payment proofs" ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'order-documents'
    AND (
      (SELECT public.is_admin_user())
      OR EXISTS (
        SELECT 1 FROM public.orders o
        WHERE o.user_id = (SELECT auth.uid())
          AND o.id::text = substring(
            objects.name from '^payment-proofs/payment-proof-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-[0-9]+\.[A-Za-z0-9]+$'
          )
      )
    )
  );

DROP POLICY IF EXISTS "Owners can upload order payment proofs" ON storage.objects;
CREATE POLICY "Owners can upload order payment proofs" ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'order-documents'
    AND EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.user_id = (SELECT auth.uid())
        AND o.id::text = substring(
          objects.name from '^payment-proofs/payment-proof-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-[0-9]+\.[A-Za-z0-9]+$'
        )
    )
  );

COMMIT;
