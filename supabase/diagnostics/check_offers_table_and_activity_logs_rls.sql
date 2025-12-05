-- ============================================================================
-- DIAGNOSTIC: Offers table structure and Activity Logs RLS
-- ============================================================================

-- ============================================================================
-- PART 1: Check offers table structure
-- ============================================================================

-- Query 1: Get all columns in offers table
SELECT
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'offers'
ORDER BY ordinal_position;

-- Expected columns based on AdminOffersTab.jsx:
-- - code (text) - MISSING causing 400 error
-- - discount_type (text)
-- - discount_value (numeric)
-- - min_purchase_amount (numeric)
-- - max_usage_global (integer)
-- - max_usage_per_user (integer)
-- - start_date (timestamptz)
-- - end_date (timestamptz)
-- - is_active (boolean)

-- ============================================================================
-- PART 2: Check activity_logs RLS policies
-- ============================================================================

-- Query 2: Check if RLS is enabled
SELECT
  tablename,
  rowsecurity as rls_enabled
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename = 'activity_logs';

-- Should show rls_enabled = true

-- Query 3: List all RLS policies
SELECT
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'activity_logs';

-- Should show:
-- - activity_logs_insert_authenticated (INSERT)
-- - activity_logs_select_authenticated (SELECT)

-- Query 4: Test if authenticated users can access
-- This will show what the current policy allows
SELECT
  policyname,
  CASE cmd
    WHEN 'SELECT' THEN 'Can read'
    WHEN 'INSERT' THEN 'Can write'
    WHEN 'UPDATE' THEN 'Can update'
    WHEN 'DELETE' THEN 'Can delete'
  END as permission,
  CASE
    WHEN 'authenticated' = ANY(roles) THEN '✓ Allows authenticated users'
    WHEN 'anon' = ANY(roles) THEN '⚠️ Allows anonymous users'
    ELSE '❌ Role restriction: ' || array_to_string(roles, ', ')
  END as access_level
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'activity_logs';

-- ============================================================================
-- PART 3: Check offers table RLS policies
-- ============================================================================

-- Query 5: Check offers RLS
SELECT
  tablename,
  rowsecurity as rls_enabled
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename = 'offers';

-- Query 6: List offers policies
SELECT
  policyname,
  permissive,
  roles,
  cmd
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'offers';

-- ============================================================================
-- EXPECTED ISSUES TO FIX:
-- ============================================================================
--
-- 1. If offers table missing 'code' column:
--    ALTER TABLE offers ADD COLUMN code text;
--
-- 2. If activity_logs policies show wrong roles or USING clause:
--    Need to recreate policies
--
-- ============================================================================
