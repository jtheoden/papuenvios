-- Rollback of 20261023110000_remittance_money_columns_guard.sql
BEGIN;
DROP TRIGGER IF EXISTS guard_remittance_money_columns ON public.remittances;
DROP FUNCTION IF EXISTS public.guard_remittance_money_columns();
DROP FUNCTION IF EXISTS public.remittance_money_columns();
COMMIT;
