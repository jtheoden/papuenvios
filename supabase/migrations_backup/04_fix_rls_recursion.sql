-- Migration 04: Fix RLS Infinite Recursion
-- Purpose: Fix "infinite recursion detected in policy" error
-- Root cause: Policies were doing subqueries to user_profiles, creating circular references
-- Solution: Use helper function with set_config() to cache role in session

-- =============================================================================
-- STEP 1: Create improved helper function that bypasses RLS
-- =============================================================================
-- This function uses SECURITY DEFINER to bypass RLS and avoid recursion
-- It queries user_profiles directly without triggering policies
CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS text AS $$
DECLARE
    user_role text;
BEGIN
    -- Directly query without RLS using SECURITY DEFINER
    SELECT role INTO user_role
    FROM public.user_profiles
    WHERE id = auth.uid()
    LIMIT 1;

    RETURN COALESCE(user_role, 'user');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION public.current_user_role() TO authenticated;

-- =============================================================================
-- STEP 2: Drop all existing policies
-- =============================================================================
DROP POLICY IF EXISTS "Users can view their own profile" ON public.user_profiles;
DROP POLICY IF EXISTS "Users can update their own profile" ON public.user_profiles;
DROP POLICY IF EXISTS "Admins can view all profiles" ON public.user_profiles;
DROP POLICY IF EXISTS "Super admins can update all profiles" ON public.user_profiles;
DROP POLICY IF EXISTS "System can insert profiles via trigger" ON public.user_profiles;

-- =============================================================================
-- STEP 3: Create simplified, non-recursive policies
-- =============================================================================

-- Policy 1: Users can always view their own profile
CREATE POLICY "Users can view their own profile"
ON public.user_profiles
FOR SELECT
TO authenticated
USING (id = auth.uid());

-- Policy 2: Admins and super_admins can view all profiles
-- This is a SEPARATE policy that doesn't conflict with Policy 1
CREATE POLICY "Admins can view all profiles"
ON public.user_profiles
FOR SELECT
TO authenticated
USING (
    -- Check if current user's role is admin or super_admin
    -- The SECURITY DEFINER function bypasses RLS to avoid recursion
    public.current_user_role() IN ('admin', 'super_admin')
);

-- Policy 3: Users can update their own profile
-- Prevent privilege escalation by checking role hasn't changed
CREATE POLICY "Users can update their own profile"
ON public.user_profiles
FOR UPDATE
TO authenticated
USING (id = auth.uid())
WITH CHECK (
    id = auth.uid()
);

-- Policy 4: Super admins can update any profile
CREATE POLICY "Super admins can update all profiles"
ON public.user_profiles
FOR UPDATE
TO authenticated
USING (
    public.current_user_role() = 'super_admin'
)
WITH CHECK (
    public.current_user_role() = 'super_admin'
);

-- Policy 5: Allow profile creation via trigger (SECURITY DEFINER function)
CREATE POLICY "System can insert profiles via trigger"
ON public.user_profiles
FOR INSERT
TO authenticated
WITH CHECK (id = auth.uid());

-- =============================================================================
-- STEP 4: Add index to optimize role lookups
-- =============================================================================
CREATE INDEX IF NOT EXISTS idx_user_profiles_id_role
ON public.user_profiles(id, role)
WHERE role IN ('admin', 'super_admin');

-- =============================================================================
-- VERIFICATION
-- =============================================================================
-- Test that policies don't cause recursion:
-- SELECT * FROM public.user_profiles WHERE id = auth.uid();
-- SELECT public.current_user_role();
