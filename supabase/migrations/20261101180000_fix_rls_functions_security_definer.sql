-- ============================================================================
-- FIX RLS HELPER FUNCTIONS - SECURITY DEFINER
-- Created: 2026-11-01
-- Purpose: Fix is_admin(), is_super_admin(), current_user_role() to be
--          SECURITY DEFINER so they bypass RLS when querying user_profiles.
--          This prevents circular RLS recursion that causes "permission denied".
-- ============================================================================

-- Problem: The functions from 20251112000001_optimize_rls_policies.sql are
-- SECURITY INVOKER by default. When an RLS policy on user_profiles calls
-- is_admin() or is_super_admin(), those functions try to SELECT from
-- user_profiles, which triggers the same RLS check = infinite recursion
-- or permission denied.
--
-- Solution: Make them SECURITY DEFINER with explicit search_path like
-- get_my_role() which already works correctly.

BEGIN;

-- Fix current_user_role() - make it SECURITY DEFINER
CREATE OR REPLACE FUNCTION current_user_role()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT COALESCE(role, 'user')
  FROM public.user_profiles
  WHERE id = auth.uid()
  LIMIT 1;
$$;

-- Fix is_admin() - make it SECURITY DEFINER
CREATE OR REPLACE FUNCTION is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT COALESCE(role = 'admin', false)
  FROM public.user_profiles
  WHERE id = auth.uid()
  LIMIT 1;
$$;

-- Fix is_super_admin() - make it SECURITY DEFINER
CREATE OR REPLACE FUNCTION is_super_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT COALESCE(role = 'super_admin', false)
  FROM public.user_profiles
  WHERE id = auth.uid()
  LIMIT 1;
$$;

-- Fix is_manager() - make it SECURITY DEFINER
CREATE OR REPLACE FUNCTION is_manager()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT COALESCE(role = 'manager', false)
  FROM public.user_profiles
  WHERE id = auth.uid()
  LIMIT 1;
$$;

-- Also ensure is_admin_user() exists and is SECURITY DEFINER
-- (used by some older policies)
CREATE OR REPLACE FUNCTION is_admin_user()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT COALESCE(role IN ('admin', 'super_admin'), false)
  FROM public.user_profiles
  WHERE id = auth.uid()
  LIMIT 1;
$$;

COMMIT;
