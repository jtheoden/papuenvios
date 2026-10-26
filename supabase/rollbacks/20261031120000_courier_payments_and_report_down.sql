-- MANDATORY ORDER: M3 -> M2 -> M1 (this file is step 1 of 3, first).
-- MANDATORY FIRST STEP (before running this file): export the data with psql, e.g.
--   \copy (SELECT * FROM public.courier_payments) TO 'courier_payments.csv' CSV HEADER
--   \copy (SELECT * FROM public.courier_accruals) TO 'courier_accruals.csv' CSV HEADER
--   \copy (SELECT * FROM public.messenger_payment_types) TO 'messenger_payment_types.csv' CSV HEADER
-- Then confirm in the same session: SET app.confirm_courier_rollback = 'yes';  (without it this file aborts if there is data)
-- ROLLBACK of 20261031120000_courier_payments_and_report.sql.
-- Destroys the payment evidence: export it first (COPY public.courier_payments TO ...). Only rows of the NEW
-- courier_accruals table are touched: paid accruals go back to 'calculated' (their payment disappears).
BEGIN;

SET LOCAL lock_timeout = '5s';

-- GUARD: refuses to run over real data unless the operator confirms AFTER exporting it (see the header).
DO $$
BEGIN
  IF (EXISTS (SELECT 1 FROM public.courier_payments))
     AND COALESCE(current_setting('app.confirm_courier_rollback', true), '') <> 'yes' THEN
    RAISE EXCEPTION 'courier_payments has rows: export them first (COPY ... TO) and then run SET app.confirm_courier_rollback = ''yes''; to confirm'
      USING ERRCODE = '55000';
  END IF;
END $$;

UPDATE public.courier_accruals SET payment_id = NULL, status = 'calculated' WHERE payment_id IS NOT NULL AND status = 'paid';
ALTER TABLE public.courier_accruals DROP CONSTRAINT IF EXISTS courier_accruals_payment_fk;
DROP FUNCTION IF EXISTS public.admin_courier_report(timestamptz, timestamptz, uuid);
DROP FUNCTION IF EXISTS public.admin_register_courier_payment(uuid, uuid[], text, text, timestamptz, text);
DROP TABLE IF EXISTS public.courier_payments;   -- also drops its immutability trigger
DROP FUNCTION IF EXISTS public.courier_payments_immutable();

COMMIT;
