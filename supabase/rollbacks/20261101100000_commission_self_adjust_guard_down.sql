-- ROLLBACK of 20261101100000_commission_self_adjust_guard.sql. No data is created or changed by the migration.
BEGIN;

SET LOCAL lock_timeout = '5s';

DROP TRIGGER IF EXISTS trg_commission_override_self_adjust ON public.remittance_commission_overrides;
DROP TRIGGER IF EXISTS trg_commission_accept_self ON public.remittance_commission_proposals;
DROP FUNCTION IF EXISTS public.guard_commission_self_adjust();
DROP FUNCTION IF EXISTS public.guard_commission_accept_self();

COMMIT;
