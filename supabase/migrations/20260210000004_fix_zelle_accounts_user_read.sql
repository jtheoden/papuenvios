-- Fix: regular users need to read active Zelle accounts when making payments
-- The select_available_zelle_account() RPC is SECURITY INVOKER, so it runs
-- with the caller's permissions and needs RLS to allow SELECT.
-- Only active accounts are exposed to non-admin users.

BEGIN;

CREATE POLICY zelle_accounts_select_active ON public.zelle_accounts
  FOR SELECT TO authenticated
  USING (is_active = true);

-- The existing zelle_accounts_manage policy (FOR ALL, admin only) ensures
-- admins can still see ALL accounts (including inactive) and modify them.

COMMIT;
