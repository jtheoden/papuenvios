-- ============================================================================
-- DIAGNOSE NEW ERRORS: user_categories 406 + offer_usage 404
-- ============================================================================

-- ============================================================================
-- ERROR 1: user_categories 406 Not Acceptable
-- Query: GET /user_categories?select=category_name&user_id=eq.cedc2b86...
-- 406 = Response can't match Accept header (usually .single() with 0 or 2+ rows)
-- ============================================================================

-- Check if user_categories table exists
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name = 'user_categories';

-- Check RLS policies on user_categories
SELECT policyname, permissive, roles, cmd, qual
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'user_categories';

-- Check if the specific user has a category
SELECT *
FROM public.user_categories
WHERE user_id = 'cedc2b86-33a5-46ce-91b4-93f01056e029';

-- Count how many rows exist for this user (should be 0 or 1)
SELECT COUNT(*) as row_count
FROM public.user_categories
WHERE user_id = 'cedc2b86-33a5-46ce-91b4-93f01056e029';

-- 406 happens when:
-- - .single() is used but 0 rows exist → Use .maybeSingle() instead
-- - .single() is used but 2+ rows exist → Fix data/query

-- ============================================================================
-- ERROR 2: offer_usage 404 Not Found
-- Query: GET /offer_usage?select=*&offer_id=eq.b636f19e...
-- 404 = Table doesn't exist
-- ============================================================================

-- Check if offer_usage table exists
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name = 'offer_usage';

-- If no rows returned: Table doesn't exist, need to create it

-- ============================================================================
-- EXPECTED STRUCTURE (if table needs to be created):
-- ============================================================================

/*
CREATE TABLE IF NOT EXISTS public.offer_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_id uuid NOT NULL REFERENCES public.offers(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  used_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_offer_usage_offer_id ON public.offer_usage(offer_id);
CREATE INDEX IF NOT EXISTS idx_offer_usage_user_id ON public.offer_usage(user_id);
CREATE INDEX IF NOT EXISTS idx_offer_usage_order_id ON public.offer_usage(order_id);

ALTER TABLE public.offer_usage ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users can view own usage"
  ON public.offer_usage FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() OR EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = auth.uid() AND role IN ('admin', 'super_admin', 'manager')
  ));

CREATE POLICY "admins can manage all usage"
  ON public.offer_usage FOR ALL
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = auth.uid() AND role IN ('admin', 'super_admin', 'manager')
  ));
*/
