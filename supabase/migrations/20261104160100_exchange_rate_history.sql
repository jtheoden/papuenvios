-- ============================================================================
-- exchange_rate_history: append-only history of rates and commissions.                         PREPARED, NOT APPLIED
-- ============================================================================
-- WHY (audit 2026-11-04, W6)
--   Rates and commissions are edited in place (exchange_rates, remittance_types); effective_date is unreliable (moved
--   and reverted the same day) and financial_audit_log keeps one text row per column, without market_rate nor the
--   currency pair. There is no way to answer "which rate/commission was in force at time T".
--
-- WHAT
--   1. Table public.exchange_rate_history: one row per INSERT, or per UPDATE that changes a tracked column, of
--        exchange_rates   (tracked: rate, market_rate, is_active)
--        remittance_types (tracked: exchange_rate, commission_percentage, commission_fixed, is_active)
--      holding the NEW snapshot (rate, market_rate | commission_percentage, commission_fixed, is_active, currency codes)
--      plus previous_rate / previous_commission_percentage, who (changed_by, changed_by_role, same resolution as
--      audit_financial_changes) and when (clock_timestamp, txid). INSERT is captured too (scope extension over the audit
--      item): currencyService inserts/upserts exchange_rates rows, and a new remittance type is a new price.
--      is_active is captured because it decides which rate is effective (USD->EUR was deactivated on 2026-11-04).
--      No foreign key on source_id: a deleted source row keeps its history.
--   2. Append-only exactly like financial_audit_log (20261020100000): RLS on, SELECT policy (SELECT is_admin_user()),
--      REVOKE ALL from PUBLIC/anon/authenticated/service_role then GRANT SELECT to authenticated, service_role (Supabase
--      default privileges would otherwise give ALL to the API roles); BEFORE UPDATE/DELETE (row) and BEFORE TRUNCATE
--      (statement) triggers raise 42501 for every role, postgres included.
--   3. Writer public.record_exchange_rate_history(): SECURITY DEFINER, search_path public, pg_temp, no exception handler
--      (fail-closed: if the history row cannot be written, the rate change is rolled back), EXECUTE revoked from API
--      roles. Reads market_rate through to_jsonb(NEW): the column exists in prod but not in the repo schema (drift).
--   4. Four AFTER triggers, ENABLE ALWAYS (as the audit triggers): exchange_rate_history_insert / _update on both tables.
--
-- DATA
--   NO BACKFILL: history starts when this migration is applied (financial_audit_log keeps the trail since 2026-10-22).
--   No existing row is read for write, updated or deleted. Prod today: 21 exchange_rates, 4 remittance_types.
--
-- ROLLBACK: supabase/rollbacks/20261104160100_exchange_rate_history_down.sql (drops the writer triggers only; the table and
--   its rows are kept on purpose: dropping them would destroy history).
-- ============================================================================

BEGIN;

SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.exchange_rate_history (
  id                             bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_table                   text        NOT NULL CHECK (source_table IN ('exchange_rates', 'remittance_types')),
  source_id                      uuid        NOT NULL,
  operation                      text        NOT NULL CHECK (operation IN ('INSERT', 'UPDATE')),
  from_currency                  text,
  to_currency                    text,
  rate                           numeric     NOT NULL,
  previous_rate                  numeric,
  market_rate                    numeric,
  commission_percentage          numeric,
  previous_commission_percentage numeric,
  commission_fixed               numeric,
  is_active                      boolean,
  changed_by                     uuid,
  changed_by_role                text        NOT NULL CHECK (changed_by_role IN ('super_admin', 'admin', 'user', 'service_role', 'system')),
  txid                           bigint      NOT NULL DEFAULT txid_current(),
  changed_at                     timestamptz NOT NULL DEFAULT clock_timestamp()
);

ALTER TABLE public.exchange_rate_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS exchange_rate_history_select_admin ON public.exchange_rate_history;
CREATE POLICY exchange_rate_history_select_admin ON public.exchange_rate_history
  FOR SELECT TO authenticated
  USING ((SELECT public.is_admin_user()));

REVOKE ALL ON public.exchange_rate_history FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.exchange_rate_history TO authenticated, service_role;

CREATE INDEX IF NOT EXISTS exchange_rate_history_source_idx
  ON public.exchange_rate_history (source_table, source_id, changed_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS exchange_rate_history_changed_at_idx
  ON public.exchange_rate_history (changed_at DESC, id DESC);

-- Immutability
CREATE OR REPLACE FUNCTION public.exchange_rate_history_block_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
BEGIN
  RAISE EXCEPTION 'exchange_rate_history_is_append_only' USING ERRCODE = '42501';
END;
$function$;

REVOKE ALL ON FUNCTION public.exchange_rate_history_block_mutation() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS exchange_rate_history_immutable_row ON public.exchange_rate_history;
CREATE TRIGGER exchange_rate_history_immutable_row
  BEFORE UPDATE OR DELETE ON public.exchange_rate_history
  FOR EACH ROW EXECUTE FUNCTION public.exchange_rate_history_block_mutation();

DROP TRIGGER IF EXISTS exchange_rate_history_immutable_truncate ON public.exchange_rate_history;
CREATE TRIGGER exchange_rate_history_immutable_truncate
  BEFORE TRUNCATE ON public.exchange_rate_history
  FOR EACH STATEMENT EXECUTE FUNCTION public.exchange_rate_history_block_mutation();

-- Writer
CREATE OR REPLACE FUNCTION public.record_exchange_rate_history()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid  uuid  := auth.uid();
  v_new  jsonb := to_jsonb(NEW);
  v_old  jsonb := CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) END;
  v_role text;
  v_from text;
  v_to   text;
BEGIN
  v_role := CASE
    WHEN v_uid IS NULL THEN
      CASE WHEN COALESCE(current_setting('role', true), '') = 'service_role' THEN 'service_role' ELSE 'system' END
    WHEN public.is_super_admin() THEN 'super_admin'
    WHEN public.is_admin_user() THEN 'admin'
    ELSE 'user'
  END;

  IF TG_TABLE_NAME = 'exchange_rates' THEN
    SELECT code INTO v_from FROM public.currencies WHERE id = (v_new ->> 'from_currency_id')::uuid;
    SELECT code INTO v_to   FROM public.currencies WHERE id = (v_new ->> 'to_currency_id')::uuid;
    INSERT INTO public.exchange_rate_history
      (source_table, source_id, operation, from_currency, to_currency, rate, previous_rate, market_rate,
       is_active, changed_by, changed_by_role)
    VALUES
      (TG_TABLE_NAME, (v_new ->> 'id')::uuid, TG_OP, v_from, v_to, (v_new ->> 'rate')::numeric,
       (v_old ->> 'rate')::numeric, (v_new ->> 'market_rate')::numeric,
       (v_new ->> 'is_active')::boolean, v_uid, v_role);
  ELSE
    INSERT INTO public.exchange_rate_history
      (source_table, source_id, operation, from_currency, to_currency, rate, previous_rate,
       commission_percentage, previous_commission_percentage, commission_fixed, is_active, changed_by, changed_by_role)
    VALUES
      (TG_TABLE_NAME, (v_new ->> 'id')::uuid, TG_OP, v_new ->> 'currency_code', v_new ->> 'delivery_currency',
       (v_new ->> 'exchange_rate')::numeric, (v_old ->> 'exchange_rate')::numeric,
       (v_new ->> 'commission_percentage')::numeric, (v_old ->> 'commission_percentage')::numeric,
       (v_new ->> 'commission_fixed')::numeric, (v_new ->> 'is_active')::boolean, v_uid, v_role);
  END IF;

  RETURN NULL; -- AFTER trigger
END;
$function$;

REVOKE ALL ON FUNCTION public.record_exchange_rate_history() FROM PUBLIC, anon, authenticated, service_role;

-- exchange_rates (market_rate compared through to_jsonb: the column exists in prod but not in the repo schema, so it
-- cannot be named in an UPDATE OF list or as OLD.market_rate)
DROP TRIGGER IF EXISTS exchange_rate_history_insert ON public.exchange_rates;
CREATE TRIGGER exchange_rate_history_insert
  AFTER INSERT ON public.exchange_rates
  FOR EACH ROW EXECUTE FUNCTION public.record_exchange_rate_history();
ALTER TABLE public.exchange_rates ENABLE ALWAYS TRIGGER exchange_rate_history_insert;

DROP TRIGGER IF EXISTS exchange_rate_history_update ON public.exchange_rates;
CREATE TRIGGER exchange_rate_history_update
  AFTER UPDATE ON public.exchange_rates
  FOR EACH ROW
  WHEN (OLD.rate IS DISTINCT FROM NEW.rate
        OR OLD.is_active IS DISTINCT FROM NEW.is_active
        OR (to_jsonb(OLD) -> 'market_rate') IS DISTINCT FROM (to_jsonb(NEW) -> 'market_rate'))
  EXECUTE FUNCTION public.record_exchange_rate_history();
ALTER TABLE public.exchange_rates ENABLE ALWAYS TRIGGER exchange_rate_history_update;

-- remittance_types
DROP TRIGGER IF EXISTS exchange_rate_history_insert ON public.remittance_types;
CREATE TRIGGER exchange_rate_history_insert
  AFTER INSERT ON public.remittance_types
  FOR EACH ROW EXECUTE FUNCTION public.record_exchange_rate_history();
ALTER TABLE public.remittance_types ENABLE ALWAYS TRIGGER exchange_rate_history_insert;

DROP TRIGGER IF EXISTS exchange_rate_history_update ON public.remittance_types;
CREATE TRIGGER exchange_rate_history_update
  AFTER UPDATE OF exchange_rate, commission_percentage, commission_fixed, is_active ON public.remittance_types
  FOR EACH ROW
  WHEN (OLD.exchange_rate IS DISTINCT FROM NEW.exchange_rate
        OR OLD.commission_percentage IS DISTINCT FROM NEW.commission_percentage
        OR OLD.commission_fixed IS DISTINCT FROM NEW.commission_fixed
        OR OLD.is_active IS DISTINCT FROM NEW.is_active)
  EXECUTE FUNCTION public.record_exchange_rate_history();
ALTER TABLE public.remittance_types ENABLE ALWAYS TRIGGER exchange_rate_history_update;

COMMIT;
