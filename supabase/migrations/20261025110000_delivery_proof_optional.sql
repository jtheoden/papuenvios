-- ============================================================================
-- Optional delivery proof for orders and remittances (W6a).   PREPARED, NOT APPLIED
-- ============================================================================
-- WHY: marking an order / remittance as delivered required a photo (22023 invalid_argument DETAIL proof_path when it was
--   missing). The owner asked for it to be optional. Production today: 8 dispatched orders and 9 processing remittances,
--   all without a photo, blocked.
--
-- WHAT (CREATE OR REPLACE over the bodies of 20261024110000 / 20261024110100, nothing else changes: matrix, authorization,
--   locks and the rest of the validation are identical):
--   * _order_transition, mark_delivered: the path is optional. When given its shape is still validated (1..500 chars, no
--     '..', no leading '/', no backslash); when empty delivery_proof_url is stored as NULL (never ''). History note:
--     'Delivered with proof' / 'Delivered without proof'.
--   * order_mark_delivered(uuid, text): gains DEFAULT NULL on the proof (same identity, grants re-issued).
--   * _remittance_transition, confirm_delivery: proof priority = new path > already stored proof (never overwritten with
--     NULL) > none (NULL). Shape validated only when there is a path. History note: 'Delivery confirmed with proof' /
--     'Delivery confirmed without proof' (a previously stored proof counts as "with").
--   Works with or without 20261024120000 (status_rpc_only_guard): delivery_proof_url is not a status column and the
--   RPCs are the ones writing it.
--
-- Compatible with the production state: prod runs these bodies under other history versions (20261022182145 /
--   20261022182243); this file is a CREATE OR REPLACE and must be applied with apply_migration / psql, NOT with
--   `supabase db push` (history drift). Deploy order: apply this BEFORE the front that can send an empty proof
--   (without it a delivery without a photo answers 22023). The currently deployed front keeps working after it.
--   Needs the owner's "dale" to apply remotely.
-- ROLLBACK: supabase/rollbacks/20261025110000_delivery_proof_optional_down.sql (revert the front in Vercel FIRST).
-- ============================================================================

BEGIN;

SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public._order_transition(p_order_id uuid, p_action text, p_data jsonb DEFAULT '{}'::jsonb)
RETURNS public.orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_is_admin boolean;
  v_is_owner boolean;
  v_owner uuid;
  v_order public.orders%ROWTYPE;
  v_ok boolean;
  v_reason text := btrim(COALESCE(p_data ->> 'reason', ''));
  v_path text := btrim(COALESCE(p_data ->> 'proof_path', ''));
  v_phone text := btrim(COALESCE(p_data ->> 'payer_phone', ''));
  v_ref text := btrim(COALESCE(p_data ->> 'reference', ''));
  v_tracking text := btrim(COALESCE(p_data ->> 'tracking', ''));
  v_notes text := btrim(COALESCE(p_data ->> 'notes', ''));
  v_note text;
  v_stock jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF public.current_user_is_blocked() THEN
    RAISE EXCEPTION 'user_disabled' USING ERRCODE = '42501';
  END IF;

  -- Authorize on an unlocked read: an unknown id and somebody else's order look the same to a non-admin.
  v_is_admin := public.is_admin_user();
  SELECT o.user_id INTO v_owner FROM public.orders o WHERE o.id = p_order_id;
  IF NOT FOUND THEN
    IF v_is_admin THEN
      RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'P0002';
    END IF;
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  v_is_owner := v_owner IS NOT DISTINCT FROM v_uid;

  CASE p_action
    WHEN 'submit_proof', 'reopen' THEN
      IF NOT v_is_owner THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501'; END IF;
    WHEN 'cancel' THEN
      IF NOT (v_is_admin OR v_is_owner) THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501'; END IF;
    WHEN 'validate_payment', 'reject_payment', 'start_processing', 'dispatch', 'mark_delivered', 'complete' THEN
      IF NOT v_is_admin THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501'; END IF;
    ELSE
      RAISE EXCEPTION 'invalid_argument' USING ERRCODE = '22023', DETAIL = 'action';
  END CASE;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'P0002';
  END IF;

  v_ok := CASE p_action
    WHEN 'submit_proof' THEN v_order.status = 'pending' AND v_order.payment_status IN ('pending', 'rejected', 'proof_uploaded')
    WHEN 'validate_payment' THEN v_order.status IN ('pending', 'processing') AND v_order.payment_status IN ('pending', 'proof_uploaded')
    WHEN 'reject_payment' THEN v_order.status = 'pending' AND v_order.payment_status IN ('pending', 'proof_uploaded')
    WHEN 'start_processing' THEN v_order.status = 'pending' AND v_order.payment_status = 'validated'
    WHEN 'dispatch' THEN v_order.status = 'processing'
    WHEN 'mark_delivered' THEN v_order.status = 'dispatched'
    WHEN 'complete' THEN v_order.status = 'delivered'
    WHEN 'cancel' THEN
      CASE WHEN v_is_admin THEN v_order.status IN ('pending', 'processing')
           ELSE v_order.status = 'pending' AND v_order.payment_status <> 'validated' END
    WHEN 'reopen' THEN v_order.status = 'cancelled' AND v_order.payment_status IN ('pending', 'rejected', 'proof_uploaded')
  END;
  IF NOT v_ok THEN
    RAISE EXCEPTION 'invalid_transition' USING ERRCODE = '22023',
      DETAIL = jsonb_build_object('status', v_order.status, 'payment_status', v_order.payment_status, 'action', p_action)::text;
  END IF;

  -- Argument validation (shape only for paths: the storage policies and orders_bizum_proof_path own the rest).
  IF p_action IN ('reject_payment', 'cancel') AND char_length(v_reason) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'invalid_argument' USING ERRCODE = '22023', DETAIL = 'reason';
  END IF;
  -- submit_proof needs a path; mark_delivered takes an OPTIONAL one (W6a) whose shape is validated only when present.
  IF (p_action = 'submit_proof' OR (p_action = 'mark_delivered' AND v_path <> ''))
     AND (char_length(v_path) NOT BETWEEN 1 AND 500 OR v_path LIKE '%..%' OR v_path LIKE '/%' OR position(E'\\' in v_path) > 0) THEN
    RAISE EXCEPTION 'invalid_argument' USING ERRCODE = '22023', DETAIL = 'proof_path';
  END IF;
  IF p_action = 'submit_proof' THEN
    IF v_phone <> '' AND char_length(v_phone) NOT BETWEEN 7 AND 30 THEN
      RAISE EXCEPTION 'invalid_argument' USING ERRCODE = '22023', DETAIL = 'payer_phone';
    END IF;
    IF char_length(v_ref) > 500 THEN
      RAISE EXCEPTION 'invalid_argument' USING ERRCODE = '22023', DETAIL = 'reference';
    END IF;
  END IF;
  IF p_action = 'dispatch' AND char_length(v_tracking) > 500 THEN
    RAISE EXCEPTION 'invalid_argument' USING ERRCODE = '22023', DETAIL = 'tracking';
  END IF;
  IF p_action = 'complete' AND char_length(v_notes) > 2000 THEN
    RAISE EXCEPTION 'invalid_argument' USING ERRCODE = '22023', DETAIL = 'notes';
  END IF;

  v_note := CASE p_action
    WHEN 'submit_proof' THEN 'Payment proof uploaded'
    WHEN 'validate_payment' THEN 'Payment validated by admin'
    WHEN 'reject_payment' THEN 'Payment rejected: ' || v_reason
    WHEN 'start_processing' THEN 'Processing started'
    WHEN 'dispatch' THEN 'Dispatched'
    WHEN 'mark_delivered' THEN CASE WHEN v_path = '' THEN 'Delivered without proof' ELSE 'Delivered with proof' END
    WHEN 'complete' THEN 'Completed'
    WHEN 'cancel' THEN CASE WHEN v_is_admin THEN 'Cancelled: ' ELSE 'Cancelled by owner: ' END || v_reason
    WHEN 'reopen' THEN 'Reopened by owner'
  END;
  PERFORM set_config('app.status_note', v_note, true);

  CASE p_action
    WHEN 'submit_proof' THEN
      UPDATE public.orders
         SET payment_proof_url = v_path,
             payment_status = 'proof_uploaded',
             rejection_reason = NULL,
             payer_phone = COALESCE(NULLIF(v_phone, ''), payer_phone),
             payment_reference = COALESCE(NULLIF(v_ref, ''), payment_reference)
       WHERE id = p_order_id;
    WHEN 'validate_payment' THEN
      UPDATE public.orders
         SET status = 'processing', payment_status = 'validated', validated_by = v_uid, validated_at = now()
       WHERE id = p_order_id;
    WHEN 'reject_payment' THEN
      UPDATE public.orders
         SET payment_status = 'rejected', validated_by = v_uid, validated_at = now(), rejection_reason = v_reason
       WHERE id = p_order_id;
    WHEN 'start_processing' THEN
      UPDATE public.orders SET status = 'processing', processing_started_at = now() WHERE id = p_order_id;
    WHEN 'dispatch' THEN
      UPDATE public.orders
         SET status = 'dispatched', dispatched_at = now(), dispatched_by = v_uid,
             notes = CASE WHEN v_tracking = '' THEN notes
                          WHEN COALESCE(notes, '') = '' THEN 'Tracking: ' || v_tracking
                          ELSE notes || E'\n\nTracking: ' || v_tracking END
       WHERE id = p_order_id;
    WHEN 'mark_delivered' THEN
      UPDATE public.orders
         SET status = 'delivered', delivered_at = now(), delivery_proof_url = NULLIF(v_path, '')
       WHERE id = p_order_id;
    WHEN 'complete' THEN
      UPDATE public.orders
         SET status = 'completed', completed_at = now(),
             notes = CASE WHEN v_notes = '' THEN notes
                          WHEN COALESCE(notes, '') = '' THEN v_notes
                          ELSE notes || E'\n\n' || v_notes END
       WHERE id = p_order_id;
    WHEN 'cancel' THEN
      UPDATE public.orders
         SET status = 'cancelled', rejection_reason = v_reason,
             payment_status = CASE WHEN v_is_admin THEN payment_status ELSE 'rejected' END
       WHERE id = p_order_id;
    WHEN 'reopen' THEN
      UPDATE public.orders SET status = 'pending', payment_status = 'pending' WHERE id = p_order_id;
  END CASE;

  -- Stock effect in the SAME transaction. The wrappers lock the same order row again (re-entrant) and check the
  -- same caller; a refusal aborts the whole transition.
  IF p_action = 'validate_payment' THEN
    v_stock := public.consume_order_inventory(p_order_id);
  ELSIF p_action = 'reopen' THEN
    v_stock := public.reserve_order_inventory(p_order_id);
  END IF;
  IF v_stock IS NOT NULL AND NOT COALESCE((v_stock ->> 'ok')::boolean, false) THEN
    RAISE EXCEPTION 'stock_refused' USING ERRCODE = 'P0001', DETAIL = v_stock::text;
  END IF;

  PERFORM set_config('app.status_note', '', true);
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  RETURN v_order;
END;
$function$;

CREATE OR REPLACE FUNCTION public.order_mark_delivered(p_order_id uuid, p_proof_path text DEFAULT NULL)
RETURNS public.orders
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
BEGIN
  RETURN public._order_transition(p_order_id, 'mark_delivered', jsonb_build_object('proof_path', p_proof_path));
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

REVOKE ALL ON FUNCTION public._order_transition(uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._remittance_transition(uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.order_mark_delivered(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.order_mark_delivered(uuid, text) TO authenticated;

COMMIT;
