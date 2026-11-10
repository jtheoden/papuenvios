-- ROLLBACK of 20261103140000_revoke_admin_resolve_refund_v1.sql: gives v1 back to authenticated exactly as 20261029100300 left it
-- (PUBLIC and anon stay revoked there). Privileges only; no data is touched.
BEGIN;

SET LOCAL lock_timeout = '5s';

GRANT EXECUTE ON FUNCTION public.admin_resolve_refund(uuid, text, text, timestamptz, text)
  TO authenticated;

COMMIT;
