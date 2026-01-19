-- ============================================================================
-- Add recipient_bank_account_id column to remittances table
-- This enables bank transfer remittances to link to recipient bank accounts
-- ============================================================================

-- Step 1: Add the column
ALTER TABLE public.remittances
ADD COLUMN IF NOT EXISTS recipient_bank_account_id UUID REFERENCES public.recipient_bank_accounts(id);

-- Step 2: Create index for efficient lookups
CREATE INDEX IF NOT EXISTS idx_remittances_recipient_bank_account_id
ON public.remittances(recipient_bank_account_id);

-- Step 3: Add comment for documentation
COMMENT ON COLUMN public.remittances.recipient_bank_account_id IS
'Links to the recipient bank account for bank transfer delivery method remittances';

-- Verification
DO $$
BEGIN
    RAISE NOTICE 'Column recipient_bank_account_id added to remittances table';
END $$;
