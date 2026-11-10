-- ROLLBACK of 20261111120100_exchange_rate_history.sql: stops recording. The table, its rows, its RLS/grants and its
-- immutability triggers are KEPT on purpose (dropping them destroys history; re-applying the migration resumes).
-- Full removal, only with explicit owner approval and after exporting the rows:
--   DROP TABLE IF EXISTS public.exchange_rate_history;   -- also drops its immutability triggers and policy
--   DROP FUNCTION IF EXISTS public.exchange_rate_history_block_mutation();
BEGIN;

SET LOCAL lock_timeout = '5s';

DROP TRIGGER IF EXISTS exchange_rate_history_insert ON public.exchange_rates;
DROP TRIGGER IF EXISTS exchange_rate_history_update ON public.exchange_rates;
DROP TRIGGER IF EXISTS exchange_rate_history_delete ON public.exchange_rates;
DROP TRIGGER IF EXISTS exchange_rate_history_insert ON public.remittance_types;
DROP TRIGGER IF EXISTS exchange_rate_history_update ON public.remittance_types;
DROP TRIGGER IF EXISTS exchange_rate_history_delete ON public.remittance_types;
DROP FUNCTION IF EXISTS public.record_exchange_rate_history();

COMMIT;
