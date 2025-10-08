-- =============================================================================
-- FIX ALL ERRORS - Schema + RLS Complete Fix
-- =============================================================================
-- This fixes:
-- 1. Missing 'slug' column in product_categories
-- 2. Orders RLS policies for admins
-- 3. All CRUD operations for admin tables
-- =============================================================================

-- =============================================================================
-- STEP 1: Add missing 'slug' column to product_categories
-- =============================================================================
ALTER TABLE public.product_categories
ADD COLUMN IF NOT EXISTS slug text;

-- Create unique index on slug (allow NULL for now)
CREATE UNIQUE INDEX IF NOT EXISTS product_categories_slug_key
ON public.product_categories(slug)
WHERE slug IS NOT NULL;

-- Generate slugs for existing categories (if any)
UPDATE public.product_categories
SET slug = LOWER(REGEXP_REPLACE(name_en, '[^a-zA-Z0-9]+', '-', 'g'))
WHERE slug IS NULL;

-- Now make slug NOT NULL and UNIQUE
ALTER TABLE public.product_categories
ALTER COLUMN slug SET NOT NULL;

-- =============================================================================
-- STEP 2: Ensure current_user_role() function exists
-- =============================================================================
CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS text AS $$
DECLARE
    user_role text;
BEGIN
    SELECT role INTO user_role
    FROM public.user_profiles
    WHERE user_id = auth.uid()
    LIMIT 1;

    RETURN COALESCE(user_role, 'user');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

GRANT EXECUTE ON FUNCTION public.current_user_role() TO authenticated, anon;

-- =============================================================================
-- STEP 3: Fix ORDERS RLS policies (403 Forbidden error)
-- =============================================================================
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

-- Drop existing policies
DROP POLICY IF EXISTS "Users can view own orders" ON public.orders;
DROP POLICY IF EXISTS "Admins can view all orders" ON public.orders;
DROP POLICY IF EXISTS "Users can create own orders" ON public.orders;
DROP POLICY IF EXISTS "Admins can manage all orders" ON public.orders;
DROP POLICY IF EXISTS "Admins can insert orders" ON public.orders;
DROP POLICY IF EXISTS "Admins can update orders" ON public.orders;
DROP POLICY IF EXISTS "Admins can delete orders" ON public.orders;

-- Policy 1: Users can view their own orders
CREATE POLICY "Users can view own orders"
ON public.orders FOR SELECT
TO authenticated
USING (user_id = auth.uid());

-- Policy 2: Admins can view ALL orders
CREATE POLICY "Admins can view all orders"
ON public.orders FOR SELECT
TO authenticated
USING (public.current_user_role() IN ('admin', 'super_admin'));

-- Policy 3: Users can create their own orders
CREATE POLICY "Users can create own orders"
ON public.orders FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

-- Policy 4: Admins can create any order
CREATE POLICY "Admins can insert orders"
ON public.orders FOR INSERT
TO authenticated
WITH CHECK (public.current_user_role() IN ('admin', 'super_admin'));

-- Policy 5: Admins can update orders
CREATE POLICY "Admins can update orders"
ON public.orders FOR UPDATE
TO authenticated
USING (public.current_user_role() IN ('admin', 'super_admin'))
WITH CHECK (public.current_user_role() IN ('admin', 'super_admin'));

-- Policy 6: Admins can delete orders
CREATE POLICY "Admins can delete orders"
ON public.orders FOR DELETE
TO authenticated
USING (public.current_user_role() IN ('admin', 'super_admin'));

-- Grant permissions
GRANT SELECT, INSERT ON public.orders TO authenticated;
GRANT UPDATE, DELETE ON public.orders TO authenticated;

-- =============================================================================
-- STEP 4: Fix PRODUCT_CATEGORIES RLS policies
-- =============================================================================
ALTER TABLE public.product_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Categories viewable by everyone" ON public.product_categories;
DROP POLICY IF EXISTS "Admins can view all categories" ON public.product_categories;
DROP POLICY IF EXISTS "Admins can insert categories" ON public.product_categories;
DROP POLICY IF EXISTS "Admins can update categories" ON public.product_categories;
DROP POLICY IF EXISTS "Admins can delete categories" ON public.product_categories;

-- Public can read active categories
CREATE POLICY "Categories viewable by everyone"
ON public.product_categories FOR SELECT
TO anon, authenticated
USING (is_active = true);

-- Admins can read all categories
CREATE POLICY "Admins can view all categories"
ON public.product_categories FOR SELECT
TO authenticated
USING (public.current_user_role() IN ('admin', 'super_admin'));

-- Admins can create categories
CREATE POLICY "Admins can insert categories"
ON public.product_categories FOR INSERT
TO authenticated
WITH CHECK (public.current_user_role() IN ('admin', 'super_admin'));

-- Admins can update categories
CREATE POLICY "Admins can update categories"
ON public.product_categories FOR UPDATE
TO authenticated
USING (public.current_user_role() IN ('admin', 'super_admin'))
WITH CHECK (public.current_user_role() IN ('admin', 'super_admin'));

-- Admins can delete categories
CREATE POLICY "Admins can delete categories"
ON public.product_categories FOR DELETE
TO authenticated
USING (public.current_user_role() IN ('admin', 'super_admin'));

GRANT SELECT ON public.product_categories TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.product_categories TO authenticated;

-- =============================================================================
-- STEP 5: Fix PRODUCTS RLS policies
-- =============================================================================
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Products viewable by all" ON public.products;
DROP POLICY IF EXISTS "Products viewable by everyone" ON public.products;
DROP POLICY IF EXISTS "Admins can view all products" ON public.products;
DROP POLICY IF EXISTS "Products manageable by admins" ON public.products;
DROP POLICY IF EXISTS "Admins can insert products" ON public.products;
DROP POLICY IF EXISTS "Admins can update products" ON public.products;
DROP POLICY IF EXISTS "Admins can delete products" ON public.products;

CREATE POLICY "Products viewable by everyone"
ON public.products FOR SELECT
TO anon, authenticated
USING (is_active = true);

CREATE POLICY "Admins can view all products"
ON public.products FOR SELECT
TO authenticated
USING (public.current_user_role() IN ('admin', 'super_admin'));

CREATE POLICY "Admins can insert products"
ON public.products FOR INSERT
TO authenticated
WITH CHECK (public.current_user_role() IN ('admin', 'super_admin'));

CREATE POLICY "Admins can update products"
ON public.products FOR UPDATE
TO authenticated
USING (public.current_user_role() IN ('admin', 'super_admin'))
WITH CHECK (public.current_user_role() IN ('admin', 'super_admin'));

CREATE POLICY "Admins can delete products"
ON public.products FOR DELETE
TO authenticated
USING (public.current_user_role() IN ('admin', 'super_admin'));

GRANT SELECT ON public.products TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.products TO authenticated;

-- =============================================================================
-- STEP 6: Fix CURRENCIES RLS policies
-- =============================================================================
ALTER TABLE public.currencies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Currencies viewable by everyone" ON public.currencies;
DROP POLICY IF EXISTS "Admins can view all currencies" ON public.currencies;
DROP POLICY IF EXISTS "Currencies manageable by admins" ON public.currencies;
DROP POLICY IF EXISTS "Admins can insert currencies" ON public.currencies;
DROP POLICY IF EXISTS "Admins can update currencies" ON public.currencies;
DROP POLICY IF EXISTS "Admins can delete currencies" ON public.currencies;

CREATE POLICY "Currencies viewable by everyone"
ON public.currencies FOR SELECT
TO anon, authenticated
USING (is_active = true);

CREATE POLICY "Admins can view all currencies"
ON public.currencies FOR SELECT
TO authenticated
USING (public.current_user_role() IN ('admin', 'super_admin'));

CREATE POLICY "Admins can insert currencies"
ON public.currencies FOR INSERT
TO authenticated
WITH CHECK (public.current_user_role() IN ('admin', 'super_admin'));

CREATE POLICY "Admins can update currencies"
ON public.currencies FOR UPDATE
TO authenticated
USING (public.current_user_role() IN ('admin', 'super_admin'))
WITH CHECK (public.current_user_role() IN ('admin', 'super_admin'));

CREATE POLICY "Admins can delete currencies"
ON public.currencies FOR DELETE
TO authenticated
USING (public.current_user_role() IN ('admin', 'super_admin'));

GRANT SELECT ON public.currencies TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.currencies TO authenticated;

-- =============================================================================
-- STEP 7: Fix COMBO_PRODUCTS RLS policies
-- =============================================================================
ALTER TABLE public.combo_products ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Combos viewable by everyone" ON public.combo_products;
DROP POLICY IF EXISTS "Admins can view all combos" ON public.combo_products;
DROP POLICY IF EXISTS "Combos manageable by admins" ON public.combo_products;
DROP POLICY IF EXISTS "Admins can insert combos" ON public.combo_products;
DROP POLICY IF EXISTS "Admins can update combos" ON public.combo_products;
DROP POLICY IF EXISTS "Admins can delete combos" ON public.combo_products;

CREATE POLICY "Combos viewable by everyone"
ON public.combo_products FOR SELECT
TO anon, authenticated
USING (is_active = true);

CREATE POLICY "Admins can view all combos"
ON public.combo_products FOR SELECT
TO authenticated
USING (public.current_user_role() IN ('admin', 'super_admin'));

CREATE POLICY "Admins can insert combos"
ON public.combo_products FOR INSERT
TO authenticated
WITH CHECK (public.current_user_role() IN ('admin', 'super_admin'));

CREATE POLICY "Admins can update combos"
ON public.combo_products FOR UPDATE
TO authenticated
USING (public.current_user_role() IN ('admin', 'super_admin'))
WITH CHECK (public.current_user_role() IN ('admin', 'super_admin'));

CREATE POLICY "Admins can delete combos"
ON public.combo_products FOR DELETE
TO authenticated
USING (public.current_user_role() IN ('admin', 'super_admin'));

GRANT SELECT ON public.combo_products TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.combo_products TO authenticated;

-- =============================================================================
-- STEP 8: Fix COMBO_ITEMS RLS policies
-- =============================================================================
ALTER TABLE public.combo_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Combo items viewable by everyone" ON public.combo_items;
DROP POLICY IF EXISTS "Admins can view all combo items" ON public.combo_items;
DROP POLICY IF EXISTS "Combo items manageable by admins" ON public.combo_items;
DROP POLICY IF EXISTS "Admins can insert combo items" ON public.combo_items;
DROP POLICY IF EXISTS "Admins can update combo items" ON public.combo_items;
DROP POLICY IF EXISTS "Admins can delete combo items" ON public.combo_items;

CREATE POLICY "Combo items viewable by everyone"
ON public.combo_items FOR SELECT
TO anon, authenticated
USING (true);

CREATE POLICY "Admins can insert combo items"
ON public.combo_items FOR INSERT
TO authenticated
WITH CHECK (public.current_user_role() IN ('admin', 'super_admin'));

CREATE POLICY "Admins can update combo items"
ON public.combo_items FOR UPDATE
TO authenticated
USING (public.current_user_role() IN ('admin', 'super_admin'))
WITH CHECK (public.current_user_role() IN ('admin', 'super_admin'));

CREATE POLICY "Admins can delete combo items"
ON public.combo_items FOR DELETE
TO authenticated
USING (public.current_user_role() IN ('admin', 'super_admin'));

GRANT SELECT ON public.combo_items TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.combo_items TO authenticated;

-- =============================================================================
-- STEP 9: Fix CAROUSEL_SLIDES RLS policies
-- =============================================================================
ALTER TABLE public.carousel_slides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Carousel slides viewable by everyone" ON public.carousel_slides;
DROP POLICY IF EXISTS "Admins can view all carousel slides" ON public.carousel_slides;
DROP POLICY IF EXISTS "Carousel slides manageable by admins" ON public.carousel_slides;
DROP POLICY IF EXISTS "Admins can insert carousel slides" ON public.carousel_slides;
DROP POLICY IF EXISTS "Admins can update carousel slides" ON public.carousel_slides;
DROP POLICY IF EXISTS "Admins can delete carousel slides" ON public.carousel_slides;

CREATE POLICY "Carousel slides viewable by everyone"
ON public.carousel_slides FOR SELECT
TO anon, authenticated
USING (is_active = true);

CREATE POLICY "Admins can view all carousel slides"
ON public.carousel_slides FOR SELECT
TO authenticated
USING (public.current_user_role() IN ('admin', 'super_admin'));

CREATE POLICY "Admins can insert carousel slides"
ON public.carousel_slides FOR INSERT
TO authenticated
WITH CHECK (public.current_user_role() IN ('admin', 'super_admin'));

CREATE POLICY "Admins can update carousel slides"
ON public.carousel_slides FOR UPDATE
TO authenticated
USING (public.current_user_role() IN ('admin', 'super_admin'))
WITH CHECK (public.current_user_role() IN ('admin', 'super_admin'));

CREATE POLICY "Admins can delete carousel slides"
ON public.carousel_slides FOR DELETE
TO authenticated
USING (public.current_user_role() IN ('admin', 'super_admin'));

GRANT SELECT ON public.carousel_slides TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.carousel_slides TO authenticated;

-- =============================================================================
-- STEP 10: Fix ORDER_ITEMS, ORDER_STATUS_HISTORY (related to orders)
-- =============================================================================
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own order items" ON public.order_items;
DROP POLICY IF EXISTS "Admins can manage all order items" ON public.order_items;
DROP POLICY IF EXISTS "Admins can view all order items" ON public.order_items;
DROP POLICY IF EXISTS "Admins can insert order items" ON public.order_items;
DROP POLICY IF EXISTS "Admins can update order items" ON public.order_items;
DROP POLICY IF EXISTS "Admins can delete order items" ON public.order_items;

CREATE POLICY "Users can view own order items"
ON public.order_items FOR SELECT
TO authenticated
USING (EXISTS (
    SELECT 1 FROM public.orders
    WHERE orders.id = order_items.order_id
    AND orders.user_id = auth.uid()
));

CREATE POLICY "Admins can view all order items"
ON public.order_items FOR SELECT
TO authenticated
USING (public.current_user_role() IN ('admin', 'super_admin'));

CREATE POLICY "Admins can insert order items"
ON public.order_items FOR INSERT
TO authenticated
WITH CHECK (public.current_user_role() IN ('admin', 'super_admin'));

CREATE POLICY "Admins can update order items"
ON public.order_items FOR UPDATE
TO authenticated
USING (public.current_user_role() IN ('admin', 'super_admin'))
WITH CHECK (public.current_user_role() IN ('admin', 'super_admin'));

CREATE POLICY "Admins can delete order items"
ON public.order_items FOR DELETE
TO authenticated
USING (public.current_user_role() IN ('admin', 'super_admin'));

GRANT SELECT ON public.order_items TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.order_items TO authenticated;

-- ORDER STATUS HISTORY
ALTER TABLE public.order_status_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own order history" ON public.order_status_history;
DROP POLICY IF EXISTS "Admins can manage all order history" ON public.order_status_history;
DROP POLICY IF EXISTS "Admins can view all order history" ON public.order_status_history;
DROP POLICY IF EXISTS "Admins can insert order history" ON public.order_status_history;

CREATE POLICY "Users can view own order history"
ON public.order_status_history FOR SELECT
TO authenticated
USING (EXISTS (
    SELECT 1 FROM public.orders
    WHERE orders.id = order_status_history.order_id
    AND orders.user_id = auth.uid()
));

CREATE POLICY "Admins can view all order history"
ON public.order_status_history FOR SELECT
TO authenticated
USING (public.current_user_role() IN ('admin', 'super_admin'));

CREATE POLICY "Admins can insert order history"
ON public.order_status_history FOR INSERT
TO authenticated
WITH CHECK (public.current_user_role() IN ('admin', 'super_admin'));

GRANT SELECT ON public.order_status_history TO authenticated;
GRANT INSERT ON public.order_status_history TO authenticated;

-- =============================================================================
-- VERIFICATION
-- =============================================================================
SELECT 'ALL ERRORS FIXED!' as result;

-- Verify slug column exists
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
AND table_name = 'product_categories'
AND column_name = 'slug';

-- Count policies per table
SELECT
    tablename,
    COUNT(*) as policy_count
FROM pg_policies
WHERE schemaname = 'public'
GROUP BY tablename
ORDER BY tablename;
