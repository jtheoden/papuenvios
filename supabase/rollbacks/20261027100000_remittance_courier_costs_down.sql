-- Rollback of 20261027100000_remittance_courier_costs.sql.
-- The table holds only derived accounting data. The Dashboard tolerates the missing table ("remittance courier cost
-- unavailable"), so no front revert is required first.
BEGIN;
SET LOCAL lock_timeout = '5s';

DROP TRIGGER IF EXISTS remittance_courier_cost_snapshot ON public.remittances;
DROP FUNCTION IF EXISTS public.snapshot_remittance_courier_cost();
DROP TABLE IF EXISTS public.remittance_courier_costs;

COMMIT;
