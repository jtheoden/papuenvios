-- MANDATORY ORDER: M3 -> M2 -> M1 (this file is step 2 of 3).
-- MANDATORY FIRST STEP (before running this file): export the data with psql, e.g.
--   \copy (SELECT * FROM public.courier_payments) TO 'courier_payments.csv' CSV HEADER
--   \copy (SELECT * FROM public.courier_accruals) TO 'courier_accruals.csv' CSV HEADER
--   \copy (SELECT * FROM public.messenger_payment_types) TO 'messenger_payment_types.csv' CSV HEADER
-- Then confirm in the same session: SET app.confirm_courier_rollback = 'yes';  (without it this file aborts if there is data)
-- ROLLBACK of 20261031110000_delivery_assignments_and_accruals.sql. Run the M3 rollback FIRST (courier_payments references accruals).
-- Destroys every accrual and assignment: export them first (COPY public.courier_accruals TO ...). The financial_audit_log rows stay.
-- After this rollback the legacy zone snapshots (order_courier_costs / remittance_courier_costs) are again the only cost source.
BEGIN;

SET LOCAL lock_timeout = '5s';

-- GUARD: refuses to run over real data unless the operator confirms AFTER exporting it (see the header).
DO $$
BEGIN
  IF (EXISTS (SELECT 1 FROM public.courier_accruals) OR EXISTS (SELECT 1 FROM public.delivery_assignments))
     AND COALESCE(current_setting('app.confirm_courier_rollback', true), '') <> 'yes' THEN
    RAISE EXCEPTION 'courier_accruals / delivery_assignments has rows: export them first (COPY ... TO) and then run SET app.confirm_courier_rollback = ''yes''; to confirm'
      USING ERRCODE = '55000';
  END IF;
END $$;

DROP TRIGGER IF EXISTS courier_accrual_on_delivered ON public.orders;
DROP TRIGGER IF EXISTS courier_accrual_on_delivered ON public.remittances;
DROP FUNCTION IF EXISTS public._courier_accrue_on_delivered();
DROP VIEW IF EXISTS public.v_effective_courier_cost;
DROP FUNCTION IF EXISTS public.admin_backfill_missing_accruals(timestamptz);
DROP FUNCTION IF EXISTS public.admin_list_deliveries_without_accrual(timestamptz, timestamptz);
DROP FUNCTION IF EXISTS public.admin_recalculate_accrual(uuid);
DROP FUNCTION IF EXISTS public.admin_reassign_accrual(uuid, uuid, text);
DROP FUNCTION IF EXISTS public.admin_adjust_accrual(uuid, numeric, text);
DROP FUNCTION IF EXISTS public.admin_void_accrual(uuid, text);
DROP FUNCTION IF EXISTS public.admin_assign_delivery_courier(text, uuid, uuid);
DROP FUNCTION IF EXISTS public._courier_create_accrual(text, uuid, text);
DROP FUNCTION IF EXISTS public._courier_compute_accrual(text, uuid, uuid, text);
DROP TABLE IF EXISTS public.courier_accruals;
DROP TABLE IF EXISTS public.delivery_assignments;

COMMIT;
