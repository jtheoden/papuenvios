-- ============================================================================
-- ROLLBACK: ADD PAYMENT_REJECTED_AT COLUMN TO REMITTANCES
-- Created: 2025-10-30
-- Purpose: Revert payment_rejected_at column addition
-- ============================================================================

-- Drop index first
DROP INDEX IF EXISTS public.idx_remittances_payment_rejected;

-- Drop column
ALTER TABLE public.remittances
DROP COLUMN IF EXISTS payment_rejected_at;

-- ============================================================================
-- VERIFICATION QUERY (for manual testing after rollback)
-- ============================================================================
-- SELECT column_name
-- FROM information_schema.columns
-- WHERE table_schema = 'public'
--   AND table_name = 'remittances'
--   AND column_name = 'payment_rejected_at';
-- Should return 0 rows after rollback
-- ============================================================================
