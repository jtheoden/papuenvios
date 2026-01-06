-- ============================================================================
-- SHIPPING ZONES BY MUNICIPALITY MIGRATION
-- Created: 2026-01-06
-- Purpose: Enable shipping cost configuration per municipality instead of just province
-- ============================================================================

-- Step 1: Remove the unique constraint on province_name
-- We need to allow multiple rows per province (one for each municipality)
ALTER TABLE public.shipping_zones
DROP CONSTRAINT IF EXISTS shipping_zones_province_name_key;

-- Step 2: Add municipality_name column (nullable for backwards compatibility)
-- NULL means the cost applies to the entire province (default behavior)
ALTER TABLE public.shipping_zones
ADD COLUMN IF NOT EXISTS municipality_name text DEFAULT NULL;

-- Step 3: Create a new unique constraint on province_name + municipality_name
-- This allows:
--   - One row with (province_name=X, municipality_name=NULL) - default for province
--   - Multiple rows with (province_name=X, municipality_name=Y) - specific municipalities
CREATE UNIQUE INDEX IF NOT EXISTS idx_shipping_zones_province_municipality
ON public.shipping_zones (province_name, COALESCE(municipality_name, ''));

-- Step 4: Add an index for faster lookups by municipality
CREATE INDEX IF NOT EXISTS idx_shipping_zones_municipality
ON public.shipping_zones (municipality_name)
WHERE municipality_name IS NOT NULL;

-- Step 5: Add comments for documentation
COMMENT ON COLUMN public.shipping_zones.municipality_name IS
  'Municipality name for specific shipping costs. NULL means the cost applies to the entire province.';

-- ============================================================================
-- HELPER FUNCTION: Get shipping cost for a specific location
-- Priority: Municipality-specific cost > Province default cost
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_shipping_cost_for_location(
  p_province_name text,
  p_municipality_name text DEFAULT NULL
)
RETURNS TABLE (
  zone_id uuid,
  shipping_cost numeric,
  free_shipping boolean,
  is_municipality_specific boolean
) AS $$
BEGIN
  -- First try to find municipality-specific cost
  IF p_municipality_name IS NOT NULL THEN
    RETURN QUERY
    SELECT
      sz.id,
      sz.shipping_cost,
      sz.free_shipping,
      true as is_municipality_specific
    FROM public.shipping_zones sz
    WHERE sz.province_name = p_province_name
      AND sz.municipality_name = p_municipality_name
      AND sz.is_active = true
    LIMIT 1;

    IF FOUND THEN
      RETURN;
    END IF;
  END IF;

  -- Fallback to province default (municipality_name is NULL)
  RETURN QUERY
  SELECT
    sz.id,
    sz.shipping_cost,
    sz.free_shipping,
    false as is_municipality_specific
  FROM public.shipping_zones sz
  WHERE sz.province_name = p_province_name
    AND sz.municipality_name IS NULL
    AND sz.is_active = true
  LIMIT 1;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION public.get_shipping_cost_for_location IS
  'Get shipping cost for a location. Tries municipality-specific first, then falls back to province default.';

-- ============================================================================
-- VERIFICATION QUERIES
-- ============================================================================
-- Verify the new column exists
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'shipping_zones'
  AND column_name = 'municipality_name';

-- Verify the function exists
SELECT proname, proargtypes
FROM pg_proc
WHERE proname = 'get_shipping_cost_for_location';

-- ============================================================================
-- MIGRATION COMPLETE
-- ============================================================================
DO $$
BEGIN
  RAISE NOTICE 'Migration 20260106000001_shipping_zones_by_municipality completed successfully';
  RAISE NOTICE 'Added: municipality_name column to shipping_zones';
  RAISE NOTICE 'Added: get_shipping_cost_for_location function for priority-based cost lookup';
  RAISE NOTICE 'NOTE: Existing province-based costs remain intact (municipality_name = NULL)';
END $$;
