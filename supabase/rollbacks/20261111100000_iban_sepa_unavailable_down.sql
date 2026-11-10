-- Rollback of 20261111100000_iban_sepa_unavailable.sql (PREPARED, NOT APPLIED).
-- Roll back only while IBAN is still unavailable/disabled; otherwise stop and
-- first migrate any dependent activity before removing the catalog entry.
BEGIN;
SET LOCAL lock_timeout = '5s';

DO $rollback$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.payment_methods
     WHERE code = 'iban'
       AND (available OR enabled_for_orders OR enabled_for_remittances)
  ) THEN
    RAISE EXCEPTION 'cannot_remove_live_iban_payment_method';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.remittances WHERE payment_method = 'iban'
  ) THEN
    RAISE EXCEPTION 'cannot_remove_iban_with_remittance_history';
  END IF;
END
$rollback$;

DELETE FROM public.payment_methods WHERE code = 'iban';

ALTER TABLE public.payment_methods
  DROP CONSTRAINT IF EXISTS payment_methods_code_check;
ALTER TABLE public.payment_methods
  ADD CONSTRAINT payment_methods_code_check
  CHECK (code IN ('zelle', 'bizum')) NOT VALID;
ALTER TABLE public.payment_methods
  VALIDATE CONSTRAINT payment_methods_code_check;

ALTER TABLE public.remittances
  DROP CONSTRAINT IF EXISTS remittances_payment_method_check;
ALTER TABLE public.remittances
  ADD CONSTRAINT remittances_payment_method_check
  CHECK (payment_method IN ('zelle', 'bizum')) NOT VALID;
ALTER TABLE public.remittances
  VALIDATE CONSTRAINT remittances_payment_method_check;

COMMIT;
