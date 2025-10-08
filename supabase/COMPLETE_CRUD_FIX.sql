-- =============================================================================
-- COMPLETE CRUD FIX - ALL ADMIN TABLES
-- =============================================================================
-- This script fixes CRUD operations for all tables that admins need to manage
-- Based on actual current schema from your database
-- =============================================================================

-- =============================================================================
-- IMPORTANT: Make sure current_user_role() function exists
-- =============================================================================
-- If the function doesn't exist, you'll see errors. This creates it if needed:

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
-- 1. PRODUCT_CATEGORIES - Full CRUD for admins
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
-- 2. PRODUCTS - Full CRUD for admins
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
-- 3. CURRENCIES - Full CRUD for admins
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
-- 4. COMBO_PRODUCTS - Full CRUD for admins
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
-- 5. COMBO_ITEMS - Full CRUD for admins
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
-- 6. CAROUSEL_SLIDES - Full CRUD for admins
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
-- 7. OFFERS - Full CRUD for admins
-- =============================================================================
ALTER TABLE public.offers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Offers viewable by everyone" ON public.offers;
DROP POLICY IF EXISTS "Admins can view all offers" ON public.offers;
DROP POLICY IF EXISTS "Offers manageable by admins" ON public.offers;
DROP POLICY IF EXISTS "Admins can insert offers" ON public.offers;
DROP POLICY IF EXISTS "Admins can update offers" ON public.offers;
DROP POLICY IF EXISTS "Admins can delete offers" ON public.offers;

CREATE POLICY "Offers viewable by everyone"
ON public.offers FOR SELECT
TO anon, authenticated
USING (is_active = true AND start_date <= NOW() AND end_date >= NOW());

CREATE POLICY "Admins can view all offers"
ON public.offers FOR SELECT
TO authenticated
USING (public.current_user_role() IN ('admin', 'super_admin'));

CREATE POLICY "Admins can insert offers"
ON public.offers FOR INSERT
TO authenticated
WITH CHECK (public.current_user_role() IN ('admin', 'super_admin'));

CREATE POLICY "Admins can update offers"
ON public.offers FOR UPDATE
TO authenticated
USING (public.current_user_role() IN ('admin', 'super_admin'))
WITH CHECK (public.current_user_role() IN ('admin', 'super_admin'));

CREATE POLICY "Admins can delete offers"
ON public.offers FOR DELETE
TO authenticated
USING (public.current_user_role() IN ('admin', 'super_admin'));

GRANT SELECT ON public.offers TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.offers TO authenticated;

-- =============================================================================
-- 8. EXCHANGE_RATES - Full CRUD for admins
-- =============================================================================
ALTER TABLE public.exchange_rates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Exchange rates viewable by everyone" ON public.exchange_rates;
DROP POLICY IF EXISTS "Admins can view all exchange rates" ON public.exchange_rates;
DROP POLICY IF EXISTS "Exchange rates manageable by admins" ON public.exchange_rates;
DROP POLICY IF EXISTS "Admins can insert exchange rates" ON public.exchange_rates;
DROP POLICY IF EXISTS "Admins can update exchange rates" ON public.exchange_rates;
DROP POLICY IF EXISTS "Admins can delete exchange rates" ON public.exchange_rates;

CREATE POLICY "Exchange rates viewable by everyone"
ON public.exchange_rates FOR SELECT
TO anon, authenticated
USING (is_active = true);

CREATE POLICY "Admins can view all exchange rates"
ON public.exchange_rates FOR SELECT
TO authenticated
USING (public.current_user_role() IN ('admin', 'super_admin'));

CREATE POLICY "Admins can insert exchange rates"
ON public.exchange_rates FOR INSERT
TO authenticated
WITH CHECK (public.current_user_role() IN ('admin', 'super_admin'));

CREATE POLICY "Admins can update exchange rates"
ON public.exchange_rates FOR UPDATE
TO authenticated
USING (public.current_user_role() IN ('admin', 'super_admin'))
WITH CHECK (public.current_user_role() IN ('admin', 'super_admin'));

CREATE POLICY "Admins can delete exchange rates"
ON public.exchange_rates FOR DELETE
TO authenticated
USING (public.current_user_role() IN ('admin', 'super_admin'));

GRANT SELECT ON public.exchange_rates TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.exchange_rates TO authenticated;

-- =============================================================================
-- 9. VIDEOS - Full CRUD for admins
-- =============================================================================
ALTER TABLE public.videos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Videos viewable by everyone" ON public.videos;
DROP POLICY IF EXISTS "Admins can view all videos" ON public.videos;
DROP POLICY IF EXISTS "Videos manageable by admins" ON public.videos;
DROP POLICY IF EXISTS "Admins can insert videos" ON public.videos;
DROP POLICY IF EXISTS "Admins can update videos" ON public.videos;
DROP POLICY IF EXISTS "Admins can delete videos" ON public.videos;

CREATE POLICY "Videos viewable by everyone"
ON public.videos FOR SELECT
TO anon, authenticated
USING (is_active = true);

CREATE POLICY "Admins can view all videos"
ON public.videos FOR SELECT
TO authenticated
USING (public.current_user_role() IN ('admin', 'super_admin'));

CREATE POLICY "Admins can insert videos"
ON public.videos FOR INSERT
TO authenticated
WITH CHECK (public.current_user_role() IN ('admin', 'super_admin'));

CREATE POLICY "Admins can update videos"
ON public.videos FOR UPDATE
TO authenticated
USING (public.current_user_role() IN ('admin', 'super_admin'))
WITH CHECK (public.current_user_role() IN ('admin', 'super_admin'));

CREATE POLICY "Admins can delete videos"
ON public.videos FOR DELETE
TO authenticated
USING (public.current_user_role() IN ('admin', 'super_admin'));

GRANT SELECT ON public.videos TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.videos TO authenticated;

-- =============================================================================
-- 10. TESTIMONIALS - Public read, Users create own, Admins manage all
-- =============================================================================
ALTER TABLE public.testimonials ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Testimonials viewable by everyone" ON public.testimonials;
DROP POLICY IF EXISTS "Users can create testimonials" ON public.testimonials;
DROP POLICY IF EXISTS "Admins can view all testimonials" ON public.testimonials;
DROP POLICY IF EXISTS "Testimonials manageable by admins" ON public.testimonials;
DROP POLICY IF EXISTS "Admins can insert testimonials" ON public.testimonials;
DROP POLICY IF EXISTS "Admins can update testimonials" ON public.testimonials;
DROP POLICY IF EXISTS "Admins can delete testimonials" ON public.testimonials;

CREATE POLICY "Testimonials viewable by everyone"
ON public.testimonials FOR SELECT
TO anon, authenticated
USING (is_visible = true);

CREATE POLICY "Users can create testimonials"
ON public.testimonials FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

CREATE POLICY "Admins can view all testimonials"
ON public.testimonials FOR SELECT
TO authenticated
USING (public.current_user_role() IN ('admin', 'super_admin'));

CREATE POLICY "Admins can insert testimonials"
ON public.testimonials FOR INSERT
TO authenticated
WITH CHECK (public.current_user_role() IN ('admin', 'super_admin'));

CREATE POLICY "Admins can update testimonials"
ON public.testimonials FOR UPDATE
TO authenticated
USING (public.current_user_role() IN ('admin', 'super_admin'))
WITH CHECK (public.current_user_role() IN ('admin', 'super_admin'));

CREATE POLICY "Admins can delete testimonials"
ON public.testimonials FOR DELETE
TO authenticated
USING (public.current_user_role() IN ('admin', 'super_admin'));

GRANT SELECT ON public.testimonials TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.testimonials TO authenticated;

-- =============================================================================
-- VERIFICATION
-- =============================================================================
SELECT 'COMPLETE CRUD FIX APPLIED SUCCESSFULLY!' as result;

-- Check all policies
SELECT
    tablename,
    COUNT(*) as policy_count
FROM pg_policies
WHERE schemaname = 'public'
AND tablename IN (
    'product_categories', 'products', 'currencies', 'combo_products',
    'combo_items', 'carousel_slides', 'offers', 'exchange_rates',
    'videos', 'testimonials'
)
GROUP BY tablename
ORDER BY tablename;
