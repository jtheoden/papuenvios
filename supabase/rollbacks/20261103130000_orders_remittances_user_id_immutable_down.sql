-- Rollback of 20261103130000_orders_remittances_user_id_immutable.sql (objects only, no data)
BEGIN;
SET LOCAL lock_timeout = '5s';
DROP TRIGGER IF EXISTS guard_orders_user_id_immutable ON public.orders;
DROP TRIGGER IF EXISTS guard_remittances_user_id_immutable ON public.remittances;
DROP FUNCTION IF EXISTS public.guard_orders_user_id_immutable();
DROP FUNCTION IF EXISTS public.guard_remittances_user_id_immutable();
COMMIT;
