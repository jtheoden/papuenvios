-- Corrective fix: REVOKE ... FROM anon in the SEC-10/SEC-12 migrations had no
-- effect because Postgres grants EXECUTE to PUBLIC by default on function
-- creation, and anon inherits it via PUBLIC membership regardless of an
-- anon-specific revoke. Confirmed via pg_proc.proacl showing "=X/postgres"
-- (PUBLIC grant) still present after the prior migrations. Must REVOKE FROM
-- PUBLIC explicitly, not just FROM anon.

REVOKE EXECUTE ON FUNCTION public.update_zelle_account_usage(uuid, numeric) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_recipient_bank_account_full(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_remittance_bank_accounts_admin(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.update_zelle_account_usage(uuid, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_recipient_bank_account_full(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_remittance_bank_accounts_admin(uuid) TO authenticated;
