-- PREPARED, NOT APPLIED
-- Why/what: remove the market_rate fallback trigger and function. Data is untouched; after this, inserts
-- without market_rate fail again on a DB where the column is NOT NULL without default.

BEGIN;
SET LOCAL lock_timeout = '5s';

DO $rollback$
BEGIN
  IF to_regclass('public.exchange_rates') IS NOT NULL THEN
    EXECUTE 'DROP TRIGGER IF EXISTS trg_exchange_rates_market_rate_fallback ON public.exchange_rates';
  END IF;
END
$rollback$;

DROP FUNCTION IF EXISTS public.exchange_rates_market_rate_fallback();

COMMIT;
