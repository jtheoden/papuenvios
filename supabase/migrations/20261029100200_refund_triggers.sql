-- ============================================================================
-- Refunds queue (3/4): capture on cancel, close on reopen.   PREPARED, NOT APPLIED
-- ============================================================================
-- WHY a trigger and not the transition helpers: the helpers _order_transition / _remittance_transition have live bodies in
--   production that differ from older migrations, and other work touches them. An AFTER UPDATE trigger needs no change to
--   them, covers every path (customer RPC, admin RPC, service role, a future admin cancel) and still sees OLD, which is the only
--   place the payment state survives (the owner's order cancel overwrites payment_status with 'rejected').
--   Precedent: release_stock_on_order_cancel.
--
-- Evidence of payment, read from OLD at the moment of the cancellation:
--   orders:      payment_status 'validated'      -> 'validated'
--                payment_status 'proof_uploaded' -> 'proof_unverified' (money may have arrived; admin verifies in Zelle)
--   remittances: status in (payment_validated, processing, delivered, completed) -> 'validated' (payment_validated_at alone is
--                not evidence: it can linger on a row whose payment was later rejected)
--                status 'payment_proof_uploaded' -> 'proof_unverified'
--   anything else (pending, rejected, payment_pending, payment_rejected): no request.
-- Amount: orders payment_amount when paid in another currency (Bizum), else total_amount; remittances amount_sent + delivery_cost.
-- Window: eligible_at = cancelled_at + refund_hold_hours() real hours; due_at = add_business_days(eligible_at, 5).
--   Orders have no cancelled_at column, so now() is the cancellation instant; remittances use their cancelled_at.
--
-- Reopen (cancelled -> any other status): the open request, if any, closes as not_applicable / 'reopened' (owner decision ND-5;
--   reopening is not blocked).
--
-- FAIL OPEN: production data must never be affected by this feature. The trigger functions catch every error: the
--   cancellation / reopen they ride on always completes with exactly the result it had before this migration. A failure is
--   logged (RAISE WARNING plus a row in activity_logs: action refund_capture_failed / refund_close_failed, with the table,
--   operation id, SQLSTATE and message) so the missing request can be created by hand. Inputs are also COALESCEd, and a
--   non-positive amount (never expected) is treated as a failure and logged, because the table requires amount > 0.
-- ROLLBACK: supabase/rollbacks/20261029100200_refund_triggers_down.sql
-- ============================================================================

BEGIN;

SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.refund_request_on_cancel()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid          uuid := auth.uid();
  v_role         text;
  v_evidence     text;
  v_amount       numeric;
  v_currency     text;
  v_cancelled_at timestamptz := now();
  v_eligible_at  timestamptz;
BEGIN
 BEGIN
  IF TG_TABLE_NAME = 'orders' THEN
    v_evidence := CASE OLD.payment_status
                    WHEN 'validated' THEN 'validated'
                    WHEN 'proof_uploaded' THEN 'proof_unverified'
                  END;
    v_amount   := CASE WHEN NEW.payment_currency IS NOT NULL THEN NEW.payment_amount ELSE NEW.total_amount END;
    v_currency := COALESCE(NEW.payment_currency, 'USD');
  ELSE
    v_evidence := CASE
                    WHEN OLD.status IN ('payment_validated', 'processing', 'delivered', 'completed') THEN 'validated'
                    WHEN OLD.status = 'payment_proof_uploaded' THEN 'proof_unverified'
                  END;
    v_amount       := COALESCE(NEW.amount_sent, 0) + COALESCE(NEW.delivery_cost, 0);
    v_currency     := COALESCE(NEW.currency_sent, 'USD');
    v_cancelled_at := COALESCE(NEW.cancelled_at, v_cancelled_at);
  END IF;

  IF v_evidence IS NULL THEN
    RETURN NULL;
  END IF;
  v_amount := round(COALESCE(v_amount, 0), 2);
  IF v_amount <= 0 THEN
    RAISE EXCEPTION 'non_positive_amount: % % has a paid state but amount %', TG_TABLE_NAME, NEW.id, v_amount;
  END IF;

  v_role := CASE
              WHEN v_uid IS NULL THEN 'system'
              WHEN public.is_admin_user() THEN 'admin'
              ELSE 'customer'
            END;
  v_eligible_at := v_cancelled_at + make_interval(hours => public.refund_hold_hours());

  IF TG_TABLE_NAME = 'orders' THEN
    INSERT INTO public.refund_requests (
      order_id, user_id, payment_evidence, amount, currency, payment_method, zelle_account_id, payment_reference,
      payer_phone, cancellation_reason, cancelled_at, cancelled_by, cancelled_by_role, eligible_at, due_at)
    VALUES (
      NEW.id, NEW.user_id, v_evidence, v_amount, v_currency, COALESCE(NEW.payment_method, 'zelle'), NEW.zelle_account_id,
      NEW.payment_reference, NEW.payer_phone, NEW.rejection_reason, v_cancelled_at, v_uid, v_role, v_eligible_at,
      public.add_business_days(v_eligible_at, public.refund_business_days()))
    ON CONFLICT (order_id) WHERE status = 'pending' AND order_id IS NOT NULL DO NOTHING;
  ELSE
    INSERT INTO public.refund_requests (
      remittance_id, user_id, payment_evidence, amount, currency, payment_method, zelle_account_id, payment_reference,
      payer_phone, cancellation_reason, cancelled_at, cancelled_by, cancelled_by_role, eligible_at, due_at)
    VALUES (
      NEW.id, NEW.user_id, v_evidence, v_amount, v_currency, COALESCE(NEW.payment_method, 'zelle'), NEW.zelle_account_id,
      NEW.payment_reference, NEW.payer_phone, NEW.cancellation_reason, v_cancelled_at, COALESCE(v_uid, NEW.cancelled_by),
      v_role, v_eligible_at, public.add_business_days(v_eligible_at, public.refund_business_days()))
    ON CONFLICT (remittance_id) WHERE status = 'pending' AND remittance_id IS NOT NULL DO NOTHING;
  END IF;

  RETURN NULL;
 EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'refund_request_on_cancel: % % not captured (%: %)', TG_TABLE_NAME, NEW.id, SQLSTATE, SQLERRM;
  BEGIN
    INSERT INTO public.activity_logs (action, entity_type, entity_id, performed_by, description, metadata)
    VALUES ('refund_capture_failed', TG_TABLE_NAME, NEW.id, v_uid::text,
            'Refund request could not be created automatically; create it manually',
            jsonb_build_object('table', TG_TABLE_NAME, 'sqlstate', SQLSTATE, 'error', SQLERRM));
  EXCEPTION WHEN OTHERS THEN
    NULL; -- logging must not block the operation either
  END;
  RETURN NULL;
 END;
END;
$function$;

CREATE OR REPLACE FUNCTION public.refund_request_on_reopen()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
 BEGIN
  UPDATE public.refund_requests
     SET status = 'not_applicable',
         resolution_reason = 'reopened',
         resolved_by = auth.uid(),
         resolved_at = now()
   WHERE status = 'pending'
     AND CASE WHEN TG_TABLE_NAME = 'orders' THEN order_id ELSE remittance_id END = NEW.id;
  RETURN NULL;
 EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'refund_request_on_reopen: % % not closed (%: %)', TG_TABLE_NAME, NEW.id, SQLSTATE, SQLERRM;
  BEGIN
    INSERT INTO public.activity_logs (action, entity_type, entity_id, performed_by, description, metadata)
    VALUES ('refund_close_failed', TG_TABLE_NAME, NEW.id, auth.uid()::text,
            'Open refund request could not be closed after a reopen; close it manually',
            jsonb_build_object('table', TG_TABLE_NAME, 'sqlstate', SQLSTATE, 'error', SQLERRM));
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  RETURN NULL;
 END;
END;
$function$;

REVOKE ALL ON FUNCTION public.refund_request_on_cancel() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.refund_request_on_reopen() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_refund_request_on_cancel ON public.orders;
CREATE TRIGGER trg_refund_request_on_cancel
  AFTER UPDATE OF status ON public.orders
  FOR EACH ROW
  WHEN (NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled')
  EXECUTE FUNCTION public.refund_request_on_cancel();

DROP TRIGGER IF EXISTS trg_refund_request_on_cancel ON public.remittances;
CREATE TRIGGER trg_refund_request_on_cancel
  AFTER UPDATE OF status ON public.remittances
  FOR EACH ROW
  WHEN (NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled')
  EXECUTE FUNCTION public.refund_request_on_cancel();

DROP TRIGGER IF EXISTS trg_refund_request_on_reopen ON public.orders;
CREATE TRIGGER trg_refund_request_on_reopen
  AFTER UPDATE OF status ON public.orders
  FOR EACH ROW
  WHEN (OLD.status = 'cancelled' AND NEW.status IS DISTINCT FROM 'cancelled')
  EXECUTE FUNCTION public.refund_request_on_reopen();

DROP TRIGGER IF EXISTS trg_refund_request_on_reopen ON public.remittances;
CREATE TRIGGER trg_refund_request_on_reopen
  AFTER UPDATE OF status ON public.remittances
  FOR EACH ROW
  WHEN (OLD.status = 'cancelled' AND NEW.status IS DISTINCT FROM 'cancelled')
  EXECUTE FUNCTION public.refund_request_on_reopen();

COMMIT;
