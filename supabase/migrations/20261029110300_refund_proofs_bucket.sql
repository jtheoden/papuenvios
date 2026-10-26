-- ============================================================================
-- Refund proofs (R5b 1/3): private bucket `refund-proofs`.   PREPARED, NOT APPLIED
-- ============================================================================
-- Admin-only evidence of the refund (usually a Zelle screenshot, so it may contain the customer's personal data):
--   * bucket private, 5 MB, jpeg / png / webp / pdf. Path: refunds/{refund_id}/{uuid}.{ext}.
--   * storage.objects policies, scoped to this bucket only (nothing is dropped or altered for other buckets):
--       SELECT and INSERT: enabled admins, path matching the pattern, and the folder must be an existing refund request;
--       DELETE: enabled admins, only for objects NOT referenced by refund_requests.proof_path (cleanup of uploads whose RPC
--       failed; a proof in use can never be deleted from the API). No UPDATE policy: objects are write-once.
--     The retention purge uses the Storage API with the service role (never SQL on storage.objects: that leaves the blob behind).
--     Uploads are accepted only for refunds still 'pending' (a resolved refund can no longer receive new files).
--     KNOWN LIMIT (phase 2): an upload whose RPC never ran and whose cleanup failed stays as an orphan; a periodic sweep
--     (objects of the bucket not referenced by proof_path, older than 24 h) is not built yet.
--   * refund_proof_required() (created in 20261029110000) is true: 'refunded' needs a proof, enforced by the refund_requests guard
--     (so by v1 and v2) and checked again in admin_resolve_refund_v2.
-- Additive: INSERT ... ON CONFLICT DO NOTHING on storage.buckets, new policies, new function.
-- ROLLBACK: supabase/rollbacks/20261029110300_refund_proofs_bucket_down.sql
-- ============================================================================

BEGIN;

SET LOCAL lock_timeout = '5s';

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('refund-proofs', 'refund-proofs', false, 5242880, ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
ON CONFLICT (id) DO NOTHING;

-- Used by the DELETE policy below (the "is this object referenced?" lookup).
CREATE INDEX IF NOT EXISTS refund_requests_proof_path_idx ON public.refund_requests (proof_path) WHERE proof_path IS NOT NULL;

-- The folder id is compared as TEXT (no cast), so a malformed name can never raise inside a policy.
DROP POLICY IF EXISTS "Admins can view refund proofs" ON storage.objects;
CREATE POLICY "Admins can view refund proofs" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'refund-proofs'
    AND (SELECT public.is_admin_user())
    AND name ~ '^refunds/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|webp|pdf)$'
  );

DROP POLICY IF EXISTS "Admins can upload refund proofs" ON storage.objects;
CREATE POLICY "Admins can upload refund proofs" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'refund-proofs'
    AND (SELECT public.is_admin_user())
    AND name ~ '^refunds/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|webp|pdf)$'
    AND EXISTS (SELECT 1 FROM public.refund_requests r WHERE r.id::text = split_part(name, '/', 2) AND r.status = 'pending')
  );

DROP POLICY IF EXISTS "Admins can delete unreferenced refund proofs" ON storage.objects;
CREATE POLICY "Admins can delete unreferenced refund proofs" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'refund-proofs'
    AND (SELECT public.is_admin_user())
    AND NOT EXISTS (SELECT 1 FROM public.refund_requests r WHERE r.proof_path = objects.name)
  );

COMMIT;
