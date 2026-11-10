-- ============================================================================
-- Refund proofs (R5b 2/3): admin_resolve_refund_v2.   PREPARED, NOT APPLIED
-- ============================================================================
-- A NEW function next to admin_resolve_refund (v1 is not touched, not replaced, not overloaded: an overload with defaults would
-- make PostgREST answer PGRST203). The new front calls v2 only.
--   admin_resolve_refund_v2(refund_id, 'refunded' | 'not_applicable', reference, refunded_at, reason,
--                           proof_path, proof_sha256, self_resolve_confirm) -> jsonb
--     { ok: true, refund: <row> }                       resolved (or an idempotent replay of the same resolution)
--     { ok: false, code: 'self_resolution_not_allowed' } the actor is the customer of the refund (separation of duties)
--   * 'refunded' REQUIRES a proof (refund_proof_required()): the path must be refunds/{this refund id}/{uuid}.{ext}, the object must
--     exist in the private bucket, the optional SHA-256 is 64 lowercase hex. proof_expires_at = refunded_at + 1 year.
--     'not_applicable' needs only the reason; a proof is ignored.
--   * Separation of duties: an admin cannot resolve a refund of his OWN operation. The attempt is audited (event
--     self_resolution_blocked, committed because the function returns instead of raising) and a WARNING is emitted.
--     Only a super_admin passing p_self_resolve_confirm = true may resolve his own refund (sole-administrator case): the row and
--     the event are flagged self_resolved and the metrics count them apart.
--   * Same checks, error codes and activity_logs row as v1 (42501, P0002 refund_not_found, 22023 refund_on_hold /
--     invalid_argument / already_resolved / proof_required). The events come from the refund_requests_audit trigger.
-- ROLLBACK: supabase/rollbacks/20261029110400_refund_resolve_with_proof_down.sql
-- ============================================================================

BEGIN;

SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.admin_resolve_refund_v2(
  p_refund_id           uuid,
  p_action              text,
  p_reference           text        DEFAULT NULL,
  p_refunded_at         timestamptz DEFAULT NULL,
  p_reason              text        DEFAULT NULL,
  p_proof_path          text        DEFAULT NULL,
  p_proof_sha256        text        DEFAULT NULL,
  p_self_resolve_confirm boolean    DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid    uuid := auth.uid();
  v_ref    text := btrim(COALESCE(p_reference, ''));
  v_reason text := btrim(COALESCE(p_reason, ''));
  v_path   text := btrim(COALESCE(p_proof_path, ''));
  v_sha    text := btrim(COALESCE(p_proof_sha256, ''));
  v_when   timestamptz;
  v_self   boolean;
  v_row    public.refund_requests%ROWTYPE;
BEGIN
  IF v_uid IS NULL OR public.current_user_is_blocked() OR NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'insufficient_privilege: only an administrator can resolve a refund' USING ERRCODE = '42501';
  END IF;
  IF p_action IS NULL OR p_action NOT IN ('refunded', 'not_applicable') THEN
    RAISE EXCEPTION 'invalid_argument: p_action must be refunded or not_applicable' USING ERRCODE = '22023', DETAIL = 'p_action';
  END IF;

  SELECT * INTO v_row FROM public.refund_requests WHERE id = p_refund_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'refund_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_row.status <> 'pending' THEN
    IF v_row.status = p_action
       AND ((p_action = 'refunded' AND v_row.refund_reference = v_ref)
         OR (p_action = 'not_applicable' AND v_row.resolution_reason = v_reason)) THEN
      RETURN jsonb_build_object('ok', true, 'refund', to_jsonb(v_row));
    END IF;
    RAISE EXCEPTION 'already_resolved: this refund request is already %', v_row.status USING ERRCODE = '22023';
  END IF;

  v_self := v_uid = v_row.user_id;
  IF v_self AND NOT (COALESCE(p_self_resolve_confirm, false) AND public.is_super_admin()) THEN
    PERFORM public._refund_event_self_block(v_row, v_uid);
    RAISE WARNING 'admin_resolve_refund_v2: self resolution blocked for refund %', v_row.id;
    RETURN jsonb_build_object('ok', false, 'code', 'self_resolution_not_allowed');
  END IF;

  IF p_action = 'refunded' THEN
    IF now() < v_row.eligible_at THEN
      RAISE EXCEPTION 'refund_on_hold: refunds start 48 hours after the cancellation' USING ERRCODE = '22023',
        DETAIL = 'eligible_at=' || to_char(v_row.eligible_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
    END IF;
    IF char_length(v_ref) NOT BETWEEN 1 AND 200 THEN
      RAISE EXCEPTION 'invalid_argument: p_reference is required (1 to 200 characters)' USING ERRCODE = '22023', DETAIL = 'p_reference';
    END IF;
    v_when := COALESCE(p_refunded_at, now());
    IF v_when > now() OR v_when < v_row.eligible_at THEN
      RAISE EXCEPTION 'invalid_argument: p_refunded_at must be between eligible_at and now' USING ERRCODE = '22023', DETAIL = 'p_refunded_at';
    END IF;
    IF v_path = '' THEN
      IF public.refund_proof_required() THEN
        RAISE EXCEPTION 'proof_required: a proof of the refund is required' USING ERRCODE = '22023', DETAIL = 'p_proof_path';
      END IF;
    ELSE
      IF v_path !~ ('^refunds/' || v_row.id::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|webp|pdf)$')
         OR NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'refund-proofs' AND o.name = v_path) THEN
        RAISE EXCEPTION 'invalid_argument: p_proof_path must be an uploaded proof of this refund' USING ERRCODE = '22023', DETAIL = 'p_proof_path';
      END IF;
    END IF;
    IF v_sha <> '' AND v_sha !~ '^[0-9a-f]{64}$' THEN
      RAISE EXCEPTION 'invalid_argument: p_proof_sha256 must be 64 lowercase hex characters' USING ERRCODE = '22023', DETAIL = 'p_proof_sha256';
    END IF;
    UPDATE public.refund_requests
       SET status = 'refunded', refund_reference = v_ref, refunded_at = v_when, resolved_by = v_uid, resolved_at = now(),
           proof_path = NULLIF(v_path, ''), proof_sha256 = NULLIF(v_sha, ''),
           proof_expires_at = CASE WHEN v_path <> '' THEN v_when + interval '1 year' END,
           self_resolved = v_self
     WHERE id = v_row.id
    RETURNING * INTO v_row;
  ELSE
    IF char_length(v_reason) NOT BETWEEN 1 AND 500 THEN
      RAISE EXCEPTION 'invalid_argument: p_reason is required (1 to 500 characters)' USING ERRCODE = '22023', DETAIL = 'p_reason';
    END IF;
    UPDATE public.refund_requests
       SET status = 'not_applicable', resolution_reason = v_reason, resolved_by = v_uid, resolved_at = now(), self_resolved = v_self
     WHERE id = v_row.id
    RETURNING * INTO v_row;
  END IF;

  INSERT INTO public.activity_logs (action, entity_type, entity_id, performed_by, description, metadata)
  VALUES ('refund_resolved', 'refund_request', v_row.id, v_uid::text, 'Refund request resolved: ' || p_action,
          jsonb_build_object('refund_id', v_row.id, 'action', p_action, 'amount', v_row.amount, 'currency', v_row.currency,
                             'operation_type', v_row.operation_type, 'order_id', v_row.order_id,
                             'remittance_id', v_row.remittance_id, 'has_proof', v_row.proof_path IS NOT NULL,
                             'self_resolved', v_row.self_resolved));
  RETURN jsonb_build_object('ok', true, 'refund', to_jsonb(v_row));
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_resolve_refund_v2(uuid, text, text, timestamptz, text, text, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_resolve_refund_v2(uuid, text, text, timestamptz, text, text, text, boolean) TO authenticated;

COMMIT;
