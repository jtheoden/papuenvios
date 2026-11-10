-- ROLLBACK of 20261105100000_remittance_admin_cancel.sql: drops remittance_admin_cancel and restores the exact
-- previous body of _remittance_transition (20261025110000 = live before the change). No data is touched.
-- Revert the front that calls remittance_admin_cancel in Vercel FIRST.
BEGIN;

SET LOCAL lock_timeout = '5s';

DROP FUNCTION IF EXISTS public.remittance_admin_cancel(uuid, text);

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

COMMIT;
