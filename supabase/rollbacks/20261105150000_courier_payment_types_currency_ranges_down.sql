-- ROLLBACK of 20261105150000_courier_payment_types_currency_ranges.sql (phase A). Run it BEFORE any M3 / M2 / M1 rollback.
-- It restores the M2 body of _courier_compute_accrual verbatim, re-grants EXECUTE on admin_set_messenger_payment_type (v1) to
-- authenticated, drops _courier_rule_resolve_v2, _courier_rule_coverage and admin_set_messenger_payment_type_v2, restores the
-- M1 CHECKs and drops the columns currency / fixed_amount.
-- GUARD: aborts (55000) while any rule depends on phase A (method fixed_amount, currency CUP, percent_of_base on orders):
--   rows are append-only and such rules cannot be represented by M1. Export them and decide first.
-- exchange_rates.rate_type is NOT dropped: production had it before phase A (phase A only reconciles the repo chain).
-- Accruals already written keep their frozen rule_snapshot (reasons no_fx / no_tier_match stay as history).
-- DEPLOY: roll the frontend back to the v1 client together with this file.
BEGIN;

SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.messenger_payment_types
              WHERE method = 'fixed_amount' OR currency = 'CUP' OR (method = 'percent_of_base' AND applies_to <> 'remittance')) THEN
    RAISE EXCEPTION 'messenger_payment_types has phase A rules (fixed_amount, CUP currency or percent on orders): they cannot be represented after this rollback'
      USING ERRCODE = '55000';
  END IF;
END $$;

-- M2 body of the accrual calculation, verbatim (20261031110000_delivery_assignments_and_accruals.sql)
CREATE OR REPLACE FUNCTION public._courier_compute_accrual(
  p_kind       text,
  p_op_id      uuid,
  p_courier_id uuid,
  p_source     text
)
RETURNS TABLE (
  rule_id uuid, amount_cup numeric, fx_used numeric, amount_usd numeric, rule_snapshot jsonb,
  margin_usd numeric, margin_pct numeric, margin_status text
)
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_sent     numeric;
  v_deliver  numeric;
  v_rate     numeric;
  v_cur_sent text;
  v_cur_del  text;
  v_comm     numeric;
  v_dcost    numeric;
  v_zone     uuid;
  v_type     uuid;
  v_tier     numeric;
  v_est      numeric;
  v_rule     public.messenger_payment_types%ROWTYPE;
  v_cup      numeric;
  v_fx       numeric;
  v_fx_src   text := 'none';
  v_usd      numeric;
  v_reason   text;
  v_income   numeric;
  v_cost     numeric;
  v_warn     numeric;
  v_crit     numeric;
  v_m        record;
BEGIN
  IF p_kind = 'remittance' THEN
    SELECT r.amount_sent, r.amount_to_deliver, r.exchange_rate, r.currency_sent, r.currency_delivered,
           r.commission_total, r.delivery_cost, r.shipping_zone_id, r.remittance_type_id
      INTO v_sent, v_deliver, v_rate, v_cur_sent, v_cur_del, v_comm, v_dcost, v_zone, v_type
      FROM public.remittances r WHERE r.id = p_op_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'operation_not_found' USING ERRCODE = 'P0002';
    END IF;
    v_tier := CASE WHEN v_cur_sent = 'USD' THEN v_sent END;
    -- the frozen rate of the remittance is a USD->CUP rate only when it was sent in USD and delivered in CUP
    IF v_cur_sent = 'USD' AND v_cur_del = 'CUP' AND v_rate > 0 THEN
      v_fx := v_rate;
      v_fx_src := 'remittance';
    END IF;
    SELECT c.amount_usd INTO v_est FROM public.remittance_courier_costs c WHERE c.remittance_id = p_op_id;
  ELSIF p_kind = 'order' THEN
    SELECT CASE WHEN cur.code = 'USD' THEN o.subtotal END, o.shipping_zone_id
      INTO v_tier, v_zone
      FROM public.orders o LEFT JOIN public.currencies cur ON cur.id = o.currency_id WHERE o.id = p_op_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'operation_not_found' USING ERRCODE = 'P0002';
    END IF;
    SELECT c.amount_usd INTO v_est FROM public.order_courier_costs c WHERE c.order_id = p_op_id;
  ELSE
    RAISE EXCEPTION 'invalid_argument: unknown operation kind' USING ERRCODE = '22023';
  END IF;

  IF v_fx IS NULL THEN
    SELECT er.rate INTO v_fx
      FROM public.exchange_rates er
      JOIN public.currencies f ON f.id = er.from_currency_id AND f.code = 'USD'
      JOIN public.currencies t ON t.id = er.to_currency_id AND t.code = 'CUP'
     WHERE er.is_active
     ORDER BY er.effective_date DESC LIMIT 1;
    IF v_fx IS NOT NULL THEN v_fx_src := 'exchange_rates'; END IF;
  END IF;

  SELECT m.* INTO v_rule FROM public.messenger_payment_types m
   WHERE m.id = public._courier_rule_resolve(p_kind, p_courier_id, v_zone, v_type, v_tier, now());
  IF NOT FOUND THEN
    v_reason := 'no_rule';
  ELSE
    v_cup := CASE v_rule.method
      WHEN 'fixed_cup' THEN v_rule.fixed_cup
      WHEN 'per_usd_delivered' THEN round(v_rule.cup_per_usd * CASE v_rule.base
          WHEN 'nominal_usd'   THEN CASE WHEN v_cur_sent = 'USD' THEN v_sent END
          WHEN 'delivered_cup' THEN CASE WHEN v_cur_sent = 'USD' AND v_cur_del = 'CUP' AND v_rate > 0 THEN round(v_deliver / v_rate, 2) END
        END, 2)
      WHEN 'percent_of_base' THEN CASE v_rule.base
          WHEN 'nominal_usd'   THEN CASE WHEN v_cur_sent = 'USD' AND v_fx IS NOT NULL THEN round(round(v_rule.percent / 100 * v_sent, 2) * v_fx, 2) END
          WHEN 'delivered_cup' THEN CASE WHEN v_cur_del = 'CUP' THEN round(v_rule.percent / 100 * v_deliver, 2) END
        END
    END;
    IF v_cup IS NULL THEN v_reason := 'no_amount_basis'; END IF;
  END IF;

  IF v_cup IS NOT NULL AND v_fx IS NOT NULL THEN
    v_usd := round(v_cup / v_fx, 2);
  END IF;

  -- Margin: remittances only (the order profit is not stored in SQL). Cost = this accrual, else the legacy estimate.
  IF p_kind = 'remittance' THEN
    v_income := v_comm + v_dcost;
  END IF;
  v_cost := COALESCE(v_usd, v_est);
  SELECT s.warning_pct, s.critical_pct INTO v_warn, v_crit FROM public.courier_margin_settings s WHERE s.kind = p_kind;
  SELECT * INTO v_m FROM public._operation_margin(v_tier, v_income, v_cost, v_warn, v_crit);

  RETURN QUERY SELECT
    v_rule.id, v_cup, v_fx, v_usd,
    jsonb_strip_nulls(jsonb_build_object(
      'source', p_source, 'reason', v_reason, 'method', v_rule.method, 'fx_source', v_fx_src,
      'cost_estimated', (v_usd IS NULL AND v_est IS NOT NULL),
      'rule', CASE WHEN v_rule.id IS NULL THEN NULL ELSE jsonb_build_object(
        'code', v_rule.code, 'version', v_rule.version, 'name', v_rule.name, 'applies_to', v_rule.applies_to,
        'method', v_rule.method, 'fixed_cup', v_rule.fixed_cup, 'cup_per_usd', v_rule.cup_per_usd, 'percent', v_rule.percent,
        'base', v_rule.base, 'courier_id', v_rule.courier_id, 'zone_id', v_rule.shipping_zone_id,
        'type_id', v_rule.remittance_type_id, 'amount_from', v_rule.amount_from, 'amount_to', v_rule.amount_to) END,
      'inputs', jsonb_build_object(
        'amount_sent', v_sent, 'amount_to_deliver', v_deliver, 'rate', v_rate, 'currency_sent', v_cur_sent,
        'currency_delivered', v_cur_del, 'tier_amount', v_tier, 'commission_total', v_comm, 'delivery_cost', v_dcost,
        'zone_id', v_zone, 'type_id', v_type, 'estimate_usd', v_est))),
    v_m.margin_usd, v_m.margin_pct, v_m.status;
END;
$function$;
REVOKE ALL ON FUNCTION public._courier_compute_accrual(text, uuid, uuid, text) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.admin_set_messenger_payment_type(text, text, text, text, numeric, numeric, numeric, text, uuid, uuid, uuid, numeric, numeric, timestamptz, timestamptz) TO authenticated;

DROP FUNCTION IF EXISTS public.admin_set_messenger_payment_type_v2(text, text, text, text, numeric, numeric, numeric, text, uuid, uuid, uuid, numeric, numeric, timestamptz, timestamptz, text, numeric, boolean);
DROP FUNCTION IF EXISTS public._courier_rule_coverage(text, uuid, uuid, uuid, text, timestamptz, timestamptz);
DROP FUNCTION IF EXISTS public._courier_rule_resolve_v2(text, uuid, uuid, uuid, numeric, text, numeric, timestamptz);

ALTER TABLE public.messenger_payment_types DROP CONSTRAINT IF EXISTS messenger_payment_types_no_nan_chk;
ALTER TABLE public.messenger_payment_types DROP CONSTRAINT IF EXISTS messenger_payment_types_base_scope_chk;
ALTER TABLE public.messenger_payment_types DROP CONSTRAINT IF EXISTS messenger_payment_types_currency_chk;
ALTER TABLE public.messenger_payment_types DROP CONSTRAINT IF EXISTS messenger_payment_types_fixed_amount_chk;
ALTER TABLE public.messenger_payment_types DROP CONSTRAINT IF EXISTS messenger_payment_types_params_chk;
ALTER TABLE public.messenger_payment_types DROP CONSTRAINT IF EXISTS messenger_payment_types_method_scope_chk;
ALTER TABLE public.messenger_payment_types DROP CONSTRAINT IF EXISTS messenger_payment_types_method_check;
ALTER TABLE public.messenger_payment_types DROP COLUMN IF EXISTS fixed_amount;
ALTER TABLE public.messenger_payment_types DROP COLUMN IF EXISTS currency;

-- M1 CHECKs, verbatim
ALTER TABLE public.messenger_payment_types ADD CONSTRAINT messenger_payment_types_method_check
  CHECK (method IN ('fixed_cup', 'per_usd_delivered', 'percent_of_base'));
ALTER TABLE public.messenger_payment_types ADD CONSTRAINT messenger_payment_types_params_chk CHECK (
     (method = 'fixed_cup'         AND fixed_cup IS NOT NULL AND cup_per_usd IS NULL AND percent IS NULL AND base IS NULL)
  OR (method = 'per_usd_delivered' AND cup_per_usd IS NOT NULL AND fixed_cup IS NULL AND percent IS NULL AND base IS NOT NULL)
  OR (method = 'percent_of_base'   AND percent IS NOT NULL AND fixed_cup IS NULL AND cup_per_usd IS NULL AND base IS NOT NULL));
ALTER TABLE public.messenger_payment_types ADD CONSTRAINT messenger_payment_types_method_scope_chk
  CHECK (method = 'fixed_cup' OR applies_to = 'remittance');

COMMIT;
