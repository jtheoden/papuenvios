-- ROLLBACK of 20261111120200_exchange_rates_validate_distinct_currencies.sql: Postgres cannot "unvalidate", so the same
-- CHECK is re-created NOT VALID (exact previous state: still enforced for new rows, convalidated = false). No row touched.
BEGIN;

SET LOCAL lock_timeout = '5s';

ALTER TABLE public.exchange_rates DROP CONSTRAINT IF EXISTS exchange_rates_distinct_currencies_chk;
ALTER TABLE public.exchange_rates
  ADD CONSTRAINT exchange_rates_distinct_currencies_chk CHECK (from_currency_id <> to_currency_id) NOT VALID;

COMMIT;
