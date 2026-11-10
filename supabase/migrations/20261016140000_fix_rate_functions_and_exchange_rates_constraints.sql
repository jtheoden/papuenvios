-- ============================================================================
-- Fix two broken SECURITY DEFINER functions + harden exchange_rates
-- ============================================================================
-- PREPARED, NOT APPLIED to the hosted project. Applying it to production is a separate action that needs the
-- owner's explicit go-ahead (see APPLY ORDER below).
--
-- 1. get_remittance_bank_accounts_admin(uuid)
--    Production body selects r.delivery_amount, a column that does not exist on public.remittances (the real
--    column is amount_to_deliver), so every call fails with 42703 at run time. Fixed: the output column keeps its
--    name (delivery_amount, part of the RETURNS TABLE) and is fed from r.amount_to_deliver. The varchar columns
--    are cast to text because RETURNS TABLE declares text. Signature, admin gate and grants are unchanged.
--
-- 2. recalculate_remittance_at_current_rate(uuid)
--    Production body falls back to public.official_currency_rates, a table that was dropped (the rate source is
--    exchange_rates), so the fallback branch fails with 42P01 and, before that, silently invented rates
--    (hardcoded CUP = 0.041, an inverse-pair guess and a final "rate := 1"). Now:
--      * same currency                         -> rate 1                  (unchanged)
--      * remittance_types.exchange_rate > 0    -> that fixed rate         (unchanged; wins, as before)
--      * otherwise the ACTIVE DIRECT pair (sent -> delivered) of exchange_rates, rate > 0, newest first
--      * no such row (unknown/inactive currency, no active pair, only the inverse pair, only inactive rows)
--        -> RAISE 'exchange_rate_unavailable' (P0001); the remittance row is left untouched (fail closed).
--    No inverse fallback, no official table, no hardcoded default, no "rate := 1". Return type (remittances),
--    ownership / admin check, status check, rounding and the UPDATE are unchanged, so
--    remittanceService.recalculateRemittance (the only caller) keeps working. Note: in production every
--    remittance_types row carries a positive exchange_rate today, so the exchange_rates branch only runs for a
--    type whose rate is 0; behaviour for those types is unchanged.
--
--    Both functions: SECURITY DEFINER, search_path = public, pg_temp, EXECUTE revoked from PUBLIC / anon and
--    granted exactly as in production (get_...: authenticated; recalculate_...: authenticated + service_role).
--    The role check stays INSIDE the body (is_admin_user(); owner / admin / super_admin).
--
-- 3. exchange_rates constraints (rows are never modified or deleted here)
--    Production check (read-only SELECTs run on 2026-10-16, 22 rows, 4 active):
--      rows with rate <= 0 ........................ 0 (0 active)
--      rows with from_currency_id = to_currency_id .. 1 (0 active): USD->USD, rate 1, inactive, effective 2025-10-01
--                                                      (id 614182fb-2fc3-4c6d-9154-449fc28f6c93)
--      directed pairs with more than one ACTIVE row .. 0
--      active rows (4, one per directed pair) ..... USD->CUP 790 (2026-10-04), CUP->USD 0.001266 (2026-10-04),
--                                                      USD->EUR 0.892861 (2026-10-16), EUR->USD 1.119995 (2026-10-16)
--    Existing unique constraint unique_currency_pair_date (from, to, effective_date) is kept untouched.
--    Legacy INACTIVE rows with absurd values (e.g. CUP->USD 400, USD->CUP 0.0025, USD->MLC/MXN/VES/COP/DOP
--    from 2025) pass rate > 0, are not ACTIVE and therefore never conflict with the partial index.
--
--    a) exchange_rates_rate_positive_chk  CHECK (rate > 0)
--       Added NOT VALID then VALIDATEd: the data allows it (0 violating rows). If a violating row appears before
--       the push, VALIDATE fails and the whole file rolls back.
--    b) exchange_rates_distinct_currencies_chk  CHECK (from_currency_id <> to_currency_id)  NOT VALID, left
--       NOT VALIDATED ON PURPOSE: the legacy inactive USD->USD row violates it, and this migration must not touch
--       data. NOT VALID is enforced for every new INSERT and every UPDATE of any row (so that legacy row cannot be
--       edited or reactivated while it stays invalid), but is not checked against existing rows.
--       After the owner approves the cleanup (probe file below) run once:
--         ALTER TABLE public.exchange_rates VALIDATE CONSTRAINT exchange_rates_distinct_currencies_chk;
--    c) exchange_rates_one_active_per_pair  UNIQUE INDEX (from_currency_id, to_currency_id) WHERE is_active
--       At most ONE active row per directed pair, whatever its effective_date. Inactive history is unrestricted.
--       Plain CREATE INDEX (not CONCURRENTLY: it must run inside the migration transaction; the table has 22 rows).
--
--    Front-end paths (src/lib/currencyService.js) against the new index, covered by the DB tests:
--      * updateExchangeRatePair: UPDATEs the active row in place (rate + today's effective_date). The row stays
--        active, so the index cannot collide. The pre-existing collision with an INACTIVE same-day leftover is on
--        unique_currency_pair_date and is still cleared by updateActiveRateRow, as before.
--      * deleteExchangeRate / deleteExchangeRatePair: is_active := false. Never collides.
--      * saveExchangeRate (upsert on from,to,effective_date, is_active := true): same-day reactivation of an
--        inactive row works. NEW BEHAVIOUR: when ANOTHER row of the pair is already active with a different date,
--        the upsert now fails with 23505 (exchange_rates_one_active_per_pair) instead of silently creating a
--        second active row (which made every "newest rate wins" reader ambiguous). The Financial Settings UI
--        already blocks that case ("delete it first", duplicateRateInfo), so only a stale tab or a direct call can
--        hit it, and it surfaces as the existing parseSupabaseError toast.
--      * Reactivating an old row while another one is active is rejected for the same reason (intended).
--
-- DATA CLEANUP (NOT part of this migration; never executed here)
--   REQUIERE DALE DEL DUEÑO. See supabase/probes/exchange_rates_legacy_cleanup_probes.sql: read-only SELECTs that
--   list the legacy rows, plus a commented-out, ready-to-review DELETE of the inactive USD->USD row. Nothing in
--   that file runs unless the owner approves and removes the comment markers by hand.
--
-- APPLY ORDER / PRECONDITIONS
--   1. Needs the already-applied bodies of 20261013170000_remittances_owner_update_guard.sql (the UPDATE inside
--      recalculate_... passes that trigger exactly as before) and is_admin_user() / is_super_admin() /
--      current_user_id(). Nothing else; independent of the Bizum files.
--   2. Re-run the three SELECTs of section 3 in production right before applying (rate <= 0, active duplicates:
--      both must still be 0; otherwise the file aborts and rolls back by itself).
--   3. Apply the whole file in ONE push (it is a single transaction). Idempotent: CREATE OR REPLACE, IF NOT EXISTS
--      and guarded ADD CONSTRAINT.
--   4. Optional, later and separately (needs the owner's go-ahead): the legacy cleanup + VALIDATE of (b).
--
-- ROLLBACK (exact inverse; the old bodies are the production ones, broken references included)
-- ALTER TABLE public.exchange_rates DROP CONSTRAINT IF EXISTS exchange_rates_rate_positive_chk;
-- ALTER TABLE public.exchange_rates DROP CONSTRAINT IF EXISTS exchange_rates_distinct_currencies_chk;
-- DROP INDEX IF EXISTS public.exchange_rates_one_active_per_pair;
--
-- CREATE OR REPLACE FUNCTION public.get_remittance_bank_accounts_admin(p_remittance_id uuid)
-- RETURNS TABLE(remittance_id uuid, recipient_name text, recipient_phone text, bank_name text, account_type text,
--               currency_code text, account_holder_name text, account_number_full text, account_number_last4 text,
--               delivery_amount numeric)
-- LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
-- AS $function$
-- BEGIN
--   IF NOT is_admin_user() THEN
--     RAISE EXCEPTION 'Access denied: admin role required';
--   END IF;
--
--   RETURN QUERY
--   SELECT
--     r.id AS remittance_id,
--     rec.full_name AS recipient_name,
--     rec.phone AS recipient_phone,
--     b.name AS bank_name,
--     at.name AS account_type,
--     c.code AS currency_code,
--     ba.account_holder_name,
--     ba.account_number_full,
--     ba.account_number_last4,
--     r.delivery_amount
--   FROM public.remittances r
--   INNER JOIN public.recipients rec ON rec.id = r.recipient_id
--   LEFT JOIN public.remittance_bank_transfers rbt ON rbt.remittance_id = r.id
--   LEFT JOIN public.recipient_bank_accounts rba ON rba.id = rbt.recipient_bank_account_id
--   LEFT JOIN public.bank_accounts ba ON ba.id = rba.bank_account_id
--   LEFT JOIN public.banks b ON b.id = ba.bank_id
--   LEFT JOIN public.account_types at ON at.id = ba.account_type_id
--   LEFT JOIN public.currencies c ON c.id = ba.currency_id
--   WHERE r.id = p_remittance_id;
-- END;
-- $function$;
--
-- CREATE OR REPLACE FUNCTION public.recalculate_remittance_at_current_rate(p_remittance_id uuid)
-- RETURNS public.remittances
-- LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
-- AS $function$
-- DECLARE
--   v_rem          public.remittances%ROWTYPE;
--   v_type         public.remittance_types%ROWTYPE;
--   v_from_id      uuid;
--   v_to_id        uuid;
--   v_rate         numeric;
--   v_inv          numeric;
--   v_from_usd     numeric;
--   v_to_usd       numeric;
--   v_comm_pct     numeric;
--   v_comm_fixed   numeric;
--   v_comm_total   numeric;
--   v_to_deliver   numeric;
-- BEGIN
--   SELECT * INTO v_rem FROM public.remittances WHERE id = p_remittance_id FOR UPDATE;
--   IF NOT FOUND THEN
--     RAISE EXCEPTION 'remittance_not_found' USING ERRCODE = 'P0002';
--   END IF;
--   IF NOT (
--     v_rem.user_id = public.current_user_id()
--     OR public.is_admin_user()
--     OR public.is_super_admin()
--   ) THEN
--     RAISE EXCEPTION 'insufficient_privilege: not the owner of this remittance' USING ERRCODE = '42501';
--   END IF;
--   IF v_rem.status NOT IN ('payment_pending', 'payment_rejected') THEN
--     RAISE EXCEPTION 'invalid_status: only payment_pending or payment_rejected remittances can be recalculated'
--       USING ERRCODE = '22023';
--   END IF;
--   SELECT * INTO v_type FROM public.remittance_types WHERE id = v_rem.remittance_type_id;
--   IF NOT FOUND THEN
--     RAISE EXCEPTION 'remittance_type_not_found' USING ERRCODE = 'P0002';
--   END IF;
--   IF v_rem.currency_sent = v_rem.currency_delivered THEN
--     v_rate := 1;
--   ELSIF v_type.exchange_rate IS NOT NULL AND v_type.exchange_rate > 0 THEN
--     v_rate := v_type.exchange_rate;
--   ELSE
--     SELECT id INTO v_from_id FROM public.currencies
--       WHERE code = v_rem.currency_sent AND is_active = true LIMIT 1;
--     SELECT id INTO v_to_id FROM public.currencies
--       WHERE code = v_rem.currency_delivered AND is_active = true LIMIT 1;
--     IF v_from_id IS NOT NULL AND v_to_id IS NOT NULL THEN
--       SELECT rate INTO v_rate
--       FROM public.exchange_rates
--       WHERE from_currency_id = v_from_id AND to_currency_id = v_to_id AND is_active = true
--       ORDER BY effective_date DESC
--       LIMIT 1;
--       IF v_rate IS NULL OR v_rate <= 0 THEN
--         v_rate := NULL;
--         SELECT rate INTO v_inv
--         FROM public.exchange_rates
--         WHERE from_currency_id = v_to_id AND to_currency_id = v_from_id AND is_active = true
--         ORDER BY effective_date DESC
--         LIMIT 1;
--         IF v_inv IS NOT NULL AND v_inv <> 0 THEN
--           v_rate := 1 / v_inv;
--         END IF;
--       END IF;
--       IF v_rate IS NULL OR v_rate <= 0 THEN
--         v_rate := NULL;
--         SELECT rate_to_usd INTO v_from_usd FROM public.official_currency_rates
--           WHERE currency_code = v_rem.currency_sent;
--         SELECT rate_to_usd INTO v_to_usd FROM public.official_currency_rates
--           WHERE currency_code = v_rem.currency_delivered;
--         v_from_usd := COALESCE(v_from_usd, CASE v_rem.currency_sent WHEN 'USD' THEN 1 WHEN 'MLC' THEN 1 WHEN 'CUP' THEN 0.041 END);
--         v_to_usd   := COALESCE(v_to_usd,   CASE v_rem.currency_delivered WHEN 'USD' THEN 1 WHEN 'MLC' THEN 1 WHEN 'CUP' THEN 0.041 END);
--         IF v_from_usd IS NOT NULL AND v_to_usd IS NOT NULL AND v_to_usd <> 0 THEN
--           v_rate := v_from_usd / v_to_usd;
--         END IF;
--       END IF;
--     END IF;
--     IF v_rate IS NULL OR v_rate <= 0 THEN
--       v_rate := 1;
--     END IF;
--   END IF;
--   v_comm_pct   := COALESCE(v_type.commission_percentage, 0);
--   v_comm_fixed := COALESCE(v_type.commission_fixed, 0);
--   v_comm_total := (v_rem.amount_sent * v_comm_pct / 100) + v_comm_fixed;
--   v_to_deliver := (v_rem.amount_sent - v_comm_total) * v_rate;
--   UPDATE public.remittances
--   SET exchange_rate         = v_rate,
--       commission_percentage = v_comm_pct,
--       commission_fixed      = v_comm_fixed,
--       commission_total      = round(v_comm_total, 2),
--       amount_to_deliver     = round(v_to_deliver, 2),
--       updated_at            = now()
--   WHERE id = p_remittance_id
--   RETURNING * INTO v_rem;
--   RETURN v_rem;
-- END;
-- $function$;
-- (the grants were never changed by this file, nothing to restore)
-- ============================================================================

-- --------------------------------------------------------------------------
-- 1. get_remittance_bank_accounts_admin
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_remittance_bank_accounts_admin(p_remittance_id uuid)
RETURNS TABLE(
  remittance_id uuid,
  recipient_name text,
  recipient_phone text,
  bank_name text,
  account_type text,
  currency_code text,
  account_holder_name text,
  account_number_full text,
  account_number_last4 text,
  delivery_amount numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'Access denied: admin role required';
  END IF;

  RETURN QUERY
  SELECT
    r.id AS remittance_id,
    rec.full_name::text AS recipient_name,
    rec.phone::text AS recipient_phone,
    b.name::text AS bank_name,
    at.name::text AS account_type,
    c.code::text AS currency_code,
    ba.account_holder_name::text,
    ba.account_number_full::text,
    ba.account_number_last4::text,
    r.amount_to_deliver AS delivery_amount
  FROM public.remittances r
  INNER JOIN public.recipients rec ON rec.id = r.recipient_id
  LEFT JOIN public.remittance_bank_transfers rbt ON rbt.remittance_id = r.id
  LEFT JOIN public.recipient_bank_accounts rba ON rba.id = rbt.recipient_bank_account_id
  LEFT JOIN public.bank_accounts ba ON ba.id = rba.bank_account_id
  LEFT JOIN public.banks b ON b.id = ba.bank_id
  LEFT JOIN public.account_types at ON at.id = ba.account_type_id
  LEFT JOIN public.currencies c ON c.id = ba.currency_id
  WHERE r.id = p_remittance_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_remittance_bank_accounts_admin(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_remittance_bank_accounts_admin(uuid) TO authenticated;

-- --------------------------------------------------------------------------
-- 2. recalculate_remittance_at_current_rate
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.recalculate_remittance_at_current_rate(p_remittance_id uuid)
RETURNS public.remittances
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_rem          public.remittances%ROWTYPE;
  v_type         public.remittance_types%ROWTYPE;
  v_from_id      uuid;
  v_to_id        uuid;
  v_rate         numeric;
  v_comm_pct     numeric;
  v_comm_fixed   numeric;
  v_comm_total   numeric;
  v_to_deliver   numeric;
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
  v_comm_total := (v_rem.amount_sent * v_comm_pct / 100) + v_comm_fixed;
  v_to_deliver := (v_rem.amount_sent - v_comm_total) * v_rate;

  UPDATE public.remittances
  SET exchange_rate         = v_rate,
      commission_percentage = v_comm_pct,
      commission_fixed      = v_comm_fixed,
      commission_total      = round(v_comm_total, 2),
      amount_to_deliver     = round(v_to_deliver, 2),
      updated_at            = now()
  WHERE id = p_remittance_id
  RETURNING * INTO v_rem;
  RETURN v_rem;
END;
$function$;

REVOKE ALL ON FUNCTION public.recalculate_remittance_at_current_rate(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recalculate_remittance_at_current_rate(uuid) TO authenticated, service_role;

-- --------------------------------------------------------------------------
-- 3. exchange_rates constraints (no data is touched)
-- --------------------------------------------------------------------------
DO $constraints$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.exchange_rates'::regclass AND conname = 'exchange_rates_rate_positive_chk'
  ) THEN
    ALTER TABLE public.exchange_rates
      ADD CONSTRAINT exchange_rates_rate_positive_chk CHECK (rate > 0) NOT VALID;
  END IF;

  -- Production has 0 rows with rate <= 0: validate (fails, and rolls the file back, if that changed).
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.exchange_rates'::regclass
      AND conname = 'exchange_rates_rate_positive_chk' AND NOT convalidated
  ) THEN
    ALTER TABLE public.exchange_rates VALIDATE CONSTRAINT exchange_rates_rate_positive_chk;
  END IF;

  -- NOT VALID and intentionally NOT validated: a legacy inactive USD->USD row exists (see header).
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.exchange_rates'::regclass AND conname = 'exchange_rates_distinct_currencies_chk'
  ) THEN
    ALTER TABLE public.exchange_rates
      ADD CONSTRAINT exchange_rates_distinct_currencies_chk CHECK (from_currency_id <> to_currency_id) NOT VALID;
  END IF;
END
$constraints$;

CREATE UNIQUE INDEX IF NOT EXISTS exchange_rates_one_active_per_pair
  ON public.exchange_rates (from_currency_id, to_currency_id)
  WHERE is_active;

COMMENT ON INDEX public.exchange_rates_one_active_per_pair IS
  'At most one ACTIVE exchange rate per directed currency pair; inactive history is unrestricted.';
