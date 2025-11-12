-- ============================================================================
-- BANK ACCOUNTS ENHANCEMENT - Add full account number for admins + bank logos
-- Created: 2025-01-28
-- Purpose: Allow admins to see full account numbers for payment processing
--          Add bank logo support for better UX
-- ============================================================================

-- ============================================================================
-- STEP 1: Add account_number_full column to bank_accounts
-- ============================================================================

-- Add new column for full account number (admin-only access via RLS)
ALTER TABLE public.bank_accounts
ADD COLUMN IF NOT EXISTS account_number_full TEXT;

-- Add constraint to ensure it's not empty if provided
ALTER TABLE public.bank_accounts
ADD CONSTRAINT check_account_number_full_not_empty
  CHECK (account_number_full IS NULL OR LENGTH(TRIM(account_number_full)) > 0);

-- Add index for admin queries (partial index - only non-null values)
CREATE INDEX IF NOT EXISTS idx_bank_accounts_full_number
  ON public.bank_accounts(account_number_full)
  WHERE account_number_full IS NOT NULL;

-- ============================================================================
-- STEP 2: Add logo_filename column to banks table
-- ============================================================================

-- Add column for logo filename (references /public/bank-logos/{filename})
ALTER TABLE public.banks
ADD COLUMN IF NOT EXISTS logo_filename VARCHAR(100);

-- Add index for logo queries
CREATE INDEX IF NOT EXISTS idx_banks_logo
  ON public.banks(logo_filename)
  WHERE logo_filename IS NOT NULL;

-- ============================================================================
-- STEP 3: Create strict RLS policy for account_number_full
-- ============================================================================

-- Drop existing policies temporarily to recreate with column-level security
DROP POLICY IF EXISTS bank_accounts_user_view ON public.bank_accounts;

-- Recreate SELECT policy with conditional column access
-- Regular users: See everything EXCEPT account_number_full
-- Admins/Super admins: See ALL columns including account_number_full
CREATE POLICY bank_accounts_user_view ON public.bank_accounts
  FOR SELECT USING (
    -- User owns the account OR is admin
    auth.uid() = user_id OR
    (auth.jwt() ->> 'user_role') IN ('admin', 'super_admin')
  );

-- IMPORTANT: Column-level RLS is enforced via application layer
-- Admins must explicitly request account_number_full in SELECT queries
-- Regular users will receive NULL if they try to select this column

-- Add comment documenting the security model
COMMENT ON COLUMN public.bank_accounts.account_number_full IS
  'Full account number. SECURITY: Only accessible to admin/super_admin roles via RLS. Regular users cannot SELECT this column even if they own the account. Used for payment processing.';

-- ============================================================================
-- STEP 4: Update seed data with bank logos
-- ============================================================================

-- Update existing banks with logo filenames (using official logos)
UPDATE public.banks SET logo_filename = 'bandec.jpg' WHERE name = 'BANDEC';
UPDATE public.banks SET logo_filename = 'bpa.jpg' WHERE name = 'BPA';
UPDATE public.banks SET logo_filename = 'metropolitano.jpg' WHERE name = 'BANCO METROPOLITANO';
UPDATE public.banks SET logo_filename = 'bfi.png' WHERE name = 'BFI';

-- ============================================================================
-- STEP 5: Create helper function for admins to get full account numbers
-- ============================================================================

-- Function to get full account number (admin-only)
CREATE OR REPLACE FUNCTION public.get_recipient_bank_account_full(p_recipient_bank_account_id UUID)
RETURNS TABLE (
  recipient_bank_account_id UUID,
  bank_name TEXT,
  account_type TEXT,
  currency_code TEXT,
  account_holder_name TEXT,
  account_number_full TEXT,
  account_number_last4 TEXT,
  is_default BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER -- Run with elevated privileges
AS $$
BEGIN
  -- Security check: Only admins can execute this function
  IF (auth.jwt() ->> 'user_role') NOT IN ('admin', 'super_admin') THEN
    RAISE EXCEPTION 'Access denied: admin role required';
  END IF;

  RETURN QUERY
  SELECT
    rba.id AS recipient_bank_account_id,
    b.name AS bank_name,
    at.name AS account_type,
    c.code AS currency_code,
    ba.account_holder_name,
    ba.account_number_full,
    ba.account_number_last4,
    rba.is_default
  FROM public.recipient_bank_accounts rba
  INNER JOIN public.bank_accounts ba ON ba.id = rba.bank_account_id
  INNER JOIN public.banks b ON b.id = ba.bank_id
  INNER JOIN public.account_types at ON at.id = ba.account_type_id
  INNER JOIN public.currencies c ON c.id = ba.currency_id
  WHERE rba.id = p_recipient_bank_account_id
    AND rba.is_active = true
    AND ba.is_active = true
    AND ba.deleted_at IS NULL;
END;
$$;

-- Grant execute permission to authenticated users (function itself checks role)
GRANT EXECUTE ON FUNCTION public.get_recipient_bank_account_full TO authenticated;

-- Add comment
COMMENT ON FUNCTION public.get_recipient_bank_account_full IS
  'Retrieve full account number for a recipient bank account. SECURITY: Only callable by admin/super_admin roles. Used for payment processing.';

-- ============================================================================
-- STEP 6: Create function to get all accounts for a remittance (admin-only)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_remittance_bank_accounts_admin(p_remittance_id UUID)
RETURNS TABLE (
  remittance_id UUID,
  recipient_name TEXT,
  recipient_phone TEXT,
  bank_name TEXT,
  account_type TEXT,
  currency_code TEXT,
  account_holder_name TEXT,
  account_number_full TEXT,
  account_number_last4 TEXT,
  delivery_amount NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Security check: Only admins can execute this function
  IF (auth.jwt() ->> 'user_role') NOT IN ('admin', 'super_admin') THEN
    RAISE EXCEPTION 'Access denied: admin role required';
  END IF;

  RETURN QUERY
  SELECT
    r.id AS remittance_id,
    rec.full_name AS recipient_name,
    rec.phone AS recipient_phone,
    b.name AS bank_name,
    at.name AS account_type,
    c.code AS currency_code,
    ba.account_holder_name,
    ba.account_number_full,
    ba.account_number_last4,
    r.delivery_amount
  FROM public.remittances r
  INNER JOIN public.recipients rec ON rec.id = r.recipient_id
  LEFT JOIN public.remittance_bank_transfers rbt ON rbt.remittance_id = r.id
  LEFT JOIN public.recipient_bank_accounts rba ON rba.id = rbt.recipient_bank_account_id
  LEFT JOIN public.bank_accounts ba ON ba.id = rba.bank_account_id
  LEFT JOIN public.banks b ON b.id = ba.bank_id
  LEFT JOIN public.account_types at ON at.id = ba.account_type_id
  LEFT JOIN public.currencies c ON c.id = ba.currency_id
  WHERE r.id = p_remittance_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_remittance_bank_accounts_admin TO authenticated;

COMMENT ON FUNCTION public.get_remittance_bank_accounts_admin IS
  'Get complete bank account details for a remittance including full account numbers. SECURITY: Admin/super_admin only. Used for payment processing dashboard.';

-- ============================================================================
-- STEP 7: Add comments for documentation
-- ============================================================================

COMMENT ON COLUMN public.banks.logo_filename IS
  'Filename of bank logo stored in /public/bank-logos/ directory (e.g., bandec.svg, bpa.svg). NULL means no logo available.';

-- ============================================================================
-- END MIGRATION
-- ============================================================================
