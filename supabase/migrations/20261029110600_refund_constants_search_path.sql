-- ============================================================================
-- Refund constants: pin search_path.   PREPARED, NOT APPLIED
-- ============================================================================
-- refund_hold_hours() and refund_business_days() (R4) are IMMUTABLE SQL constants without a search_path. Pinning it to
-- pg_catalog changes no behaviour (the bodies are `SELECT 48` / `SELECT 5`, prosrc is untouched) and removes the
-- "function_search_path_mutable" advisory. ALTER FUNCTION only: no body is redefined.
-- ROLLBACK: supabase/rollbacks/20261029110600_refund_constants_search_path_down.sql
-- ============================================================================

BEGIN;

SET LOCAL lock_timeout = '5s';

ALTER FUNCTION public.refund_hold_hours() SET search_path = pg_catalog;
ALTER FUNCTION public.refund_business_days() SET search_path = pg_catalog;

COMMIT;
