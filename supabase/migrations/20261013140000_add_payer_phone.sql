-- ============================================================================
-- Add payer contact phone to orders and remittances (client observation #3)
-- ============================================================================
-- Rationale:
--   Admins need a phone number to contact the person who paid when reviewing a
--   payment proof. The value is captured by the payment-proof UI and shown to
--   admins (and included in the admin WhatsApp notification).
--
--   * remittances.payer_phone is written by PR-06a (remittance proof upload).
--   * orders.payer_phone is added now so PR-06b (orders flow) needs no further
--     schema change; nothing reads or writes it yet.
--
-- Design decisions:
--   * Nullable on purpose: no NOT NULL and no backfill. Existing rows keep NULL;
--     the requirement is enforced in the UI and in the service layer.
--   * No forced E.164 / leading '+'. The CHECK constraints are intentionally
--     loose: when present, the trimmed length must be between 7 and 30.
--   * No data changes in this migration.
--
-- Privileges:
--   No RLS or GRANT changes. New columns inherit the existing table-level
--   privileges and RLS policies. Checked with rg over supabase/migrations: there
--   are no column-level GRANT/REVOKE statements on public.orders or
--   public.remittances (only table-level ones, e.g. 20251007_orders_payment_system.sql
--   and REVOKE REFERENCES/TRIGGER/TRUNCATE in 20260210000001_security_hardening.sql).
--   Remote grants on public.remittances are not defined in this repo and were
--   not verified here.
--
-- Idempotent: safe to run more than once.
--
-- ROLLBACK:
--   ALTER TABLE public.orders      DROP CONSTRAINT IF EXISTS orders_payer_phone_length_check;
--   ALTER TABLE public.remittances DROP CONSTRAINT IF EXISTS remittances_payer_phone_length_check;
--   ALTER TABLE public.orders      DROP COLUMN IF EXISTS payer_phone;
--   ALTER TABLE public.remittances DROP COLUMN IF EXISTS payer_phone;
-- ============================================================================

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS payer_phone text;

ALTER TABLE public.remittances
  ADD COLUMN IF NOT EXISTS payer_phone varchar(30);

COMMENT ON COLUMN public.orders.payer_phone IS
  'Contact phone of the person who paid, captured with the payment proof. Nullable; free-form.';
COMMENT ON COLUMN public.remittances.payer_phone IS
  'Contact phone of the person who paid, captured with the payment proof. Nullable; free-form.';

ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_payer_phone_length_check;
ALTER TABLE public.orders
  ADD CONSTRAINT orders_payer_phone_length_check
  CHECK (payer_phone IS NULL OR char_length(btrim(payer_phone)) BETWEEN 7 AND 30);

ALTER TABLE public.remittances
  DROP CONSTRAINT IF EXISTS remittances_payer_phone_length_check;
ALTER TABLE public.remittances
  ADD CONSTRAINT remittances_payer_phone_length_check
  CHECK (payer_phone IS NULL OR char_length(btrim(payer_phone)) BETWEEN 7 AND 30);
