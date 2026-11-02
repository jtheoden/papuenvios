-- ============================================================================
-- ZELLE ACCOUNTS: OPTIONAL EMAIL/PHONE WITH CONTACT TYPE SELECTOR
-- Created: 2026-11-02
-- Purpose: Make email optional, require at least one contact (email or phone),
--          add contact_type to indicate which is primary
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. DROP EXISTING CONSTRAINTS
-- ============================================================================
ALTER TABLE public.zelle_accounts
DROP CONSTRAINT IF EXISTS zelle_accounts_email_check;

-- ============================================================================
-- 2. ALTER EMAIL COLUMN TO BE NULLABLE
-- ============================================================================
ALTER TABLE public.zelle_accounts
ALTER COLUMN email DROP NOT NULL;

-- ============================================================================
-- 3. ADD CONTACT_TYPE COLUMN
-- ============================================================================
-- contact_type indicates which contact method is primary for Zelle transfers
-- 'email' = use email for Zelle
-- 'phone' = use phone for Zelle
ALTER TABLE public.zelle_accounts
ADD COLUMN IF NOT EXISTS contact_type text DEFAULT 'email'
CHECK (contact_type IN ('email', 'phone'));

-- ============================================================================
-- 4. ADD CONSTRAINT: AT LEAST ONE CONTACT REQUIRED
-- ============================================================================
ALTER TABLE public.zelle_accounts
ADD CONSTRAINT at_least_one_contact
CHECK (
  (email IS NOT NULL AND email != '') OR
  (phone IS NOT NULL AND phone != '')
);

-- ============================================================================
-- 5. ADD CONSTRAINT: SELECTED CONTACT TYPE MUST HAVE VALUE
-- ============================================================================
ALTER TABLE public.zelle_accounts
ADD CONSTRAINT contact_type_has_value
CHECK (
  (contact_type = 'email' AND email IS NOT NULL AND email != '') OR
  (contact_type = 'phone' AND phone IS NOT NULL AND phone != '')
);

-- ============================================================================
-- 6. UPDATE EXISTING RECORDS
-- ============================================================================
-- Set contact_type based on existing data
UPDATE public.zelle_accounts
SET contact_type = CASE
  WHEN email IS NOT NULL AND email != '' THEN 'email'
  WHEN phone IS NOT NULL AND phone != '' THEN 'phone'
  ELSE 'email'
END
WHERE contact_type IS NULL;

COMMIT;
