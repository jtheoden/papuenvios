-- ============================================================================
-- exchange_rates: only a super_admin may write (DEC-10 = A, 2026-10-27).                 PREPARED, NOT APPLIED
-- ============================================================================
-- Live state before this migration (verified in production with SELECT):
--   exchange_rates_manage  PERMISSIVE  {authenticated}  ALL     USING ((SELECT is_admin_user()))   -> any admin could write
--   exchange_rates_select  PERMISSIVE  {public}         SELECT  USING (true)                       -> unchanged here
-- This replaces the write policy with one gated by (SELECT is_super_admin()) (initplan form kept). FOR ALL keeps the same
-- scope as today (INSERT/UPDATE/DELETE); WITH CHECK defaults to USING. A plain admin now gets 42501 on INSERT and 0 rows on
-- UPDATE/DELETE (no error). Table GRANTs are untouched. SECURITY DEFINER functions run as the owner and are not affected
-- (no function in production writes exchange_rates; the financial audit triggers fire for the super_admin as before).
-- Deploy order: ship the front first (it already degrades to read-only for admins), then apply. Idempotent, additive, reversible.
-- ROLLBACK: supabase/rollbacks/20261103100200_exchange_rates_super_admin_write_down.sql
-- ============================================================================

BEGIN;

SET LOCAL lock_timeout = '5s';

DROP POLICY IF EXISTS "exchange_rates_manage" ON public.exchange_rates;
CREATE POLICY "exchange_rates_manage" ON public.exchange_rates
  FOR ALL TO authenticated
  USING ((SELECT public.is_super_admin()));

COMMIT;
