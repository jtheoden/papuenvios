-- MANDATORY ORDER: M3 -> M2 -> M1 (this file is step 3 of 3, last).
-- MANDATORY FIRST STEP (before running this file): export the data with psql, e.g.
--   \copy (SELECT * FROM public.courier_payments) TO 'courier_payments.csv' CSV HEADER
--   \copy (SELECT * FROM public.courier_accruals) TO 'courier_accruals.csv' CSV HEADER
--   \copy (SELECT * FROM public.messenger_payment_types) TO 'messenger_payment_types.csv' CSV HEADER
-- Then confirm in the same session: SET app.confirm_courier_rollback = 'yes';  (without it this file aborts if there is data)
-- ROLLBACK of 20261031100000_couriers_and_payment_types.sql. Run the M3 and M2 rollbacks FIRST (they reference these tables).
-- Destroys the couriers, the payment-type versions and the thresholds: export them first
-- (COPY public.messenger_payment_types TO ...). The financial_audit_log rows written by the RPCs are append-only history and stay.
BEGIN;

SET LOCAL lock_timeout = '5s';

-- GUARD: refuses to run over real data unless the operator confirms AFTER exporting it (see the header).
DO $$
BEGIN
  IF (EXISTS (SELECT 1 FROM public.couriers) OR EXISTS (SELECT 1 FROM public.messenger_payment_types))
     AND COALESCE(current_setting('app.confirm_courier_rollback', true), '') <> 'yes' THEN
    RAISE EXCEPTION 'couriers / messenger_payment_types has rows: export them first (COPY ... TO) and then run SET app.confirm_courier_rollback = ''yes''; to confirm'
      USING ERRCODE = '55000';
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.admin_set_margin_thresholds(text, numeric, numeric, numeric);
DROP FUNCTION IF EXISTS public.admin_deactivate_messenger_payment_type(text);
DROP FUNCTION IF EXISTS public.admin_set_messenger_payment_type(text, text, text, text, numeric, numeric, numeric, text, uuid, uuid, uuid, numeric, numeric, timestamptz, timestamptz);
DROP FUNCTION IF EXISTS public.admin_upsert_courier(uuid, text, text, text, boolean);
DROP FUNCTION IF EXISTS public._operation_margin(numeric, numeric, numeric, numeric, numeric);
DROP FUNCTION IF EXISTS public._courier_rule_resolve(text, uuid, uuid, uuid, numeric, timestamptz);
DROP FUNCTION IF EXISTS public._courier_audit(text, uuid, text, text, text, text);
DROP FUNCTION IF EXISTS public._courier_require_admin();
DROP TABLE IF EXISTS public.courier_margin_settings;
DROP TABLE IF EXISTS public.messenger_payment_types;   -- also drops its guard trigger
DROP FUNCTION IF EXISTS public.messenger_payment_types_guard();
DROP TABLE IF EXISTS public.couriers;

COMMIT;
