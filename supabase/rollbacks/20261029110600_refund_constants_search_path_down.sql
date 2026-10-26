-- ROLLBACK of 20261029110600_refund_constants_search_path.sql: restores the R4 state (no search_path setting).
BEGIN;

SET LOCAL lock_timeout = '5s';

ALTER FUNCTION public.refund_hold_hours() RESET search_path;
ALTER FUNCTION public.refund_business_days() RESET search_path;

COMMIT;
