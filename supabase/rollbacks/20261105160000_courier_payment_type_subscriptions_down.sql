-- ROLLBACK of 20261105160000_courier_payment_type_subscriptions.sql (phase B). Run it BEFORE the phase A rollback.
-- Restores the phase A bodies of _courier_rule_resolve_v2, _courier_rule_coverage and admin_set_messenger_payment_type_v2
-- verbatim, then drops the subscribe / unsubscribe RPCs, _courier_effective_conflict, the table, its trigger and guard.
-- GUARD: aborts (55000) while courier_payment_type_subscriptions has rows (active or closed), because they would be lost.
--   MANDATORY first: export them (COPY public.courier_payment_type_subscriptions TO ...). Then confirm in the same session:
--   SET app.confirm_courier_rollback = 'yes';
-- Accruals already written keep their frozen rule_snapshot; nothing else is touched.
-- DEPLOY: roll the frontend back to the phase A client together with this file.
BEGIN;

SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF to_regclass('public.courier_payment_type_subscriptions') IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.courier_payment_type_subscriptions)
     AND COALESCE(current_setting('app.confirm_courier_rollback', true), '') <> 'yes' THEN
    RAISE EXCEPTION 'courier_payment_type_subscriptions has rows: export them first (COPY ... TO) and then run SET app.confirm_courier_rollback = ''yes''; to confirm'
      USING ERRCODE = '55000';
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.admin_subscribe_courier_payment_type(uuid, text, boolean);
DROP FUNCTION IF EXISTS public.admin_unsubscribe_courier_payment_type(uuid, text);

-- phase A bodies, verbatim (20261105150000_courier_payment_types_currency_ranges.sql)
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

DROP FUNCTION IF EXISTS public._courier_effective_conflict(uuid);
DROP TABLE IF EXISTS public.courier_payment_type_subscriptions;   -- also drops its trigger, policy and indexes
DROP FUNCTION IF EXISTS public.courier_payment_type_subscriptions_guard();

COMMIT;
