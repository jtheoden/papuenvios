-- ROLLBACK of 20261101100200_remittances_admin_self_dealing_guard.sql. No data is created or changed by the migration.
BEGIN;

SET LOCAL lock_timeout = '5s';

DROP TRIGGER IF EXISTS trg_remittances_admin_self_dealing ON public.remittances;
DROP FUNCTION IF EXISTS public.guard_remittances_admin_self_dealing();

COMMIT;
