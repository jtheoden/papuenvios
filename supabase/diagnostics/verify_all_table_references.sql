-- ============================================================================
-- VERIFY ALL TABLE REFERENCES USED IN FRONTEND CODE
-- Run this to confirm all tables exist and have correct names
-- ============================================================================

-- Get list of all public tables
SELECT
  table_name,
  table_type,
  CASE
    WHEN table_name = 'activity_logs' THEN '✓ Used by activityLogger.js'
    WHEN table_name = 'user_profiles' THEN '✓ Used by zelleService.js, userService.js, etc'
    WHEN table_name = 'category_discounts' THEN '✓ Used by orderDiscountService.js'
    WHEN table_name = 'user_categories' THEN '✓ Used by orderDiscountService.js'
    WHEN table_name = 'zelle_accounts' THEN '✓ Used by zelleService.js'
    WHEN table_name = 'zelle_transaction_history' THEN '✓ Used by zelleService.js'
    WHEN table_name = 'orders' THEN '✓ Used by orderService.js'
    WHEN table_name = 'order_items' THEN '✓ Used by orderService.js'
    WHEN table_name = 'remittances' THEN '✓ Used by remittanceService.js'
    WHEN table_name = 'products' THEN '✓ Used by productService.js'
    WHEN table_name = 'combos' THEN '✓ Used by comboService.js'
    WHEN table_name = 'recipients' THEN '✓ Used by recipientService.js'
    WHEN table_name = 'testimonials' THEN '✓ Used by testimonialService.js'
    WHEN table_name = 'offers' THEN '✓ Used by orderDiscountService.js'
    WHEN table_name = 'currencies' THEN '✓ Used by currencyService.js'
    WHEN table_name = 'shipping_zones' THEN '✓ Used by shippingService.js'
    WHEN table_name = 'bank_accounts' THEN '✓ Used by bankService.js'
    ELSE 'Other table'
  END as usage_note
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_type = 'BASE TABLE'
ORDER BY table_name;

-- ============================================================================
-- Check for tables that DON'T exist but might be referenced in code
-- ============================================================================

-- These tables should NOT exist (old/wrong names):
SELECT
  'profiles' as deprecated_table_name,
  CASE
    WHEN EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'profiles' AND table_schema = 'public')
    THEN '❌ PROBLEM: Old table still exists, should use user_profiles'
    ELSE '✓ Good: Table does not exist (using user_profiles instead)'
  END as status;

-- ============================================================================
-- Verify critical tables for current session fixes
-- ============================================================================

SELECT
  'Critical Tables Check' as check_type,
  json_build_object(
    'activity_logs', EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'activity_logs' AND table_schema = 'public'),
    'user_profiles', EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'user_profiles' AND table_schema = 'public'),
    'category_discounts', EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'category_discounts' AND table_schema = 'public'),
    'user_categories', EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'user_categories' AND table_schema = 'public'),
    'zelle_accounts', EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'zelle_accounts' AND table_schema = 'public'),
    'zelle_transaction_history', EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'zelle_transaction_history' AND table_schema = 'public')
  ) as tables_exist;

-- All should be true

-- ============================================================================
-- Check RLS policies on critical tables
-- ============================================================================

SELECT
  tablename,
  COUNT(*) as policy_count,
  array_agg(policyname) as policies
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN (
    'activity_logs',
    'user_profiles',
    'category_discounts',
    'user_categories',
    'zelle_accounts',
    'zelle_transaction_history'
  )
GROUP BY tablename
ORDER BY tablename;

-- Should show at least 1 policy for each table
