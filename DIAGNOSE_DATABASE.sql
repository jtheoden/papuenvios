-- ============================================================================
-- COMPREHENSIVE DATABASE DIAGNOSTIC SCRIPT
-- ============================================================================
-- Run this in Supabase SQL Editor to diagnose all current issues
-- ============================================================================

-- 1. CHECK IF USER PROFILE EXISTS
-- Replace with your actual email
SELECT
    '🔍 USER PROFILE CHECK' as section,
    id,
    user_id,
    email,
    role,
    is_enabled,
    created_at
FROM user_profiles
WHERE email = 'jtheoden@googlemail.com';

-- 2. CHECK RLS STATUS ON user_profiles
SELECT
    '🔒 RLS STATUS' as section,
    tablename,
    CASE
        WHEN rowsecurity THEN '⚠️ ENABLED'
        ELSE '✅ DISABLED'
    END as rls_status
FROM pg_tables
WHERE schemaname = 'public'
AND tablename = 'user_profiles';

-- 3. CHECK POLICIES ON user_profiles
SELECT
    '📋 RLS POLICIES' as section,
    schemaname,
    tablename,
    policyname,
    permissive,
    roles,
    cmd,
    qual as using_expression,
    with_check as with_check_expression
FROM pg_policies
WHERE schemaname = 'public'
AND tablename = 'user_profiles'
ORDER BY policyname;

-- 4. CHECK INDEXES ON user_profiles
SELECT
    '📊 INDEXES' as section,
    indexname,
    indexdef
FROM pg_indexes
WHERE schemaname = 'public'
AND tablename = 'user_profiles'
ORDER BY indexname;

-- 5. CHECK STORAGE BUCKETS
SELECT
    '🗂️ STORAGE BUCKETS' as section,
    id,
    name,
    public,
    created_at
FROM storage.buckets
ORDER BY name;

-- 6. CHECK STORAGE POLICIES
SELECT
    '🔐 STORAGE POLICIES' as section,
    bucket_id,
    name as policy_name,
    definition
FROM storage.policies
ORDER BY bucket_id, name;

-- 7. CHECK IF is_admin_user() FUNCTION EXISTS
SELECT
    '⚙️ HELPER FUNCTIONS' as section,
    routine_name,
    routine_type,
    security_type
FROM information_schema.routines
WHERE routine_schema = 'public'
AND routine_name = 'is_admin_user';

-- 8. TEST is_admin_user() FUNCTION (if exists)
DO $$
BEGIN
    IF EXISTS (
        SELECT FROM information_schema.routines
        WHERE routine_schema = 'public'
        AND routine_name = 'is_admin_user'
    ) THEN
        RAISE NOTICE '✅ is_admin_user() function exists';
        -- Try to execute it
        PERFORM is_admin_user();
        RAISE NOTICE '✅ is_admin_user() function executes successfully';
    ELSE
        RAISE NOTICE '⚠️ is_admin_user() function does NOT exist';
    END IF;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '❌ is_admin_user() function error: %', SQLERRM;
END $$;

-- 9. CHECK ALL TABLES RLS STATUS
SELECT
    '📊 ALL TABLES RLS' as section,
    tablename,
    CASE
        WHEN rowsecurity THEN '🔒 ENABLED'
        ELSE '🔓 DISABLED'
    END as rls_status,
    (SELECT COUNT(*) FROM pg_policies WHERE pg_policies.tablename = pg_tables.tablename) as policy_count
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;

-- 10. CHECK AUTH SCHEMA (session info)
SELECT
    '👤 AUTH USERS' as section,
    id,
    email,
    created_at,
    last_sign_in_at,
    email_confirmed_at
FROM auth.users
WHERE email = 'jtheoden@googlemail.com';

-- 11. QUERY PERFORMANCE TEST
EXPLAIN ANALYZE
SELECT
    role,
    is_enabled,
    avatar_url,
    full_name,
    email
FROM user_profiles
WHERE id = (SELECT id FROM auth.users WHERE email = 'jtheoden@googlemail.com' LIMIT 1)
LIMIT 1;

-- ============================================================================
-- SUMMARY
-- ============================================================================
SELECT '================================' as divider
UNION ALL SELECT '📋 DIAGNOSTIC COMPLETE' as divider
UNION ALL SELECT '================================' as divider
UNION ALL SELECT '' as divider
UNION ALL SELECT '✅ Check results above for issues' as divider
UNION ALL SELECT '' as divider
UNION ALL SELECT '⚠️ Common Issues:' as divider
UNION ALL SELECT '  - No user profile = need to create one' as divider
UNION ALL SELECT '  - RLS enabled + no policies = queries timeout' as divider
UNION ALL SELECT '  - Missing storage buckets = upload fails' as divider
UNION ALL SELECT '  - Missing indexes = slow queries' as divider;
