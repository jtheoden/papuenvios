-- ROLLBACK of 20261103100100_refund_dispute_states.sql: drops the read-only RPC. No data is touched.
BEGIN;

SET LOCAL lock_timeout = '5s';

DROP FUNCTION IF EXISTS public.admin_refund_dispute_states(uuid[]);

COMMIT;
