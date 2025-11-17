-- ============================================================================
-- FIX: Restore Admin Update Permissions for User Profiles
-- ============================================================================
-- PROBLEM: Emergency RLS fix removed "admins can update any profile" policy
--          This policy is REQUIRED for UserManagement component to work
--          Admin/super_admin cannot update other users' is_enabled or role
-- SOLUTION: Restore the proper UPDATE policy with admin/super_admin checks
-- ============================================================================

-- STEP 1: Drop the overly restrictive emergency policy
DROP POLICY IF EXISTS "user_profiles_update_own" ON public.user_profiles;

SELECT '✅ STEP 1: Dropped overly restrictive "user_profiles_update_own" policy' as status;

-- STEP 2: Create proper UPDATE policy for regular users (own profile only)
CREATE POLICY "users_can_update_own_profile"
ON public.user_profiles
FOR UPDATE
TO authenticated
USING (id = auth.uid())
WITH CHECK (id = auth.uid());

SELECT '✅ STEP 2: Created "users_can_update_own_profile" (users can only update themselves)' as status;

-- STEP 3: Create UPDATE policy for admins (can update any profile)
-- Note: Uses is_admin() and is_super_admin() helper functions
CREATE POLICY "admins_can_update_any_profile"
ON public.user_profiles
FOR UPDATE
TO authenticated
USING (is_admin() OR is_super_admin())
WITH CHECK (is_admin() OR is_super_admin());

SELECT '✅ STEP 3: Created "admins_can_update_any_profile" (admins can update all users)' as status;

-- STEP 4: Verify the current UPDATE policies
SELECT
    '📋 CURRENT UPDATE POLICIES on user_profiles' as verification_header,
    policyname,
    cmd as operation
FROM pg_policies
WHERE schemaname = 'public'
AND tablename = 'user_profiles'
AND cmd = 'UPDATE'
ORDER BY policyname;

SELECT '✅ STEP 4: Verified UPDATE policies' as status;

-- STEP 5: Record this fix
INSERT INTO public._migrations_applied (migration)
VALUES ('20251116_fix_user_profile_update_permissions')
ON CONFLICT (migration) DO NOTHING;

SELECT '✅ STEP 5: Recorded migration' as status;

SELECT '🎯 CRITICAL FIX COMPLETE: Admin update permissions restored!
UserManagement component can now update user roles and is_enabled status.' as final_status;
