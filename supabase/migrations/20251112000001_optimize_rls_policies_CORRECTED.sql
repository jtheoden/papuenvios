-- ============================================================================
-- RLS POLICIES OPTIMIZATION - CORRECTED FOR ACTUAL SCHEMA
-- Created: 2025-11-12
-- Purpose: Replace slow EXISTS subqueries with STABLE functions to improve auth performance
-- ADAPTED TO ACTUAL SCHEMA: remittances uses user_id (not sender_id)
-- ============================================================================

-- ============================================================================
-- STEP 1: Create STABLE Functions for Role Checking
-- ============================================================================

CREATE OR REPLACE FUNCTION current_user_id() RETURNS uuid AS $$
  SELECT auth.uid();
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION current_user_role() RETURNS text AS $$
  SELECT COALESCE(role, 'user')
  FROM public.user_profiles
  WHERE id = auth.uid()
  LIMIT 1;
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION is_admin() RETURNS boolean AS $$
  SELECT COALESCE(role = 'admin', false)
  FROM public.user_profiles
  WHERE id = auth.uid()
  LIMIT 1;
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION is_super_admin() RETURNS boolean AS $$
  SELECT COALESCE(role = 'super_admin', false)
  FROM public.user_profiles
  WHERE id = auth.uid()
  LIMIT 1;
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION is_manager() RETURNS boolean AS $$
  SELECT COALESCE(role = 'manager', false)
  FROM public.user_profiles
  WHERE id = auth.uid()
  LIMIT 1;
$$ LANGUAGE sql STABLE;

-- ============================================================================
-- STEP 2: Optimize user_profiles RLS Policies
-- ============================================================================

DROP POLICY IF EXISTS "users can view own profile" ON public.user_profiles;
DROP POLICY IF EXISTS "users can update own profile" ON public.user_profiles;
DROP POLICY IF EXISTS "admins can view all profiles" ON public.user_profiles;
DROP POLICY IF EXISTS "admins can update any profile" ON public.user_profiles;

-- Allow users to view their own profile
CREATE POLICY "users can view own profile"
ON public.user_profiles
FOR SELECT
TO authenticated
USING (id = current_user_id());

-- Allow users to update their own profile
CREATE POLICY "users can update own profile"
ON public.user_profiles
FOR UPDATE
TO authenticated
USING (id = current_user_id())
WITH CHECK (id = current_user_id());

-- Allow admins to view all profiles
CREATE POLICY "admins can view all profiles"
ON public.user_profiles
FOR SELECT
TO authenticated
USING (is_admin() OR is_super_admin());

-- Allow admins to update any profile
CREATE POLICY "admins can update any profile"
ON public.user_profiles
FOR UPDATE
TO authenticated
USING (is_admin() OR is_super_admin())
WITH CHECK (is_admin() OR is_super_admin());

-- ============================================================================
-- STEP 3: Optimize orders RLS Policies
-- ============================================================================

DROP POLICY IF EXISTS "users can view own orders" ON public.orders;
DROP POLICY IF EXISTS "users can insert own orders" ON public.orders;
DROP POLICY IF EXISTS "users can update own orders" ON public.orders;
DROP POLICY IF EXISTS "admins can view all orders" ON public.orders;
DROP POLICY IF EXISTS "admins can update all orders" ON public.orders;

-- Users can view their own orders
CREATE POLICY "users can view own orders"
ON public.orders
FOR SELECT
TO authenticated
USING (user_id = current_user_id());

-- Users can create orders
CREATE POLICY "users can insert own orders"
ON public.orders
FOR INSERT
TO authenticated
WITH CHECK (user_id = current_user_id());

-- Users can update their own orders
CREATE POLICY "users can update own orders"
ON public.orders
FOR UPDATE
TO authenticated
USING (user_id = current_user_id())
WITH CHECK (user_id = current_user_id());

-- Admins can view all orders
CREATE POLICY "admins can view all orders"
ON public.orders
FOR SELECT
TO authenticated
USING (is_admin() OR is_super_admin());

-- Admins can update all orders
CREATE POLICY "admins can update all orders"
ON public.orders
FOR UPDATE
TO authenticated
USING (is_admin() OR is_super_admin())
WITH CHECK (is_admin() OR is_super_admin());

-- ============================================================================
-- STEP 4: Optimize remittances RLS Policies
-- CORRECTED: Uses user_id (not sender_id) as per actual schema
-- ============================================================================

DROP POLICY IF EXISTS "users can view own remittances" ON public.remittances;
DROP POLICY IF EXISTS "users can insert remittances" ON public.remittances;
DROP POLICY IF EXISTS "users can update own remittances" ON public.remittances;
DROP POLICY IF EXISTS "admins can view all remittances" ON public.remittances;
DROP POLICY IF EXISTS "admins can update all remittances" ON public.remittances;

-- Users can view their own remittances
CREATE POLICY "users can view own remittances"
ON public.remittances
FOR SELECT
TO authenticated
USING (user_id = current_user_id());

-- Users can create remittances
CREATE POLICY "users can insert remittances"
ON public.remittances
FOR INSERT
TO authenticated
WITH CHECK (user_id = current_user_id());

-- Users can update their own remittances
CREATE POLICY "users can update own remittances"
ON public.remittances
FOR UPDATE
TO authenticated
USING (user_id = current_user_id())
WITH CHECK (user_id = current_user_id());

-- Admins can view all remittances
CREATE POLICY "admins can view all remittances"
ON public.remittances
FOR SELECT
TO authenticated
USING (is_admin() OR is_super_admin());

-- Admins can update all remittances
CREATE POLICY "admins can update all remittances"
ON public.remittances
FOR UPDATE
TO authenticated
USING (is_admin() OR is_super_admin())
WITH CHECK (is_admin() OR is_super_admin());

-- ============================================================================
-- STEP 5: Optimize products RLS Policies
-- ============================================================================

DROP POLICY IF EXISTS "anyone can view products" ON public.products;
DROP POLICY IF EXISTS "admins can insert products" ON public.products;
DROP POLICY IF EXISTS "admins can update products" ON public.products;
DROP POLICY IF EXISTS "admins can delete products" ON public.products;

-- Anyone can view products (public)
CREATE POLICY "anyone can view products"
ON public.products
FOR SELECT
TO public
USING (true);

-- Admins can insert products
CREATE POLICY "admins can insert products"
ON public.products
FOR INSERT
TO authenticated
WITH CHECK (is_admin() OR is_super_admin());

-- Admins can update products
CREATE POLICY "admins can update products"
ON public.products
FOR UPDATE
TO authenticated
USING (is_admin() OR is_super_admin())
WITH CHECK (is_admin() OR is_super_admin());

-- Admins can delete products
CREATE POLICY "admins can delete products"
ON public.products
FOR DELETE
TO authenticated
USING (is_admin() OR is_super_admin());

-- ============================================================================
-- STEP 6: Optimize combo_products RLS Policies
-- ============================================================================

DROP POLICY IF EXISTS "anyone can view combos" ON public.combo_products;
DROP POLICY IF EXISTS "admins can manage combos" ON public.combo_products;
DROP POLICY IF EXISTS "admins can insert combos" ON public.combo_products;
DROP POLICY IF EXISTS "admins can update combos" ON public.combo_products;
DROP POLICY IF EXISTS "admins can delete combos" ON public.combo_products;

-- Anyone can view combos
CREATE POLICY "anyone can view combos"
ON public.combo_products
FOR SELECT
TO public
USING (true);

-- Admins can insert combos
CREATE POLICY "admins can insert combos"
ON public.combo_products
FOR INSERT
TO authenticated
WITH CHECK (is_admin() OR is_super_admin());

-- Admins can update combos
CREATE POLICY "admins can update combos"
ON public.combo_products
FOR UPDATE
TO authenticated
USING (is_admin() OR is_super_admin())
WITH CHECK (is_admin() OR is_super_admin());

-- Admins can delete combos
CREATE POLICY "admins can delete combos"
ON public.combo_products
FOR DELETE
TO authenticated
USING (is_admin() OR is_super_admin());

-- ============================================================================
-- STEP 7: Optimize testimonials RLS Policies
-- ============================================================================

DROP POLICY IF EXISTS "anyone can view testimonials" ON public.testimonials;
DROP POLICY IF EXISTS "users can insert testimonials" ON public.testimonials;
DROP POLICY IF EXISTS "admins can manage testimonials" ON public.testimonials;
DROP POLICY IF EXISTS "users can view own testimonials" ON public.testimonials;
DROP POLICY IF EXISTS "admins can update testimonials" ON public.testimonials;
DROP POLICY IF EXISTS "admins can delete testimonials" ON public.testimonials;

-- Anyone can view approved testimonials (is_visible = true)
CREATE POLICY "anyone can view testimonials"
ON public.testimonials
FOR SELECT
TO public
USING (is_visible = true);

-- Authenticated users can view their own testimonials
CREATE POLICY "users can view own testimonials"
ON public.testimonials
FOR SELECT
TO authenticated
USING (user_id = current_user_id() OR is_admin() OR is_super_admin());

-- Users can insert testimonials
CREATE POLICY "users can insert testimonials"
ON public.testimonials
FOR INSERT
TO authenticated
WITH CHECK (user_id = current_user_id());

-- Admins can update testimonials
CREATE POLICY "admins can update testimonials"
ON public.testimonials
FOR UPDATE
TO authenticated
USING (is_admin() OR is_super_admin())
WITH CHECK (is_admin() OR is_super_admin());

-- Admins can delete testimonials
CREATE POLICY "admins can delete testimonials"
ON public.testimonials
FOR DELETE
TO authenticated
USING (is_admin() OR is_super_admin());

-- ============================================================================
-- STEP 8: Grant execute permissions on functions
-- ============================================================================

GRANT EXECUTE ON FUNCTION current_user_id() TO authenticated, public;
GRANT EXECUTE ON FUNCTION current_user_role() TO authenticated, public;
GRANT EXECUTE ON FUNCTION is_admin() TO authenticated, public;
GRANT EXECUTE ON FUNCTION is_super_admin() TO authenticated, public;
GRANT EXECUTE ON FUNCTION is_manager() TO authenticated, public;

-- ============================================================================
-- VERIFICATION QUERIES
-- ============================================================================
-- Test that functions work:
-- SELECT current_user_id(), current_user_role(), is_admin(), is_super_admin();

-- Check RLS policies are in place:
-- SELECT schemaname, tablename, policyname
-- FROM pg_policies
-- WHERE schemaname = 'public'
-- ORDER BY tablename, policyname;

-- ============================================================================
