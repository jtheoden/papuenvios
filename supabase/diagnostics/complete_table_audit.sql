-- ============================================================================
-- COMPLETE DATABASE TABLE AUDIT
-- Comprehensive check of all tables referenced in frontend code
-- ============================================================================

-- ============================================================================
-- PART 1: Check existence of ALL tables used in frontend
-- ============================================================================

WITH expected_tables AS (
  SELECT unnest(ARRAY[
    'activity_logs',
    'user_profiles',
    'category_discounts',
    'user_categories',
    'category_rules',
    'user_category_history',
    'zelle_accounts',
    'zelle_transaction_history',
    'orders',
    'order_items',
    'remittances',
    'products',
    'inventory',
    'product_categories',
    'combos',
    'combo_products',
    'combo_items',
    'recipients',
    'recipient_addresses',
    'recipient_bank_accounts',
    'bank_accounts',
    'cuban_municipalities',
    'testimonials',
    'offers',
    'offer_usage',
    'currencies',
    'shipping_zones',
    'system_messages',
    'system_config'
  ]) as table_name
)
SELECT
  et.table_name,
  CASE
    WHEN t.table_name IS NOT NULL THEN '✓ EXISTS'
    ELSE '❌ MISSING'
  END as status,
  CASE
    WHEN t.table_name IS NOT NULL AND pt.rowsecurity THEN '✓ RLS Enabled'
    WHEN t.table_name IS NOT NULL AND NOT pt.rowsecurity THEN '⚠️ RLS Disabled'
    ELSE 'N/A'
  END as rls_status
FROM expected_tables et
LEFT JOIN information_schema.tables t
  ON t.table_name = et.table_name AND t.table_schema = 'public'
LEFT JOIN pg_tables pt
  ON pt.tablename = et.table_name AND pt.schemaname = 'public'
ORDER BY
  CASE WHEN t.table_name IS NULL THEN 0 ELSE 1 END,
  et.table_name;

-- ============================================================================
-- PART 2: Check for deprecated/wrong table names
-- ============================================================================

SELECT
  'Deprecated Tables Check' as check_type,
  table_name,
  '❌ Should be renamed or removed' as issue
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('profiles')  -- Old name, should be user_profiles
ORDER BY table_name;

-- ============================================================================
-- PART 3: Verify RLS policies on critical tables
-- ============================================================================

SELECT
  tablename,
  COUNT(*) as policy_count,
  string_agg(policyname, ', ' ORDER BY policyname) as policies,
  CASE
    WHEN COUNT(*) = 0 THEN '❌ No policies (table is blocked!)'
    WHEN COUNT(*) < 2 THEN '⚠️ Only ' || COUNT(*) || ' policy'
    ELSE '✓ ' || COUNT(*) || ' policies'
  END as status
FROM pg_policies
WHERE schemaname = 'public'
GROUP BY tablename
HAVING tablename IN (
  'activity_logs',
  'user_profiles',
  'category_discounts',
  'user_categories',
  'zelle_accounts',
  'orders',
  'remittances',
  'products',
  'recipients',
  'offers'
)
ORDER BY tablename;

-- ============================================================================
-- PART 4: Check specific table structures for recent fixes
-- ============================================================================

-- Check category_discounts has correct column name
SELECT
  column_name,
  data_type,
  CASE
    WHEN column_name = 'discount_percentage' THEN '✓ Correct column name'
    WHEN column_name = 'discount_percent' THEN '❌ Wrong column name (should be discount_percentage)'
    ELSE ''
  END as validation
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'category_discounts'
  AND column_name LIKE 'discount%'
ORDER BY column_name;

-- Check activity_logs structure
SELECT
  'activity_logs' as table_name,
  COUNT(*) as column_count,
  bool_and(column_name IN ('id', 'action', 'entity_type', 'entity_id', 'performed_by', 'description', 'metadata', 'created_at')) as has_required_columns
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'activity_logs'
  AND column_name IN ('id', 'action', 'entity_type', 'entity_id', 'performed_by', 'description', 'metadata', 'created_at');

-- Check user_profiles exists (not 'profiles')
SELECT
  CASE
    WHEN EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'user_profiles'
    ) THEN '✓ user_profiles exists'
    ELSE '❌ user_profiles missing'
  END as user_profiles_check,
  CASE
    WHEN EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'profiles'
    ) THEN '❌ Old "profiles" table still exists'
    ELSE '✓ No deprecated "profiles" table'
  END as profiles_deprecation_check;

-- ============================================================================
-- PART 5: Summary Report
-- ============================================================================

SELECT
  'Database Health Summary' as report_type,
  (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE') as total_tables,
  (SELECT COUNT(*) FROM pg_tables WHERE schemaname = 'public' AND rowsecurity = true) as tables_with_rls,
  (SELECT COUNT(*) FROM pg_policies WHERE schemaname = 'public') as total_policies,
  (SELECT COUNT(DISTINCT tablename) FROM pg_policies WHERE schemaname = 'public') as tables_with_policies;
