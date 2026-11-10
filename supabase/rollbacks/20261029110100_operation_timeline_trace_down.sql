-- ROLLBACK of 20261029110100_operation_timeline_trace.sql: drops the read-only timeline/trace RPCs. No data is touched.
BEGIN;

SET LOCAL lock_timeout = '5s';

DROP FUNCTION IF EXISTS public.admin_refund_trace(text, uuid);
DROP FUNCTION IF EXISTS public.admin_get_operation_refunds(text, uuid);
DROP FUNCTION IF EXISTS public.admin_operation_timeline(text, uuid);
DROP FUNCTION IF EXISTS public._refund_operation_refunds(text, uuid);
DROP FUNCTION IF EXISTS public._refund_operation_timeline(text, uuid);
DROP FUNCTION IF EXISTS public._refund_assert_admin_operation(text, uuid);

COMMIT;
