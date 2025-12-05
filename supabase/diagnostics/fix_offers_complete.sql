-- ============================================================================
-- FIX OFFERS TABLE - Add all missing columns
-- This migration was in 20251205_activity_and_offer_support.sql but wasn't applied
-- ============================================================================

-- Add missing columns to offers table
ALTER TABLE public.offers
  ADD COLUMN IF NOT EXISTS code text,
  ADD COLUMN IF NOT EXISTS max_usage_global integer,
  ADD COLUMN IF NOT EXISTS max_usage_per_user integer;

-- Create unique index on code (only for non-null values)
CREATE UNIQUE INDEX IF NOT EXISTS offers_code_unique
ON public.offers(code)
WHERE code IS NOT NULL;

-- Add comments
COMMENT ON COLUMN public.offers.code IS 'Unique promotional code for the offer (e.g., "SUMMER2025")';
COMMENT ON COLUMN public.offers.max_usage_global IS 'Maximum number of times this offer can be used globally (null = unlimited)';
COMMENT ON COLUMN public.offers.max_usage_per_user IS 'Maximum number of times a single user can use this offer (null = unlimited)';

-- Verify columns were added
SELECT
  column_name,
  data_type,
  is_nullable,
  CASE
    WHEN column_name = 'code' THEN '✓ Added for coupon codes'
    WHEN column_name = 'max_usage_global' THEN '✓ Added for global usage limit'
    WHEN column_name = 'max_usage_per_user' THEN '✓ Added for per-user limit'
    ELSE ''
  END as note
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'offers'
  AND column_name IN ('code', 'max_usage_global', 'max_usage_per_user')
ORDER BY column_name;

-- Should return 3 rows
