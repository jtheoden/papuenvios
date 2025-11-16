-- ============================================================================
-- EMERGENCY FIX: Restore user_profiles RLS Policies
-- ============================================================================
-- PROBLEM: Removing ALL RLS policies from user_profiles table caused HTTP 406
--          errors ("The result contains 0 rows") because NO read access was allowed
-- SOLUTION: Restore BASIC non-recursive RLS policies that allow:
--           1. Users to read their OWN profile
--           2. Users to insert/update their OWN profile
--           This avoids the is_admin_user() recursion loop
-- ============================================================================

-- STEP 1: Enable RLS on user_profiles (should already be enabled)
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

SELECT '✅ STEP 1: RLS enabled on user_profiles' as status;

-- STEP 2: Drop any existing policies (clean slate)
DROP POLICY IF EXISTS "user_profiles_select_own" ON public.user_profiles;
DROP POLICY IF EXISTS "user_profiles_insert_own" ON public.user_profiles;
DROP POLICY IF EXISTS "user_profiles_update_own" ON public.user_profiles;

-- Drop old problematic policies if they still exist
DROP POLICY IF EXISTS "user_profiles select" ON public.user_profiles;
DROP POLICY IF EXISTS "user_profiles insert" ON public.user_profiles;
DROP POLICY IF EXISTS "user_profiles update" ON public.user_profiles;

SELECT '✅ STEP 2: Dropped old RLS policies' as status;

-- STEP 3: Create SIMPLE non-recursive SELECT policy
-- Allows authenticated users to read ONLY their own profile
CREATE POLICY "user_profiles_select_own"
ON public.user_profiles
FOR SELECT
TO authenticated
USING (id = auth.uid());

SELECT '✅ STEP 3: Created user_profiles_select_own policy' as status;

-- STEP 4: Create SIMPLE non-recursive INSERT policy
-- Allows authenticated users to insert ONLY their own profile
CREATE POLICY "user_profiles_insert_own"
ON public.user_profiles
FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

SELECT '✅ STEP 4: Created user_profiles_insert_own policy' as status;

-- STEP 5: Create SIMPLE non-recursive UPDATE policy
-- Allows authenticated users to update ONLY their own profile
CREATE POLICY "user_profiles_update_own"
ON public.user_profiles
FOR UPDATE
TO authenticated
USING (id = auth.uid())
WITH CHECK (user_id = auth.uid());

SELECT '✅ STEP 5: Created user_profiles_update_own policy' as status;

-- STEP 6: Verify the new policies are in place
SELECT
    'VERIFICATION: New RLS Policies on user_profiles' as status,
    policyname,
    cmd as operation,
    qual as condition
FROM pg_policies
WHERE schemaname = 'public'
AND tablename = 'user_profiles'
ORDER BY policyname;

-- STEP 7: Record this fix
INSERT INTO public._migrations_applied (migration)
VALUES ('20251116_emergency_restore_user_profiles_rls')
ON CONFLICT (migration) DO NOTHING;

SELECT '✅ STEP 7: Recorded migration in _migrations_applied' as status;

SELECT '🎯 SUCCESS: user_profiles RLS policies restored!
UserManagement should now work, and HTTP 406 errors should be resolved.
You may need to hard refresh your browser (Ctrl+F5 or Cmd+Shift+R).' as final_status;
