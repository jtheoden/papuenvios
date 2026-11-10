-- ROLLBACK of 20261029110200_refund_metrics_export.sql: drops the read-only metrics/export RPCs. No data is touched.
BEGIN;

SET LOCAL lock_timeout = '5s';

DROP FUNCTION IF EXISTS public.admin_refund_export(timestamptz, timestamptz);
DROP FUNCTION IF EXISTS public.admin_refund_metrics(timestamptz, timestamptz, text);
DROP FUNCTION IF EXISTS public._refund_assert_admin_range(timestamptz, timestamptz);

COMMIT;
