-- ============================================================================
-- Phase 1.5 / S2 (audit_phase1_price_tamper.md, patch P3): server-side sanity guard for
-- remittance INSERTs, with an off / warn / block kill switch.      PREPARED, NOT APPLIED
-- ============================================================================
-- Closes (matrix): T-07 (inflated amount_to_deliver), T-08 (own exchange rate), T-10 (amount outside the
-- type limits, currencies that do not match the type, inactive type or currency) and the forced
-- USD->USD rate (same-currency types carry exchange_rate = 105 in remittance_types: the same-currency
-- branch "rate = 1" is evaluated FIRST). A negative commission is rejected too.
--
-- What it is NOT: it does not recompute the remittance, it only enforces UPPER BOUNDS that every flow of
-- the current client satisfies (calculateRemittance, direct and reverse mode both end in the same forward
-- calculation). Server-authoritative pricing (create_remittance RPC, quote_id, idempotency) stays in F4a.
--
-- ----------------------------------------------------------------------------------------------------
-- RULES (all on public.remittances BEFORE INSERT, trigger guard_remittance_pricing)
--   blocking class (rejected in 'block', recorded as flag in 'warn'):
--     type_unavailable      remittance type missing or is_active = false (NULL counts as active, like the client)
--     currency_mismatch     currency_sent / currency_delivered differ from the type's currency_code / delivery_currency
--     currency_inactive     either currency is not an active row of public.currencies
--     below_min / above_max amount_sent outside [min_amount, max_amount] (max NULL = no maximum)
--     rate_above_resolved   exchange_rate > resolved_rate * 1.0005, where resolved_rate is, in this order:
--                             1. same currency (type.currency_code = type.delivery_currency) -> 1
--                             2. remittance_types.exchange_rate when > 0
--                             3. active DIRECT pair of exchange_rates, else 1/(active inverse pair)
--                             4. none -> rule skipped, flag 'rate_unresolvable' (types with rate 0 do not exist in
--                                production today; the client would fall back to a rate we cannot reproduce)
--                           A rate BELOW the resolved one always passes (stale cached rate, admin lowered the rate).
--     delivery_above_cap    amount_to_deliver > (amount_sent - commission_total) * exchange_rate
--                                               + 0.0125 * exchange_rate + 0.0001 * amount_sent + 0.02
--     commission_negative   commission_total < 0 or commission_fixed < 0
--   flag-only class (NEVER blocks, recorded in 'warn' and 'block'; not recorded in 'off'):
--     commission_below_floor  commission_total < max(0, amount_sent * type.commission_percentage / 100
--                             + type.commission_fixed - discount_amount) - 0.01
--                             Fails today on REM-2026-001111 and REM-2026-001113 (USD->USD, 3.00 vs 4.90, written by an
--                             older client formula), so a block would create false positives.
--   Every comparison is written "IF (cond) IS NOT TRUE" so a NULL operand rejects instead of skipping.
--
-- ROUNDING CONTRACT OBSERVED (documented, NOT changed - changing it needs the owner's "dale"):
--   The client computes in JS floats and sends UNROUNDED values: amount_sent (raw input, e.g. 102.5641025641 in
--   reverse mode), commission_total = max(0, amount*pct/100 + fixed - discount) with no rounding, and
--   amount_to_deliver = amount*rate - commission*rate. PostgreSQL then rounds every column to its scale
--   (amount_sent 2 dp, commission_total 2 dp, amount_to_deliver 2 dp, exchange_rate 4 dp). Hence the stored
--   amount_to_deliver can exceed (stored_sent - stored_commission) * rate by up to ~0.005*rate for each rounded
--   input (about 8 CUP at rate 800: REM-2026-001125, 765 USD, stored commission 19.13 vs raw 19.125, delivers
--   596700 where the stored-commission formula gives 596696). The cap above adds 0.0125 * rate (10 CUP at 800)
--   + 0.0001 * amount_sent + 0.02 of allowance, i.e. the attacker's extra gain is bounded to about 10 CUP
--   (~0.0125 USD) per remittance. The 3000-sample float replay in phase15S2RemittancePricingGuard.test.js and
--   the 27 production rows all pass with positive slack.
--
-- KILL SWITCH: system_config key remittance_pricing_guard_mode (value_text): 'off' | 'warn' | 'block'.
--   Ships as 'warn'. Missing row or any other value behaves as 'warn' (a mistake can never block checkout or
--   silently disable the guard). Change it without a migration: SELECT public.set_remittance_pricing_guard_mode('block');
--   (super_admin only, logged to activity_logs) or, with SQL access, UPDATE system_config SET value_text = ...
--   The CHECKs of S1 are NOT governed by this switch (they are plain arithmetic; roll them back with DROP CONSTRAINT).
--   IN WARN MODE THE ATTACKS ARE ONLY RECORDED, NOT STOPPED: flip to 'block' once price_integrity_flags shows no
--   legitimate traffic being flagged (a flag for a real customer = a false positive to investigate first).
--
-- OBSERVABILITY: public.price_integrity_flags (new, admin-only: RLS on, NO policies, NO grants for anon /
--   authenticated, not in supabase_realtime, no FK so execute_platform_reset and deletes are never blocked).
--   Read it with service_role / SQL editor. Generic columns (source_table, source_id, rule, mode, details) so the
--   order_items patch (S3) can reuse it without an ALTER. In 'block' mode the rejected INSERT rolls back its own
--   transaction, so a blocked attempt leaves NO flag row: it is visible only in the Postgres / API logs (error text
--   'remittance_pricing_rejected'). execute_platform_reset does not clear this table (changing that SECURITY DEFINER
--   function needs its own "dale"; leftover flags are harmless).
--
-- WHO IS NOT RESTRICTED: service_role, postgres, supabase_admin, requests without a JWT subject, admins and
--   super_admins (same bypass as guard_remittance_owner_insert). Evidence: the only code that INSERTs into
--   remittances is src/lib/remittanceService.js createRemittance (same function for admins, who send their own
--   user_id); no SQL function and no Edge Function inserts remittances (notify-zelle-deactivation only reads).
--   The bypass test matrix (admin, super_admin, service_role, postgres accepted; customer rejected) is in the DB tests.
--
-- SECURITY DEFINER (justified): the trigger must read system_config (admin-only RLS) and write
--   price_integrity_flags (no grants). Because current_user inside a DEFINER function is the function owner, the
--   bypass is NOT written with current_user (that would let everybody through); it uses auth.uid(), is_admin_user(),
--   is_super_admin() and the session GUC `role` (set by PostgREST's SET ROLE; the DEFINER switch does not alter it).
--   search_path = public, pg_temp; EXECUTE revoked from PUBLIC, anon, authenticated; trigger functions cannot be
--   called as plain functions anyway. The error is uniform ('remittance_pricing_rejected', SQLSTATE 23514, no DETAIL
--   or HINT): rates, limits and commissions never leak through errors (the type rate and limits are public, the
--   commission floor is not part of any blocking rule).
--
-- TRIGGER ORDER (BEFORE INSERT, alphabetical): guard_payment_method_enabled, guard_remittance_owner_insert,
--   guard_remittance_pricing (NEW), guard_reset_lock_remittances, trigger_generate_remittance_number.
--   Runs after the owner-state guard and before the platform-reset lock; reads client columns only and writes none.
--   Bizum S5a sealing is on orders and is not touched.
--
-- Production verification (read-only SELECTs via MCP, 2026-10-17, project qcwnlbpultscerwdnzbm):
--   currencies USD / CUP / EUR: all is_active = true.
--   remittance_types (4): 'Dolares a CUP (Efectivo)' USD>CUP rate 800 pct 2.5 min 20 max 3000 cash active;
--     'Dolares a CUP(Transferencia)' USD>CUP 900 pct 5.5555555556 min 100 max NULL transfer INACTIVE;
--     'Dolares a USD (Transferencia)' USD>USD rate 105 pct 4.7619047619 min 20 max 2000 INACTIVE;
--     'Dolares a Dolares' USD>USD rate 105 pct 4.7619047619 min 20 max 1000 cash active.
--   remittances: 27 rows (the audit counted 24; 3 were created since). Final rules run verbatim against all 27 with
--     the shipped tolerance: currency mismatch 0, inactive type 0, limits 0, rate rule 0, delivery cap 0 (minimum
--     slack 0.04), negative commission 0, commission_below_floor 2 (REM-2026-001111, REM-2026-001113: flag only).
--   exchange_rates / system_config: no key matching remit*, guard* or integrity* exists; price_integrity_flags absent.
--   Trigger list on remittances (BEFORE INSERT): guard_payment_method_enabled, guard_remittance_owner_insert,
--     guard_reset_lock_remittances, trigger_generate_remittance_number (identical to the local replay).
--
-- Preconditions: S1 applied first (20261017100000); is_admin_user(), is_super_admin(), auth.uid(), activity_logs
--   and system_config exist. No active remittance type has exchange_rate <= 0 (re-run before applying:
--   SELECT id FROM remittance_types WHERE is_active AND exchange_rate <= 0 -> expect 0 rows).
-- Apply order: S1 then S2. Needs the owner's "dale" to apply remotely. Idempotent (CREATE OR REPLACE, IF NOT EXISTS).
-- Recommended rollout: apply in 'warn', watch price_integrity_flags for a few days of real traffic, then set 'block'.
--
-- ROLLBACK (exact inverse; the config row and flags are data and are removed explicitly):
-- DROP TRIGGER IF EXISTS guard_remittance_pricing ON public.remittances;
-- DROP FUNCTION IF EXISTS public.guard_remittance_pricing();
-- DROP FUNCTION IF EXISTS public.set_remittance_pricing_guard_mode(text);
-- DROP FUNCTION IF EXISTS public._remittance_guard_mode();
-- DELETE FROM public.system_config WHERE key = 'remittance_pricing_guard_mode';
-- DROP TABLE IF EXISTS public.price_integrity_flags;   -- only if S3 has not started using it
-- ============================================================================

SET LOCAL lock_timeout = '5s';

-- ----------------------------------------------------------------------------------------------------
-- 1. Flags table (admin-only: RLS on, no policies, no grants)
-- ----------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.price_integrity_flags (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at   timestamptz NOT NULL DEFAULT now(),
  source_table text NOT NULL,
  source_id    uuid NOT NULL,
  user_id      uuid,
  rule         text NOT NULL,
  mode         text NOT NULL CHECK (mode IN ('warn', 'flag', 'block')),
  details      jsonb NOT NULL DEFAULT '{}'::jsonb
);

ALTER TABLE public.price_integrity_flags ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.price_integrity_flags FROM PUBLIC, anon, authenticated;

CREATE INDEX IF NOT EXISTS price_integrity_flags_source_idx
  ON public.price_integrity_flags (source_table, source_id);
CREATE INDEX IF NOT EXISTS price_integrity_flags_created_idx
  ON public.price_integrity_flags (created_at DESC);

-- ----------------------------------------------------------------------------------------------------
-- 2. Kill switch row (ships in warn) and its readers / writer
-- ----------------------------------------------------------------------------------------------------
INSERT INTO public.system_config (key, value_text, description)
SELECT 'remittance_pricing_guard_mode', 'warn',
       'Remittance pricing guard mode: off | warn | block. warn records violations in price_integrity_flags without blocking; block rejects them. Missing or invalid values behave as warn.'
 WHERE NOT EXISTS (SELECT 1 FROM public.system_config c WHERE c.key = 'remittance_pricing_guard_mode');

CREATE OR REPLACE FUNCTION public._remittance_guard_mode()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT COALESCE(
    (SELECT value_text FROM public.system_config
      WHERE key = 'remittance_pricing_guard_mode' AND value_text IN ('off', 'warn', 'block')),
    'warn');
$function$;

REVOKE ALL ON FUNCTION public._remittance_guard_mode() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.set_remittance_pricing_guard_mode(p_mode text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_before text;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE = '42501';
  END IF;
  IF p_mode IS NULL OR p_mode NOT IN ('off', 'warn', 'block') THEN
    RAISE EXCEPTION 'invalid_mode: expected off, warn or block' USING ERRCODE = '22023';
  END IF;

  v_before := public._remittance_guard_mode();

  INSERT INTO public.system_config (key, value_text, description)
  VALUES ('remittance_pricing_guard_mode', p_mode,
          'Remittance pricing guard mode: off | warn | block. Missing or invalid values behave as warn.')
  ON CONFLICT (key) DO UPDATE SET value_text = EXCLUDED.value_text;

  INSERT INTO public.activity_logs (action, entity_type, entity_id, performed_by, description, metadata)
  VALUES ('remittance_pricing_guard_mode_changed', 'system_config', NULL, COALESCE(auth.uid()::text, 'service_role'),
          'Remittance pricing guard mode changed',
          jsonb_build_object('before', v_before, 'after', p_mode));

  RETURN p_mode;
END;
$function$;

REVOKE ALL ON FUNCTION public.set_remittance_pricing_guard_mode(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_remittance_pricing_guard_mode(text) TO authenticated, service_role;

-- ----------------------------------------------------------------------------------------------------
-- 3. The guard
-- ----------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_remittance_pricing()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_mode      text;
  v_type      public.remittance_types%ROWTYPE;
  v_type_ok   boolean;
  v_rate      numeric;
  v_cap       numeric;
  v_floor     numeric;
  v_from_id   uuid;
  v_to_id     uuid;
  v_inv       numeric;
  v_block     text[] := ARRAY[]::text[];
  v_flag      text[] := ARRAY[]::text[];
  v_rule      text;
BEGIN
  -- Trusted contexts. NOT current_user: inside SECURITY DEFINER it is the function owner.
  IF auth.uid() IS NULL
     OR COALESCE(current_setting('role', true), '') IN ('service_role', 'postgres', 'supabase_admin')
     OR public.is_admin_user()
     OR public.is_super_admin() THEN
    RETURN NEW;
  END IF;

  v_mode := public._remittance_guard_mode();
  IF v_mode = 'off' THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_type FROM public.remittance_types WHERE id = NEW.remittance_type_id;
  v_type_ok := FOUND;

  IF NOT v_type_ok OR (COALESCE(v_type.is_active, true)) IS NOT TRUE THEN
    v_block := array_append(v_block, 'type_unavailable'::text);
  END IF;

  IF v_type_ok THEN
    IF (NEW.currency_sent = v_type.currency_code AND NEW.currency_delivered = v_type.delivery_currency) IS NOT TRUE THEN
      v_block := array_append(v_block, 'currency_mismatch'::text);
    END IF;

    IF (SELECT count(DISTINCT code) FROM public.currencies
         WHERE is_active AND code IN (v_type.currency_code, v_type.delivery_currency))
       IS DISTINCT FROM (SELECT count(DISTINCT c) FROM unnest(ARRAY[v_type.currency_code, v_type.delivery_currency]) AS c) THEN
      v_block := array_append(v_block, 'currency_inactive'::text);
    END IF;

    IF (NEW.amount_sent >= v_type.min_amount) IS NOT TRUE THEN
      v_block := array_append(v_block, 'below_min'::text);
    END IF;
    IF v_type.max_amount IS NOT NULL AND (NEW.amount_sent <= v_type.max_amount) IS NOT TRUE THEN
      v_block := array_append(v_block, 'above_max'::text);
    END IF;

    -- Resolved rate, same precedence as the client (getRemittanceExchangeRate); same currency FIRST.
    v_rate := NULL;
    IF v_type.currency_code = v_type.delivery_currency THEN
      v_rate := 1;
    ELSIF v_type.exchange_rate IS NOT NULL AND v_type.exchange_rate > 0 THEN
      v_rate := v_type.exchange_rate;
    ELSE
      SELECT id INTO v_from_id FROM public.currencies WHERE code = v_type.currency_code AND is_active LIMIT 1;
      SELECT id INTO v_to_id   FROM public.currencies WHERE code = v_type.delivery_currency AND is_active LIMIT 1;
      IF v_from_id IS NOT NULL AND v_to_id IS NOT NULL THEN
        SELECT rate INTO v_rate FROM public.exchange_rates
         WHERE from_currency_id = v_from_id AND to_currency_id = v_to_id AND is_active AND rate > 0
         ORDER BY effective_date DESC LIMIT 1;
        IF v_rate IS NULL THEN
          SELECT rate INTO v_inv FROM public.exchange_rates
           WHERE from_currency_id = v_to_id AND to_currency_id = v_from_id AND is_active AND rate > 0
           ORDER BY effective_date DESC LIMIT 1;
          IF v_inv IS NOT NULL THEN
            v_rate := 1 / v_inv;
          END IF;
        END IF;
      END IF;
    END IF;

    IF v_rate IS NULL THEN
      v_flag := array_append(v_flag, 'rate_unresolvable'::text);
    ELSIF (NEW.exchange_rate <= v_rate * 1.0005) IS NOT TRUE THEN
      v_block := array_append(v_block, 'rate_above_resolved'::text);
    END IF;
  END IF;

  v_cap := (NEW.amount_sent - NEW.commission_total) * NEW.exchange_rate
           + 0.0125 * NEW.exchange_rate + 0.0001 * NEW.amount_sent + 0.02;
  IF (NEW.amount_to_deliver <= v_cap) IS NOT TRUE THEN
    v_block := array_append(v_block, 'delivery_above_cap'::text);
  END IF;

  IF (NEW.commission_total >= 0 AND NEW.commission_fixed >= 0) IS NOT TRUE THEN
    v_block := array_append(v_block, 'commission_negative'::text);
  END IF;

  -- Flag-only: commission far below what the type would charge. Never blocks.
  IF v_type_ok THEN
    v_floor := GREATEST(0, NEW.amount_sent * COALESCE(v_type.commission_percentage, 0) / 100
                           + COALESCE(v_type.commission_fixed, 0) - COALESCE(NEW.discount_amount, 0));
    IF (NEW.commission_total >= v_floor - 0.01) IS NOT TRUE THEN
      v_flag := array_append(v_flag, 'commission_below_floor'::text);
    END IF;
  END IF;

  IF array_length(v_block, 1) IS NOT NULL AND v_mode = 'block' THEN
    RAISE EXCEPTION 'remittance_pricing_rejected' USING ERRCODE = '23514';
  END IF;

  FOREACH v_rule IN ARRAY v_block LOOP
    INSERT INTO public.price_integrity_flags (source_table, source_id, user_id, rule, mode, details)
    VALUES ('remittances', NEW.id, NEW.user_id, v_rule, 'warn',
            jsonb_build_object('type_id', NEW.remittance_type_id, 'amount_sent', NEW.amount_sent,
                               'exchange_rate', NEW.exchange_rate, 'resolved_rate', v_rate,
                               'commission_total', NEW.commission_total, 'amount_to_deliver', NEW.amount_to_deliver,
                               'delivery_cap', v_cap));
  END LOOP;

  FOREACH v_rule IN ARRAY v_flag LOOP
    INSERT INTO public.price_integrity_flags (source_table, source_id, user_id, rule, mode, details)
    VALUES ('remittances', NEW.id, NEW.user_id, v_rule, 'flag',
            jsonb_build_object('type_id', NEW.remittance_type_id, 'amount_sent', NEW.amount_sent,
                               'exchange_rate', NEW.exchange_rate, 'resolved_rate', v_rate,
                               'commission_total', NEW.commission_total, 'commission_floor', v_floor,
                               'discount_amount', NEW.discount_amount));
  END LOOP;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.guard_remittance_pricing() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS guard_remittance_pricing ON public.remittances;
CREATE TRIGGER guard_remittance_pricing
  BEFORE INSERT ON public.remittances
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_remittance_pricing();
