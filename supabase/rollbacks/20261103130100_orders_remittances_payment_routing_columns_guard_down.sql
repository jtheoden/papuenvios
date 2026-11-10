-- Rollback of 20261103130100_orders_remittances_payment_routing_columns_guard.sql (objects only, no data)
BEGIN;
SET LOCAL lock_timeout = '5s';
DROP TRIGGER IF EXISTS guard_orders_payment_routing_columns ON public.orders;
DROP TRIGGER IF EXISTS guard_remittances_payment_routing_columns ON public.remittances;
DROP FUNCTION IF EXISTS public.guard_orders_payment_routing_columns();
DROP FUNCTION IF EXISTS public.guard_remittances_payment_routing_columns();
COMMIT;
