-- ============================================================================
-- Admin cancel of a pending remittance (no payment proof yet).   PREPARED, NOT APPLIED
-- ============================================================================
-- WHY: an admin / super_admin could not cancel a remittance in payment_pending (customer never uploaded a proof).
--   Two layers: no admin screen offered the action, and _remittance_transition authorizes 'cancel' for the OWNER only
--   (42501 for anybody else). Production 2026-11-05: 9 payment_pending remittances, none with a proof.
--
-- WHAT (CREATE OR REPLACE over the LIVE body of _remittance_transition, md5 ebbd27fe90d583f269b76884e65f18ba, identical
--   to 20261025110000; only these lines change, every other action is untouched):
--   * new action 'admin_cancel': admin only (is_admin_user = admin|super_admin, enabled), payment_pending -> cancelled,
--     reason 1..500 required, writes cancelled_at / cancelled_by (the admin) / cancellation_reason like 'cancel';
--     history note 'Cancelled by admin: <reason>' (audit_remittance_status_change, one row).
--   * IF NOT v_ok -> IF NOT COALESCE(v_ok, false): a future action missing from the matrix fails closed.
--   * new wrapper public.remittance_admin_cancel(uuid, text): SECURITY DEFINER, authenticated only.
--   remittance_cancel stays OWNER-only (same matrix as before).
--   Triggers on the cancel: refund_request_on_cancel is a no-op from payment_pending (no payment evidence);
--   guard_commission_acceptance closes pending commission proposals; the self-dealing guard allows it (customer action).
--
-- Additive and reversible: no data is written, no column changes. Deploy order: apply BEFORE the front that calls
--   remittance_admin_cancel (without it the new button answers 404 / PGRST202; the current front is unaffected).
--   Apply with apply_migration / psql. Needs the owner's "dale" to apply remotely.
-- ROLLBACK: supabase/rollbacks/20261105100000_remittance_admin_cancel_down.sql (revert the front in Vercel FIRST).
-- ============================================================================

BEGIN;

SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public._remittance_transition(p_remittance_id uuid, p_action text, p_data jsonb DEFAULT '{}'::jsonb)
RETURNS public.remittances
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_is_admin boolean;
  v_owner uuid;
  v_rem public.remittances%ROWTYPE;
  v_ok boolean;
  v_reason text := btrim(COALESCE(p_data ->> 'reason', ''));
  v_path text := btrim(COALESCE(p_data ->> 'proof_path', ''));
  v_ref text := btrim(COALESCE(p_data ->> 'reference', ''));
  v_notes text := btrim(COALESCE(p_data ->> 'notes', ''));
  v_phone text := btrim(COALESCE(p_data ->> 'payer_phone', ''));
  v_note text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF public.current_user_is_blocked() THEN
    RAISE EXCEPTION 'user_disabled' USING ERRCODE = '42501';
  END IF;

  v_is_admin := public.is_admin_user();
  SELECT r.user_id INTO v_owner FROM public.remittances r WHERE r.id = p_remittance_id;
  IF NOT FOUND THEN
    IF v_is_admin THEN
      RAISE EXCEPTION 'remittance_not_found' USING ERRCODE = 'P0002';
    END IF;
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;

  CASE p_action
    WHEN 'submit_proof', 'cancel' THEN
      IF v_owner IS DISTINCT FROM v_uid THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501'; END IF;
    WHEN 'admin_cancel', 'validate_payment', 'reject_payment', 'start_processing', 'confirm_delivery', 'complete' THEN
      IF NOT v_is_admin THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501'; END IF;
    ELSE
      RAISE EXCEPTION 'invalid_argument' USING ERRCODE = '22023', DETAIL = 'action';
  END CASE;

  SELECT * INTO v_rem FROM public.remittances WHERE id = p_remittance_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'remittance_not_found' USING ERRCODE = 'P0002';
  END IF;

  v_ok := CASE p_action
    WHEN 'submit_proof' THEN v_rem.status IN ('payment_pending', 'payment_rejected')
    WHEN 'cancel' THEN v_rem.status IN ('payment_pending', 'payment_rejected', 'payment_proof_uploaded')
    -- Admin: only before any payment proof exists (a proof is handled with reject_payment; no refund is involved).
    WHEN 'admin_cancel' THEN v_rem.status = 'payment_pending'
    WHEN 'validate_payment' THEN v_rem.status = 'payment_proof_uploaded'
    WHEN 'reject_payment' THEN v_rem.status = 'payment_proof_uploaded'
    WHEN 'start_processing' THEN v_rem.status = 'payment_validated'
    WHEN 'confirm_delivery' THEN v_rem.status = 'processing'
    WHEN 'complete' THEN v_rem.status = 'delivered'
  END;
  IF NOT COALESCE(v_ok, false) THEN
    RAISE EXCEPTION 'invalid_transition' USING ERRCODE = '22023',
      DETAIL = jsonb_build_object('status', v_rem.status, 'action', p_action)::text;
  END IF;

  -- Argument validation (shape only for paths: the storage policies own the rest).
  IF p_action IN ('reject_payment', 'admin_cancel') AND char_length(v_reason) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'invalid_argument' USING ERRCODE = '22023', DETAIL = 'reason';
  END IF;
  IF p_action = 'cancel' AND char_length(v_reason) > 500 THEN
    RAISE EXCEPTION 'invalid_argument' USING ERRCODE = '22023', DETAIL = 'reason';
  END IF;
  IF p_action = 'submit_proof' THEN
    IF char_length(v_path) NOT BETWEEN 1 AND 500 OR v_path LIKE '%..%' OR v_path LIKE '/%' OR position(E'\\' in v_path) > 0 THEN
      RAISE EXCEPTION 'invalid_argument' USING ERRCODE = '22023', DETAIL = 'proof_path';
    END IF;
    IF char_length(v_ref) NOT BETWEEN 1 AND 200 THEN
      RAISE EXCEPTION 'invalid_argument' USING ERRCODE = '22023', DETAIL = 'reference';
    END IF;
    IF v_phone <> '' AND char_length(v_phone) NOT BETWEEN 7 AND 30 THEN
      RAISE EXCEPTION 'invalid_argument' USING ERRCODE = '22023', DETAIL = 'payer_phone';
    END IF;
  END IF;
  IF p_action = 'confirm_delivery' THEN
    -- The proof is OPTIONAL (W6a): the new path wins, else the one already stored, else none (NULL). Shape is
    -- validated only when there is one.
    IF v_path = '' THEN
      v_path := btrim(COALESCE(v_rem.delivery_proof_url, ''));
    END IF;
    IF v_path <> '' AND (char_length(v_path) NOT BETWEEN 1 AND 500 OR v_path LIKE '%..%' OR v_path LIKE '/%' OR position(E'\\' in v_path) > 0) THEN
      RAISE EXCEPTION 'invalid_argument' USING ERRCODE = '22023', DETAIL = 'proof_path';
    END IF;
  END IF;
  IF p_action IN ('submit_proof', 'confirm_delivery', 'complete') AND char_length(v_notes) > 2000 THEN
    RAISE EXCEPTION 'invalid_argument' USING ERRCODE = '22023', DETAIL = 'notes';
  END IF;

  v_note := CASE p_action
    WHEN 'submit_proof' THEN 'Payment proof uploaded'
    WHEN 'cancel' THEN 'Cancelled by owner' || CASE WHEN v_reason <> '' THEN ': ' || v_reason ELSE '' END
    WHEN 'admin_cancel' THEN 'Cancelled by admin: ' || v_reason
    WHEN 'validate_payment' THEN 'Payment validated by admin'
    WHEN 'reject_payment' THEN 'Payment rejected: ' || v_reason
    WHEN 'start_processing' THEN 'Processing started'
    WHEN 'confirm_delivery' THEN CASE WHEN v_path = '' THEN 'Delivery confirmed without proof' ELSE 'Delivery confirmed with proof' END
    WHEN 'complete' THEN 'Completed'
  END;
  PERFORM set_config('app.status_note', v_note, true);

  CASE p_action
    WHEN 'submit_proof' THEN
      UPDATE public.remittances
         SET status = 'payment_proof_uploaded', payment_proof_url = v_path, payment_reference = v_ref,
             payment_proof_notes = NULLIF(v_notes, ''), payment_proof_uploaded_at = now(),
             payer_phone = COALESCE(NULLIF(v_phone, ''), payer_phone)
       WHERE id = p_remittance_id;
    WHEN 'cancel', 'admin_cancel' THEN
      UPDATE public.remittances
         SET status = 'cancelled', cancelled_at = now(), cancelled_by = v_uid, cancellation_reason = NULLIF(v_reason, '')
       WHERE id = p_remittance_id;
    WHEN 'validate_payment' THEN
      UPDATE public.remittances
         SET status = 'payment_validated', payment_validated = true, payment_validated_at = now(),
             payment_validated_by = v_uid
       WHERE id = p_remittance_id;
    WHEN 'reject_payment' THEN
      UPDATE public.remittances
         SET status = 'payment_rejected', payment_rejection_reason = v_reason
       WHERE id = p_remittance_id;
    WHEN 'start_processing' THEN
      UPDATE public.remittances SET status = 'processing', processing_started_at = now() WHERE id = p_remittance_id;
    WHEN 'confirm_delivery' THEN
      UPDATE public.remittances
         SET status = 'delivered', delivered_at = now(), delivery_proof_url = NULLIF(v_path, ''),
             delivery_notes_admin = COALESCE(NULLIF(v_notes, ''), delivery_notes_admin)
       WHERE id = p_remittance_id;
    WHEN 'complete' THEN
      UPDATE public.remittances
         SET status = 'completed', completed_at = now(),
             delivery_notes_admin = COALESCE(NULLIF(v_notes, ''), delivery_notes_admin)
       WHERE id = p_remittance_id;
  END CASE;

  PERFORM set_config('app.status_note', '', true);
  SELECT * INTO v_rem FROM public.remittances WHERE id = p_remittance_id;
  RETURN v_rem;
END;
$function$;

REVOKE ALL ON FUNCTION public._remittance_transition(uuid, text, jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.remittance_admin_cancel(p_remittance_id uuid, p_reason text)
RETURNS public.remittances
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
BEGIN
  RETURN public._remittance_transition(p_remittance_id, 'admin_cancel', jsonb_build_object('reason', p_reason));
END;
$function$;

REVOKE ALL ON FUNCTION public.remittance_admin_cancel(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remittance_admin_cancel(uuid, text) TO authenticated;

COMMIT;
