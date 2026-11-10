-- ROLLBACK of 20261103140100_admin_refund_proof_orphans.sql: removes the read-only report function. No data involved.
BEGIN;

SET LOCAL lock_timeout = '5s';

DROP FUNCTION IF EXISTS public.admin_refund_proof_orphans();

COMMIT;
