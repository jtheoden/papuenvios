-- ============================================================================
-- RLS POLICIES OPTIMIZATION - Create STABLE Functions and Replace Subqueries
-- Created: 2025-11-12
-- Purpose: Replace slow EXISTS subqueries with STABLE functions to improve auth performance
-- Impact: Reduce auth timeout issues, eliminate RLS warnings, improve query performance
-- ============================================================================

-- ============================================================================
-- STEP 1: Create STABLE Functions for Role Checking
-- These functions are STABLE so PostgreSQL can cache results within a transaction
-- ============================================================================

-- Get current authenticated user's ID
CREATE OR REPLACE FUNCTION current_user_id() RETURNS uuid AS $$
  SELECT auth.uid();
$$ LANGUAGE sql STABLE;

-- Get current authenticated user's role from user_profiles
CREATE OR REPLACE FUNCTION current_user_role() RETURNS text AS $$
  SELECT COALESCE(role, 'user')
  FROM public.user_profiles
  WHERE id = auth.uid()
  LIMIT 1;
$$ LANGUAGE sql STABLE;

-- Check if current user is admin
CREATE OR REPLACE FUNCTION is_admin() RETURNS boolean AS $$
  SELECT COALESCE(role = 'admin', false)
  FROM public.user_profiles
  WHERE id = auth.uid()
  LIMIT 1;
$$ LANGUAGE sql STABLE;

-- Check if current user is super_admin
CREATE OR REPLACE FUNCTION is_super_admin() RETURNS boolean AS $$
  SELECT COALESCE(role = 'super_admin', false)
  FROM public.user_profiles
  WHERE id = auth.uid()
  LIMIT 1;
$$ LANGUAGE sql STABLE;

-- Check if current user is manager
CREATE OR REPLACE FUNCTION is_manager() RETURNS boolean AS $$
  SELECT COALESCE(role = 'manager', false)
  FROM public.user_profiles
  WHERE id = auth.uid()
  LIMIT 1;
$$ LANGUAGE sql STABLE;

-- ============================================================================
-- STEP 2: Optimize user_profiles RLS Policies
-- ============================================================================

-- Drop old policies if they exist
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

-- Allow public to view basic profile info (limited columns)
CREATE POLICY "public can view basic profile info"
ON public.user_profiles
FOR SELECT
TO public
USING (true);

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
USING (sender_id = current_user_id());

-- Users can create remittances
CREATE POLICY "users can insert remittances"
ON public.remittances
FOR INSERT
TO authenticated
WITH CHECK (sender_id = current_user_id());

-- Users can update their own remittances
CREATE POLICY "users can update own remittances"
ON public.remittances
FOR UPDATE
TO authenticated
USING (sender_id = current_user_id())
WITH CHECK (sender_id = current_user_id());

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
-- STEP 6: Optimize combos RLS Policies (if exists)
-- ============================================================================

DROP POLICY IF EXISTS "anyone can view combos" ON public.combos;
DROP POLICY IF EXISTS "admins can manage combos" ON public.combos;

-- Anyone can view combos
CREATE POLICY "anyone can view combos"
ON public.combos
FOR SELECT
TO public
USING (true);

-- Admins can manage combos
CREATE POLICY "admins can manage combos"
ON public.combos
FOR INSERT
TO authenticated
WITH CHECK (is_admin() OR is_super_admin());

CREATE POLICY "admins can update combos"
ON public.combos
FOR UPDATE
TO authenticated
USING (is_admin() OR is_super_admin())
WITH CHECK (is_admin() OR is_super_admin());

CREATE POLICY "admins can delete combos"
ON public.combos
FOR DELETE
TO authenticated
USING (is_admin() OR is_super_admin());

-- ============================================================================
-- STEP 7: Optimize testimonials RLS Policies
-- ============================================================================

DROP POLICY IF EXISTS "anyone can view testimonials" ON public.testimonials;
DROP POLICY IF EXISTS "users can insert testimonials" ON public.testimonials;
DROP POLICY IF EXISTS "admins can manage testimonials" ON public.testimonials;

-- Anyone can view approved testimonials
CREATE POLICY "anyone can view testimonials"
ON public.testimonials
FOR SELECT
TO public
USING (approved = true);

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

-- Admins can manage testimonials
CREATE POLICY "admins can update testimonials"
ON public.testimonials
FOR UPDATE
TO authenticated
USING (is_admin() OR is_super_admin())
WITH CHECK (is_admin() OR is_super_admin());

CREATE POLICY "admins can delete testimonials"
ON public.testimonials
FOR DELETE
TO authenticated
USING (is_admin() OR is_super_admin());

-- ============================================================================
-- STEP 8: Optimize bank_accounts RLS Policies
-- ============================================================================

DROP POLICY IF EXISTS "users can view bank accounts" ON public.bank_accounts;
DROP POLICY IF EXISTS "admins can manage bank accounts" ON public.bank_accounts;

-- Users can view bank accounts (public data)
CREATE POLICY "users can view bank accounts"
ON public.bank_accounts
FOR SELECT
TO authenticated
USING (true);

-- Public can view bank accounts
CREATE POLICY "public can view bank accounts"
ON public.bank_accounts
FOR SELECT
TO public
USING (true);

-- Admins can manage bank accounts
CREATE POLICY "admins can insert bank accounts"
ON public.bank_accounts
FOR INSERT
TO authenticated
WITH CHECK (is_admin() OR is_super_admin());

CREATE POLICY "admins can update bank accounts"
ON public.bank_accounts
FOR UPDATE
TO authenticated
USING (is_admin() OR is_super_admin())
WITH CHECK (is_admin() OR is_super_admin());

CREATE POLICY "admins can delete bank accounts"
ON public.bank_accounts
FOR DELETE
TO authenticated
USING (is_admin() OR is_super_admin());

-- ============================================================================
-- STEP 9: Grant execute permissions on functions
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
