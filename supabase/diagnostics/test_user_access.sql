-- ============================================================================
-- TEST USER ACCESS TO CATEGORY DISCOUNTS
-- This simulates what the frontend sees
-- ============================================================================

-- Test 1: Can authenticated users see any discounts?
-- Run this as an authenticated user (not admin)
SELECT
  category_name,
  discount_percentage,
  enabled
FROM public.category_discounts;

-- If this returns 0 rows but Fix #2 shows data exists,
-- then it's an RLS policy issue -> Apply FIX 1

-- ============================================================================

-- Test 2: Specific query that frontend uses
-- This is the exact query from orderDiscountService.js
SELECT discount_percentage, enabled
FROM public.category_discounts
WHERE category_name = 'pro';

-- Expected result: { discount_percentage: 5, enabled: false }
-- If you get: "permission denied" or 0 rows -> RLS issue
-- If you get: "column discount_percent does not exist" -> Wrong column name (already fixed in code)

-- ============================================================================

-- Test 3: Check what the current user can see
SELECT
  current_user as postgres_user,
  current_setting('request.jwt.claims', true)::json->>'role' as jwt_role,
  current_setting('request.jwt.claims', true)::json->>'sub' as user_id;

-- This shows who you're authenticated as

-- ============================================================================

-- Test 4: Check if user has a category assigned
SELECT
  uc.category_name,
  uc.assigned_at,
  uc.assignment_reason
FROM public.user_categories uc
WHERE uc.user_id = auth.uid();

-- This shows your current category (regular, pro, or vip)
-- If no rows, you don't have a category assigned yet (will default to 'regular')

-- ============================================================================

-- Test 5: Complete discount lookup (simulates full frontend flow)
WITH user_cat AS (
  SELECT category_name
  FROM public.user_categories
  WHERE user_id = auth.uid()
)
SELECT
  COALESCE(user_cat.category_name, 'regular') as user_category,
  cd.discount_percentage,
  cd.enabled,
  CASE
    WHEN cd.enabled THEN cd.discount_percentage
    ELSE 0
  END as effective_discount
FROM user_cat
LEFT JOIN public.category_discounts cd
  ON cd.category_name = COALESCE(user_cat.category_name, 'regular');

-- This should return your category and applicable discount
-- If this fails, note the exact error message
