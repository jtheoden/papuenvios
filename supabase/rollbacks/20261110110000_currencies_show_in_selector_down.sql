-- Rollback of 20261110110000_currencies_show_in_selector.sql (PREPARED, NOT APPLIED).
-- Loses only the visibility choices; no price, rate or order data is touched.
BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE public.currencies DROP CONSTRAINT IF EXISTS currencies_base_visible_chk;
ALTER TABLE public.currencies DROP COLUMN IF EXISTS show_in_selector;

COMMIT;
