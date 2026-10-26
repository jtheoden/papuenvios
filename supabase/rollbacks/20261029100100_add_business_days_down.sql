-- ROLLBACK of 20261029100100_add_business_days.sql. Roll back 20261029100200 (triggers) first: they call these functions.
BEGIN;

SET LOCAL lock_timeout = '5s';

DROP FUNCTION IF EXISTS public.add_business_days(timestamptz, integer);
DROP FUNCTION IF EXISTS public.refund_hold_hours();
DROP FUNCTION IF EXISTS public.refund_business_days();

COMMIT;
