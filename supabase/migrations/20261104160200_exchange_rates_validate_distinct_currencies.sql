-- ============================================================================
-- exchange_rates: VALIDATE exchange_rates_distinct_currencies_chk.                              PREPARED, NOT APPLIED
-- ============================================================================
-- WHY (audit 2026-11-04, W14): the CHECK (from_currency_id <> to_currency_id) was added NOT VALID because of a legacy
--   USD->USD row; that row was deleted on 2026-11-02 (financial_audit_log). NOT VALID already rejects new bad rows;
--   validating makes the guarantee cover every row and lets the planner trust it.
-- PRE-CHECK (prod, read-only 2026-11-04): convalidated = false; SELECT count(*) FROM exchange_rates
--   WHERE from_currency_id = to_currency_id -> 0 of 21 rows. Re-run that SELECT right before applying: if it is not 0,
--   do NOT apply (VALIDATE would fail and abort, harmlessly, but the row needs an owner decision).
-- LOCK: VALIDATE CONSTRAINT takes SHARE UPDATE EXCLUSIVE (reads and writes keep working); 21 rows, instant.
-- DATA: no row is modified.
-- ROLLBACK: supabase/rollbacks/20261104160200_exchange_rates_validate_distinct_currencies_down.sql (back to NOT VALID).
-- ============================================================================

BEGIN;

SET LOCAL lock_timeout = '5s';

ALTER TABLE public.exchange_rates VALIDATE CONSTRAINT exchange_rates_distinct_currencies_chk;

COMMIT;
