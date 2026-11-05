-- ============================================================================
-- Courier payment types, phase B: subscriptions of couriers to payment types (admin / super_admin only).
--   PREPARED, NOT APPLIED
-- ============================================================================
-- WHY: the owner wants to say "this courier is paid with this payment type" without copying the type per courier.
-- WHAT:
--   1. public.courier_payment_type_subscriptions (courier, payment type CODE): append-only. A cancellation closes the row
--      (is_active false + deactivated_*); re-subscribing inserts a new row. Referenced by code, not by id (a new version
--      changes the id); no FK to messenger_payment_types: the RPC validates the code. FK to couriers ON DELETE RESTRICT.
--   2. RPCs admin_subscribe_courier_payment_type / admin_unsubscribe_courier_payment_type (SECURITY DEFINER, role
--      re-verified, advisory lock 'courier_rules', audited in financial_audit_log). Subscribing validates the courier's
--      EFFECTIVE set = own rules + subscribed rules: overlaps (23P01), one currency per tiered scope (mixed_currency_scope)
--      and gaps (coverage_gap with a JSON DETAIL unless p_accept_gaps). Idempotent: an active pair returns its id.
--   3. CREATE OR REPLACE (diff against the phase A bodies; phase A is not applied in production yet, so the repo text IS
--      the base; prod has neither function):
--      - _courier_rule_resolve_v2: same filter; for the courier being resolved a subscribed type ranks as a courier rule.
--        A general type keeps applying to the couriers NOT subscribed to it, exactly as today.
--      - _courier_rule_coverage: a courier scope also counts the general rules that courier is subscribed to.
--      - admin_set_messenger_payment_type_v2: a new version of a subscribed code (or a new own rule of a subscriber)
--        re-runs the effective-set check of every courier it reaches; a subscribed code cannot move to another courier;
--        a deactivated code cannot be recreated while active subscriptions to it remain.
--      - admin_deactivate_messenger_payment_type (M1 body, identical to the live production body): deactivating a code
--        CLOSES its active subscriptions (audited, listing the couriers), so a recreated code never revives them.
-- HISTORY: the cost is frozen at delivery (courier_accruals). Unsubscribing before the delivery changes the rule used;
--   after the delivery nothing is touched.
-- PLATFORM RESET: execute_platform_reset keeps couriers and messenger_payment_types (configuration); subscriptions are
--   configuration too, so it is not modified and keeps them.
-- SAFETY: additive and re-runnable. No existing row is read for writing; courier_accruals are never touched.
--   Apply AFTER 20261105150000 (phase A).
-- ROLLBACK: supabase/rollbacks/20261105160000_courier_payment_type_subscriptions_down.sql (run it BEFORE phase A's)
-- ============================================================================

BEGIN;

SET LOCAL lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. Table, indexes, append-only guard, visibility
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.courier_payment_type_subscriptions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  courier_id        uuid NOT NULL REFERENCES public.couriers(id) ON DELETE RESTRICT,
  payment_type_code text NOT NULL CHECK (char_length(btrim(payment_type_code)) BETWEEN 1 AND 100),
  is_active         boolean NOT NULL DEFAULT true,
  created_by        uuid,
  created_at        timestamptz NOT NULL DEFAULT now(),
  deactivated_by    uuid,
  deactivated_at    timestamptz,
  CONSTRAINT courier_payment_type_subscriptions_active_chk CHECK (is_active = (deactivated_at IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS courier_payment_type_subscriptions_active_uniq
  ON public.courier_payment_type_subscriptions (courier_id, payment_type_code) WHERE is_active;
CREATE INDEX IF NOT EXISTS courier_payment_type_subscriptions_code_idx
  ON public.courier_payment_type_subscriptions (payment_type_code);

-- Only true -> false together with deactivated_*; never DELETE; every other column is immutable.
CREATE OR REPLACE FUNCTION public.courier_payment_type_subscriptions_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'courier_payment_type_subscriptions_is_append_only: subscriptions are never deleted' USING ERRCODE = '42501';
  END IF;
  IF NOT (OLD.is_active AND NOT NEW.is_active AND NEW.deactivated_at IS NOT NULL
          AND (to_jsonb(NEW) - 'is_active' - 'deactivated_by' - 'deactivated_at')
              = (to_jsonb(OLD) - 'is_active' - 'deactivated_by' - 'deactivated_at')) THEN
    RAISE EXCEPTION 'courier_payment_type_subscriptions_is_append_only: only closing an active subscription is allowed; subscribe again instead'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.courier_payment_type_subscriptions_guard() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS courier_payment_type_subscriptions_guard ON public.courier_payment_type_subscriptions;
CREATE TRIGGER courier_payment_type_subscriptions_guard
  BEFORE UPDATE OR DELETE ON public.courier_payment_type_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.courier_payment_type_subscriptions_guard();

ALTER TABLE public.courier_payment_type_subscriptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.courier_payment_type_subscriptions FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.courier_payment_type_subscriptions TO authenticated;
DROP POLICY IF EXISTS courier_payment_type_subscriptions_select_admin ON public.courier_payment_type_subscriptions;
CREATE POLICY courier_payment_type_subscriptions_select_admin ON public.courier_payment_type_subscriptions
  FOR SELECT TO authenticated USING ((SELECT public.is_admin_user()));

-- ---------------------------------------------------------------------------
-- 2. Effective set of one courier (own rules + subscribed general rules, active, current or future):
--    'mixed_currency_scope' / 'overlapping_rule' for the first ambiguity found between two codes, NULL when clean.
--    Same predicates as the phase A checks of admin_set_messenger_payment_type_v2, with the courier as the shared scope.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._courier_effective_conflict(p_courier_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $function$
  WITH e AS (
    SELECT m.code, m.applies_to, m.shipping_zone_id, m.remittance_type_id, m.amount_from, m.amount_to, m.currency,
           m.valid_from, m.valid_to, (m.amount_from IS NOT NULL OR m.amount_to IS NOT NULL) AS tiered
      FROM public.messenger_payment_types m
     WHERE m.is_active
       AND (m.valid_to IS NULL OR m.valid_to > now())
       AND (m.courier_id = p_courier_id
            OR (m.courier_id IS NULL AND EXISTS (
                  SELECT 1 FROM public.courier_payment_type_subscriptions s
                   WHERE s.is_active AND s.courier_id = p_courier_id AND s.payment_type_code = m.code)))
  ), pairs AS (
    SELECT (a.tiered AND b.tiered AND a.currency <> b.currency) AS mixed,
           (a.tiered = b.tiered
            AND COALESCE(a.amount_from, -1) < COALESCE(b.amount_to, 1e15)
            AND COALESCE(b.amount_from, -1) < COALESCE(a.amount_to, 1e15)) AS overlap
      FROM e a
      JOIN e b ON a.code < b.code
             AND a.shipping_zone_id IS NOT DISTINCT FROM b.shipping_zone_id
             AND a.remittance_type_id IS NOT DISTINCT FROM b.remittance_type_id
             AND (a.applies_to = 'both' OR b.applies_to = 'both' OR a.applies_to = b.applies_to)
             AND a.valid_from < COALESCE(b.valid_to, 'infinity'::timestamptz)
             AND b.valid_from < COALESCE(a.valid_to, 'infinity'::timestamptz)
  )
  SELECT CASE WHEN bool_or(mixed) THEN 'mixed_currency_scope' WHEN bool_or(overlap) THEN 'overlapping_rule' END FROM pairs;
$function$;
REVOKE ALL ON FUNCTION public._courier_effective_conflict(uuid) FROM PUBLIC, anon, authenticated, service_role;

-- Gaps that the tiered rules p_rule_ids leave in the courier-level ladder of each courier of p_couriers (subscribers):
-- [{courier_id, gaps:[{kind, from, to}]}], only couriers with a gap. A scope where the courier has no tramo at all
-- (from and to both open) is not a gap of its ladder: its general rules keep applying there.
CREATE OR REPLACE FUNCTION public._courier_subscriber_gaps(p_rule_ids uuid[], p_couriers uuid[])
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $function$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('courier_id', x.courier_id, 'gaps', x.gaps) ORDER BY x.courier_id), '[]'::jsonb)
    FROM (
      SELECT c.courier_id, jsonb_agg(DISTINCT g.gap) AS gaps
        FROM unnest(p_couriers) AS c(courier_id)
        CROSS JOIN public.messenger_payment_types m
        CROSS JOIN LATERAL jsonb_array_elements(public._courier_rule_coverage(
                     m.applies_to, c.courier_id, m.shipping_zone_id, m.remittance_type_id, m.currency,
                     greatest(m.valid_from, now()), m.valid_to)) AS g(gap)
       WHERE m.id = ANY(p_rule_ids)
         AND (m.amount_from IS NOT NULL OR m.amount_to IS NOT NULL)
         AND NOT (g.gap->'from' = 'null'::jsonb AND g.gap->'to' = 'null'::jsonb)
       GROUP BY c.courier_id
    ) x;
$function$;
REVOKE ALL ON FUNCTION public._courier_subscriber_gaps(uuid[], uuid[]) FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Resolver v2 (phase A body + subscribed type ranked as a courier rule)
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
       -- phase B: m.courier_id = p_courier_id OR (m.courier_id IS NULL AND subscribed) OR the general case = the same set
       AND (m.courier_id IS NULL OR m.courier_id = p_courier_id)
       AND (m.shipping_zone_id IS NULL OR m.shipping_zone_id = p_zone_id)
       AND (m.remittance_type_id IS NULL OR m.remittance_type_id = p_type_id)
     ORDER BY (m.courier_id IS NOT NULL OR (p_courier_id IS NOT NULL AND EXISTS (  -- phase B: a subscribed type ranks as a courier rule
                 SELECT 1 FROM public.courier_payment_type_subscriptions s
                  WHERE s.is_active AND s.courier_id = p_courier_id AND s.payment_type_code = m.code))) DESC,
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
    -- no value: a tramo cannot match (same as v1); NaN sorts above every number and would match "más de X"
    CONTINUE WHEN p_amount IS NULL OR p_amount = 'NaN'::numeric;
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
-- 4. Coverage (phase A body + subscribed general rules in a courier scope)
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
         AND (m.courier_id IS NOT DISTINCT FROM p_courier_id          -- phase B: + the subscribed general rules
              OR (p_courier_id IS NOT NULL AND m.courier_id IS NULL AND EXISTS (
                    SELECT 1 FROM public.courier_payment_type_subscriptions s
                     WHERE s.is_active AND s.courier_id = p_courier_id AND s.payment_type_code = m.code)))
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
         AND (m.courier_id IS NOT DISTINCT FROM p_courier_id          -- phase B: + the subscribed general rules
              OR (p_courier_id IS NOT NULL AND m.courier_id IS NULL AND EXISTS (
                    SELECT 1 FROM public.courier_payment_type_subscriptions s
                     WHERE s.is_active AND s.courier_id = p_courier_id AND s.payment_type_code = m.code)))
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
-- 5. Admin RPC v2 (phase A body + effective-set check of the owner and of every subscriber)
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
  v_sub     record;
  v_clash   text;
  v_sub_gaps jsonb;
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

  -- phase B: a code recreated from scratch (every version deactivated) must not inherit live subscriptions silently.
  IF v_version > 0 AND v_last IS NULL AND EXISTS (
    SELECT 1 FROM public.courier_payment_type_subscriptions s WHERE s.is_active AND s.payment_type_code = v_code
  ) THEN
    RAISE EXCEPTION 'invalid_argument: this deactivated code still has active subscriptions; unsubscribe them before recreating it'
      USING ERRCODE = '22023', DETAIL = (SELECT jsonb_build_object('code', v_code, 'couriers', jsonb_agg(s.courier_id ORDER BY s.courier_id))::text
                                          FROM public.courier_payment_type_subscriptions s WHERE s.is_active AND s.payment_type_code = v_code);
  END IF;

  -- phase B: a subscribed type cannot become the own rule of a courier that is not its subscriber.
  IF p_courier_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.courier_payment_type_subscriptions s
     WHERE s.is_active AND s.payment_type_code = v_code AND s.courier_id <> p_courier_id
  ) THEN
    RAISE EXCEPTION 'invalid_argument: this payment type is subscribed by another courier; unsubscribe it first' USING ERRCODE = '22023';
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

  -- phase B: the effective set (own + subscribed rules) of the owner and of every subscriber of this code stays unambiguous.
  FOR v_sub IN
    SELECT p_courier_id AS courier_id WHERE p_courier_id IS NOT NULL
    UNION
    SELECT s.courier_id FROM public.courier_payment_type_subscriptions s WHERE s.is_active AND s.payment_type_code = v_code
  LOOP
    v_clash := public._courier_effective_conflict(v_sub.courier_id);
    IF v_clash = 'mixed_currency_scope' THEN
      RAISE EXCEPTION 'mixed_currency_scope: the ranges of this courier already use another currency' USING ERRCODE = '22023';
    ELSIF v_clash = 'overlapping_rule' THEN
      RAISE EXCEPTION 'overlapping_rule: another rule of this courier (own or subscribed) already covers this scope in this period' USING ERRCODE = '23P01';
    END IF;
  END LOOP;

  -- Gaps are computed on the table as it will be (new row in, superseded version closed); refusing rolls both back.
  IF v_tiered THEN
    v_gaps := public._courier_rule_coverage(p_applies_to, p_courier_id, p_zone_id, p_type_id, p_currency, v_from, p_valid_to);
  END IF;
  -- phase B: also the gaps this code leaves in the ladder of each of its subscribers (same confirmation)
  v_sub_gaps := public._courier_subscriber_gaps(
    ARRAY(SELECT m.id FROM public.messenger_payment_types m
           WHERE m.code = v_code AND m.is_active AND (m.valid_to IS NULL OR m.valid_to > now())),
    ARRAY(SELECT s.courier_id FROM public.courier_payment_type_subscriptions s WHERE s.is_active AND s.payment_type_code = v_code));
  IF (jsonb_array_length(COALESCE(v_gaps, '[]'::jsonb)) > 0 OR jsonb_array_length(v_sub_gaps) > 0)
     AND NOT COALESCE(p_accept_gaps, false) THEN
    RAISE EXCEPTION 'coverage_gap: the ranges of this scope leave values without a rule; confirm to save anyway'
      USING ERRCODE = '22023', DETAIL = (CASE WHEN jsonb_array_length(v_sub_gaps) = 0
        THEN jsonb_build_object('currency', p_currency, 'gaps', v_gaps)  -- same DETAIL as phase A
        ELSE jsonb_build_object('currency', p_currency, 'subscribers', v_sub_gaps,
               'gaps', (SELECT COALESCE(jsonb_agg(u.g), '[]'::jsonb) FROM (
                         SELECT jsonb_array_elements(COALESCE(v_gaps, '[]'::jsonb)) AS g
                         UNION SELECT jsonb_array_elements(x->'gaps') FROM jsonb_array_elements(v_sub_gaps) x) u))
        END)::text;
  END IF;

  PERFORM public._courier_audit('messenger_payment_types', v_id, 'created', NULL,
    jsonb_build_object('code', v_code, 'version', v_version + 1, 'applies_to', p_applies_to, 'method', p_method,
                       'fixed_cup', p_fixed_cup, 'cup_per_usd', p_cup_per_usd, 'percent', p_percent, 'base', p_base,
                       'courier_id', p_courier_id, 'zone_id', p_zone_id, 'type_id', p_type_id,
                       'amount_from', p_amount_from, 'amount_to', p_amount_to, 'valid_from', v_from, 'valid_to', p_valid_to,
                       'currency', p_currency, 'fixed_amount', p_fixed_amount,
                       'accept_gaps', COALESCE(p_accept_gaps, false), 'gaps', v_gaps,
                       'subscriber_gaps', v_sub_gaps)::text,
    'UPDATE');
  RETURN v_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_set_messenger_payment_type_v2(text, text, text, text, numeric, numeric, numeric, text, uuid, uuid, uuid, numeric, numeric, timestamptz, timestamptz, text, numeric, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_messenger_payment_type_v2(text, text, text, text, numeric, numeric, numeric, text, uuid, uuid, uuid, numeric, numeric, timestamptz, timestamptz, text, numeric, boolean) TO authenticated;

-- ---------------------------------------------------------------------------
-- 6. Subscribe / unsubscribe
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_subscribe_courier_payment_type(
  p_courier_id  uuid,
  p_code        text,
  p_accept_gaps boolean DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid   uuid := public._courier_require_admin();
  v_code  text := btrim(COALESCE(p_code, ''));
  v_id    uuid;
  v_clash text;
  v_r     record;
  v_cur   text;
  v_gaps  jsonb := '[]'::jsonb;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('courier_rules'));

  IF char_length(v_code) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'invalid_argument: code (1-100) is required' USING ERRCODE = '22023';
  END IF;
  IF p_courier_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.couriers WHERE id = p_courier_id AND is_active) THEN
    RAISE EXCEPTION 'invalid_argument: courier not found or inactive' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.messenger_payment_types
                  WHERE code = v_code AND is_active AND (valid_to IS NULL OR valid_to > now())) THEN
    RAISE EXCEPTION 'invalid_argument: unknown payment type code or no active version' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.messenger_payment_types
              WHERE code = v_code AND is_active AND (valid_to IS NULL OR valid_to > now())
                AND courier_id IS NOT NULL AND courier_id <> p_courier_id) THEN
    RAISE EXCEPTION 'invalid_argument: this payment type belongs to another courier' USING ERRCODE = '22023';
  END IF;

  SELECT id INTO v_id FROM public.courier_payment_type_subscriptions
   WHERE courier_id = p_courier_id AND payment_type_code = v_code AND is_active;
  IF FOUND THEN
    RETURN v_id; -- idempotent
  END IF;

  -- Validated on the table as it will be; any refusal rolls the insert back.
  INSERT INTO public.courier_payment_type_subscriptions (courier_id, payment_type_code, created_by)
  VALUES (p_courier_id, v_code, v_uid)
  RETURNING id INTO v_id;

  v_clash := public._courier_effective_conflict(p_courier_id);
  IF v_clash = 'mixed_currency_scope' THEN
    RAISE EXCEPTION 'mixed_currency_scope: the ranges of this courier already use another currency' USING ERRCODE = '22023';
  ELSIF v_clash = 'overlapping_rule' THEN
    RAISE EXCEPTION 'overlapping_rule: another rule of this courier (own or subscribed) already covers this scope in this period' USING ERRCODE = '23P01';
  END IF;

  -- Gaps of every tiered scope the subscribed code reaches, seen from this courier.
  FOR v_r IN
    SELECT m.applies_to, m.shipping_zone_id, m.remittance_type_id, m.currency, greatest(m.valid_from, now()) AS f, m.valid_to
      FROM public.messenger_payment_types m
     WHERE m.code = v_code AND m.is_active AND (m.valid_to IS NULL OR m.valid_to > now())
       AND (m.amount_from IS NOT NULL OR m.amount_to IS NOT NULL)
     ORDER BY m.valid_from
  LOOP
    v_cur := COALESCE(v_cur, v_r.currency);
    v_gaps := v_gaps || public._courier_rule_coverage(v_r.applies_to, p_courier_id, v_r.shipping_zone_id, v_r.remittance_type_id,
                                                      v_r.currency, v_r.f, v_r.valid_to);
  END LOOP;
  SELECT COALESCE(jsonb_agg(DISTINCT g), '[]'::jsonb) INTO v_gaps FROM jsonb_array_elements(v_gaps) g;
  IF jsonb_array_length(v_gaps) > 0 AND NOT COALESCE(p_accept_gaps, false) THEN
    RAISE EXCEPTION 'coverage_gap: the ranges of this courier leave values without a rule; confirm to subscribe anyway'
      USING ERRCODE = '22023', DETAIL = jsonb_build_object('currency', v_cur, 'gaps', v_gaps)::text;
  END IF;

  PERFORM public._courier_audit('courier_payment_type_subscriptions', v_id, 'created', NULL,
    jsonb_build_object('courier_id', p_courier_id, 'code', v_code, 'accept_gaps', COALESCE(p_accept_gaps, false), 'gaps', v_gaps)::text,
    'UPDATE');
  RETURN v_id;
END;
$function$;

-- Closes the active subscription of the pair; 0 when there is none (idempotent).
CREATE OR REPLACE FUNCTION public.admin_unsubscribe_courier_payment_type(
  p_courier_id uuid,
  p_code       text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid  uuid := public._courier_require_admin();
  v_code text := btrim(COALESCE(p_code, ''));
  v_row  record;
  v_n    integer := 0;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('courier_rules'));
  FOR v_row IN
    UPDATE public.courier_payment_type_subscriptions
       SET is_active = false, deactivated_by = v_uid, deactivated_at = now()
     WHERE courier_id = p_courier_id AND payment_type_code = v_code AND is_active
    RETURNING id
  LOOP
    v_n := v_n + 1;
    PERFORM public._courier_audit('courier_payment_type_subscriptions', v_row.id, 'is_active', 'true', 'false', 'UPDATE');
  END LOOP;
  RETURN v_n;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 7. Deactivating a payment type also closes its subscriptions (M1 body = live production body, diff minimal)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_deactivate_messenger_payment_type(p_code text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_code text := btrim(COALESCE(p_code, ''));
  v_row  record;
  v_n    integer := 0;
  v_sub  record;
  v_ids  uuid[] := '{}';
  v_who  uuid[] := '{}';
BEGIN
  PERFORM public._courier_require_admin();
  PERFORM pg_advisory_xact_lock(hashtext('courier_rules'));
  IF NOT EXISTS (SELECT 1 FROM public.messenger_payment_types WHERE code = v_code) THEN
    RAISE EXCEPTION 'invalid_argument: unknown payment type code' USING ERRCODE = '22023';
  END IF;
  FOR v_row IN
    UPDATE public.messenger_payment_types SET is_active = false WHERE code = v_code AND is_active RETURNING id
  LOOP
    v_n := v_n + 1;
    v_ids := v_ids || v_row.id;
    PERFORM public._courier_audit('messenger_payment_types', v_row.id, 'is_active', 'true', 'false', 'UPDATE');
  END LOOP;

  -- phase B: a deactivated code keeps no live subscription (it would revive with courier precedence if recreated)
  FOR v_sub IN
    UPDATE public.courier_payment_type_subscriptions
       SET is_active = false, deactivated_by = auth.uid(), deactivated_at = now()
     WHERE payment_type_code = v_code AND is_active
    RETURNING id, courier_id
  LOOP
    v_who := v_who || v_sub.courier_id;
    PERFORM public._courier_audit('courier_payment_type_subscriptions', v_sub.id, 'is_active', 'true', 'false', 'UPDATE');
  END LOOP;
  IF cardinality(v_who) > 0 THEN
    PERFORM public._courier_audit('messenger_payment_types',
      (SELECT id FROM public.messenger_payment_types WHERE code = v_code ORDER BY version DESC LIMIT 1),
      'subscriptions_closed', NULL,
      jsonb_build_object('code', v_code, 'couriers', to_jsonb(v_who),
                         'subscriber_gaps', public._courier_subscriber_gaps(v_ids, v_who))::text, 'UPDATE');
  END IF;
  RETURN v_n;
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_deactivate_messenger_payment_type(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_deactivate_messenger_payment_type(text) TO authenticated;

REVOKE ALL ON FUNCTION public.admin_subscribe_courier_payment_type(uuid, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_subscribe_courier_payment_type(uuid, text, boolean) TO authenticated;
REVOKE ALL ON FUNCTION public.admin_unsubscribe_courier_payment_type(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_unsubscribe_courier_payment_type(uuid, text) TO authenticated;

COMMIT;
