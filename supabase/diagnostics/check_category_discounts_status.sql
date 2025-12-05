-- ============================================================================
-- DIAGNOSTIC QUERIES FOR CATEGORY DISCOUNTS ISSUE
-- Run these in Supabase SQL Editor to diagnose the problem
-- ============================================================================

-- 1. Check if category_discounts table exists and its structure
SELECT
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'category_discounts'
ORDER BY ordinal_position;

-- 2. Check all data in category_discounts table
SELECT * FROM public.category_discounts ORDER BY category_name;

-- 3. Check current RLS policies on category_discounts
SELECT
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'category_discounts';

-- 4. Check if RLS is enabled on category_discounts
SELECT
  schemaname,
  tablename,
  rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename = 'category_discounts';

-- 5. Check user_categories structure
SELECT
  column_name,
  data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'user_categories'
ORDER BY ordinal_position;

-- 6. Check sample user categories (first 5 users)
SELECT
  uc.user_id,
  uc.category_name,
  up.email,
  up.full_name
FROM public.user_categories uc
LEFT JOIN public.user_profiles up ON uc.user_id = up.id
LIMIT 5;

-- 7. Check category_rules table
SELECT * FROM public.category_rules ORDER BY category_name;

-- ============================================================================
-- EXPECTED RESULTS:
-- ============================================================================
--
-- 1. category_discounts should have columns:
--    - discount_percentage (numeric) NOT discount_percent
--    - enabled (boolean)
--    - category_name (text)
--
-- 2. Should have 3 rows: regular, pro, vip
--
-- 3. RLS policies should allow authenticated users to SELECT
--
-- 4. rowsecurity should be 't' (true)
--
-- ============================================================================
