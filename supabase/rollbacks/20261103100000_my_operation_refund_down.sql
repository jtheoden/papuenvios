-- ROLLBACK of 20261103100000_my_operation_refund.sql: drops the read-only customer RPC. No data is touched.
BEGIN;

SET LOCAL lock_timeout = '5s';

DROP FUNCTION IF EXISTS public.my_operation_refund(text, uuid);

COMMIT;
