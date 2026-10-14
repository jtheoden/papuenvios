-- Zelle accounts: restrict direct SELECT to admins (follow-up of PR-10 / F5, step 2 of 2).
--
-- ############################################################################
-- DO NOT APPLY until the frontend with the RPC-based selector is live.
-- ############################################################################
--
-- ROLLOUT ORDER:
--   1. 20261014130000_zelle_accounts_list_public_rpc.sql (additive).
--   2. Deploy the frontend that reads accounts via list_zelle_accounts_public
--      (ZelleAccountSelector -> getZelleAccountsForCustomer). Wait until no
--      client still runs the previous bundle (hard refresh / cache turnover).
--   3. THIS migration.
-- Applying it earlier makes the OLD ZelleAccountSelector (direct select) see an
-- empty list, so customers cannot choose a Zelle account at checkout/remittance.
--
-- What it does: drops the policy zelle_accounts_select_active (SELECT for any
-- authenticated user where is_active = true), which let every logged-in customer
-- read email/phone of active accounts and ignore show_email / show_phone.
-- Admin SELECT is NOT re-created here: the existing policy zelle_accounts_manage
-- (FOR ALL TO authenticated USING ((select is_admin_user()))) already grants
-- admins SELECT/INSERT/UPDATE/DELETE, so a second admin SELECT policy would only
-- duplicate it. A guard below aborts the migration if that policy is missing, so
-- admins can never be locked out.
--
-- Dependency inventory (checked read-only against the live DB):
--   * Client: only admin screens (SettingsZelleTab, ZellePaymentHistoryTab,
--     zelleService admin CRUD) still read the table; customer paths use the RPCs
--     list_zelle_accounts_public / get_zelle_account_public. Customer realtime on
--     the table is replaced by polling in ZelleAccountSelector.
--   * Other tables' RLS policies / views: none reference zelle_accounts.
--     FKs (orders, remittances, zelle_transaction_history, zelle_payment_stats)
--     are validated by internal RI triggers, which are unaffected by RLS.
--   * SECURITY DEFINER functions (get_zelle_account_public,
--     list_zelle_accounts_public, update_zelle_account_usage,
--     execute_platform_reset): unaffected.
--   * SECURITY INVOKER functions that read zelle_accounts:
--       - select_available_zelle_account(): read-only helper, not called by the
--         client anymore (replaced by reserve_zelle_account). It returns NULL for
--         non-admins after this migration. Harmless.
--       - reserve_zelle_account(): customers ALREADY get NULL today because
--         SELECT ... FOR UPDATE needs an UPDATE policy and only the admin
--         zelle_accounts_manage policy provides one. This migration does not
--         change that (pre-existing; CartPage then falls back to the account the
--         customer selected in the RPC-backed selector).
--       - reset_daily_zelle_counters / reset_monthly_zelle_counters: scheduled/
--         admin maintenance, already blocked for customers by RLS on UPDATE.
--   * Edge Function notify-zelle-deactivation uses the service role (bypasses RLS).
--   * Realtime postgres_changes on zelle_accounts: customers stop receiving events
--     (RLS applies to realtime); admins keep receiving them.
--
-- Idempotent: safe to run more than once.
--
-- Verification (read-only):
--   SELECT policyname, cmd, qual FROM pg_policies
--   WHERE schemaname = 'public' AND tablename = 'zelle_accounts';
--   -- expected: only zelle_accounts_manage (ALL, admin)
--   -- As a customer: SELECT count(*) FROM zelle_accounts;  -- 0
--   -- As a customer: SELECT * FROM list_zelle_accounts_public('products'); -- rows
--
-- Rollback (re-creates the previous policy exactly as in
-- 20260210000004_fix_zelle_accounts_user_read.sql):
--   CREATE POLICY zelle_accounts_select_active ON public.zelle_accounts
--     FOR SELECT TO authenticated
--     USING (is_active = true);

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'zelle_accounts'
      AND policyname = 'zelle_accounts_manage'
      AND cmd = 'ALL'
  ) THEN
    RAISE EXCEPTION 'zelle_accounts_manage (admin ALL) policy is missing; refusing to drop customer SELECT policy';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'list_zelle_accounts_public'
  ) THEN
    RAISE EXCEPTION 'list_zelle_accounts_public is missing; apply 20261014130000 first';
  END IF;
END
$$;

DROP POLICY IF EXISTS zelle_accounts_select_active ON public.zelle_accounts;

COMMIT;
