-- ============================================================================
-- ROLLBACK: Bank Accounts Enhancement Migration
-- ============================================================================

-- Drop functions
DROP FUNCTION IF EXISTS public.get_remittance_bank_accounts_admin(UUID);
DROP FUNCTION IF EXISTS public.get_recipient_bank_account_full(UUID);

-- Restore original RLS policy (without account_number_full considerations)
DROP POLICY IF EXISTS bank_accounts_user_view ON public.bank_accounts;

CREATE POLICY bank_accounts_user_view ON public.bank_accounts
  FOR SELECT USING (
    auth.uid() = user_id OR
    (auth.jwt() ->> 'user_role') = 'admin'
  );

-- Remove indexes
DROP INDEX IF EXISTS public.idx_bank_accounts_full_number;
DROP INDEX IF EXISTS public.idx_banks_logo;

-- Remove constraints
ALTER TABLE public.bank_accounts
DROP CONSTRAINT IF EXISTS check_account_number_full_not_empty;

-- Remove columns
ALTER TABLE public.bank_accounts
DROP COLUMN IF EXISTS account_number_full;

ALTER TABLE public.banks
DROP COLUMN IF EXISTS logo_filename;

-- Clear logo updates from seed data (reset to NULL)
UPDATE public.banks SET logo_filename = NULL;

-- ============================================================================
-- END ROLLBACK
-- ============================================================================
