-- APPLIED to production on 2026-11-09 (apply_migration name: exchange_rates_market_rate_fallback)
-- Why: production exchange_rates has market_rate numeric NOT NULL with no default (schema drift, not in
-- the repo chain). The app upserts without market_rate, so every create/replace fails with 400
-- "null value in column market_rate violates not-null constraint".
-- What: BEFORE INSERT trigger that sets NEW.market_rate := NEW.rate when it is NULL. The column and its
-- constraint are untouched. BEFORE INSERT triggers run before the NOT NULL check and before ON CONFLICT
-- arbitration, and the upsert's DO UPDATE only sets payload columns, so a same-day upsert over an existing
-- row keeps its stored market_rate (the owner's reference rate is never overwritten).
-- Guarded: a no-op on a DB without the column (e.g. the repo CI chain). Idempotent.
-- Rollback: supabase/rollbacks/20261109120000_exchange_rates_market_rate_fallback_down.sql

BEGIN;
SET LOCAL lock_timeout = '5s';

DO $migration$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'exchange_rates' AND column_name = 'market_rate'
  ) THEN
    EXECUTE $fn$
      CREATE OR REPLACE FUNCTION public.exchange_rates_market_rate_fallback()
      RETURNS trigger
      LANGUAGE plpgsql
      SECURITY INVOKER
      SET search_path = public, pg_temp
      AS $body$
      BEGIN
        IF NEW.market_rate IS NULL THEN
          NEW.market_rate := NEW.rate;
        END IF;
        RETURN NEW;
      END
      $body$
    $fn$;
    EXECUTE 'DROP TRIGGER IF EXISTS trg_exchange_rates_market_rate_fallback ON public.exchange_rates';
    EXECUTE 'CREATE TRIGGER trg_exchange_rates_market_rate_fallback BEFORE INSERT ON public.exchange_rates '
         || 'FOR EACH ROW EXECUTE FUNCTION public.exchange_rates_market_rate_fallback()';
  END IF;
END
$migration$;

COMMIT;
