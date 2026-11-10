-- ROLLBACK of 20261029110300_refund_proofs_bucket.sql.
-- The bucket is removed only when it holds no object; a bucket with proofs is KEPT (and left without admin policies) so no
-- evidence is lost. Empty it through the Storage API first if you really want it gone.
BEGIN;

SET LOCAL lock_timeout = '5s';

DROP POLICY IF EXISTS "Admins can delete unreferenced refund proofs" ON storage.objects;
DROP POLICY IF EXISTS "Admins can upload refund proofs" ON storage.objects;
DROP POLICY IF EXISTS "Admins can view refund proofs" ON storage.objects;
DROP INDEX IF EXISTS public.refund_requests_proof_path_idx;

DELETE FROM storage.buckets
 WHERE id = 'refund-proofs'
   AND NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'refund-proofs');

COMMIT;
