-- ============================================================================
-- Super admin readjustment of a remittance already made.   PREPARED, NOT APPLIED
-- ============================================================================
-- WHY: a wrong rate or commission at the moment of a sale leaves the remittance with figures (and a profit) that differ
--   from what the business really earned. Today nothing can correct them: guard_remittance_money_columns and
--   guard_status_via_rpc refuse every direct change, and the existing RPCs only re-price a remittance whose payment is
--   still pending. The owner needs ONE audited way to correct status, amounts, rate and commission (the remittance
--   profit is commission_total + delivery_cost, so correcting commission_total corrects the profit).
--
-- WHAT:
--   * public.remittance_readjustments: append-only history (who, why, before/after snapshots). financial_audit_log keeps
--     the changed columns but has no reason column; this table keeps the reason. Readable by super admins only.
--   * public.superadmin_readjust_remittance(...): SECURITY DEFINER, super admin only. Locks the row, validates every
--     figure like the table CHECKs, recalculates amount_to_deliver from sent/commission/rate when it is not given, and
--     writes the history row. It passes guard_remittance_money_columns and guard_status_via_rpc because both only refuse
--     current_user authenticated/anon, and a DEFINER function runs as its owner. financial_audit_log records every changed
--     column with via_function = superadmin_readjust_remittance.
--   * A super admin cannot readjust a remittance that belongs to himself (same separation of duties as the rest of the
--     project; trg_remittances_admin_self_dealing also fires inside the function).
--
-- NOT DONE ON PURPOSE (documented limits, shown to the user in the form):
--   * Dates (payment_validated_at, delivered_at...) are not rewritten when the status changes.
--   * Cancelling a remittance whose payment was validated makes trg_refund_request_on_cancel open a pending refund request.
--   * A courier accrual already created (courier_accruals) is NOT recalculated: if the remittance was delivered its
--     margin snapshot stays as it was and must be adjusted with admin_adjust_accrual.
--
-- Preconditions: is_super_admin(), financial_audit_log, remittances_status_check. Idempotent.
-- ROLLBACK: supabase/rollbacks/20261112120000_superadmin_readjust_remittance_down.sql
-- Needs the owner's "dale" to apply remotely.
-- ============================================================================

BEGIN;

SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.remittance_readjustments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  remittance_id uuid NOT NULL REFERENCES public.remittances(id) ON DELETE CASCADE,
  set_by        uuid NOT NULL,
  reason        text NOT NULL CHECK (char_length(reason) BETWEEN 10 AND 500),
  before        jsonb NOT NULL,
  after         jsonb NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS remittance_readjustments_remittance_idx
  ON public.remittance_readjustments (remittance_id, created_at DESC);

ALTER TABLE public.remittance_readjustments ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.remittance_readjustments FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.remittance_readjustments TO authenticated;

DROP POLICY IF EXISTS remittance_readjustments_select_super_admin ON public.remittance_readjustments;
CREATE POLICY remittance_readjustments_select_super_admin ON public.remittance_readjustments
  FOR SELECT TO authenticated
  USING ((SELECT public.is_super_admin()));

CREATE OR REPLACE FUNCTION public.superadmin_readjust_remittance(
  p_remittance_id    uuid,
  p_reason           text,
  p_exchange_rate    numeric DEFAULT NULL,
  p_commission_total numeric DEFAULT NULL,
  p_amount_to_deliver numeric DEFAULT NULL,
  p_amount_sent      numeric DEFAULT NULL,
  p_status           text DEFAULT NULL
)
RETURNS public.remittances
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid     uuid := auth.uid();
  v_reason  text := btrim(COALESCE(p_reason, ''));
  v_rem     public.remittances%ROWTYPE;
  v_before  jsonb;
  v_sent    numeric;
  v_rate    numeric;
  v_comm    numeric;
  v_deliver numeric;
  v_status  text;
BEGIN
  IF v_uid IS NULL OR NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'insufficient_privilege: only a super administrator can readjust a remittance' USING ERRCODE = '42501';
  END IF;
  IF char_length(v_reason) < 10 OR char_length(v_reason) > 500 THEN
    RAISE EXCEPTION 'invalid_reason: a reason of 10 to 500 characters is required' USING ERRCODE = '22023';
  END IF;
  IF p_exchange_rate IS NULL AND p_commission_total IS NULL AND p_amount_to_deliver IS NULL
     AND p_amount_sent IS NULL AND p_status IS NULL THEN
    RAISE EXCEPTION 'nothing_to_change: give at least one value to readjust' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('remittance_readjust'));

  SELECT * INTO v_rem FROM public.remittances WHERE id = p_remittance_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'remittance_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_rem.user_id = v_uid THEN
    RAISE EXCEPTION 'own_operation_not_allowed: another administrator must readjust your own remittance' USING ERRCODE = '42501';
  END IF;

  IF p_status IS NOT NULL AND p_status NOT IN (
    'payment_pending', 'payment_proof_uploaded', 'payment_validated', 'payment_rejected',
    'processing', 'delivered', 'completed', 'cancelled'
  ) THEN
    RAISE EXCEPTION 'invalid_status: % is not a remittance status', p_status USING ERRCODE = '22023';
  END IF;
  IF p_exchange_rate IS NOT NULL AND (p_exchange_rate <= 0 OR p_exchange_rate <> round(p_exchange_rate, 4)) THEN
    RAISE EXCEPTION 'invalid_rate: must be greater than 0 with at most 4 decimals' USING ERRCODE = '22023';
  END IF;
  IF p_amount_sent IS NOT NULL AND (p_amount_sent <= 0 OR p_amount_sent <> round(p_amount_sent, 2)) THEN
    RAISE EXCEPTION 'invalid_amount: the amount sent must be greater than 0 with at most 2 decimals' USING ERRCODE = '22023';
  END IF;
  IF p_amount_to_deliver IS NOT NULL AND (p_amount_to_deliver <= 0 OR p_amount_to_deliver <> round(p_amount_to_deliver, 2)) THEN
    RAISE EXCEPTION 'invalid_amount: the amount to deliver must be greater than 0 with at most 2 decimals' USING ERRCODE = '22023';
  END IF;

  v_sent := COALESCE(p_amount_sent, v_rem.amount_sent);
  v_rate := COALESCE(p_exchange_rate, v_rem.exchange_rate);
  v_comm := COALESCE(p_commission_total, v_rem.commission_total);
  v_status := COALESCE(p_status, v_rem.status);

  IF v_comm < 0 OR v_comm >= v_sent OR v_comm <> round(v_comm, 2) THEN
    RAISE EXCEPTION 'invalid_commission: must be between 0 and the amount sent (excluded), with at most 2 decimals'
      USING ERRCODE = '22023';
  END IF;

  -- Without an explicit figure, the amount to deliver follows sent, commission and rate (same formula as the quote).
  v_deliver := CASE
    WHEN p_amount_to_deliver IS NOT NULL THEN p_amount_to_deliver
    WHEN p_amount_sent IS NOT NULL OR p_exchange_rate IS NOT NULL OR p_commission_total IS NOT NULL
      THEN round((v_sent - v_comm) * round(v_rate, 4), 2)
    ELSE v_rem.amount_to_deliver
  END;
  IF v_deliver <= 0 THEN
    RAISE EXCEPTION 'invalid_amount: the amount to deliver must be greater than 0' USING ERRCODE = '22023';
  END IF;

  IF v_sent = v_rem.amount_sent AND v_rate = v_rem.exchange_rate AND v_comm = v_rem.commission_total
     AND v_deliver = v_rem.amount_to_deliver AND v_status = v_rem.status THEN
    RAISE EXCEPTION 'nothing_to_change: the given values equal the current ones' USING ERRCODE = '22023';
  END IF;

  v_before := jsonb_build_object(
    'status', v_rem.status, 'amount_sent', v_rem.amount_sent, 'exchange_rate', v_rem.exchange_rate,
    'commission_total', v_rem.commission_total, 'amount_to_deliver', v_rem.amount_to_deliver
  );

  -- audit_remittance_status_change copies this note into remittance_status_history.
  PERFORM set_config('app.status_note', 'Super admin readjustment: ' || v_reason, true);

  UPDATE public.remittances
     SET amount_sent       = v_sent,
         exchange_rate     = v_rate,
         commission_total  = v_comm,
         amount_to_deliver = v_deliver,
         status            = v_status,
         updated_at        = now()
   WHERE id = p_remittance_id
   RETURNING * INTO v_rem;

  PERFORM set_config('app.status_note', '', true);

  INSERT INTO public.remittance_readjustments (remittance_id, set_by, reason, before, after)
  VALUES (
    p_remittance_id, v_uid, v_reason, v_before,
    jsonb_build_object(
      'status', v_rem.status, 'amount_sent', v_rem.amount_sent, 'exchange_rate', v_rem.exchange_rate,
      'commission_total', v_rem.commission_total, 'amount_to_deliver', v_rem.amount_to_deliver
    )
  );

  RETURN v_rem;
END;
$function$;

REVOKE ALL ON FUNCTION public.superadmin_readjust_remittance(uuid, text, numeric, numeric, numeric, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.superadmin_readjust_remittance(uuid, text, numeric, numeric, numeric, numeric, text) TO authenticated;

COMMIT;
