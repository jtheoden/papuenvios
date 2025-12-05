-- ============================================================================
-- FIXES FOR CATEGORY DISCOUNTS ISSUE
-- Apply these based on diagnostic results
-- ============================================================================

-- ============================================================================
-- FIX 1: If RLS policy blocks regular users
-- ============================================================================
-- Run this if diagnostic query #3 shows only admin policies

DROP POLICY IF EXISTS "admins can view discounts" ON public.category_discounts;

DROP POLICY IF EXISTS "authenticated users can view discounts" ON public.category_discounts;
CREATE POLICY "authenticated users can view discounts"
ON public.category_discounts
FOR SELECT
TO authenticated
USING (true);

COMMENT ON POLICY "authenticated users can view discounts" ON public.category_discounts IS
'Allow all authenticated users to view category discounts for checkout calculations';

-- ============================================================================
-- FIX 2: If table doesn't exist, create it
-- ============================================================================
-- Run this if diagnostic query #1 returns no rows

CREATE TABLE IF NOT EXISTS public.category_discounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_name text NOT NULL UNIQUE,
  discount_percentage numeric(5,2) NOT NULL DEFAULT 0,
  discount_description text,
  enabled boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  FOREIGN KEY (category_name) REFERENCES public.category_rules(category_name) ON DELETE CASCADE,
  CONSTRAINT category_discounts_percentage_check CHECK (discount_percentage >= 0 AND discount_percentage <= 100)
);

-- Seed initial data
INSERT INTO public.category_discounts (category_name, discount_percentage, discount_description, enabled)
VALUES
  ('regular', 0, 'No discount', false),
  ('pro', 5, '5% discount for active users', false),
  ('vip', 10, '10% discount for premium users', false)
ON CONFLICT (category_name) DO NOTHING;

-- Enable RLS
ALTER TABLE public.category_discounts ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- FIX 3: If column is named wrong (discount_percent instead of discount_percentage)
-- ============================================================================
-- Run this if diagnostic query #1 shows 'discount_percent' column

ALTER TABLE public.category_discounts
RENAME COLUMN discount_percent TO discount_percentage;

-- ============================================================================
-- FIX 4: If data is missing
-- ============================================================================
-- Run this if diagnostic query #2 returns no rows

INSERT INTO public.category_discounts (category_name, discount_percentage, discount_description, enabled)
VALUES
  ('regular', 0, 'No discount', false),
  ('pro', 5, '5% discount for active users', false),
  ('vip', 10, '10% discount for premium users', false)
ON CONFLICT (category_name) DO NOTHING;

-- ============================================================================
-- VERIFICATION QUERY
-- Run this after applying fixes to confirm everything works
-- ============================================================================

-- Test the query that the frontend will use
SELECT discount_percentage, enabled
FROM public.category_discounts
WHERE category_name = 'pro';

-- Should return: { discount_percentage: 5, enabled: false } (or true if enabled)
