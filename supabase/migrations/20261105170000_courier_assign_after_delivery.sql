-- ============================================================================
-- Courier phase C: assign a courier AFTER delivery. PREPARED, NOT APPLIED
-- Deploy: M1 -> M2 -> M3 -> A -> B -> C, then enable the matching frontend.
-- Adds functions ONLY; no data backfill, columns, tables, triggers or existing function replacements.
-- Pricing: same v2 resolver (courier > zone > type > tier > general, ranges (from,to]), TODAY's rules.
-- USD->CUP remittance: frozen operation rate for ALL conversions; orders / other remittances: current rate.
-- Preview writes nothing. Confirmation requires the reviewed server quote token, recalculated under locks.
-- Unknown CUP quotes are preview-only: confirmation refuses without consuming the eligible accrual.
-- Repeated identical confirmation is a no-op; every other assigned / settled / void accrual is refused.
-- Cost remains attributed to the operation date: past-month figures can change, no frozen closings.
-- ROLLBACK: supabase/rollbacks/20261105170000_courier_assign_after_delivery_down.sql
-- C rollback is independent of B -> A rollback and never restores/deletes business data or audit evidence.
-- B must still be rolled back BEFORE A. Disable Phase C UI if A is removed; C pricing needs A's columns/resolver.
-- Drop C before M2/M1. No CASCADE; original delivery and settlement paths remain untouched.
-- ============================================================================
BEGIN;
SET LOCAL lock_timeout = '5s';

-- Separate calculator derived from phase A, using the currently installed v2 resolver (including B subscriptions).
-- The existing _courier_compute_accrual and the delivery path are deliberately left byte-for-byte unchanged.
CREATE FUNCTION public._courier_compute_accrual_retroactive(
  p_kind       text,
  p_op_id      uuid,
  p_courier_id uuid
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
  v_rule_id  uuid;
  v_cup      numeric;
  v_fx       numeric;
  v_live_fx  numeric;
  v_fx_src   text := 'none';
  v_usd      numeric;
  v_reason   text;
  v_income   numeric;
  v_cost     numeric;
  v_warn     numeric;
  v_crit     numeric;
  v_m        record;
  v_subscribed boolean := false;
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
    -- phase A: the order value (range and percent base) is the subtotal, in the order currency (USD)
    SELECT CASE WHEN cur.code = 'USD' THEN o.subtotal END, o.shipping_zone_id, o.subtotal, cur.code
      INTO v_tier, v_zone, v_sent, v_cur_sent
      FROM public.orders o LEFT JOIN public.currencies cur ON cur.id = o.currency_id WHERE o.id = p_op_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'operation_not_found' USING ERRCODE = 'P0002';
    END IF;
    SELECT c.amount_usd INTO v_est FROM public.order_courier_costs c WHERE c.order_id = p_op_id;
  ELSE
    RAISE EXCEPTION 'invalid_argument: unknown operation kind' USING ERRCODE = '22023';
  END IF;

  -- a NaN operation value passes the `> 0` CHECKs: treat it as unknown (no tramo, no percent base, no margin)
  v_sent := NULLIF(v_sent, 'NaN'::numeric);
  v_deliver := NULLIF(v_deliver, 'NaN'::numeric);
  v_tier := NULLIF(v_tier, 'NaN'::numeric);

  -- the active USD->CUP row, read live (no cache, no fail-open helper); prefers rate_type 'general', ties broken by id
  SELECT er.rate INTO v_live_fx
    FROM public.exchange_rates er
    JOIN public.currencies f ON f.id = er.from_currency_id AND f.code = 'USD'
    JOIN public.currencies t ON t.id = er.to_currency_id AND t.code = 'CUP'
   WHERE er.is_active
   ORDER BY (er.rate_type = 'general') DESC NULLS LAST, er.effective_date DESC, er.id LIMIT 1;
  -- a NaN rate passes `rate > 0`: treat it as missing (never multiply an accrual by NaN)
  -- (fx_used numeric(15,6) cannot overflow: its sources are exchange_rates.rate (15,6) and remittances.exchange_rate (12,4))
  v_live_fx := NULLIF(v_live_fx, 'NaN'::numeric);
  v_fx := NULLIF(v_fx, 'NaN'::numeric);
  -- Retroactive USD->CUP conversions MUST use the operation frozen rate, never a historical rates row.
  IF NOT (p_kind = 'remittance' AND v_cur_sent = 'USD' AND v_cur_del = 'CUP') AND v_fx IS NULL AND v_live_fx IS NOT NULL THEN
    v_fx := v_live_fx;
    v_fx_src := 'exchange_rates';
  END IF;

  SELECT r.rule_id, r.reason INTO v_rule_id, v_reason
    FROM public._courier_rule_resolve_v2(p_kind, p_courier_id, v_zone, v_type, v_sent, v_cur_sent, v_fx, now()) r;
  SELECT m.* INTO v_rule FROM public.messenger_payment_types m WHERE m.id = v_rule_id;
  IF NOT FOUND THEN
    v_reason := COALESCE(v_reason, 'no_rule');
  ELSE
    v_cup := CASE v_rule.method
      WHEN 'fixed_cup' THEN v_rule.fixed_cup
      WHEN 'fixed_amount' THEN CASE v_rule.currency
          WHEN 'CUP' THEN v_rule.fixed_amount
          WHEN 'USD' THEN CASE WHEN v_fx IS NOT NULL THEN round(v_rule.fixed_amount * v_fx, 2) END
        END
      WHEN 'per_usd_delivered' THEN round(v_rule.cup_per_usd * CASE v_rule.base
          WHEN 'nominal_usd'   THEN CASE WHEN v_cur_sent = 'USD' THEN v_sent END
          WHEN 'delivered_cup' THEN CASE WHEN v_cur_sent = 'USD' AND v_cur_del = 'CUP' AND v_rate > 0 THEN round(v_deliver / v_rate, 2) END
        END, 2)
      WHEN 'percent_of_base' THEN CASE v_rule.base
          WHEN 'nominal_usd'   THEN CASE WHEN v_cur_sent = 'USD' AND v_fx IS NOT NULL THEN round(round(v_rule.percent / 100 * v_sent, 2) * v_fx, 2) END
          WHEN 'delivered_cup' THEN CASE WHEN v_cur_del = 'CUP' THEN round(v_rule.percent / 100 * v_deliver, 2) END
        END
    END;
    IF v_cup IS NULL THEN
      v_reason := CASE
        WHEN v_rule.method = 'fixed_amount' AND v_rule.currency = 'USD' AND v_fx IS NULL THEN 'no_fx'
        WHEN v_rule.method = 'percent_of_base' AND v_rule.base = 'nominal_usd' AND v_cur_sent = 'USD' AND v_fx IS NULL THEN 'no_fx'
        ELSE 'no_amount_basis' END;
    END IF;
  END IF;

  IF v_cup IS NOT NULL AND v_rule.method = 'fixed_amount' AND v_rule.currency = 'USD' THEN
    -- The fixed USD figure uses the same chosen rate for pricing and conversion.
    v_usd := v_rule.fixed_amount;
  ELSIF v_cup IS NOT NULL AND v_fx IS NOT NULL THEN
    v_usd := round(v_cup / v_fx, 2);
  END IF;

  -- courier_accruals.amount_cup / amount_usd are numeric(12,2): an overflow would make the (non-blocking) trigger swallow
  -- the error and leave NO accrual. Keep the row, with an unknown amount and a reason.
  IF abs(v_cup) >= 1e10 OR abs(v_usd) >= 1e10 OR v_cup = 'NaN'::numeric OR v_usd = 'NaN'::numeric THEN
    v_cup := NULL;
    v_usd := NULL;
    v_reason := 'amount_out_of_range';
  END IF;

  -- Margin: remittances only (the order profit is not stored in SQL). Cost = this accrual, else the legacy estimate.
  IF p_kind = 'remittance' THEN
    v_income := v_comm + v_dcost;
  END IF;
  v_cost := COALESCE(v_usd, v_est);
  SELECT s.warning_pct, s.critical_pct INTO v_warn, v_crit FROM public.courier_margin_settings s WHERE s.kind = p_kind;
  SELECT * INTO v_m FROM public._operation_margin(v_tier, v_income, v_cost, v_warn, v_crit);
  -- margin_usd numeric(12,2) / margin_pct numeric(10,4): a margin they cannot store is unknown, the accrual is still written
  IF v_m.margin_usd = 'NaN'::numeric OR abs(v_m.margin_usd) >= 1e10 THEN
    v_m.margin_usd := NULL;
    v_m.margin_pct := NULL;
    v_m.status := 'unknown';
  ELSIF v_m.margin_pct = 'NaN'::numeric OR abs(v_m.margin_pct) >= 1e6 THEN
    v_m.margin_pct := NULL;
    v_m.status := 'unknown';
  END IF;

  -- Optional phase B metadata: no catalog dependency, so B can roll back independently.
  IF v_rule.courier_id IS NULL AND p_courier_id IS NOT NULL
     AND to_regclass('public.courier_payment_type_subscriptions') IS NOT NULL THEN
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.courier_payment_type_subscriptions
                            WHERE is_active AND courier_id = $1 AND payment_type_code = $2)'
      INTO v_subscribed USING p_courier_id, v_rule.code;
  END IF;
  RETURN QUERY SELECT
    v_rule.id, v_cup, v_fx, v_usd,
    jsonb_strip_nulls(jsonb_build_object(
      'source', 'retroactive', 'retroactive', true, 'via_subscription', v_subscribed,
      'precedence', CASE WHEN v_rule.id IS NULL THEN 'none'
        WHEN v_rule.courier_id IS NOT NULL OR v_subscribed THEN 'courier'
        WHEN v_rule.shipping_zone_id IS NOT NULL THEN 'zone'
        WHEN v_rule.remittance_type_id IS NOT NULL THEN 'type'
        WHEN v_rule.amount_from IS NOT NULL OR v_rule.amount_to IS NOT NULL THEN 'tier'
        ELSE 'general' END, 'reason', v_reason, 'method', v_rule.method, 'fx_source', v_fx_src,
      'cost_estimated', (v_usd IS NULL AND v_est IS NOT NULL),
      'rule', CASE WHEN v_rule.id IS NULL THEN NULL ELSE jsonb_build_object(
        'code', v_rule.code, 'version', v_rule.version, 'name', v_rule.name, 'applies_to', v_rule.applies_to,
        'method', v_rule.method, 'fixed_cup', v_rule.fixed_cup, 'cup_per_usd', v_rule.cup_per_usd, 'percent', v_rule.percent,
        'base', v_rule.base, 'courier_id', v_rule.courier_id, 'zone_id', v_rule.shipping_zone_id,
        'type_id', v_rule.remittance_type_id, 'amount_from', v_rule.amount_from, 'amount_to', v_rule.amount_to,
        'currency', v_rule.currency, 'fixed_amount', v_rule.fixed_amount) END,
      'inputs', jsonb_build_object(
        'amount_sent', v_sent, 'amount_to_deliver', v_deliver, 'rate', v_rate, 'currency_sent', v_cur_sent,
        'currency_delivered', v_cur_del, 'tier_amount', v_tier, 'commission_total', v_comm, 'delivery_cost', v_dcost,
        'zone_id', v_zone, 'type_id', v_type, 'estimate_usd', v_est, 'live_fx', v_live_fx))),
    v_m.margin_usd, v_m.margin_pct, v_m.status;
END;
$function$;
REVOKE ALL ON FUNCTION public._courier_compute_accrual_retroactive(text, uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.admin_assign_courier_after_delivery(
  p_kind text,
  p_id uuid,
  p_courier_id uuid,
  p_reason text,
  p_confirm boolean DEFAULT false,
  p_preview_token text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid uuid := public._courier_require_admin();
  v_reason text := btrim(COALESCE(p_reason, ''));
  v_status text;
  v_a public.courier_accruals%ROWTYPE;
  v_c record;
  v_quote jsonb;
  v_token text;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'insufficient_privilege: only a super administrator can assign a courier after delivery' USING ERRCODE = '42501';
  END IF;
  IF p_kind IS NULL OR p_kind NOT IN ('order', 'remittance') THEN
    RAISE EXCEPTION 'invalid_argument: kind must be order or remittance' USING ERRCODE = '22023';
  END IF;
  IF char_length(v_reason) NOT BETWEEN 10 AND 500 THEN
    RAISE EXCEPTION 'invalid_reason: a reason of 10 to 500 characters is required' USING ERRCODE = '22023';
  END IF;
  -- Same domain lock as rule/subscription edits; then operation -> accrual locks (delivery lock order).
  -- Settlement / void / reassign / recalculate serialize through the accrual row lock too.
  PERFORM pg_advisory_xact_lock(hashtext('courier_rules'));
  PERFORM pg_advisory_xact_lock(hashtext('courier_after_delivery_' || p_kind));
  IF p_kind = 'remittance' THEN
    SELECT r.status INTO v_status FROM public.remittances r WHERE r.id = p_id FOR UPDATE;
  ELSE
    SELECT o.status INTO v_status FROM public.orders o WHERE o.id = p_id FOR UPDATE;
  END IF;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'operation_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_status NOT IN ('delivered', 'completed') THEN
    RAISE EXCEPTION 'invalid_status: only delivered or completed operations can be assigned retroactively' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_a FROM public.courier_accruals a
   WHERE a.source_kind = p_kind AND a.source_id = p_id AND a.component = 'delivery' FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'accrual_not_found' USING ERRCODE = 'P0002';
  END IF;
  -- Exact retries acknowledge the frozen result even if settlement happened since confirmation.
  -- Voided accruals are never acknowledged, and this branch must never write or reprice.
  IF p_confirm IS TRUE AND v_a.status IN ('calculated', 'paid') AND v_a.courier_id = p_courier_id
     AND v_a.rule_snapshot->>'assignment_reason' = v_reason
     AND v_a.rule_snapshot->>'assignment_preview_token' = p_preview_token
     AND v_a.rule_snapshot->>'retroactive' = 'true' THEN
    RETURN v_a.rule_snapshot->'assignment_preview' || jsonb_build_object('confirmed', true, 'already_assigned', true);
  END IF;
  IF v_a.status <> 'calculated' OR v_a.payment_id IS NOT NULL THEN
    RAISE EXCEPTION 'invalid_status: only calculated unpaid delivery accruals can be assigned' USING ERRCODE = '22023';
  END IF;
  IF v_a.courier_id IS NOT NULL THEN
    RAISE EXCEPTION 'already_assigned: the accrual already has a courier' USING ERRCODE = '22023';
  END IF;
  IF v_a.amount_cup IS NOT NULL OR v_a.amount_usd IS NOT NULL THEN
    RAISE EXCEPTION 'invalid_status: only an unknown-cost accrual can be assigned retroactively' USING ERRCODE = '22023';
  END IF;
  IF p_courier_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.couriers WHERE id = p_courier_id AND is_active FOR SHARE) THEN
    RAISE EXCEPTION 'invalid_argument: courier not found or inactive' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_c FROM public._courier_compute_accrual_retroactive(p_kind, p_id, p_courier_id);
  v_quote := jsonb_build_object(
    'accrual_id', v_a.id, 'source_kind', p_kind, 'source_id', p_id, 'courier_id', p_courier_id,
    'amount', v_c.amount_cup, 'currency', 'CUP', 'amount_cup', v_c.amount_cup, 'amount_usd', v_c.amount_usd,
    'rule_id', v_c.rule_id, 'rule', v_c.rule_snapshot->'rule', 'precedence', v_c.rule_snapshot->'precedence',
    'reason', v_c.rule_snapshot->'reason', 'fx_used', v_c.fx_used, 'fx_source', v_c.rule_snapshot->'fx_source',
    'retroactive', true, 'delivered_at', v_a.delivered_at,
    'warnings', jsonb_build_array('past_months_change') || CASE WHEN v_c.amount_cup IS NULL OR v_c.amount_usd IS NULL
      THEN jsonb_build_array(COALESCE(v_c.rule_snapshot->>'reason', 'no_fx')) ELSE '[]'::jsonb END);
  -- Binds the quote to the inputs, reason and all computed accounting fields (no client-supplied amount accepted).
  v_token := md5(jsonb_build_object('quote', v_quote, 'calculation', to_jsonb(v_c), 'reason', v_reason)::text);
  v_quote := v_quote || jsonb_build_object('preview_token', v_token, 'confirmed', false);
  IF p_confirm IS NOT TRUE THEN RETURN v_quote; END IF;
  IF p_preview_token IS NULL THEN
    RAISE EXCEPTION 'preview_required: review a server preview before confirming' USING ERRCODE = '22023';
  END IF;
  IF p_preview_token <> v_token THEN
    RAISE EXCEPTION 'preview_changed: pricing or inputs changed; review a new preview' USING ERRCODE = '22023';
  END IF;
  IF v_c.amount_cup IS NULL THEN
    RAISE EXCEPTION 'no_amount: %', COALESCE(v_c.rule_snapshot->>'reason', 'no_amount_basis') USING ERRCODE = '22023';
  END IF;
  UPDATE public.courier_accruals
     SET courier_id = p_courier_id, rule_id = v_c.rule_id,
         rule_snapshot = v_c.rule_snapshot || jsonb_build_object(
           'assignment_reason', v_reason, 'assigned_by', v_uid, 'assigned_at', now(),
           'assignment_preview_token', v_token, 'assignment_preview', v_quote),
         amount_cup = v_c.amount_cup, fx_used = v_c.fx_used, amount_usd = v_c.amount_usd,
         margin_usd = v_c.margin_usd, margin_pct = v_c.margin_pct, margin_status = v_c.margin_status
   WHERE id = v_a.id;
  -- Do not edit delivery_assignments: those describe the pre-delivery workflow, not retroactive accounting.
  PERFORM public._courier_audit('courier_accruals', v_a.id, 'retroactive_assignment', to_jsonb(v_a)::text,
    jsonb_build_object('reason', v_reason, 'preview', v_quote)::text, 'UPDATE');
  RETURN v_quote || jsonb_build_object('confirmed', true, 'already_assigned', false);
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_assign_courier_after_delivery(text, uuid, uuid, text, boolean, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_assign_courier_after_delivery(text, uuid, uuid, text, boolean, text) TO authenticated;
COMMIT;
