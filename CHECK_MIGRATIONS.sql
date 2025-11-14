-- ============================================================================
-- MIGRATION STATUS CHECKER
-- ============================================================================
-- Copy and paste this ENTIRE script into Supabase SQL Editor
-- It will show you exactly what's been applied and what's pending
-- ============================================================================

-- Step 1: Check if tracking table exists
DO $$
BEGIN
    RAISE NOTICE '================================';
    RAISE NOTICE 'MIGRATION STATUS REPORT';
    RAISE NOTICE '================================';
    RAISE NOTICE '';

    IF EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_name = '_migrations_applied'
    ) THEN
        RAISE NOTICE '✅ Migration tracking table exists';
    ELSE
        RAISE NOTICE '⚠️  Migration tracking table does NOT exist';
        RAISE NOTICE '   This means no migrations have been tracked yet';
    END IF;
    RAISE NOTICE '';
END $$;

-- Step 2: Show applied migrations (if any)
DO $$
DECLARE
    migration_count INTEGER;
BEGIN
    IF EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_name = '_migrations_applied'
    ) THEN
        SELECT COUNT(*) INTO migration_count FROM _migrations_applied;

        RAISE NOTICE '📊 APPLIED MIGRATIONS: % total', migration_count;
        RAISE NOTICE '--------------------------------';

        IF migration_count > 0 THEN
            -- This will be shown in the query results below
            RAISE NOTICE 'See query results for list of applied migrations';
        ELSE
            RAISE NOTICE 'No migrations applied yet';
        END IF;
    END IF;
    RAISE NOTICE '';
END $$;

-- Step 3: Show applied migrations in results
SELECT
    migration_name,
    applied_at,
    CASE
        WHEN applied_at > NOW() - INTERVAL '1 day' THEN '🆕 New (< 24h)'
        WHEN applied_at > NOW() - INTERVAL '7 days' THEN '📅 Recent (< 7d)'
        ELSE '📆 Older'
    END as age
FROM _migrations_applied
ORDER BY applied_at DESC;

-- Step 4: Check critical tables
DO $$
DECLARE
    table_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO table_count
    FROM information_schema.tables
    WHERE table_schema = 'public'
    AND table_type = 'BASE TABLE';

    RAISE NOTICE '📋 TABLES IN DATABASE: %', table_count;
    RAISE NOTICE '--------------------------------';
    RAISE NOTICE '';
END $$;

-- Step 5: Check specific important tables
SELECT
    table_name,
    CASE WHEN EXISTS (
        SELECT FROM pg_tables
        WHERE schemaname = 'public'
        AND tablename = t.table_name
        AND rowsecurity = true
    ) THEN '✅ RLS Enabled' ELSE '❌ RLS Disabled' END as rls_status
FROM (
    VALUES
        ('user_profiles'),
        ('products'),
        ('orders'),
        ('remittances'),
        ('remittance_types'),
        ('bank_accounts'),
        ('user_categories'),
        ('zelle_accounts')
) AS t(table_name)
WHERE EXISTS (
    SELECT FROM information_schema.tables
    WHERE table_schema = 'public'
    AND information_schema.tables.table_name = t.table_name
)
ORDER BY table_name;

-- Step 6: Check storage buckets
DO $$
DECLARE
    bucket_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO bucket_count FROM storage.buckets;

    RAISE NOTICE '🪣 STORAGE BUCKETS: %', bucket_count;
    RAISE NOTICE '--------------------------------';

    IF bucket_count = 0 THEN
        RAISE NOTICE '⚠️  No storage buckets found';
        RAISE NOTICE '   You need to create:';
        RAISE NOTICE '   - remittance-proofs';
        RAISE NOTICE '   - order-delivery-proofs';
        RAISE NOTICE '   - remittance-delivery-proofs';
    ELSE
        RAISE NOTICE 'See query results for bucket list';
    END IF;
    RAISE NOTICE '';
END $$;

-- Show buckets
SELECT
    name as bucket_name,
    CASE WHEN public THEN '🌐 Public' ELSE '🔒 Private' END as visibility,
    created_at
FROM storage.buckets
ORDER BY name;

-- Step 7: Check RLS policies count
DO $$
DECLARE
    policy_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO policy_count
    FROM pg_policies
    WHERE schemaname = 'public';

    RAISE NOTICE '🛡️  RLS POLICIES: %', policy_count;
    RAISE NOTICE '--------------------------------';

    IF policy_count < 20 THEN
        RAISE NOTICE '⚠️  Low policy count - you may need to apply RLS fixes';
        RAISE NOTICE '   Run: supabase/FIX_403_MANUAL.sql';
    ELSE
        RAISE NOTICE '✅ Good policy coverage';
    END IF;
    RAISE NOTICE '';
END $$;

-- Step 8: Check your user role
DO $$
BEGIN
    RAISE NOTICE '👤 YOUR USER INFORMATION:';
    RAISE NOTICE '--------------------------------';
    RAISE NOTICE 'Check query results below for your user details';
    RAISE NOTICE '';
END $$;

-- Show current user
SELECT
    email,
    role,
    is_enabled,
    created_at,
    CASE
        WHEN role = 'super_admin' THEN '👑 Super Admin'
        WHEN role = 'admin' THEN '🔑 Admin'
        WHEN role = 'manager' THEN '📊 Manager'
        ELSE '👤 User'
    END as role_display
FROM user_profiles
WHERE user_id = auth.uid();

-- Final Summary
DO $$
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '================================';
    RAISE NOTICE 'SUMMARY & NEXT STEPS';
    RAISE NOTICE '================================';
    RAISE NOTICE '';
    RAISE NOTICE '📖 Check the query results above for details';
    RAISE NOTICE '';
    RAISE NOTICE '✅ If you see many tables and policies: System is mostly set up';
    RAISE NOTICE '⚠️  If you see few tables: Run migrations from RUN_MIGRATIONS_NOW.md';
    RAISE NOTICE '⚠️  If your role is not admin: Run FIX_403_MANUAL.sql with your email';
    RAISE NOTICE '⚠️  If no storage buckets: Create them manually in Supabase Dashboard';
    RAISE NOTICE '';
    RAISE NOTICE '📚 See RUN_MIGRATIONS_NOW.md for complete instructions';
    RAISE NOTICE '';
    RAISE NOTICE '================================';
END $$;
