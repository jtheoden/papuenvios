-- ============================================================================
-- FIX BANK ACCOUNTS RLS POLICIES FOR ADMIN ACCESS
-- Created: 2026-01-19
-- Purpose: Fix RLS policies to use get_my_role() instead of JWT claims
--          so admins can see bank account details in remittance view
-- ============================================================================

-- Problem: The current RLS policies use (auth.jwt() ->> 'user_role') which
-- doesn't exist in the Supabase JWT. This prevents admins from viewing
-- bank account details in the remittance detail modal.
--
-- Solution: Replace JWT claim checks with get_my_role() function calls

-- ============================================================================
-- STEP 1: Ensure get_my_role() function exists
-- ============================================================================

-- Create or replace the function (idempotent)
CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT COALESCE(
    (SELECT role FROM user_profiles WHERE id = auth.uid() LIMIT 1),
    'user'
  )
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION public.get_my_role() TO authenticated;

-- ============================================================================
-- STEP 2: Fix bank_accounts RLS policies
-- ============================================================================

-- Drop existing policies
DROP POLICY IF EXISTS bank_accounts_user_view ON public.bank_accounts;
DROP POLICY IF EXISTS bank_accounts_user_insert ON public.bank_accounts;
DROP POLICY IF EXISTS bank_accounts_user_update ON public.bank_accounts;
DROP POLICY IF EXISTS bank_accounts_user_delete ON public.bank_accounts;

-- Recreate SELECT policy: Users see their own accounts, admins see all
CREATE POLICY bank_accounts_user_view ON public.bank_accounts
  FOR SELECT USING (
    auth.uid() = user_id OR
    public.get_my_role() IN ('admin', 'super_admin')
  );

-- Recreate INSERT policy: Users can only insert their own accounts
CREATE POLICY bank_accounts_user_insert ON public.bank_accounts
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Recreate UPDATE policy: Users update their own, admins update all
CREATE POLICY bank_accounts_user_update ON public.bank_accounts
  FOR UPDATE USING (
    auth.uid() = user_id OR
    public.get_my_role() IN ('admin', 'super_admin')
  );

-- Recreate DELETE policy: Users delete their own, admins delete all
CREATE POLICY bank_accounts_user_delete ON public.bank_accounts
  FOR DELETE USING (
    auth.uid() = user_id OR
    public.get_my_role() IN ('admin', 'super_admin')
  );

-- ============================================================================
-- STEP 3: Fix recipient_bank_accounts RLS policies
-- ============================================================================

-- Drop existing policies
DROP POLICY IF EXISTS recipient_bank_accounts_view ON public.recipient_bank_accounts;
DROP POLICY IF EXISTS recipient_bank_accounts_insert ON public.recipient_bank_accounts;
DROP POLICY IF EXISTS recipient_bank_accounts_update ON public.recipient_bank_accounts;
DROP POLICY IF EXISTS recipient_bank_accounts_delete ON public.recipient_bank_accounts;

-- Recreate SELECT policy: Users see their recipients' accounts, admins see all
CREATE POLICY recipient_bank_accounts_view ON public.recipient_bank_accounts
  FOR SELECT USING (
    public.get_my_role() IN ('admin', 'super_admin') OR
    EXISTS (
      SELECT 1 FROM public.recipients
      WHERE recipients.id = recipient_bank_accounts.recipient_id
      AND recipients.user_id = auth.uid()
    )
  );

-- Add INSERT policy for users linking their own recipients
CREATE POLICY recipient_bank_accounts_insert ON public.recipient_bank_accounts
  FOR INSERT WITH CHECK (
    public.get_my_role() IN ('admin', 'super_admin') OR
    EXISTS (
      SELECT 1 FROM public.recipients
      WHERE recipients.id = recipient_bank_accounts.recipient_id
      AND recipients.user_id = auth.uid()
    )
  );

-- Add UPDATE policy
CREATE POLICY recipient_bank_accounts_update ON public.recipient_bank_accounts
  FOR UPDATE USING (
    public.get_my_role() IN ('admin', 'super_admin') OR
    EXISTS (
      SELECT 1 FROM public.recipients
      WHERE recipients.id = recipient_bank_accounts.recipient_id
      AND recipients.user_id = auth.uid()
    )
  );

-- Add DELETE policy
CREATE POLICY recipient_bank_accounts_delete ON public.recipient_bank_accounts
  FOR DELETE USING (
    public.get_my_role() IN ('admin', 'super_admin') OR
    EXISTS (
      SELECT 1 FROM public.recipients
      WHERE recipients.id = recipient_bank_accounts.recipient_id
      AND recipients.user_id = auth.uid()
    )
  );

-- ============================================================================
-- STEP 4: Fix remittance_bank_transfers RLS policies
-- ============================================================================

-- Drop existing policies
DROP POLICY IF EXISTS remittance_bank_transfers_view ON public.remittance_bank_transfers;
DROP POLICY IF EXISTS remittance_bank_transfers_insert ON public.remittance_bank_transfers;
DROP POLICY IF EXISTS remittance_bank_transfers_update ON public.remittance_bank_transfers;

-- Recreate policies using get_my_role()
CREATE POLICY remittance_bank_transfers_view ON public.remittance_bank_transfers
  FOR SELECT USING (public.get_my_role() IN ('admin', 'super_admin'));

CREATE POLICY remittance_bank_transfers_insert ON public.remittance_bank_transfers
  FOR INSERT WITH CHECK (public.get_my_role() IN ('admin', 'super_admin'));

CREATE POLICY remittance_bank_transfers_update ON public.remittance_bank_transfers
  FOR UPDATE USING (public.get_my_role() IN ('admin', 'super_admin'));

-- ============================================================================
-- STEP 5: Ensure table-level grants exist
-- ============================================================================

-- Grant permissions to authenticated role (required for RLS to work)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bank_accounts TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.recipient_bank_accounts TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.remittance_bank_transfers TO authenticated;

-- ============================================================================
-- STEP 6: Verification
-- ============================================================================

DO $$
BEGIN
    RAISE NOTICE 'Bank accounts RLS policies fixed successfully';
    RAISE NOTICE 'Admins can now view bank account details in remittance details modal';
    RAISE NOTICE 'Using get_my_role() function instead of JWT claims';
END $$;

-- ============================================================================
-- END MIGRATION
-- ============================================================================
