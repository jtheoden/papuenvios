-- Courier phase C rollback. PREPARED, NOT APPLIED
-- Disable the Phase C frontend first. Independent of the B -> A rollback order (B still precedes A).
-- Removes ONLY the new functions; never undo assignments, costs, snapshots, payments or audit evidence.
-- No columns were added. No original function needs restoring. Run before M2 / M1 rollback.
BEGIN;
SET LOCAL lock_timeout = '5s';
DROP FUNCTION IF EXISTS public.admin_assign_courier_after_delivery(text, uuid, uuid, text, boolean, text);
DROP FUNCTION IF EXISTS public._courier_compute_accrual_retroactive(text, uuid, uuid);
COMMIT;
