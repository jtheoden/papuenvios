-- ============================================================================
-- ROLLBACK: ADD MANAGER ROLE TO USER PROFILES
-- Created: 2025-11-12
-- Purpose: Remove manager role support and related tables/functions
-- ============================================================================

-- ============================================================================
-- STEP 1: Drop functions
-- ============================================================================

DROP FUNCTION IF EXISTS public.remove_manager_role CASCADE;
DROP FUNCTION IF EXISTS public.assign_manager_role CASCADE;

-- ============================================================================
-- STEP 2: Drop RLS Policies
-- ============================================================================

DROP POLICY IF EXISTS "managers can view own assignment" ON public.manager_assignments;
DROP POLICY IF EXISTS "super admins can view all assignments" ON public.manager_assignments;
DROP POLICY IF EXISTS "super admins can create assignments" ON public.manager_assignments;
DROP POLICY IF EXISTS "super admins can update assignments" ON public.manager_assignments;
DROP POLICY IF EXISTS "super admins can delete assignments" ON public.manager_assignments;

-- ============================================================================
-- STEP 3: Drop manager_assignments table
-- ============================================================================

DROP TABLE IF EXISTS public.manager_assignments CASCADE;

-- ============================================================================
-- STEP 4: Update role check constraint to remove 'manager'
-- ============================================================================

ALTER TABLE public.user_profiles
DROP CONSTRAINT IF EXISTS user_profiles_role_check;

-- Restore original constraint (without 'manager')
ALTER TABLE public.user_profiles
ADD CONSTRAINT user_profiles_role_check
CHECK (role IN ('user', 'admin', 'super_admin'));

-- ============================================================================
-- NOTE: If any users have role='manager', update them to 'user' before rollback
-- SELECT COUNT(*) FROM public.user_profiles WHERE role = 'manager';
-- UPDATE public.user_profiles SET role = 'user' WHERE role = 'manager';
-- ============================================================================
