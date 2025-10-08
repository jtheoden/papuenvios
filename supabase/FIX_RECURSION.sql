-- ============================================================================
-- EMERGENCY FIX: Infinite Recursion in RLS Policies
-- ============================================================================
-- This will completely disable and rebuild RLS policies correctly
-- ============================================================================

BEGIN;

-- ============================================================================
-- STEP 1: Temporarily disable RLS to check if that's the issue
-- ============================================================================
ALTER TABLE public.user_profiles DISABLE ROW LEVEL SECURITY;

-- ============================================================================
-- STEP 2: Drop ALL existing policies (clean slate)
-- ============================================================================
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN (SELECT policyname FROM pg_policies WHERE tablename = 'user_profiles' AND schemaname = 'public')
    LOOP
        EXECUTE 'DROP POLICY IF EXISTS ' || quote_ident(r.policyname) || ' ON public.user_profiles';
        RAISE NOTICE 'Dropped policy: %', r.policyname;
    END LOOP;
END $$;

-- ============================================================================
-- STEP 3: Recreate helper function with better isolation
-- ============================================================================
CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS text AS $$
DECLARE
    user_role text;
BEGIN
    -- Direct query bypassing RLS using SECURITY DEFINER
    -- This function runs with elevated privileges
    SELECT role INTO user_role
    FROM public.user_profiles
    WHERE id = auth.uid()
    LIMIT 1;

    RETURN COALESCE(user_role, 'user');
EXCEPTION
    WHEN OTHERS THEN
        -- If anything fails, return safe default
        RETURN 'user';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE
SET search_path = public, pg_temp;

-- Grant execute
GRANT EXECUTE ON FUNCTION public.current_user_role() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_user_role() TO anon;

-- ============================================================================
-- STEP 4: Create SIMPLE policies that won't recurse
-- ============================================================================

-- Enable RLS
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

-- Policy 1: Users can SELECT their own profile (NO SUBQUERY)
CREATE POLICY "user_profiles_select_own"
ON public.user_profiles
AS PERMISSIVE
FOR SELECT
TO authenticated
USING (auth.uid() = id);

-- Policy 2: Admins can SELECT all profiles (uses function)
CREATE POLICY "user_profiles_select_admin"
ON public.user_profiles
AS PERMISSIVE
FOR SELECT
TO authenticated
USING (
    public.current_user_role() = 'admin' OR
    public.current_user_role() = 'super_admin'
);

-- Policy 3: Users can UPDATE their own profile
CREATE POLICY "user_profiles_update_own"
ON public.user_profiles
AS PERMISSIVE
FOR UPDATE
TO authenticated
USING (auth.uid() = id)
WITH CHECK (auth.uid() = id);

-- Policy 4: Super admins can UPDATE any profile
CREATE POLICY "user_profiles_update_admin"
ON public.user_profiles
AS PERMISSIVE
FOR UPDATE
TO authenticated
USING (public.current_user_role() = 'super_admin')
WITH CHECK (public.current_user_role() = 'super_admin');

-- Policy 5: INSERT via trigger (system inserts)
CREATE POLICY "user_profiles_insert_trigger"
ON public.user_profiles
AS PERMISSIVE
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = id);

-- ============================================================================
-- STEP 5: Verify policies were created
-- ============================================================================
SELECT
    schemaname,
    tablename,
    policyname,
    permissive,
    roles,
    cmd
FROM pg_policies
WHERE tablename = 'user_profiles'
AND schemaname = 'public'
ORDER BY policyname;

COMMIT;

-- ============================================================================
-- TEST QUERIES (Run these separately AFTER commit)
-- ============================================================================
-- Test 1: Check if you can read your own profile
-- SELECT * FROM public.user_profiles WHERE id = auth.uid();

-- Test 2: Check current role function
-- SELECT public.current_user_role();

-- Test 3: Try to read all profiles (should work if you're admin/super_admin)
-- SELECT id, email, role FROM public.user_profiles LIMIT 5;
