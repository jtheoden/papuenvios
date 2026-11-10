-- Rollback of 20261024100000_status_check_constraints.sql
BEGIN;
SET LOCAL lock_timeout = '5s';
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_payment_status_check;
ALTER TABLE public.remittances DROP CONSTRAINT IF EXISTS remittances_status_check;
ALTER TABLE public.zelle_transaction_history DROP CONSTRAINT IF EXISTS zelle_transaction_history_status_check;
ALTER TABLE public.offers DROP CONSTRAINT IF EXISTS offers_discount_type_check;
ALTER TABLE public.orders ALTER COLUMN status DROP NOT NULL;
ALTER TABLE public.orders ALTER COLUMN payment_status DROP NOT NULL;
ALTER TABLE public.zelle_transaction_history ALTER COLUMN status DROP NOT NULL;
COMMIT;
