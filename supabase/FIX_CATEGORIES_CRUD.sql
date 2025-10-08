-- =============================================================================
-- DIAGNOSE AND FIX PRODUCT_CATEGORIES CRUD
-- =============================================================================
-- Run this script to check current policies and fix CRUD issues
-- =============================================================================

-- STEP 1: Check current policies on product_categories
SELECT
    'CURRENT POLICIES:' as info,
    policyname,
    roles::text[],
    cmd,
    qual,
    with_check
FROM pg_policies
WHERE schemaname = 'public'
AND tablename = 'product_categories'
ORDER BY policyname;

-- STEP 2: Check if RLS is enabled
SELECT
    'RLS STATUS:' as info,
    tablename,
    rowsecurity as rls_enabled
FROM pg_tables
WHERE schemaname = 'public'
AND tablename = 'product_categories';

-- STEP 3: Check table permissions
SELECT
    'TABLE PERMISSIONS:' as info,
    grantee,
    privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
AND table_name = 'product_categories';

-- =============================================================================
-- FIX: Drop all existing policies and recreate properly
-- =============================================================================

-- Enable RLS (safe if already enabled)
ALTER TABLE public.product_categories ENABLE ROW LEVEL SECURITY;

-- Drop ALL existing policies to start fresh
DROP POLICY IF EXISTS "Categories viewable by everyone" ON public.product_categories;
DROP POLICY IF EXISTS "Categories viewable by all" ON public.product_categories;
DROP POLICY IF EXISTS "Categories manageable by admins" ON public.product_categories;
DROP POLICY IF EXISTS "product_categories_read_policy" ON public.product_categories;
DROP POLICY IF EXISTS "product_categories_write_policy" ON public.product_categories;

-- Policy 1: Allow anonymous and authenticated users to READ active categories
CREATE POLICY "Categories viewable by everyone"
ON public.product_categories FOR SELECT
TO anon, authenticated
USING (is_active = true);

-- Policy 2: Allow admins to SELECT all categories (even inactive)
CREATE POLICY "Admins can view all categories"
ON public.product_categories FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.user_profiles
        WHERE user_profiles.user_id = auth.uid()
        AND user_profiles.role IN ('admin', 'super_admin')
    )
);

-- Policy 3: Allow admins to INSERT categories
CREATE POLICY "Admins can insert categories"
ON public.product_categories FOR INSERT
TO authenticated
WITH CHECK (
    EXISTS (
        SELECT 1 FROM public.user_profiles
        WHERE user_profiles.user_id = auth.uid()
        AND user_profiles.role IN ('admin', 'super_admin')
    )
);

-- Policy 4: Allow admins to UPDATE categories
CREATE POLICY "Admins can update categories"
ON public.product_categories FOR UPDATE
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.user_profiles
        WHERE user_profiles.user_id = auth.uid()
        AND user_profiles.role IN ('admin', 'super_admin')
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1 FROM public.user_profiles
        WHERE user_profiles.user_id = auth.uid()
        AND user_profiles.role IN ('admin', 'super_admin')
    )
);

-- Policy 5: Allow admins to DELETE categories
CREATE POLICY "Admins can delete categories"
ON public.product_categories FOR DELETE
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.user_profiles
        WHERE user_profiles.user_id = auth.uid()
        AND user_profiles.role IN ('admin', 'super_admin')
    )
);

-- =============================================================================
-- GRANT TABLE PERMISSIONS
-- =============================================================================

-- Grant SELECT to everyone
GRANT SELECT ON public.product_categories TO anon, authenticated;

-- Grant INSERT, UPDATE, DELETE to authenticated users
-- (RLS policies will restrict to admins only)
GRANT INSERT, UPDATE, DELETE ON public.product_categories TO authenticated;

-- =============================================================================
-- VERIFICATION: Check that policies were created
-- =============================================================================
SELECT
    'VERIFICATION - NEW POLICIES:' as info,
    policyname,
    roles::text[],
    cmd
FROM pg_policies
WHERE schemaname = 'public'
AND tablename = 'product_categories'
ORDER BY policyname;

-- =============================================================================
-- TEST: Check if current user can perform operations
-- =============================================================================
-- Run this as an admin user to test:
-- SELECT
--     'TEST - USER ROLE:' as info,
--     role
-- FROM public.user_profiles
-- WHERE user_id = auth.uid();

SELECT 'FIX APPLIED SUCCESSFULLY!' as result;
