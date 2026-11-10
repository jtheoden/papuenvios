-- ROLLBACK of 20261029110400_refund_resolve_with_proof.sql: drops admin_resolve_refund_v2. admin_resolve_refund (v1) is untouched.
-- Data already resolved (with proofs, self_resolved flags) is not modified. Revert the front first if it calls v2.
BEGIN;

SET LOCAL lock_timeout = '5s';

DROP FUNCTION IF EXISTS public.admin_resolve_refund_v2(uuid, text, text, timestamptz, text, text, text, boolean);

COMMIT;
