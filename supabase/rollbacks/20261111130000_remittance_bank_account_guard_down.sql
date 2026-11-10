-- PREPARED, NOT APPLIED
-- Why/what: remove the bank account guard on remittance inserts. Stored remittances are untouched; after this,
-- a customer insert for a non-cash type is no longer checked for a usable recipient bank account in the database
-- (the wizard and createRemittance still check it in the browser).

BEGIN;
SET LOCAL lock_timeout = '5s';

DROP TRIGGER IF EXISTS guard_remittance_bank_account ON public.remittances;
DROP FUNCTION IF EXISTS public.guard_remittance_bank_account();

COMMIT;
