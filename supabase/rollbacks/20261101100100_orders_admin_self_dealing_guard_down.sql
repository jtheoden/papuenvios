-- ROLLBACK of 20261101100100_orders_admin_self_dealing_guard.sql. No data is created or changed by the migration.
BEGIN;

SET LOCAL lock_timeout = '5s';

DROP TRIGGER IF EXISTS trg_orders_admin_self_dealing ON public.orders;
DROP FUNCTION IF EXISTS public.guard_orders_admin_self_dealing();

COMMIT;
