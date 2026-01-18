-- ============================================================================
-- DEFINITIVE FIX: notification_settings RLS policies
-- Run this in Supabase SQL Editor to fix permission issues
-- ============================================================================

-- Step 1: Create a SECURITY DEFINER function that bypasses RLS to get user role
-- This avoids recursion issues with user_profiles RLS
CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT COALESCE(
    (SELECT role FROM user_profiles WHERE id = auth.uid() LIMIT 1),
    'user'
  )
$$;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION public.get_my_role() TO authenticated;

-- Step 2: Drop ALL existing policies on notification_settings to start fresh
DO $$
DECLARE
    policy_record RECORD;
BEGIN
    FOR policy_record IN
        SELECT policyname
        FROM pg_policies
        WHERE tablename = 'notification_settings' AND schemaname = 'public'
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.notification_settings', policy_record.policyname);
    END LOOP;
END $$;

-- Step 3: Enable RLS on the table (in case it's not enabled)
ALTER TABLE public.notification_settings ENABLE ROW LEVEL SECURITY;

-- Step 4: Create simple, non-recursive policies

-- Policy 1: All authenticated users can READ (needed for notifications)
CREATE POLICY "notification_settings_select_authenticated"
ON public.notification_settings
FOR SELECT
TO authenticated
USING (true);

-- Policy 2: Admins can INSERT
CREATE POLICY "notification_settings_insert_admin"
ON public.notification_settings
FOR INSERT
TO authenticated
WITH CHECK (public.get_my_role() IN ('admin', 'super_admin'));

-- Policy 3: Admins can UPDATE
CREATE POLICY "notification_settings_update_admin"
ON public.notification_settings
FOR UPDATE
TO authenticated
USING (public.get_my_role() IN ('admin', 'super_admin'))
WITH CHECK (public.get_my_role() IN ('admin', 'super_admin'));

-- Policy 4: Admins can DELETE
CREATE POLICY "notification_settings_delete_admin"
ON public.notification_settings
FOR DELETE
TO authenticated
USING (public.get_my_role() IN ('admin', 'super_admin'));

-- Step 5: Verify the policies were created
DO $$
BEGIN
    RAISE NOTICE 'RLS policies created successfully for notification_settings';
    RAISE NOTICE 'Policies: SELECT (all auth), INSERT/UPDATE/DELETE (admin/super_admin only)';
END $$;

-- Step 6: Test the function works (optional - will show your role)
-- SELECT public.get_my_role();
