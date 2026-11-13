-- Rollback of 20261112120000_superadmin_readjust_remittance.sql
-- The history table is dropped with its rows: export it first if the readjustments must be kept.
BEGIN;

DROP FUNCTION IF EXISTS public.superadmin_readjust_remittance(uuid, text, numeric, numeric, numeric, numeric, text);
DROP TABLE IF EXISTS public.remittance_readjustments;

COMMIT;
