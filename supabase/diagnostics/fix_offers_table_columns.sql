-- ============================================================================
-- FIX OFFERS TABLE - Add missing 'code' column
-- ============================================================================

-- Add the missing 'code' column
ALTER TABLE public.offers
ADD COLUMN IF NOT EXISTS code text UNIQUE;

-- Create unique index on code (only for non-null values)
CREATE UNIQUE INDEX IF NOT EXISTS offers_code_unique
ON public.offers(code)
WHERE code IS NOT NULL;

-- Add comment
COMMENT ON COLUMN public.offers.code IS 'Unique promotional code for the offer (e.g., "SUMMER2025")';

-- Verify the column was added
SELECT
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'offers'
  AND column_name = 'code';

-- Should return 1 row showing the 'code' column exists
