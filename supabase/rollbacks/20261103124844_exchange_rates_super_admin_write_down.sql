-- ROLLBACK of 20261103124844_exchange_rates_super_admin_write.sql (restored copy of 20261103100200_*): restores the exact
-- pre-DEC-10 policy (any admin can write). Reopens rate writes to plain admins: only with explicit owner approval.
BEGIN;

SET LOCAL lock_timeout = '5s';

DROP POLICY IF EXISTS "exchange_rates_manage" ON public.exchange_rates;
CREATE POLICY "exchange_rates_manage" ON public.exchange_rates FOR ALL TO authenticated USING ((SELECT is_admin_user()));

COMMIT;
