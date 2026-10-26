-- Rollback of 20261102100000_orders_money_columns_guard.sql
BEGIN;
SET LOCAL lock_timeout = '5s';
DROP TRIGGER IF EXISTS guard_orders_money_columns ON public.orders;
DROP FUNCTION IF EXISTS public.guard_orders_money_columns();
DROP FUNCTION IF EXISTS public.order_money_columns();
COMMIT;
