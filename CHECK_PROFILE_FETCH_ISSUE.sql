-- ============================================================================
-- DIAGNOSE PROFILE FETCH TIMEOUT ISSUE
-- ============================================================================
-- Run this to understand why profile fetch is timing out
-- ============================================================================

-- 1. Check if your user profile exists
SELECT
    '👤 YOUR USER PROFILE' as section,
    id,
    user_id,
    email,
    role,
    is_enabled,
    created_at
FROM user_profiles
WHERE email = 'jtheoden@googlemail.com';

-- 2. Check auth.users entry
SELECT
    '🔑 AUTH USER' as section,
    id,
    email,
    created_at,
    last_sign_in_at,
    email_confirmed_at
FROM auth.users
WHERE email = 'jtheoden@googlemail.com';

-- 3. Test the exact query the app uses
EXPLAIN ANALYZE
SELECT
    role,
    is_enabled,
    avatar_url,
    full_name,
    email
FROM user_profiles
WHERE id = (SELECT id FROM auth.users WHERE email = 'jtheoden@googlemail.com' LIMIT 1);

-- 4. Check RLS policies on user_profiles
SELECT
    '🔒 RLS POLICIES' as section,
    policyname,
    cmd,
    permissive,
    roles
FROM pg_policies
WHERE schemaname = 'public'
AND tablename = 'user_profiles';

-- 5. Check if is_admin_user() function works
DO $$
BEGIN
    IF EXISTS (SELECT FROM information_schema.routines WHERE routine_name = 'is_admin_user') THEN
        -- Try to call it
        PERFORM is_admin_user();
        RAISE NOTICE '✅ is_admin_user() function works';
    ELSE
        RAISE NOTICE '⚠️ is_admin_user() function does NOT exist';
    END IF;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '❌ is_admin_user() ERROR: %', SQLERRM;
END $$;

-- 6. Check for indexes on user_profiles
SELECT
    '📊 INDEXES' as section,
    indexname,
    indexdef
FROM pg_indexes
WHERE schemaname = 'public'
AND tablename = 'user_profiles';

-- 7. Test query speed without RLS
SET LOCAL row_security = off;
EXPLAIN ANALYZE
SELECT * FROM user_profiles WHERE email = 'jtheoden@googlemail.com';

-- Summary
SELECT '================================' as result
UNION ALL SELECT '📋 DIAGNOSIS COMPLETE' as result
UNION ALL SELECT '================================' as result
UNION ALL SELECT '' as result
UNION ALL SELECT 'If query times are > 100ms, there is a performance issue' as result
UNION ALL SELECT 'If profile is NULL, user needs to be created' as result
UNION ALL SELECT 'If is_admin_user() fails, RLS policies will timeout' as result;
