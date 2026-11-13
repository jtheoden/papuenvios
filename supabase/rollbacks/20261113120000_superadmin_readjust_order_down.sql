-- Rollback of 20261113120000_superadmin_readjust_order.sql
-- The history table is dropped with its rows: export it first if the readjustments must be kept.
BEGIN;

DROP FUNCTION IF EXISTS public.superadmin_readjust_order(uuid, text, jsonb, numeric, numeric, text, text);
DROP TABLE IF EXISTS public.order_readjustments;

COMMIT;
