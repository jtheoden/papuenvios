-- ============================================================================
-- Atomic remittance transitions: one RPC per transition over one locked helper (W5a / E5).   PREPARED, NOT APPLIED
-- ============================================================================
-- WHY: same defect as orders (see 20261024110000_order_transition_rpcs.sql): every remittance function reads the row,
--   checks the status in JS and updates without `AND status = <expected>`, so two admins (or an admin and the owner)
--   can both pass the check and one silently overwrites the other (validate vs reject, validate vs owner cancel).
--
-- WHAT:
--   * public._remittance_transition(p_remittance_id, p_action, p_data jsonb) RETURNS remittances: SECURITY DEFINER,
--     EXECUTE revoked from every API role. Same order of steps as the orders helper: authenticated -> not disabled
--     (a definer skips RLS) -> unlocked owner read to authorize (unknown id and somebody else's row look the same to
--     a non-admin: 42501) -> SELECT ... FOR UPDATE -> matrix on the LOCKED row -> argument validation -> UPDATE.
--   * Seven SECURITY DEFINER wrappers (authenticated only): remittance_submit_proof, remittance_cancel,
--     remittance_validate_payment, remittance_reject_payment, remittance_start_processing,
--     remittance_confirm_delivery, remittance_complete.
--   * Errors: 42501 not_authorized / user_disabled; P0002 remittance_not_found (admins only); 22023 invalid_transition
--     (DETAIL = {"status","action"}); 22023 invalid_argument (DETAIL = the field).
--
-- MATRIX (actor: status -> status):
--   submit_proof     owner  payment_pending|payment_rejected -> payment_proof_uploaded
--   cancel           owner  payment_pending|payment_rejected|payment_proof_uploaded -> cancelled
--   validate_payment admin  payment_proof_uploaded -> payment_validated
--   reject_payment   admin  payment_proof_uploaded -> payment_rejected   (reason 1..500 required)
--   start_processing admin  payment_validated -> processing
--   confirm_delivery admin  processing -> delivered   (a proof is required: the new path or the stored one)
--   complete         admin  delivered -> completed
--   The owner rules replicate guard_remittance_owner_update (skipped inside a definer). Money columns are never
--   written, so guard_remittance_money_columns and audit_financial_update do not fire.
--
-- HISTORY: audit_remittance_status_change stores the note carried by the transaction (app.status_note, set with
--   set_config(..., true) and cleared at the end of the helper) in remittance_status_history.notes. Every
--   remittance transition changes the status, so each RPC call writes exactly one row.
--
-- Deploy order: aditive. Apply BEFORE the front of E7 is merged. Needs the owner's "dale" to apply remotely.
-- ROLLBACK: supabase/rollbacks/20261024110100_remittance_transition_rpcs_down.sql (revert E7 in Vercel FIRST).
-- ============================================================================

BEGIN;

SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.audit_remittance_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF (TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status) THEN
    INSERT INTO remittance_status_history (remittance_id, old_status, new_status, changed_by, notes, created_at)
    VALUES (NEW.id, OLD.status, NEW.status, auth.uid(), nullif(current_setting('app.status_note', true), ''), NOW());
  END IF;
  RETURN NEW;
END;
$function$;

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
    WHEN 'validate_payment', 'reject_payment', 'start_processing', 'confirm_delivery', 'complete' THEN
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
    WHEN 'validate_payment' THEN v_rem.status = 'payment_proof_uploaded'
    WHEN 'reject_payment' THEN v_rem.status = 'payment_proof_uploaded'
    WHEN 'start_processing' THEN v_rem.status = 'payment_validated'
    WHEN 'confirm_delivery' THEN v_rem.status = 'processing'
    WHEN 'complete' THEN v_rem.status = 'delivered'
  END;
  IF NOT v_ok THEN
    RAISE EXCEPTION 'invalid_transition' USING ERRCODE = '22023',
      DETAIL = jsonb_build_object('status', v_rem.status, 'action', p_action)::text;
  END IF;

  -- Argument validation (shape only for paths: the storage policies own the rest).
  IF p_action = 'reject_payment' AND char_length(v_reason) NOT BETWEEN 1 AND 500 THEN
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
    -- A proof is mandatory: the new path, or the one already stored.
    IF v_path = '' THEN
      v_path := btrim(COALESCE(v_rem.delivery_proof_url, ''));
    END IF;
    IF char_length(v_path) NOT BETWEEN 1 AND 500 OR v_path LIKE '%..%' OR v_path LIKE '/%' OR position(E'\\' in v_path) > 0 THEN
      RAISE EXCEPTION 'invalid_argument' USING ERRCODE = '22023', DETAIL = 'proof_path';
    END IF;
  END IF;
  IF p_action IN ('submit_proof', 'confirm_delivery', 'complete') AND char_length(v_notes) > 2000 THEN
    RAISE EXCEPTION 'invalid_argument' USING ERRCODE = '22023', DETAIL = 'notes';
  END IF;

  v_note := CASE p_action
    WHEN 'submit_proof' THEN 'Payment proof uploaded'
    WHEN 'cancel' THEN 'Cancelled by owner' || CASE WHEN v_reason <> '' THEN ': ' || v_reason ELSE '' END
    WHEN 'validate_payment' THEN 'Payment validated by admin'
    WHEN 'reject_payment' THEN 'Payment rejected: ' || v_reason
    WHEN 'start_processing' THEN 'Processing started'
    WHEN 'confirm_delivery' THEN 'Delivery confirmed'
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
    WHEN 'cancel' THEN
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
         SET status = 'delivered', delivered_at = now(), delivery_proof_url = v_path,
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

CREATE OR REPLACE FUNCTION public.remittance_submit_proof(
  p_remittance_id uuid, p_proof_path text, p_reference text, p_notes text DEFAULT NULL, p_payer_phone text DEFAULT NULL)
RETURNS public.remittances
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
BEGIN
  RETURN public._remittance_transition(p_remittance_id, 'submit_proof',
    jsonb_build_object('proof_path', p_proof_path, 'reference', p_reference, 'notes', p_notes, 'payer_phone', p_payer_phone));
END;
$function$;

CREATE OR REPLACE FUNCTION public.remittance_cancel(p_remittance_id uuid, p_reason text DEFAULT NULL)
RETURNS public.remittances
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
BEGIN
  RETURN public._remittance_transition(p_remittance_id, 'cancel', jsonb_build_object('reason', p_reason));
END;
$function$;

CREATE OR REPLACE FUNCTION public.remittance_validate_payment(p_remittance_id uuid)
RETURNS public.remittances
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
BEGIN
  RETURN public._remittance_transition(p_remittance_id, 'validate_payment', '{}'::jsonb);
END;
$function$;

CREATE OR REPLACE FUNCTION public.remittance_reject_payment(p_remittance_id uuid, p_reason text)
RETURNS public.remittances
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
BEGIN
  RETURN public._remittance_transition(p_remittance_id, 'reject_payment', jsonb_build_object('reason', p_reason));
END;
$function$;

CREATE OR REPLACE FUNCTION public.remittance_start_processing(p_remittance_id uuid)
RETURNS public.remittances
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
BEGIN
  RETURN public._remittance_transition(p_remittance_id, 'start_processing', '{}'::jsonb);
END;
$function$;

CREATE OR REPLACE FUNCTION public.remittance_confirm_delivery(p_remittance_id uuid, p_proof_path text DEFAULT NULL, p_notes text DEFAULT NULL)
RETURNS public.remittances
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
BEGIN
  RETURN public._remittance_transition(p_remittance_id, 'confirm_delivery',
    jsonb_build_object('proof_path', p_proof_path, 'notes', p_notes));
END;
$function$;

CREATE OR REPLACE FUNCTION public.remittance_complete(p_remittance_id uuid, p_notes text DEFAULT NULL)
RETURNS public.remittances
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
BEGIN
  RETURN public._remittance_transition(p_remittance_id, 'complete', jsonb_build_object('notes', p_notes));
END;
$function$;

REVOKE ALL ON FUNCTION public.remittance_submit_proof(uuid, text, text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.remittance_cancel(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.remittance_validate_payment(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.remittance_reject_payment(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.remittance_start_processing(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.remittance_confirm_delivery(uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.remittance_complete(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remittance_submit_proof(uuid, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.remittance_cancel(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.remittance_validate_payment(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.remittance_reject_payment(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.remittance_start_processing(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.remittance_confirm_delivery(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.remittance_complete(uuid, text) TO authenticated;

COMMIT;
