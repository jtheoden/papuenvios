-- ============================================================================
-- ADD MANAGER ROLE TO USER PROFILES
-- Created: 2025-11-12
-- Purpose: Add 'manager' role to user_profiles and update RLS policies
-- ============================================================================

-- ============================================================================
-- STEP 1: Update user_profiles role check constraint
-- ============================================================================

-- Drop existing constraint if it exists
ALTER TABLE public.user_profiles
DROP CONSTRAINT IF EXISTS user_profiles_role_check;

-- Add new constraint that includes 'manager' role
ALTER TABLE public.user_profiles
ADD CONSTRAINT user_profiles_role_check
CHECK (role IN ('user', 'admin', 'super_admin', 'manager'));

-- ============================================================================
-- STEP 2: Update is_manager() function to work with new role
-- ============================================================================

-- The is_manager() function was already created in the RLS optimization migration
-- No additional changes needed here, it already checks for 'manager' role

-- ============================================================================
-- STEP 3: Create Manager Assignment Audit Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.manager_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  manager_id uuid NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  assigned_by uuid NOT NULL REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
  scope text DEFAULT 'all', -- 'all', 'remittances', 'orders', etc.
  assigned_at timestamp with time zone DEFAULT now(),
  removed_at timestamp with time zone,
  reason text,

  -- Metadata
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

-- Add comment
COMMENT ON TABLE public.manager_assignments IS
'Tracks manager role assignments and their scope. Managers can only be assigned by super_admin.';

-- Indexes for performance
CREATE INDEX idx_manager_assignments_manager_id
  ON public.manager_assignments(manager_id)
  WHERE removed_at IS NULL;

CREATE INDEX idx_manager_assignments_assigned_by
  ON public.manager_assignments(assigned_by);

CREATE INDEX idx_manager_assignments_scope
  ON public.manager_assignments(scope)
  WHERE removed_at IS NULL;

-- ============================================================================
-- STEP 4: Enable RLS on manager_assignments
-- ============================================================================

ALTER TABLE public.manager_assignments ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- STEP 5: Add RLS Policies for manager_assignments
-- ============================================================================

-- Managers can view their own assignment info
CREATE POLICY "managers can view own assignment"
ON public.manager_assignments
FOR SELECT
TO authenticated
USING (manager_id = auth.uid());

-- Super admins can view all assignments
CREATE POLICY "super admins can view all assignments"
ON public.manager_assignments
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = auth.uid()
    AND role = 'super_admin'
  )
);

-- Super admins can create assignments
CREATE POLICY "super admins can create assignments"
ON public.manager_assignments
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = auth.uid()
    AND role = 'super_admin'
  )
);

-- Super admins can update assignments
CREATE POLICY "super admins can update assignments"
ON public.manager_assignments
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = auth.uid()
    AND role = 'super_admin'
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = auth.uid()
    AND role = 'super_admin'
  )
);

-- Super admins can delete assignments
CREATE POLICY "super admins can delete assignments"
ON public.manager_assignments
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = auth.uid()
    AND role = 'super_admin'
  )
);

-- ============================================================================
-- STEP 6: Create function to assign manager role
-- ============================================================================

CREATE OR REPLACE FUNCTION public.assign_manager_role(
  p_manager_id uuid,
  p_scope text DEFAULT 'all',
  p_reason text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_result json;
BEGIN
  -- Check if current user is super_admin
  IF NOT EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = v_user_id AND role = 'super_admin'
  ) THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Only super_admin can assign manager role'
    );
  END IF;

  -- Update user_profiles to set role to manager
  UPDATE public.user_profiles
  SET role = 'manager'
  WHERE id = p_manager_id;

  -- Create assignment record
  INSERT INTO public.manager_assignments (
    manager_id,
    assigned_by,
    scope,
    reason
  )
  VALUES (p_manager_id, v_user_id, p_scope, p_reason);

  RETURN json_build_object(
    'success', true,
    'message', 'Manager role assigned successfully',
    'manager_id', p_manager_id
  );
END;
$$;

-- ============================================================================
-- STEP 7: Create function to remove manager role
-- ============================================================================

CREATE OR REPLACE FUNCTION public.remove_manager_role(p_manager_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  -- Check if current user is super_admin
  IF NOT EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = v_user_id AND role = 'super_admin'
  ) THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Only super_admin can remove manager role'
    );
  END IF;

  -- Update user_profiles to set role back to user
  UPDATE public.user_profiles
  SET role = 'user'
  WHERE id = p_manager_id;

  -- Mark assignment as removed
  UPDATE public.manager_assignments
  SET removed_at = now()
  WHERE manager_id = p_manager_id
  AND removed_at IS NULL;

  RETURN json_build_object(
    'success', true,
    'message', 'Manager role removed successfully',
    'manager_id', p_manager_id
  );
END;
$$;

-- ============================================================================
-- STEP 8: Grant execute permissions
-- ============================================================================

GRANT EXECUTE ON FUNCTION public.assign_manager_role TO authenticated;
GRANT EXECUTE ON FUNCTION public.remove_manager_role TO authenticated;

-- ============================================================================
-- VERIFICATION QUERIES
-- ============================================================================
/*
-- Check role constraint
SELECT constraint_name, constraint_definition
FROM information_schema.table_constraints
WHERE table_name = 'user_profiles'
AND constraint_name LIKE '%role%';

-- Check manager_assignments table
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'manager_assignments'
ORDER BY ordinal_position;

-- Check manager assignment policies
SELECT schemaname, tablename, policyname
FROM pg_policies
WHERE tablename = 'manager_assignments'
ORDER BY policyname;
*/

-- ============================================================================
