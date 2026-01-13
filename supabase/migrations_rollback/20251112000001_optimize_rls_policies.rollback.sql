-- ============================================================================
-- ROLLBACK: RLS POLICIES OPTIMIZATION
-- Created: 2025-11-12
-- Purpose: Revert changes from RLS optimization migration
-- ============================================================================

-- ============================================================================
-- STEP 1: Drop optimized STABLE functions
-- ============================================================================

DROP FUNCTION IF EXISTS public.current_user_id();
DROP FUNCTION IF EXISTS public.current_user_role();
DROP FUNCTION IF EXISTS public.is_admin();
DROP FUNCTION IF EXISTS public.is_super_admin();
DROP FUNCTION IF EXISTS public.is_manager();

-- ============================================================================
-- STEP 2: Revert user_profiles RLS Policies to original state
-- ============================================================================

DROP POLICY IF EXISTS "users can view own profile" ON public.user_profiles;
DROP POLICY IF EXISTS "users can update own profile" ON public.user_profiles;
DROP POLICY IF EXISTS "admins can view all profiles" ON public.user_profiles;
DROP POLICY IF EXISTS "admins can update any profile" ON public.user_profiles;
DROP POLICY IF EXISTS "public can view basic profile info" ON public.user_profiles;

-- Recreate original policies with subqueries (if they existed)
-- NOTE: These are placeholder policies. Adjust based on original implementation.
-- If the original migration had different policies, restore those instead.

CREATE POLICY "users can view own profile"
ON public.user_profiles
FOR SELECT
TO authenticated
USING (id = auth.uid());

CREATE POLICY "users can update own profile"
ON public.user_profiles
FOR UPDATE
TO authenticated
USING (id = auth.uid())
WITH CHECK (id = auth.uid());

-- ============================================================================
-- STEP 3: Revert orders RLS Policies
-- ============================================================================

DROP POLICY IF EXISTS "users can view own orders" ON public.orders;
DROP POLICY IF EXISTS "users can insert own orders" ON public.orders;
DROP POLICY IF EXISTS "users can update own orders" ON public.orders;
DROP POLICY IF EXISTS "admins can view all orders" ON public.orders;
DROP POLICY IF EXISTS "admins can update all orders" ON public.orders;

-- Recreate with original logic
CREATE POLICY "users can view own orders"
ON public.orders
FOR SELECT
TO authenticated
USING (user_id = auth.uid());

CREATE POLICY "users can insert own orders"
ON public.orders
FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

CREATE POLICY "users can update own orders"
ON public.orders
FOR UPDATE
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

-- ============================================================================
-- STEP 4: Revert remittances RLS Policies
-- ============================================================================

DROP POLICY IF EXISTS "users can view own remittances" ON public.remittances;
DROP POLICY IF EXISTS "users can insert remittances" ON public.remittances;
DROP POLICY IF EXISTS "users can update own remittances" ON public.remittances;
DROP POLICY IF EXISTS "admins can view all remittances" ON public.remittances;
DROP POLICY IF EXISTS "admins can update all remittances" ON public.remittances;

CREATE POLICY "users can view own remittances"
ON public.remittances
FOR SELECT
TO authenticated
USING (sender_id = auth.uid());

CREATE POLICY "users can insert remittances"
ON public.remittances
FOR INSERT
TO authenticated
WITH CHECK (sender_id = auth.uid());

CREATE POLICY "users can update own remittances"
ON public.remittances
FOR UPDATE
TO authenticated
USING (sender_id = auth.uid())
WITH CHECK (sender_id = auth.uid());

-- ============================================================================
-- STEP 5: Revert products RLS Policies
-- ============================================================================

DROP POLICY IF EXISTS "anyone can view products" ON public.products;
DROP POLICY IF EXISTS "admins can insert products" ON public.products;
DROP POLICY IF EXISTS "admins can update products" ON public.products;
DROP POLICY IF EXISTS "admins can delete products" ON public.products;

CREATE POLICY "anyone can view products"
ON public.products
FOR SELECT
TO public
USING (true);

-- ============================================================================
-- STEP 6: Revert combos RLS Policies
-- ============================================================================

DROP POLICY IF EXISTS "anyone can view combos" ON public.combos;
DROP POLICY IF EXISTS "admins can manage combos" ON public.combos;
DROP POLICY IF EXISTS "admins can update combos" ON public.combos;
DROP POLICY IF EXISTS "admins can delete combos" ON public.combos;

CREATE POLICY "anyone can view combos"
ON public.combos
FOR SELECT
TO public
USING (true);

-- ============================================================================
-- STEP 7: Revert testimonials RLS Policies
-- ============================================================================

DROP POLICY IF EXISTS "anyone can view testimonials" ON public.testimonials;
DROP POLICY IF EXISTS "users can view own testimonials" ON public.testimonials;
DROP POLICY IF EXISTS "users can insert testimonials" ON public.testimonials;
DROP POLICY IF EXISTS "admins can update testimonials" ON public.testimonials;
DROP POLICY IF EXISTS "admins can delete testimonials" ON public.testimonials;

CREATE POLICY "anyone can view testimonials"
ON public.testimonials
FOR SELECT
TO public
USING (approved = true);

-- ============================================================================
-- STEP 8: Revert bank_accounts RLS Policies
-- ============================================================================

DROP POLICY IF EXISTS "users can view bank accounts" ON public.bank_accounts;
DROP POLICY IF EXISTS "public can view bank accounts" ON public.bank_accounts;
DROP POLICY IF EXISTS "admins can insert bank accounts" ON public.bank_accounts;
DROP POLICY IF EXISTS "admins can update bank accounts" ON public.bank_accounts;
DROP POLICY IF EXISTS "admins can delete bank accounts" ON public.bank_accounts;

CREATE POLICY "anyone can view bank accounts"
ON public.bank_accounts
FOR SELECT
TO public
USING (true);

-- ============================================================================
-- VERIFICATION
-- ============================================================================
-- SELECT schemaname, tablename, policyname
-- FROM pg_policies
-- WHERE schemaname = 'public'
-- ORDER BY tablename, policyname;

-- ============================================================================
