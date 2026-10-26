-- ROLLBACK of 20261029110500_refund_proof_retention.sql: drops the purge helpers, the dispute RPC and the report.
-- proof_purged_at values and the events already written are NOT modified. Without these helpers nothing purges proofs.
BEGIN;

SET LOCAL lock_timeout = '5s';

DROP FUNCTION IF EXISTS public.admin_refund_proofs_expiring(integer);
DROP FUNCTION IF EXISTS public.admin_set_refund_dispute(uuid, boolean);
DROP FUNCTION IF EXISTS public._mark_refund_proof_purged(uuid, uuid);
DROP FUNCTION IF EXISTS public._refund_proofs_due(integer);
DROP FUNCTION IF EXISTS public._refund_dispute_open(uuid);

COMMIT;
