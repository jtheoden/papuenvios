-- ============================================================================
-- Courier payment types, phase A: currency per type, fixed amount in USD or CUP, amount ranges per operation value.
--   PREPARED, NOT APPLIED
-- ============================================================================
-- WHY: the owner wants, besides percentages, a FIXED amount in a chosen currency and rules by RANGE of the operation value
--   ("more than X" / "up to Y (included)" / "more than X and up to Y"), with overlaps blocked and gaps only after an explicit
--   confirmation. Every value is typed by the owner: nothing is seeded here.
-- WHAT:
--   1. messenger_payment_types gains `currency` (USD | CUP, default USD): the currency of the range comparison AND of the
--      fixed amount; and `fixed_amount` numeric(12,2) >= 0 for the new method 'fixed_amount' (fixed_cup is kept as is).
--      CHECKs rebuilt: method_check (+fixed_amount), params_chk (fixed_amount branch), method_scope_chk (percent of the nominal
--      USD is valid for orders: their base is the USD subtotal), new base_scope_chk (delivered_cup stays remittance-only).
--   2. Operation value: orders.subtotal (USD, before discounts and shipping) or remittances.amount_sent (in currency_sent).
--      It is converted to the currency of EACH candidate rule with the active USD->CUP exchange_rates row, read LIVE inside the
--      accrual (no cache, never get_order_exchange_rate / get_market_exchange_rate: they fail open with 1.0). Fail CLOSED:
--      a tiered candidate that needs a missing rate stops the resolution with reason 'no_fx' (never a lower-precedence rule).
--   3. _courier_rule_resolve_v2(): same precedence as v1 (courier > zone > type > tramo > general), returns (rule_id, reason)
--      with reason no_rule / no_tier_match / no_fx. v1 is kept untouched (rollback). DIFFERS FROM v1 on purpose when a
--      tiered candidate needs a rate that is missing (value in another currency, no active USD->CUP row): v1 skipped the
--      tramo and fell to a lower-precedence rule; v2 stops with 'no_fx' (fail closed).
--   Guards (review): NaN is refused in every numeric parameter and by messenger_payment_types_no_nan_chk (it passes
--      `>= 0`); amounts above 9999999999.99, percent beyond 3 decimals and cup_per_usd beyond 4 are 22023; an accrual
--      that would overflow numeric(12,2) is kept with amount NULL and reason 'amount_out_of_range'; a NaN rate is "no rate".
--   4. _courier_compute_accrual (same signature): orders take the subtotal as value and as percent base; fixed USD is converted
--      at the live rate in force at delivery (amount_usd = the fixed figure, fx_used = that rate); reasons no_fx / no_tier_match
--      are frozen in rule_snapshot. The delivery is NEVER blocked (the trigger is not touched).
--   5. _courier_rule_coverage(): gaps of the tiered rules of one scope (start, between, end); none when a rule without tramo
--      exists in the same scope.
--   6. admin_set_messenger_payment_type_v2(): v1 parameters + p_currency, p_fixed_amount, p_accept_gaps. Validated server
--      side under pg_advisory_xact_lock('courier_rules'): at most 2 decimals (numeric(12,2) would round silently), one currency
--      per tiered scope (22023 mixed_currency_scope), overlaps (23P01), gaps (22023 coverage_gap with a JSON DETAIL unless
--      p_accept_gaps; the acceptance and the gaps are written to financial_audit_log). v1 is NOT dropped: EXECUTE is revoked
--      from API roles (a DEFAULT-extended overload would be ambiguous for PostgREST).
-- RANGES: half-open (from, to] in exact cents. "Up to Y" is stored as from NULL / to Y and covers 0.00.
-- SAFETY: additive and reversible. Production has 0 messenger_payment_types rows; the existing accruals (reason no_rule) are
--   neither read nor written. _order_transition / _remittance_transition are not touched. Apply AFTER M1..M3.
-- DEPLOY: apply together with the frontend that calls v2 (the old UI calls v1, which this migration closes).
-- ROLLBACK: supabase/rollbacks/20261105150000_courier_payment_types_currency_ranges_down.sql
-- ============================================================================

BEGIN;

SET LOCAL lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. Columns and CHECKs (re-runnable)
-- ---------------------------------------------------------------------------
ALTER TABLE public.messenger_payment_types
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'USD',
  ADD COLUMN IF NOT EXISTS fixed_amount numeric(12,2);

ALTER TABLE public.messenger_payment_types DROP CONSTRAINT IF EXISTS messenger_payment_types_currency_chk;
ALTER TABLE public.messenger_payment_types ADD CONSTRAINT messenger_payment_types_currency_chk
  CHECK (currency IN ('USD', 'CUP'));

ALTER TABLE public.messenger_payment_types DROP CONSTRAINT IF EXISTS messenger_payment_types_fixed_amount_chk;
ALTER TABLE public.messenger_payment_types ADD CONSTRAINT messenger_payment_types_fixed_amount_chk
  CHECK (fixed_amount IS NULL OR fixed_amount >= 0);

-- 'NaN'::numeric sorts above every number, so the inherited `x >= 0` CHECKs let it through: refuse it explicitly.
ALTER TABLE public.messenger_payment_types DROP CONSTRAINT IF EXISTS messenger_payment_types_no_nan_chk;
ALTER TABLE public.messenger_payment_types ADD CONSTRAINT messenger_payment_types_no_nan_chk CHECK (
      (fixed_cup IS NULL OR fixed_cup < 'NaN'::numeric) AND (fixed_amount IS NULL OR fixed_amount < 'NaN'::numeric)
  AND (cup_per_usd IS NULL OR cup_per_usd < 'NaN'::numeric) AND (percent IS NULL OR percent < 'NaN'::numeric)
  AND (amount_from IS NULL OR amount_from < 'NaN'::numeric) AND (amount_to IS NULL OR amount_to < 'NaN'::numeric));

ALTER TABLE public.messenger_payment_types DROP CONSTRAINT IF EXISTS messenger_payment_types_method_check;
ALTER TABLE public.messenger_payment_types ADD CONSTRAINT messenger_payment_types_method_check
  CHECK (method IN ('fixed_cup', 'fixed_amount', 'per_usd_delivered', 'percent_of_base'));

ALTER TABLE public.messenger_payment_types DROP CONSTRAINT IF EXISTS messenger_payment_types_params_chk;
ALTER TABLE public.messenger_payment_types ADD CONSTRAINT messenger_payment_types_params_chk CHECK (
     (method = 'fixed_cup'         AND fixed_cup IS NOT NULL AND fixed_amount IS NULL AND cup_per_usd IS NULL AND percent IS NULL AND base IS NULL)
  OR (method = 'fixed_amount'      AND fixed_amount IS NOT NULL AND fixed_cup IS NULL AND cup_per_usd IS NULL AND percent IS NULL AND base IS NULL)
  OR (method = 'per_usd_delivered' AND cup_per_usd IS NOT NULL AND fixed_cup IS NULL AND fixed_amount IS NULL AND percent IS NULL AND base IS NOT NULL)
  OR (method = 'percent_of_base'   AND percent IS NOT NULL AND fixed_cup IS NULL AND fixed_amount IS NULL AND cup_per_usd IS NULL AND base IS NOT NULL));

ALTER TABLE public.messenger_payment_types DROP CONSTRAINT IF EXISTS messenger_payment_types_method_scope_chk;
ALTER TABLE public.messenger_payment_types ADD CONSTRAINT messenger_payment_types_method_scope_chk CHECK (
  method IN ('fixed_cup', 'fixed_amount') OR applies_to = 'remittance' OR (method = 'percent_of_base' AND base = 'nominal_usd'));

ALTER TABLE public.messenger_payment_types DROP CONSTRAINT IF EXISTS messenger_payment_types_base_scope_chk;
ALTER TABLE public.messenger_payment_types ADD CONSTRAINT messenger_payment_types_base_scope_chk
  CHECK (base IS DISTINCT FROM 'delivered_cup' OR applies_to = 'remittance');

-- ---------------------------------------------------------------------------
-- 2. Resolver v2: precedence of v1, value converted to each candidate currency, reason when nothing applies
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._courier_rule_resolve_v2(
  p_kind            text,
  p_courier_id      uuid,
  p_zone_id         uuid,
  p_type_id         uuid,
  p_amount          numeric,
  p_amount_currency text,
  p_fx              numeric,              -- active USD->CUP rate read live by the caller; NULL = none
  p_at              timestamptz DEFAULT now()
)
RETURNS TABLE (rule_id uuid, reason text)
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_m    record;
  v_val  numeric;
  v_seen boolean := false;
BEGIN
  FOR v_m IN
    SELECT m.id, m.currency, m.amount_from, m.amount_to,
           (m.amount_from IS NOT NULL OR m.amount_to IS NOT NULL) AS tiered
      FROM public.messenger_payment_types m
     WHERE m.is_active
       AND m.applies_to IN (p_kind, 'both')
       AND m.valid_from <= p_at AND (m.valid_to IS NULL OR p_at < m.valid_to)
       AND (m.courier_id IS NULL OR m.courier_id = p_courier_id)
       AND (m.shipping_zone_id IS NULL OR m.shipping_zone_id = p_zone_id)
       AND (m.remittance_type_id IS NULL OR m.remittance_type_id = p_type_id)
     ORDER BY (m.courier_id IS NOT NULL) DESC,
              (m.shipping_zone_id IS NOT NULL) DESC,
              (m.remittance_type_id IS NOT NULL) DESC,
              (m.amount_from IS NOT NULL OR m.amount_to IS NOT NULL) DESC,
              m.valid_from DESC, m.id
  LOOP
    IF NOT v_m.tiered THEN
      RETURN QUERY SELECT v_m.id, NULL::text;
      RETURN;
    END IF;
    v_seen := true;
    CONTINUE WHEN p_amount IS NULL; -- no value: a tramo cannot match (same as v1)
    v_val := CASE
      WHEN p_amount_currency = v_m.currency THEN p_amount
      WHEN p_fx IS NULL OR p_fx <= 0 THEN NULL
      WHEN p_amount_currency = 'USD' AND v_m.currency = 'CUP' THEN round(p_amount * p_fx, 2)
      WHEN p_amount_currency = 'CUP' AND v_m.currency = 'USD' THEN round(p_amount / p_fx, 2)
    END;                                -- any other pair (e.g. EUR) has no rate: NULL
    IF v_val IS NULL THEN
      -- fail closed: never fall to a lower-precedence rule because a rate is missing
      RETURN QUERY SELECT NULL::uuid, 'no_fx'::text;
      RETURN;
    END IF;
    IF (v_m.amount_from IS NULL OR v_val > v_m.amount_from) AND (v_m.amount_to IS NULL OR v_val <= v_m.amount_to) THEN
      RETURN QUERY SELECT v_m.id, NULL::text;
      RETURN;
    END IF;
  END LOOP;
  RETURN QUERY SELECT NULL::uuid, CASE WHEN v_seen THEN 'no_tier_match' ELSE 'no_rule' END;
END;
$function$;
REVOKE ALL ON FUNCTION public._courier_rule_resolve_v2(text, uuid, uuid, uuid, numeric, text, numeric, timestamptz) FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Coverage of the tiered rules of one scope: JSON array of gaps {kind, from, to} meaning (from, to];
--    from NULL = from 0.00 included, to NULL = no upper end. Empty array = covered.
--    shortcut: a rule counts only when its window covers the WHOLE window asked; piecewise windows are reported as gaps
--    (more warnings, never fewer). Upgrade to a per-period sweep if scheduled ladders become common.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._courier_rule_coverage(
  p_applies_to text,
  p_courier_id uuid,
  p_zone_id    uuid,
  p_type_id    uuid,
  p_currency   text,
  p_from       timestamptz,
  p_to         timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_kind text;
  v_r    record;
  v_c    numeric;   -- every value <= v_c is covered; -0.01 = nothing yet (0.00 still needed)
  v_inf  boolean;
  v_gaps jsonb := '[]'::jsonb;
BEGIN
  FOREACH v_kind IN ARRAY CASE WHEN p_applies_to = 'both' THEN ARRAY['remittance', 'order'] ELSE ARRAY[p_applies_to] END LOOP
    CONTINUE WHEN EXISTS (
      SELECT 1 FROM public.messenger_payment_types m
       WHERE m.is_active AND m.applies_to IN (v_kind, 'both')
         AND m.courier_id IS NOT DISTINCT FROM p_courier_id
         AND m.shipping_zone_id IS NOT DISTINCT FROM p_zone_id
         AND m.remittance_type_id IS NOT DISTINCT FROM p_type_id
         AND m.amount_from IS NULL AND m.amount_to IS NULL
         AND m.valid_from <= p_from
         AND (m.valid_to IS NULL OR (p_to IS NOT NULL AND m.valid_to >= p_to)));
    v_c := -0.01;
    v_inf := false;
    FOR v_r IN
      SELECT COALESCE(m.amount_from, -0.01) AS lo, m.amount_to AS hi
        FROM public.messenger_payment_types m
       WHERE m.is_active AND m.applies_to IN (v_kind, 'both')
         AND m.courier_id IS NOT DISTINCT FROM p_courier_id
         AND m.shipping_zone_id IS NOT DISTINCT FROM p_zone_id
         AND m.remittance_type_id IS NOT DISTINCT FROM p_type_id
         AND (m.amount_from IS NOT NULL OR m.amount_to IS NOT NULL)
         AND m.currency = p_currency
         AND m.valid_from <= p_from
         AND (m.valid_to IS NULL OR (p_to IS NOT NULL AND m.valid_to >= p_to))
       ORDER BY 1, 2 NULLS LAST
    LOOP
      IF v_r.lo > v_c THEN
        v_gaps := v_gaps || jsonb_build_object('kind', v_kind, 'from', CASE WHEN v_c >= 0 THEN v_c END, 'to', v_r.lo);
      END IF;
      IF v_r.hi IS NULL THEN
        v_inf := true;
        EXIT;
      END IF;
      v_c := greatest(v_c, v_r.hi);
    END LOOP;
    IF NOT v_inf THEN
      v_gaps := v_gaps || jsonb_build_object('kind', v_kind, 'from', CASE WHEN v_c >= 0 THEN v_c END, 'to', NULL);
    END IF;
  END LOOP;
  RETURN v_gaps;
END;
$function$;
REVOKE ALL ON FUNCTION public._courier_rule_coverage(text, uuid, uuid, uuid, text, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Accrual calculation (same signature; diff kept minimal against the live body of M2)
-- ---------------------------------------------------------------------------
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

  -- the active USD->CUP row, read live (no cache, no fail-open helper)
  SELECT er.rate INTO v_live_fx
    FROM public.exchange_rates er
    JOIN public.currencies f ON f.id = er.from_currency_id AND f.code = 'USD'
    JOIN public.currencies t ON t.id = er.to_currency_id AND t.code = 'CUP'
   WHERE er.is_active
   ORDER BY er.effective_date DESC LIMIT 1;
  -- a NaN rate passes `rate > 0`: treat it as missing (never multiply an accrual by NaN)
  v_live_fx := NULLIF(v_live_fx, 'NaN'::numeric);
  v_fx := NULLIF(v_fx, 'NaN'::numeric);
  IF v_fx IS NULL AND v_live_fx IS NOT NULL THEN
    v_fx := v_live_fx;
    v_fx_src := 'exchange_rates';
  END IF;

  SELECT r.rule_id, r.reason INTO v_rule_id, v_reason
    FROM public._courier_rule_resolve_v2(p_kind, p_courier_id, v_zone, v_type, v_sent, v_cur_sent, v_live_fx, now()) r;
  SELECT m.* INTO v_rule FROM public.messenger_payment_types m WHERE m.id = v_rule_id;
  IF NOT FOUND THEN
    v_reason := COALESCE(v_reason, 'no_rule');
  ELSE
    v_cup := CASE v_rule.method
      WHEN 'fixed_cup' THEN v_rule.fixed_cup
      WHEN 'fixed_amount' THEN CASE v_rule.currency
          WHEN 'CUP' THEN v_rule.fixed_amount
          WHEN 'USD' THEN CASE WHEN v_live_fx IS NOT NULL THEN round(v_rule.fixed_amount * v_live_fx, 2) END
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
        WHEN v_rule.method = 'fixed_amount' AND v_rule.currency = 'USD' AND v_live_fx IS NULL THEN 'no_fx'
        WHEN v_rule.method = 'percent_of_base' AND v_rule.base = 'nominal_usd' AND v_cur_sent = 'USD' AND v_fx IS NULL THEN 'no_fx'
        ELSE 'no_amount_basis' END;
    END IF;
  END IF;

  IF v_cup IS NOT NULL AND v_rule.method = 'fixed_amount' AND v_rule.currency = 'USD' THEN
    -- converted at the live rate: that is the rate used, and the USD figure is the fixed one
    v_fx := v_live_fx;
    v_fx_src := 'exchange_rates';
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

  RETURN QUERY SELECT
    v_rule.id, v_cup, v_fx, v_usd,
    jsonb_strip_nulls(jsonb_build_object(
      'source', p_source, 'reason', v_reason, 'method', v_rule.method, 'fx_source', v_fx_src,
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
REVOKE ALL ON FUNCTION public._courier_compute_accrual(text, uuid, uuid, text) FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Admin RPC v2 (v1 body + currency, fixed amount, decimals, mixed currency, coverage)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_set_messenger_payment_type_v2(
  p_code         text,
  p_name         text,
  p_applies_to   text,
  p_method       text,
  p_fixed_cup    numeric,
  p_cup_per_usd  numeric,
  p_percent      numeric,
  p_base         text,
  p_courier_id   uuid,
  p_zone_id      uuid,
  p_type_id      uuid,
  p_amount_from  numeric,
  p_amount_to    numeric,
  p_valid_from   timestamptz DEFAULT NULL,
  p_valid_to     timestamptz DEFAULT NULL,
  p_currency     text DEFAULT 'USD',
  p_fixed_amount numeric DEFAULT NULL,
  p_accept_gaps  boolean DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid     uuid := public._courier_require_admin();
  v_code    text := btrim(COALESCE(p_code, ''));
  v_name    text := btrim(COALESCE(p_name, ''));
  v_from    timestamptz := COALESCE(p_valid_from, now());
  v_tiered  boolean := (p_amount_from IS NOT NULL OR p_amount_to IS NOT NULL);
  v_version integer;
  v_last    timestamptz;
  v_id      uuid;
  v_prev    record;
  v_gaps    jsonb;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('courier_rules'));

  IF char_length(v_code) NOT BETWEEN 1 AND 100 OR char_length(v_name) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'invalid_argument: code (1-100) and name (1-200) are required' USING ERRCODE = '22023';
  END IF;
  IF p_applies_to IS NULL OR p_applies_to NOT IN ('remittance', 'order', 'both')
     OR p_method IS NULL OR p_method NOT IN ('fixed_cup', 'fixed_amount', 'per_usd_delivered', 'percent_of_base') THEN
    RAISE EXCEPTION 'invalid_argument: unknown applies_to or method' USING ERRCODE = '22023';
  END IF;
  IF p_currency IS NULL OR p_currency NOT IN ('USD', 'CUP') THEN
    RAISE EXCEPTION 'invalid_argument: currency must be USD or CUP' USING ERRCODE = '22023';
  END IF;
  IF NOT (p_method IN ('fixed_cup', 'fixed_amount') OR p_applies_to = 'remittance'
          OR (p_method = 'percent_of_base' AND p_base = 'nominal_usd')) THEN
    RAISE EXCEPTION 'invalid_argument: this method only applies to remittances' USING ERRCODE = '22023';
  END IF;
  IF p_type_id IS NOT NULL AND p_applies_to <> 'remittance' THEN
    RAISE EXCEPTION 'invalid_argument: a remittance type only makes sense for remittance rules' USING ERRCODE = '22023';
  END IF;
  -- NaN passes `>= 0` (it sorts above every number) and would be frozen into the accruals
  IF 'NaN'::numeric IN (p_amount_from, p_amount_to, p_fixed_amount, p_fixed_cup, p_cup_per_usd, p_percent) THEN
    RAISE EXCEPTION 'invalid_argument: NaN is not a valid amount, rate or percentage' USING ERRCODE = '22023',
      DETAIL = 'amount_from, amount_to, fixed_amount, fixed_cup, cup_per_usd and percent must be finite numbers';
  END IF;
  -- Typed parameters of the chosen method, and none of the others.
  IF NOT (CASE p_method
            WHEN 'fixed_cup' THEN p_fixed_cup >= 0 AND p_fixed_amount IS NULL AND p_cup_per_usd IS NULL AND p_percent IS NULL AND p_base IS NULL
            WHEN 'fixed_amount' THEN p_fixed_amount >= 0 AND p_fixed_cup IS NULL AND p_cup_per_usd IS NULL AND p_percent IS NULL AND p_base IS NULL
            WHEN 'per_usd_delivered' THEN p_cup_per_usd >= 0 AND p_fixed_cup IS NULL AND p_fixed_amount IS NULL AND p_percent IS NULL
                                          AND p_base IN ('nominal_usd', 'delivered_cup')
            WHEN 'percent_of_base' THEN p_percent BETWEEN 0 AND 100 AND p_fixed_cup IS NULL AND p_fixed_amount IS NULL AND p_cup_per_usd IS NULL
                                        AND p_base IN ('nominal_usd', 'delivered_cup')
          END) IS TRUE THEN
    RAISE EXCEPTION 'invalid_argument: parameters do not match the method' USING ERRCODE = '22023';
  END IF;
  -- numeric(12,2) holds at most 9999999999.99: a typed refusal instead of a raw 22003 overflow
  IF greatest(p_amount_from, p_amount_to, p_fixed_amount, p_fixed_cup) > 9999999999.99 THEN
    RAISE EXCEPTION 'invalid_argument: amounts accept at most 9999999999.99' USING ERRCODE = '22023';
  END IF;
  -- numeric(12,2) columns would round 100.005 silently: refuse anything beyond cents
  IF p_amount_from <> round(p_amount_from, 2) OR p_amount_to <> round(p_amount_to, 2)
     OR p_fixed_amount <> round(p_fixed_amount, 2) OR p_fixed_cup <> round(p_fixed_cup, 2) THEN
    RAISE EXCEPTION 'invalid_argument: amounts accept at most 2 decimals' USING ERRCODE = '22023';
  END IF;
  -- same for percent numeric(6,3) and cup_per_usd numeric(12,4)
  IF p_percent <> round(p_percent, 3) OR p_cup_per_usd <> round(p_cup_per_usd, 4) THEN
    RAISE EXCEPTION 'invalid_argument: percent accepts at most 3 decimals and cup_per_usd at most 4 decimals' USING ERRCODE = '22023';
  END IF;
  IF (p_amount_from IS NOT NULL AND p_amount_from < 0) OR (p_amount_to IS NOT NULL AND p_amount_to < 0)
     OR (p_amount_from IS NOT NULL AND p_amount_to IS NOT NULL AND p_amount_to <= p_amount_from) THEN
    RAISE EXCEPTION 'invalid_argument: the amount tier must satisfy 0 <= from < to' USING ERRCODE = '22023';
  END IF;
  IF p_courier_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.couriers WHERE id = p_courier_id AND is_active) THEN
    RAISE EXCEPTION 'invalid_argument: courier not found or inactive' USING ERRCODE = '22023';
  END IF;
  IF p_zone_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.shipping_zones WHERE id = p_zone_id) THEN
    RAISE EXCEPTION 'invalid_argument: shipping zone not found' USING ERRCODE = '22023';
  END IF;
  IF p_type_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.remittance_types WHERE id = p_type_id) THEN
      RAISE EXCEPTION 'invalid_argument: remittance type not found' USING ERRCODE = '22023';
    END IF;
    IF p_base = 'delivered_cup' AND NOT EXISTS (SELECT 1 FROM public.remittance_types WHERE id = p_type_id AND delivery_currency = 'CUP') THEN
      RAISE EXCEPTION 'invalid_argument: the delivered_cup base needs a remittance type delivered in CUP' USING ERRCODE = '22023';
    END IF;
  END IF;
  -- Only the future is editable: new rates never touch deliveries already accrued.
  IF v_from < now() - interval '1 minute' THEN
    RAISE EXCEPTION 'invalid_argument: valid_from cannot be in the past' USING ERRCODE = '22023';
  END IF;
  IF p_valid_to IS NOT NULL AND p_valid_to <= v_from THEN
    RAISE EXCEPTION 'invalid_argument: valid_to must be after valid_from' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(max(version), 0), max(valid_from) FILTER (WHERE is_active)
    INTO v_version, v_last FROM public.messenger_payment_types WHERE code = v_code;
  IF v_last IS NOT NULL AND v_from <= v_last THEN
    RAISE EXCEPTION 'invalid_argument: a new version must start after the latest version of this code' USING ERRCODE = '22023';
  END IF;

  -- One currency per tiered scope: ranges of one ladder are compared in the same currency.
  IF v_tiered AND EXISTS (
    SELECT 1 FROM public.messenger_payment_types o
     WHERE o.is_active AND o.code <> v_code
       AND o.courier_id IS NOT DISTINCT FROM p_courier_id
       AND o.shipping_zone_id IS NOT DISTINCT FROM p_zone_id
       AND o.remittance_type_id IS NOT DISTINCT FROM p_type_id
       AND (o.amount_from IS NOT NULL OR o.amount_to IS NOT NULL)
       AND o.currency <> p_currency
       AND (o.applies_to = 'both' OR p_applies_to = 'both' OR o.applies_to = p_applies_to)
       AND o.valid_from < COALESCE(p_valid_to, 'infinity'::timestamptz)
       AND v_from < COALESCE(o.valid_to, 'infinity'::timestamptz)
  ) THEN
    RAISE EXCEPTION 'mixed_currency_scope: the ranges of this scope already use another currency' USING ERRCODE = '22023';
  END IF;

  -- Overlap: same scope tuple, same tier presence, intersecting tiers (a,b], windows and operation kinds.
  IF EXISTS (
    SELECT 1 FROM public.messenger_payment_types o
     WHERE o.is_active AND o.code <> v_code
       AND o.courier_id IS NOT DISTINCT FROM p_courier_id
       AND o.shipping_zone_id IS NOT DISTINCT FROM p_zone_id
       AND o.remittance_type_id IS NOT DISTINCT FROM p_type_id
       AND ((o.amount_from IS NOT NULL OR o.amount_to IS NOT NULL) = v_tiered)
       AND COALESCE(o.amount_from, -1) < COALESCE(p_amount_to, 1e15)
       AND COALESCE(p_amount_from, -1) < COALESCE(o.amount_to, 1e15)
       AND (o.applies_to = 'both' OR p_applies_to = 'both' OR o.applies_to = p_applies_to)
       AND o.valid_from < COALESCE(p_valid_to, 'infinity'::timestamptz)
       AND v_from < COALESCE(o.valid_to, 'infinity'::timestamptz)
  ) THEN
    RAISE EXCEPTION 'overlapping_rule: another active rule already covers this scope in this period' USING ERRCODE = '23P01';
  END IF;

  -- Close the previous version at the start of the new one.
  FOR v_prev IN
    UPDATE public.messenger_payment_types
       SET valid_to = v_from
     WHERE code = v_code AND is_active AND valid_from < v_from AND (valid_to IS NULL OR valid_to > v_from)
    RETURNING id, valid_to
  LOOP
    PERFORM public._courier_audit('messenger_payment_types', v_prev.id, 'valid_to', NULL, v_prev.valid_to::text, 'UPDATE');
  END LOOP;

  INSERT INTO public.messenger_payment_types
    (code, name, version, applies_to, method, fixed_cup, cup_per_usd, percent, base, courier_id, shipping_zone_id,
     remittance_type_id, amount_from, amount_to, valid_from, valid_to, created_by, currency, fixed_amount)
  VALUES
    (v_code, v_name, v_version + 1, p_applies_to, p_method, p_fixed_cup, p_cup_per_usd, p_percent, p_base, p_courier_id, p_zone_id,
     p_type_id, p_amount_from, p_amount_to, v_from, p_valid_to, v_uid, p_currency, p_fixed_amount)
  RETURNING id INTO v_id;

  -- Gaps are computed on the table as it will be (new row in, superseded version closed); refusing rolls both back.
  IF v_tiered THEN
    v_gaps := public._courier_rule_coverage(p_applies_to, p_courier_id, p_zone_id, p_type_id, p_currency, v_from, p_valid_to);
    IF jsonb_array_length(v_gaps) > 0 AND NOT COALESCE(p_accept_gaps, false) THEN
      RAISE EXCEPTION 'coverage_gap: the ranges of this scope leave values without a rule; confirm to save anyway'
        USING ERRCODE = '22023', DETAIL = jsonb_build_object('currency', p_currency, 'gaps', v_gaps)::text;
    END IF;
  END IF;

  PERFORM public._courier_audit('messenger_payment_types', v_id, 'created', NULL,
    jsonb_build_object('code', v_code, 'version', v_version + 1, 'applies_to', p_applies_to, 'method', p_method,
                       'fixed_cup', p_fixed_cup, 'cup_per_usd', p_cup_per_usd, 'percent', p_percent, 'base', p_base,
                       'courier_id', p_courier_id, 'zone_id', p_zone_id, 'type_id', p_type_id,
                       'amount_from', p_amount_from, 'amount_to', p_amount_to, 'valid_from', v_from, 'valid_to', p_valid_to,
                       'currency', p_currency, 'fixed_amount', p_fixed_amount,
                       'accept_gaps', COALESCE(p_accept_gaps, false), 'gaps', v_gaps)::text,
    'UPDATE');
  RETURN v_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_set_messenger_payment_type_v2(text, text, text, text, numeric, numeric, numeric, text, uuid, uuid, uuid, numeric, numeric, timestamptz, timestamptz, text, numeric, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_messenger_payment_type_v2(text, text, text, text, numeric, numeric, numeric, text, uuid, uuid, uuid, numeric, numeric, timestamptz, timestamptz, text, numeric, boolean) TO authenticated;

-- v1 stays for the rollback, closed to API roles (the client calls v2 only)
REVOKE EXECUTE ON FUNCTION public.admin_set_messenger_payment_type(text, text, text, text, numeric, numeric, numeric, text, uuid, uuid, uuid, numeric, numeric, timestamptz, timestamptz)
  FROM PUBLIC, anon, authenticated;

COMMIT;
