-- ============================================================================
-- RB-02 (2/2): read-only report of orphan refund proofs.   PREPARED, NOT APPLIED
-- ============================================================================
-- WHY:      An admin can upload a proof to the private bucket `refund-proofs` and never complete the resolution (browser closed,
--           RPC rejected). Those objects stay in storage.objects with no refund_requests.proof_path pointing at them. Nothing
--           reports them yet (20261029110300 notes the cleanup job as not built).
-- WHAT:     public.admin_refund_proof_orphans() -> (object_name, created_at, size_bytes): objects of bucket 'refund-proofs' whose
--           name is not any refund_requests.proof_path. SECURITY DEFINER (reads storage.objects), pinned search_path, super_admin
--           only (42501 otherwise), EXECUTE for authenticated only. STABLE pure SELECT: it deletes nothing and never calls the
--           Storage API. A proof uploaded minutes ago for a resolution still in progress also shows up: judge by created_at.
--           size_bytes comes from storage.objects.metadata->>'size' (NULL when absent).
-- ROLLBACK: supabase/rollbacks/20261103140100_admin_refund_proof_orphans_down.sql (DROP FUNCTION).
-- DATA:     none. No row is written, updated or deleted; no object is removed.
-- ============================================================================

BEGIN;

SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.admin_refund_proof_orphans()
RETURNS TABLE (object_name text, created_at timestamptz, size_bytes bigint)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'insufficient_privilege: only a super administrator can read this' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT o.name,
         o.created_at,
         CASE WHEN o.metadata ->> 'size' ~ '^[0-9]{1,18}$' THEN (o.metadata ->> 'size')::bigint END
    FROM storage.objects o
   WHERE o.bucket_id = 'refund-proofs'
     AND NOT EXISTS (SELECT 1 FROM public.refund_requests r WHERE r.proof_path = o.name)
   ORDER BY o.created_at, o.name;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_refund_proof_orphans() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_refund_proof_orphans() TO authenticated;

COMMIT;
