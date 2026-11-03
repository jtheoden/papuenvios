-- ============================================================================
-- RB-02 (1/2): close the v1 refund resolution RPC to API roles.   PREPARED, NOT APPLIED
-- ============================================================================
-- WHY:      R5 introduced admin_resolve_refund_v2 (proof + separation of duties). The v1 5-argument admin_resolve_refund is no
--           longer called by the front (src/lib/refundService.js calls v2 only) nor by any Edge Function. A terminal-row guard
--           already refuses a v1 "refunded" without proof and a v1 self-resolution; revoking EXECUTE is defence in depth, so the
--           bypass does not depend on that guard alone.
-- WHAT:     REVOKE EXECUTE on public.admin_resolve_refund(uuid, text, text, timestamptz, text) from authenticated (the role that
--           held it) and, idempotently, from PUBLIC and anon (already revoked by 20261029100300). The function itself is not
--           touched, replaced or dropped; postgres/service_role keep EXECUTE.
-- ROLLBACK: supabase/rollbacks/20261103140000_revoke_admin_resolve_refund_v1_down.sql (re-GRANT to authenticated).
-- DATA:     none. No row is read, written or deleted; privileges only. Prod has no refund_requests rows at the time of writing.
-- ============================================================================

BEGIN;

SET LOCAL lock_timeout = '5s';

REVOKE EXECUTE ON FUNCTION public.admin_resolve_refund(uuid, text, text, timestamptz, text)
  FROM PUBLIC, anon, authenticated;

COMMIT;
