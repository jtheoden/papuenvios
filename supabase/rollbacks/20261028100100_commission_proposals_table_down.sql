-- MANDATORY ORDER: M3 -> M2 -> M1 (this file is step 3 of 3, last).
-- ROLLBACK of 20261028100100_commission_proposals_table.sql. Run the M3 / M2 rollbacks FIRST (they reference the table).
-- Destroys the proposal history: export it before (COPY public.remittance_commission_proposals TO ...).
BEGIN;

SET LOCAL lock_timeout = '5s';

DROP TABLE IF EXISTS public.remittance_commission_proposals;

COMMIT;
