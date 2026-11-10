-- ============================================================================
-- exchange_rates: only a super_admin may write (DEC-10 = A, 2026-10-27).
-- RESTORED TO THE REPO, ALREADY APPLIED IN PROD (schema_migrations version 20261103124844, name
-- exchange_rates_super_admin_write). Applying it again is a no-op (same policy text).
-- ============================================================================
-- Repo drift (audit 2026-11-04): this file shipped as 20261103100200_exchange_rates_super_admin_write.sql in #143
-- (42b8578b) and was deleted by the e2e PR #144 (658bd94a). Prod kept the policy; a DB rebuilt from the repo
-- (supabase/e2e/base-public-schema.sql + replay) reopened rate writes to every admin. The file is restored under the
-- PROD version so `supabase migration list` matches and the e2e/scratch replay picks it up (no base schema change).
--
-- Live state (pg_policies, read-only 2026-11-04):
--   exchange_rates_manage  PERMISSIVE  {authenticated}  ALL     USING (( SELECT is_super_admin() AS is_super_admin))  WITH CHECK NULL
--   exchange_rates_select  PERMISSIVE  {public}         SELECT  USING (true)                                           -> unchanged here
-- FOR ALL keeps the scope (INSERT/UPDATE/DELETE); WITH CHECK defaults to USING. A plain admin gets 42501 on INSERT and
-- 0 rows on UPDATE/DELETE. Table privileges are untouched. SECURITY DEFINER functions run as the owner and are not
-- affected; the financial audit triggers fire for the super_admin as before.
-- ROLLBACK: supabase/rollbacks/20261103124844_exchange_rates_super_admin_write_down.sql
-- ============================================================================

BEGIN;

SET LOCAL lock_timeout = '5s';

DROP POLICY IF EXISTS "exchange_rates_manage" ON public.exchange_rates;
CREATE POLICY "exchange_rates_manage" ON public.exchange_rates
  FOR ALL TO authenticated
  USING ((SELECT public.is_super_admin()));

COMMIT;
