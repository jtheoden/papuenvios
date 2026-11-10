-- ============================================================================
-- Atomic order transitions: one RPC per transition over one locked helper (W5a / E4).   PREPARED, NOT APPLIED
-- ============================================================================
-- WHY: today each status change is SELECT -> check in JS -> UPDATE without `AND status = <expected>`. Two admins
--   acting on the same order both pass the check and the second silently overwrites the first (TOCTOU); validatePayment
--   updates first and consumes stock after, reverting from the browser if the consume fails; dispatch / complete read
--   `notes` without selecting it and overwrite them; and the browser inserts its own status history on top of the
--   audit trigger (32 duplicated groups in production).
--
-- WHAT:
--   * public._order_transition(p_order_id, p_action, p_data jsonb) RETURNS orders: SECURITY DEFINER, EXECUTE revoked
--     from every API role. In order: authenticated? -> not disabled (a definer skips RLS, so the RLS check on
--     disabled users is repeated here) -> unlocked read of the owner to authorize (an unknown id and somebody else's
--     order are indistinguishable for a non-admin: 42501, no existence leak, no waiting on a stranger's lock) ->
--     SELECT ... FOR UPDATE -> matrix on the LOCKED row -> argument validation -> UPDATE -> stock side effect ->
--     RETURN the fresh row.
--   * Nine thin SECURITY DEFINER wrappers (authenticated only): order_submit_proof, order_validate_payment,
--     order_reject_payment, order_start_processing, order_dispatch, order_mark_delivered, order_complete,
--     order_cancel, order_reopen.
--   * Errors: 42501 not_authorized / user_disabled; P0002 order_not_found (admins only); 22023 invalid_transition with
--     DETAIL = {"status","payment_status","action"} of the locked row (the second admin learns the order already
--     moved); 22023 invalid_argument with DETAIL = the field; P0001 stock_refused with DETAIL = the JSON answer of
--     consume_order_inventory / reserve_order_inventory (reason, product_id, available), after which EVERYTHING rolls
--     back: no manual revert, no cancelled -> pending -> cancelled flip-flop on a reopen without stock.
--
-- MATRIX (actor: status / payment_status -> status / payment_status):
--   submit_proof     owner  pending / pending|rejected|proof_uploaded -> pending / proof_uploaded
--   validate_payment admin  pending|processing / pending|proof_uploaded -> processing / validated (+ consume stock)
--   reject_payment   admin  pending / pending|proof_uploaded -> pending / rejected (stock is NOT released)
--   start_processing admin  pending / validated -> processing / validated   (legacy path, ND-4)
--   dispatch         admin  processing / any -> dispatched          (tracking APPENDED to notes)
--   mark_delivered   admin  dispatched -> delivered                 (proof path required)
--   complete         admin  delivered -> completed                  (notes APPENDED)
--   cancel           admin  pending|processing / any -> cancelled / unchanged
--   cancel           owner  pending / not validated -> cancelled / rejected
--   reopen           owner  cancelled / pending|rejected|proof_uploaded -> pending / pending (+ reserve stock)
--   The owner rules replicate guard_orders_owner_update exactly: inside a definer that guard is skipped (current_user
--   is the function owner). Re-opening is owner-only (ND-3: reopenOrderByAdmin had no caller and is deleted).
--   Money, Bizum and stock columns are never written, so guard_bizum_quote_immutable and audit_financial_update do not
--   fire; updated_at is maintained by its trigger.
--
-- HISTORY: audit_order_status_change now stores the note carried by the transaction setting app.status_note
--   (set_config(..., true), cleared at the end of the helper) and also logs a payment-only change (submit_proof,
--   reject_payment keep status = pending) when a note is present. Direct PATCHes carry no note, so their behaviour is
--   unchanged. The front stops inserting history rows itself.
--
-- Deploy order: aditive. Apply BEFORE the front of E6 is merged. Needs the owner's "dale" to apply remotely.
-- ROLLBACK: supabase/rollbacks/20261024110000_order_transition_rpcs_down.sql (revert E6 in Vercel FIRST, or its
--   buttons break).
-- ============================================================================

BEGIN;

SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.audit_order_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_note text := nullif(current_setting('app.status_note', true), '');
BEGIN
  IF TG_OP = 'UPDATE'
     AND (OLD.status IS DISTINCT FROM NEW.status
          OR (v_note IS NOT NULL AND OLD.payment_status IS DISTINCT FROM NEW.payment_status)) THEN
    INSERT INTO order_status_history (order_id, previous_status, new_status, changed_by, notes, created_at)
    VALUES (NEW.id, OLD.status, NEW.status, auth.uid(), v_note, NOW());
  END IF;
  RETURN NEW;
END;
$function$;

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
  IF p_action IN ('submit_proof', 'mark_delivered')
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
    WHEN 'mark_delivered' THEN 'Delivered with proof'
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
         SET status = 'delivered', delivered_at = now(), delivery_proof_url = v_path
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

REVOKE ALL ON FUNCTION public._order_transition(uuid, text, jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.order_submit_proof(
  p_order_id uuid, p_proof_path text, p_reference text DEFAULT NULL, p_payer_phone text DEFAULT NULL)
RETURNS public.orders
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
BEGIN
  RETURN public._order_transition(p_order_id, 'submit_proof',
    jsonb_build_object('proof_path', p_proof_path, 'reference', p_reference, 'payer_phone', p_payer_phone));
END;
$function$;

CREATE OR REPLACE FUNCTION public.order_validate_payment(p_order_id uuid)
RETURNS public.orders
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
BEGIN
  RETURN public._order_transition(p_order_id, 'validate_payment', '{}'::jsonb);
END;
$function$;

CREATE OR REPLACE FUNCTION public.order_reject_payment(p_order_id uuid, p_reason text)
RETURNS public.orders
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
BEGIN
  RETURN public._order_transition(p_order_id, 'reject_payment', jsonb_build_object('reason', p_reason));
END;
$function$;

CREATE OR REPLACE FUNCTION public.order_start_processing(p_order_id uuid)
RETURNS public.orders
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
BEGIN
  RETURN public._order_transition(p_order_id, 'start_processing', '{}'::jsonb);
END;
$function$;

CREATE OR REPLACE FUNCTION public.order_dispatch(p_order_id uuid, p_tracking text DEFAULT NULL)
RETURNS public.orders
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
BEGIN
  RETURN public._order_transition(p_order_id, 'dispatch', jsonb_build_object('tracking', p_tracking));
END;
$function$;

CREATE OR REPLACE FUNCTION public.order_mark_delivered(p_order_id uuid, p_proof_path text)
RETURNS public.orders
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
BEGIN
  RETURN public._order_transition(p_order_id, 'mark_delivered', jsonb_build_object('proof_path', p_proof_path));
END;
$function$;

CREATE OR REPLACE FUNCTION public.order_complete(p_order_id uuid, p_notes text DEFAULT NULL)
RETURNS public.orders
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
BEGIN
  RETURN public._order_transition(p_order_id, 'complete', jsonb_build_object('notes', p_notes));
END;
$function$;

CREATE OR REPLACE FUNCTION public.order_cancel(p_order_id uuid, p_reason text)
RETURNS public.orders
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
BEGIN
  RETURN public._order_transition(p_order_id, 'cancel', jsonb_build_object('reason', p_reason));
END;
$function$;

CREATE OR REPLACE FUNCTION public.order_reopen(p_order_id uuid)
RETURNS public.orders
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
BEGIN
  RETURN public._order_transition(p_order_id, 'reopen', '{}'::jsonb);
END;
$function$;

REVOKE ALL ON FUNCTION public.order_submit_proof(uuid, text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.order_validate_payment(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.order_reject_payment(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.order_start_processing(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.order_dispatch(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.order_mark_delivered(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.order_complete(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.order_cancel(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.order_reopen(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.order_submit_proof(uuid, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.order_validate_payment(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.order_reject_payment(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.order_start_processing(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.order_dispatch(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.order_mark_delivered(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.order_complete(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.order_cancel(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.order_reopen(uuid) TO authenticated;

COMMIT;
