-- Rollback of 20261024120000_status_rpc_only_guard.sql (reopens the direct PATCH path on status columns).
BEGIN;
SET LOCAL lock_timeout = '5s';

DROP TRIGGER IF EXISTS guard_status_via_rpc ON public.orders;
DROP TRIGGER IF EXISTS guard_status_via_rpc ON public.remittances;
DROP FUNCTION IF EXISTS public.guard_status_via_rpc();

COMMIT;
