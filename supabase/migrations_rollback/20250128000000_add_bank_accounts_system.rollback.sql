-- ============================================================================
-- ROLLBACK SCRIPT - Bank Accounts System
-- This script reverts all changes made by the migration
-- ============================================================================

-- Drop tables in correct order (reverse dependency)
DROP TABLE IF EXISTS public.remittance_bank_transfers CASCADE;
DROP TABLE IF EXISTS public.recipient_bank_accounts CASCADE;
DROP TABLE IF EXISTS public.bank_accounts CASCADE;
DROP TABLE IF EXISTS public.account_types CASCADE;
DROP TABLE IF EXISTS public.banks CASCADE;

-- ============================================================================
-- END ROLLBACK
-- ============================================================================
