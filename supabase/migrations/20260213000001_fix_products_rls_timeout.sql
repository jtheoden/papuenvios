-- Fix: products query hitting statement timeout (500 Internal Server Error)
--
-- Root cause: The original schema policies from 20241001000000 were never
-- dropped when optimized policies were added in later migrations. The old
-- policies use current_user_role() which evaluates PER ROW without InitPlan
-- optimization, causing O(n) overhead and statement timeouts.
--
-- This migration drops ALL old unoptimized policies from the original schema
-- for: products, inventory, user_profiles. Orders and system_config were
-- already cleaned up by earlier migrations.

BEGIN;

-- ========== PRODUCTS ==========
-- Drop old unoptimized policies
DROP POLICY IF EXISTS "Products viewable by all" ON public.products;
DROP POLICY IF EXISTS "Products manageable by admins" ON public.products;

-- Ensure optimized policies exist (idempotent — drop + recreate)
DROP POLICY IF EXISTS "products_select_public" ON public.products;
CREATE POLICY "products_select_public" ON public.products
  FOR SELECT USING ((is_active = true) OR (select is_admin_user()));

DROP POLICY IF EXISTS "products_delete_admin" ON public.products;
CREATE POLICY "products_delete_admin" ON public.products
  FOR DELETE USING ((select is_admin_user()));

DROP POLICY IF EXISTS "products_insert_admin" ON public.products;
CREATE POLICY "products_insert_admin" ON public.products
  FOR INSERT WITH CHECK ((select is_admin_user()));

DROP POLICY IF EXISTS "products_update_admin" ON public.products;
CREATE POLICY "products_update_admin" ON public.products
  FOR UPDATE USING ((select is_admin_user())) WITH CHECK ((select is_admin_user()));

-- ========== INVENTORY ==========
-- Drop old unoptimized policies
DROP POLICY IF EXISTS "Inventory viewable by admins" ON public.inventory;
DROP POLICY IF EXISTS "Inventory manageable by admins" ON public.inventory;

-- ========== USER_PROFILES ==========
-- Drop old unoptimized policies (use current_user_role() per row)
DROP POLICY IF EXISTS "Admins can view all profiles" ON public.user_profiles;
DROP POLICY IF EXISTS "Super admins can update all profiles" ON public.user_profiles;

-- ========== ORDERS ==========
-- Drop any remaining old policies that weren't cleaned up
DROP POLICY IF EXISTS "Admins can view all orders" ON public.orders;
DROP POLICY IF EXISTS "Admins can manage all orders" ON public.orders;
DROP POLICY IF EXISTS "Users can create own orders" ON public.orders;

COMMIT;
