-- IBAN/SEPA registered as an unavailable payment method.   PREPARED, NOT APPLIED
-- F1 preparatory slice only: register IBAN/SEPA as an unavailable method.
-- This deliberately does not configure a receiving account, accept transfers,
-- or turn the method on for either flow.
-- orders_payment_method_chk (20261015150100) intentionally still allows only zelle and bizum, so orders cannot carry iban.

BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE public.payment_methods
  DROP CONSTRAINT IF EXISTS payment_methods_code_check;
ALTER TABLE public.payment_methods
  ADD CONSTRAINT payment_methods_code_check
  CHECK (code IN ('zelle', 'bizum', 'iban')) NOT VALID;
ALTER TABLE public.payment_methods
  VALIDATE CONSTRAINT payment_methods_code_check;

ALTER TABLE public.remittances
  DROP CONSTRAINT IF EXISTS remittances_payment_method_check;
ALTER TABLE public.remittances
  ADD CONSTRAINT remittances_payment_method_check
  CHECK (payment_method IN ('zelle', 'bizum', 'iban')) NOT VALID;
ALTER TABLE public.remittances
  VALIDATE CONSTRAINT remittances_payment_method_check;

INSERT INTO public.payment_methods (
  code, available, enabled_for_orders, enabled_for_remittances, disabled_reason
)
VALUES (
  'iban', false, false, false,
  'IBAN/SEPA collection is not implemented or approved for live use.'
)
ON CONFLICT (code) DO NOTHING;

COMMIT;
