-- ============================================================================
-- COMBO PRODUCTS: ADD CURRENCY SUPPORT
-- Created: 2026-11-02
-- Purpose: Add base_currency_id to combo_products so prices can be set in any currency
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. ADD BASE_CURRENCY_ID TO COMBO_PRODUCTS
-- ============================================================================
ALTER TABLE public.combo_products
ADD COLUMN IF NOT EXISTS base_currency_id uuid REFERENCES public.currencies(id);

-- ============================================================================
-- 2. SET DEFAULT CURRENCY (USD) FOR EXISTING COMBOS
-- ============================================================================
UPDATE public.combo_products
SET base_currency_id = (
  SELECT id FROM public.currencies WHERE code = 'USD' LIMIT 1
)
WHERE base_currency_id IS NULL;

-- ============================================================================
-- 3. MAKE CURRENCY REQUIRED (AFTER SETTING DEFAULTS)
-- ============================================================================
ALTER TABLE public.combo_products
ALTER COLUMN base_currency_id SET NOT NULL;

-- ============================================================================
-- 4. ADD INDEX FOR CURRENCY LOOKUPS
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_combo_products_currency
ON public.combo_products(base_currency_id);

COMMIT;
