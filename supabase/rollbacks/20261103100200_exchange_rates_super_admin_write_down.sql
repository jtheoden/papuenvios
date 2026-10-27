-- ROLLBACK of 20261103100200_exchange_rates_super_admin_write.sql: restores the exact previous live policy (any admin can write).
BEGIN;

SET LOCAL lock_timeout = '5s';

DROP POLICY IF EXISTS "exchange_rates_manage" ON public.exchange_rates;
CREATE POLICY "exchange_rates_manage" ON public.exchange_rates FOR ALL TO authenticated USING ((SELECT is_admin_user()));

COMMIT;
