-- ============================================================================
-- ADD PAYMENT_REJECTED_AT COLUMN TO REMITTANCES
-- Created: 2025-10-30
-- Purpose: Track timestamp when payment is rejected for audit trail
-- Related Issue: Error "payment_rejected_at column not found" when rejecting payment
-- ============================================================================

-- Add payment_rejected_at timestamp column
ALTER TABLE public.remittances
ADD COLUMN IF NOT EXISTS payment_rejected_at timestamptz;

-- Add index for performance when filtering by rejection date
CREATE INDEX IF NOT EXISTS idx_remittances_payment_rejected
  ON public.remittances(payment_rejected_at)
  WHERE payment_rejected_at IS NOT NULL;

-- Add comment for documentation
COMMENT ON COLUMN public.remittances.payment_rejected_at IS
  'Timestamp when payment was rejected by admin. NULL if payment was never rejected or was validated.';

-- ============================================================================
-- VERIFICATION QUERY (for manual testing)
-- ============================================================================
-- SELECT column_name, data_type, is_nullable
-- FROM information_schema.columns
-- WHERE table_schema = 'public'
--   AND table_name = 'remittances'
--   AND column_name = 'payment_rejected_at';
-- ============================================================================
