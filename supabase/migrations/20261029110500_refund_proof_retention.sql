-- ============================================================================
-- Refund proofs (R5b 3/3): one-year retention, disputes and the "expiring soon" report.   PREPARED, NOT APPLIED
-- ============================================================================
-- A proof expires ONE YEAR after the refund (refund_requests.proof_expires_at = refunded_at + 1 year, set by
-- admin_resolve_refund_v2) and is then deleted through the STORAGE API (supabase/functions/purge-refund-proofs, not deployed).
-- Deleting storage.objects rows by SQL leaves the blob behind, so no SQL here removes a file. The database side only
-- decides WHAT is due and records the outcome:
--   _refund_proofs_due(limit)               service_role only. Proofs with proof_expires_at <= now(), not purged, no open dispute.
--   _mark_refund_proof_purged(id, actor)    service_role only. Under a row lock it RE-CHECKS everything (expired, not purged, no open
--       dispute) and then sets proof_purged_at = now(); the audit trigger writes the immutable event proof_expired (actor, time).
--       Returns false (and changes nothing) when the proof is not due: a non-expired file can never be marked, even by a direct call.
--       proof_path, proof_sha256, reference and dates are kept as the record. Idempotent: a second call returns false.
--   admin_set_refund_dispute(id, open)      enabled admins. Events dispute_opened / dispute_closed; the state is the last one; an open
--       dispute blocks the purge. The customer of the refund cannot touch it (same separation of duties as the resolution).
--   admin_refund_proofs_expiring(days)      enabled admins. { count, items[{refund_id, proof_expires_at}], overdue_unpurged }:
--       no paths, no personal data.
-- The purge order is: Storage API delete (404 = already gone = ok), THEN _mark_refund_proof_purged. If the mark fails the next run
-- repeats the delete (idempotent) and marks again, so nothing is lost and no event is duplicated.
-- Nothing existing is replaced. ROLLBACK: supabase/rollbacks/20261029110500_refund_proof_retention_down.sql
-- ============================================================================

BEGIN;

SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public._refund_dispute_open(p_refund_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT COALESCE((SELECT e.event_type = 'dispute_opened'
                     FROM public.refund_request_events e
                    WHERE e.refund_id = p_refund_id AND e.event_type IN ('dispute_opened', 'dispute_closed')
                    ORDER BY e.id DESC LIMIT 1), false);
$function$;
REVOKE ALL ON FUNCTION public._refund_dispute_open(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._refund_dispute_open(uuid) TO service_role; -- read-only; the purge re-checks it right before each remove

CREATE OR REPLACE FUNCTION public._refund_proofs_due(p_limit integer DEFAULT 100)
RETURNS TABLE (refund_id uuid, proof_path text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT r.id, r.proof_path
    FROM public.refund_requests r
   WHERE r.proof_path IS NOT NULL
     AND r.proof_purged_at IS NULL
     AND r.proof_expires_at <= now()
     AND NOT public._refund_dispute_open(r.id)
   ORDER BY r.proof_expires_at, r.id
   LIMIT LEAST(GREATEST(COALESCE(p_limit, 100), 1), 500);
$function$;

CREATE OR REPLACE FUNCTION public._mark_refund_proof_purged(p_refund_id uuid, p_actor uuid DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_row public.refund_requests%ROWTYPE;
BEGIN
  SELECT * INTO v_row FROM public.refund_requests WHERE id = p_refund_id FOR UPDATE;
  IF NOT FOUND
     OR v_row.proof_path IS NULL
     OR v_row.proof_purged_at IS NOT NULL
     OR v_row.proof_expires_at IS NULL
     OR v_row.proof_expires_at > now()
     OR public._refund_dispute_open(v_row.id) THEN
    RETURN false;
  END IF;
  PERFORM set_config('app.refund_actor', COALESCE(p_actor::text, ''), true);
  UPDATE public.refund_requests SET proof_purged_at = now() WHERE id = v_row.id;
  PERFORM set_config('app.refund_actor', '', true);
  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_set_refund_dispute(p_refund_id uuid, p_open boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.refund_requests%ROWTYPE;
BEGIN
  IF v_uid IS NULL OR public.current_user_is_blocked() OR NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'insufficient_privilege: only an administrator can manage a dispute' USING ERRCODE = '42501';
  END IF;
  IF p_open IS NULL THEN
    RAISE EXCEPTION 'invalid_argument: p_open' USING ERRCODE = '22023', DETAIL = 'p_open';
  END IF;
  SELECT * INTO v_row FROM public.refund_requests WHERE id = p_refund_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'refund_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_uid = v_row.user_id THEN
    PERFORM public._refund_event_self_block(v_row, v_uid);
    RAISE WARNING 'admin_set_refund_dispute: self management blocked for refund %', v_row.id;
    RETURN jsonb_build_object('ok', false, 'code', 'self_resolution_not_allowed');
  END IF;
  IF public._refund_dispute_open(v_row.id) IS DISTINCT FROM p_open THEN
    PERFORM public._refund_event(v_row, CASE WHEN p_open THEN 'dispute_opened' ELSE 'dispute_closed' END,
                                 v_row.status, v_row.status, NULL, false, v_row.proof_path IS NOT NULL, NULL, v_uid);
  END IF;
  RETURN jsonb_build_object('ok', true, 'open', p_open);
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_refund_proofs_expiring(p_days integer DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_items jsonb;
BEGIN
  IF auth.uid() IS NULL OR public.current_user_is_blocked() OR NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'insufficient_privilege: only an administrator can read this' USING ERRCODE = '42501';
  END IF;
  IF p_days IS NULL OR p_days NOT BETWEEN 1 AND 366 THEN
    RAISE EXCEPTION 'invalid_argument: p_days must be between 1 and 366' USING ERRCODE = '22023', DETAIL = 'p_days';
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('refund_id', id, 'proof_expires_at', proof_expires_at) ORDER BY proof_expires_at, id), '[]'::jsonb)
    INTO v_items
    FROM (SELECT id, proof_expires_at FROM public.refund_requests
           WHERE proof_path IS NOT NULL AND proof_purged_at IS NULL
             AND proof_expires_at > now() AND proof_expires_at <= now() + make_interval(days => p_days)
           ORDER BY proof_expires_at, id LIMIT 500) q;
  RETURN jsonb_build_object(
    'count', jsonb_array_length(v_items),
    'items', v_items,
    'overdue_unpurged', (SELECT count(*) FROM public.refund_requests
                          WHERE proof_path IS NOT NULL AND proof_purged_at IS NULL AND proof_expires_at <= now()));
END;
$function$;

REVOKE ALL ON FUNCTION public._refund_proofs_due(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._mark_refund_proof_purged(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._refund_proofs_due(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public._mark_refund_proof_purged(uuid, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.admin_set_refund_dispute(uuid, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_refund_proofs_expiring(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_refund_dispute(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_refund_proofs_expiring(integer) TO authenticated;

COMMIT;
