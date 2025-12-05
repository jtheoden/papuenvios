-- ============================================================================
-- EMERGENCY: Fix Infinite Recursion in user_profiles RLS Policy
-- ============================================================================
-- ERROR: 42P17 - infinite recursion detected in policy for relation "user_profiles"
-- CAUSE: admins_can_view_all_profiles policy uses subquery to user_profiles
--        This creates recursion: RLS policy -> SELECT user_profiles -> RLS check -> ...
-- SOLUTION: Use is_admin_user() function instead (non-recursive implementation)
-- ============================================================================

-- STEP 1: DROP the dangerous recursive policy
DROP POLICY IF EXISTS "admins_can_view_all_profiles" ON public.user_profiles;

SELECT '✅ STEP 1: Dropped recursive policy "admins_can_view_all_profiles"' as status;

-- STEP 2: Create safe policy using is_admin_user() function (no recursion)
-- is_admin_user() already exists in your DB and doesn't cause recursion
CREATE POLICY "admins_select_all_profiles"
ON public.user_profiles
FOR SELECT
TO authenticated
USING (
  -- Use existing is_admin_user() function - it's non-recursive
  is_admin_user() OR id = auth.uid()
);

SELECT '✅ STEP 2: Created safe policy using is_admin_user() function' as status;

-- STEP 3: Verify final state of user_profiles policies
SELECT
    'VERIFICATION: Final RLS Policies on user_profiles' as status,
    policyname,
    cmd as operation
FROM pg_policies
WHERE schemaname = 'public'
AND tablename = 'user_profiles'
ORDER BY policyname;

SELECT '✅ STEP 3: Verified policies' as status;

-- STEP 4: Record this critical fix
INSERT INTO public._migrations_applied (migration)
VALUES ('20251116_fix_recursive_rls_policy')
ON CONFLICT (migration) DO NOTHING;

SELECT '✅ STEP 4: Recorded migration' as status;

SELECT '🎯 CRITICAL FIX COMPLETE: Recursive RLS policy removed!
Hard refresh browser (Ctrl+F5) to clear errors and load the application.' as final_status;
