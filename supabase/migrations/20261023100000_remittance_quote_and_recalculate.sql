-- ============================================================================
-- Remittance rounding contract in SQL: _remittance_quote + recalculate with rounding per step and discount.   PREPARED, NOT APPLIED
-- ============================================================================
-- WHY: recalculate_remittance_at_current_rate (prod 20261016192617) computes the commission without rounding,
--   derives amount_to_deliver from the UNROUNDED commission and never mentions the offer discount, so a re-priced
--   remittance loses its discount and the stored columns disagree by up to 0.005 * rate CUP
--   (REM-2026-001125: stored 596700, formula over the stored commission 596696). The JS twin
--   (src/lib/remittanceCalculations.js, calcForward) now rounds per step; this file gives SQL the same contract.
--
-- WHAT:
--   0. public._remittance_discount_source(offer_id, stored): the offer's discount, or the stored amount when no offer row.
--   1. public._remittance_quote(amount, pct, fixed, rate, discount_type, discount_value): IMMUTABLE pure arithmetic.
--        r = round(rate, 4); S = round(amount, 2); gross = round(S * pct / 100 + fixed, 2);
--        discount = round(percentage ? gross * v / 100 : least(v, gross), 2), clamped to [0, gross];
--        commission_total = gross - discount; amount_to_deliver = round((S - commission_total) * r, 2).
--      Postgres round(numeric, 2) is half away from zero = roundMoney in JS. Golden vectors shared with the unit tests:
--      src/tests/fixtures/remittanceGoldenVectors.json (tested in src/tests/concurrency/remittanceQuote.test.js).
--      Internal helper: EXECUTE revoked from PUBLIC, anon, authenticated and service_role.
--   2. recalculate_remittance_at_current_rate: same signature, role/status checks and rate resolution; prices with
--      _remittance_quote. Discount (decision ND-2): re-derived from offers.discount_type/discount_value over the new
--      gross commission when offer_id points at an offer (even an expired one: it was accepted at creation);
--      when there is no offer row, the stored discount_amount is kept, capped at the gross commission.
--      KNOWN LIMIT (same in JS calcForward): the offer is applied as accepted at creation. is_active, start_date/end_date,
--      min_purchase_amount and max_discount_amount of the offer are NOT re-evaluated on a re-pricing; only discount_type and
--      discount_value are used.
--      commission_percentage stays numeric(5,2) (ND-1: not widened); the quote uses the type's full precision.
--
-- Preconditions: remittances, remittance_types, offers, exchange_rates, currencies, is_admin_user(), is_super_admin(),
--   current_user_id(). No data is modified. Idempotent (CREATE OR REPLACE). Needs the owner's "dale" to apply remotely.
--   Must be applied AFTER 20261021120040 (financial_audit_log in prod, file 20261020100000 locally).
--
-- ROLLBACK: supabase/rollbacks/20261023100000_remittance_quote_and_recalculate_down.sql (restores the previous body
--   of recalculate_remittance_at_current_rate and drops _remittance_quote).
-- ============================================================================

BEGIN;

SET LOCAL lock_timeout = '5s';

-- ----------------------------------------------------------------------------------------------------
-- 1. Pure quote
-- ----------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._remittance_quote(
  p_amount         numeric,
  p_pct            numeric,
  p_fixed          numeric,
  p_rate           numeric,
  p_discount_type  text,
  p_discount_value numeric
)
RETURNS TABLE (
  amount_sent       numeric,
  gross             numeric,
  discount          numeric,
  commission_total  numeric,
  rate4             numeric,
  amount_to_deliver numeric
)
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_rate  numeric := round(p_rate, 4);
  v_sent  numeric := round(p_amount, 2);
  v_gross numeric := round(round(p_amount, 2) * COALESCE(p_pct, 0) / 100 + COALESCE(p_fixed, 0), 2);
  v_type  text    := CASE WHEN p_discount_type = 'fixed' THEN 'fixed_amount' ELSE p_discount_type END;
  v_disc  numeric;
  v_comm  numeric;
BEGIN
  v_disc := CASE v_type
    WHEN 'percentage'  THEN round(v_gross * COALESCE(p_discount_value, 0) / 100, 2)
    WHEN 'fixed_amount' THEN round(least(COALESCE(p_discount_value, 0), v_gross), 2)
    ELSE 0
  END;
  v_disc := greatest(0, least(v_disc, v_gross));
  v_comm := v_gross - v_disc;
  RETURN QUERY SELECT v_sent, v_gross, v_disc, v_comm, v_rate, round((v_sent - v_comm) * v_rate, 2);
END;
$function$;

REVOKE ALL ON FUNCTION public._remittance_quote(numeric, numeric, numeric, numeric, text, numeric)
  FROM PUBLIC, anon, authenticated, service_role;

-- ----------------------------------------------------------------------------------------------------
-- 2. Where the discount of a remittance comes from (shared by the re-pricing RPC and the commission override RPC)
--    offer row exists  -> its discount_type / discount_value (re-derived over the new gross commission, ND-2)
--    no offer row      -> the stored discount_amount as a fixed amount (the quote caps it at the gross commission)
-- ----------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._remittance_discount_source(p_offer_id uuid, p_stored numeric)
RETURNS TABLE (discount_type text, discount_value numeric)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $function$
  SELECT o.discount_type::text, o.discount_value::numeric FROM public.offers o WHERE o.id = p_offer_id
  UNION ALL
  SELECT 'fixed_amount'::text, COALESCE(p_stored, 0)::numeric
  WHERE NOT EXISTS (SELECT 1 FROM public.offers o WHERE o.id = p_offer_id);
$function$;

REVOKE ALL ON FUNCTION public._remittance_discount_source(uuid, numeric) FROM PUBLIC, anon, authenticated, service_role;

-- ----------------------------------------------------------------------------------------------------
-- 3. Re-pricing RPC
-- ----------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.recalculate_remittance_at_current_rate(p_remittance_id uuid)
 RETURNS remittances
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_rem          public.remittances%ROWTYPE;
  v_type         public.remittance_types%ROWTYPE;
  v_from_id      uuid;
  v_to_id        uuid;
  v_rate         numeric;
  v_comm_pct     numeric;
  v_comm_fixed   numeric;
  v_disc         record;
  v_quote        record;
BEGIN
  SELECT * INTO v_rem FROM public.remittances WHERE id = p_remittance_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'remittance_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT (
    v_rem.user_id = public.current_user_id()
    OR public.is_admin_user()
    OR public.is_super_admin()
  ) THEN
    RAISE EXCEPTION 'insufficient_privilege: not the owner of this remittance' USING ERRCODE = '42501';
  END IF;
  IF v_rem.status NOT IN ('payment_pending', 'payment_rejected') THEN
    RAISE EXCEPTION 'invalid_status: only payment_pending or payment_rejected remittances can be recalculated'
      USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_type FROM public.remittance_types WHERE id = v_rem.remittance_type_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'remittance_type_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_rem.currency_sent = v_rem.currency_delivered THEN
    v_rate := 1;
  ELSIF v_type.exchange_rate IS NOT NULL AND v_type.exchange_rate > 0 THEN
    v_rate := v_type.exchange_rate;
  ELSE
    -- Central rate: the ACTIVE DIRECT pair (sent -> delivered) of exchange_rates. No inverse, no default.
    SELECT id INTO v_from_id FROM public.currencies
      WHERE code = v_rem.currency_sent AND is_active = true LIMIT 1;
    SELECT id INTO v_to_id FROM public.currencies
      WHERE code = v_rem.currency_delivered AND is_active = true LIMIT 1;
    IF v_from_id IS NOT NULL AND v_to_id IS NOT NULL THEN
      SELECT er.rate INTO v_rate
      FROM public.exchange_rates er
      WHERE er.from_currency_id = v_from_id
        AND er.to_currency_id = v_to_id
        AND er.is_active = true
        AND er.rate > 0
      ORDER BY er.effective_date DESC, er.updated_at DESC, er.id DESC
      LIMIT 1;
    END IF;
    IF v_rate IS NULL OR v_rate <= 0 THEN
      RAISE EXCEPTION 'exchange_rate_unavailable: no active % -> % rate in exchange_rates',
        v_rem.currency_sent, v_rem.currency_delivered
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  v_comm_pct   := COALESCE(v_type.commission_percentage, 0);
  v_comm_fixed := COALESCE(v_type.commission_fixed, 0);

  -- Discount: re-derived from the offer the customer accepted; without an offer row the stored amount is kept
  -- (a fixed discount, capped at the gross commission by the quote).
  SELECT * INTO v_disc FROM public._remittance_discount_source(v_rem.offer_id, v_rem.discount_amount);

  SELECT * INTO v_quote
  FROM public._remittance_quote(v_rem.amount_sent, v_comm_pct, v_comm_fixed, v_rate, v_disc.discount_type, v_disc.discount_value);

  UPDATE public.remittances
  SET exchange_rate         = v_quote.rate4,
      commission_percentage = v_comm_pct,
      commission_fixed      = v_comm_fixed,
      commission_total      = v_quote.commission_total,
      discount_amount       = v_quote.discount,
      amount_to_deliver     = v_quote.amount_to_deliver,
      updated_at            = now()
  WHERE id = p_remittance_id
  RETURNING * INTO v_rem;
  RETURN v_rem;
END;
$function$;

REVOKE ALL ON FUNCTION public.recalculate_remittance_at_current_rate(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recalculate_remittance_at_current_rate(uuid) TO authenticated, service_role;

COMMIT;
