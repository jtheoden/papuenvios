-- ============================================================================
-- SECURE FIX: Testimonials RLS - Use RPC Function for Author Profiles
-- ============================================================================
-- PROBLEM: testimonialService.js tries to fetch user_profiles directly
--          This was blocked by RLS, so a dangerous policy (USING true) was added
-- SOLUTION: Use RPC function with SECURITY DEFINER instead of direct table access
-- ============================================================================

-- STEP 1: Create secure RPC function to fetch testimonial author profiles
-- This function uses SECURITY DEFINER to run with creator's permissions
-- SECURITY CONSTRAINT: ONLY exposes 3 fields for display purposes
--   ✅ user_id: Internal reference only
--   ✅ full_name: Public display name only
--   ✅ avatar_url: Public profile picture only
-- PROTECTED (never exposed): email, phone, address, city, birth_date, preferences, etc.
CREATE OR REPLACE FUNCTION public.get_testimonial_author_profiles(p_user_ids UUID[])
RETURNS TABLE (
  user_id UUID,
  full_name TEXT,
  avatar_url TEXT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  -- SECURITY: Only SELECT the 3 safe fields - no other data is exposed
  SELECT
    up.user_id,
    up.full_name,
    up.avatar_url
  FROM public.user_profiles up
  WHERE up.user_id = ANY(p_user_ids);
$$;

SELECT '✅ STEP 1: Created secure RPC function get_testimonial_author_profiles' as status;

-- STEP 2: Grant execute permission to authenticated users
-- This allows the RPC to be called from the client
GRANT EXECUTE ON FUNCTION public.get_testimonial_author_profiles(UUID[])
  TO authenticated, anon;

SELECT '✅ STEP 2: Granted execute permission to authenticated and anonymous users' as status;

-- STEP 3: Remove dangerous policy that exposes all user data
-- anyone_can_read_user_display_profiles with USING (true) allows reading everything
DROP POLICY IF EXISTS "anyone_can_read_user_display_profiles" ON public.user_profiles;

SELECT '✅ STEP 3: Removed dangerous "anyone_can_read_user_display_profiles" policy' as status;

-- STEP 4: Keep only essential RLS policies on user_profiles
-- These already exist and are secure:
-- - user_profiles_select_own: users read their own profile
-- - admins_can_view_all_profiles: admins see all profiles
-- - user_profiles_insert_own: users create own profile
-- - user_profiles_update_own: users update own profile

-- STEP 5: Clean up redundant testimonial policies
-- Keep only: testimonials_select_public, testimonials_insert, testimonials_update
DROP POLICY IF EXISTS "anyone_can_view_visible_testimonials" ON public.testimonials;
DROP POLICY IF EXISTS "users_can_view_own_testimonials" ON public.testimonials;
DROP POLICY IF EXISTS "users_can_insert_testimonials" ON public.testimonials;
DROP POLICY IF EXISTS "users_can_update_own_testimonials" ON public.testimonials;

SELECT '✅ STEP 4: Removed redundant testimonial policies' as status;

-- STEP 6: Verify current user_profiles policies
SELECT
    '📋 CURRENT user_profiles RLS POLICIES' as verification_header,
    policyname,
    cmd as operation
FROM pg_policies
WHERE schemaname = 'public'
AND tablename = 'user_profiles'
ORDER BY policyname;

-- STEP 7: Verify current testimonials policies
SELECT
    '📋 CURRENT testimonials RLS POLICIES' as verification_header,
    policyname,
    cmd as operation
FROM pg_policies
WHERE schemaname = 'public'
AND tablename = 'testimonials'
ORDER BY policyname;

-- STEP 8: Record this fix
INSERT INTO public._migrations_applied (migration)
VALUES ('20251116_secure_testimonials_rls_with_rpc')
ON CONFLICT (migration) DO NOTHING;

SELECT '✅ STEP 8: Recorded migration' as status;

SELECT '🎯 SUCCESS: Testimonials now use secure RPC function!
Next: Update testimonialService.js to call get_testimonial_author_profiles() instead of direct query' as final_status;
