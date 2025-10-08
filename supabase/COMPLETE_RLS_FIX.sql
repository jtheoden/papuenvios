-- =============================================================================
-- COMPLETE RLS FIX FOR ALL TABLES
-- =============================================================================
-- This script fixes RLS policies for:
-- 1. Public read access (anon + authenticated)
-- 2. Admin CRUD operations
-- 3. Proper permissions for all tables
-- =============================================================================

-- =============================================================================
-- 1. CURRENCIES - Public read, Admin manage
-- =============================================================================
ALTER TABLE public.currencies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Currencies viewable by everyone" ON public.currencies;
DROP POLICY IF EXISTS "Currencies manageable by admins" ON public.currencies;

CREATE POLICY "Currencies viewable by everyone"
ON public.currencies FOR SELECT
TO anon, authenticated
USING (is_active = true);

CREATE POLICY "Currencies manageable by admins"
ON public.currencies FOR ALL
TO authenticated
USING (public.current_user_role() IN ('admin', 'super_admin'))
WITH CHECK (public.current_user_role() IN ('admin', 'super_admin'));

GRANT SELECT ON public.currencies TO anon;
GRANT ALL ON public.currencies TO authenticated;

-- =============================================================================
-- 2. PRODUCT CATEGORIES - Public read, Admin manage
-- =============================================================================
ALTER TABLE public.product_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Categories viewable by everyone" ON public.product_categories;
DROP POLICY IF EXISTS "Categories manageable by admins" ON public.product_categories;

CREATE POLICY "Categories viewable by everyone"
ON public.product_categories FOR SELECT
TO anon, authenticated
USING (is_active = true);

CREATE POLICY "Categories manageable by admins"
ON public.product_categories FOR ALL
TO authenticated
USING (public.current_user_role() IN ('admin', 'super_admin'))
WITH CHECK (public.current_user_role() IN ('admin', 'super_admin'));

GRANT SELECT ON public.product_categories TO anon;
GRANT ALL ON public.product_categories TO authenticated;

-- =============================================================================
-- 3. PRODUCTS - Public read, Admin manage
-- =============================================================================
-- Already enabled, just update policies
DROP POLICY IF EXISTS "Products viewable by all" ON public.products;
DROP POLICY IF EXISTS "Products viewable by everyone" ON public.products;
DROP POLICY IF EXISTS "Products manageable by admins" ON public.products;

CREATE POLICY "Products viewable by everyone"
ON public.products FOR SELECT
TO anon, authenticated
USING (is_active = true);

CREATE POLICY "Products manageable by admins"
ON public.products FOR ALL
TO authenticated
USING (public.current_user_role() IN ('admin', 'super_admin'))
WITH CHECK (public.current_user_role() IN ('admin', 'super_admin'));

GRANT SELECT ON public.products TO anon;
GRANT ALL ON public.products TO authenticated;

-- =============================================================================
-- 4. COMBO PRODUCTS - Public read, Admin manage
-- =============================================================================
ALTER TABLE public.combo_products ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Combos viewable by everyone" ON public.combo_products;
DROP POLICY IF EXISTS "Combos manageable by admins" ON public.combo_products;

CREATE POLICY "Combos viewable by everyone"
ON public.combo_products FOR SELECT
TO anon, authenticated
USING (is_active = true);

CREATE POLICY "Combos manageable by admins"
ON public.combo_products FOR ALL
TO authenticated
USING (public.current_user_role() IN ('admin', 'super_admin'))
WITH CHECK (public.current_user_role() IN ('admin', 'super_admin'));

GRANT SELECT ON public.combo_products TO anon;
GRANT ALL ON public.combo_products TO authenticated;

-- =============================================================================
-- 5. COMBO ITEMS - Public read, Admin manage
-- =============================================================================
ALTER TABLE public.combo_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Combo items viewable by everyone" ON public.combo_items;
DROP POLICY IF EXISTS "Combo items manageable by admins" ON public.combo_items;

CREATE POLICY "Combo items viewable by everyone"
ON public.combo_items FOR SELECT
TO anon, authenticated
USING (true);

CREATE POLICY "Combo items manageable by admins"
ON public.combo_items FOR ALL
TO authenticated
USING (public.current_user_role() IN ('admin', 'super_admin'))
WITH CHECK (public.current_user_role() IN ('admin', 'super_admin'));

GRANT SELECT ON public.combo_items TO anon;
GRANT ALL ON public.combo_items TO authenticated;

-- =============================================================================
-- 6. CAROUSEL SLIDES - Public read, Admin manage
-- =============================================================================
ALTER TABLE public.carousel_slides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Carousel slides viewable by everyone" ON public.carousel_slides;
DROP POLICY IF EXISTS "Carousel slides manageable by admins" ON public.carousel_slides;

CREATE POLICY "Carousel slides viewable by everyone"
ON public.carousel_slides FOR SELECT
TO anon, authenticated
USING (
    is_active = true AND
    (starts_at IS NULL OR starts_at <= NOW()) AND
    (ends_at IS NULL OR ends_at >= NOW())
);

CREATE POLICY "Carousel slides manageable by admins"
ON public.carousel_slides FOR ALL
TO authenticated
USING (public.current_user_role() IN ('admin', 'super_admin'))
WITH CHECK (public.current_user_role() IN ('admin', 'super_admin'));

GRANT SELECT ON public.carousel_slides TO anon;
GRANT ALL ON public.carousel_slides TO authenticated;

-- =============================================================================
-- 7. OFFERS - Public read, Admin manage
-- =============================================================================
ALTER TABLE public.offers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Offers viewable by everyone" ON public.offers;
DROP POLICY IF EXISTS "Offers manageable by admins" ON public.offers;

CREATE POLICY "Offers viewable by everyone"
ON public.offers FOR SELECT
TO anon, authenticated
USING (
    is_active = true AND
    start_date <= NOW() AND
    end_date >= NOW()
);

CREATE POLICY "Offers manageable by admins"
ON public.offers FOR ALL
TO authenticated
USING (public.current_user_role() IN ('admin', 'super_admin'))
WITH CHECK (public.current_user_role() IN ('admin', 'super_admin'));

GRANT SELECT ON public.offers TO anon;
GRANT ALL ON public.offers TO authenticated;

-- =============================================================================
-- 8. OFFER ITEMS - Public read, Admin manage
-- =============================================================================
ALTER TABLE public.offer_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Offer items viewable by everyone" ON public.offer_items;
DROP POLICY IF EXISTS "Offer items manageable by admins" ON public.offer_items;

CREATE POLICY "Offer items viewable by everyone"
ON public.offer_items FOR SELECT
TO anon, authenticated
USING (true);

CREATE POLICY "Offer items manageable by admins"
ON public.offer_items FOR ALL
TO authenticated
USING (public.current_user_role() IN ('admin', 'super_admin'))
WITH CHECK (public.current_user_role() IN ('admin', 'super_admin'));

GRANT SELECT ON public.offer_items TO anon;
GRANT ALL ON public.offer_items TO authenticated;

-- =============================================================================
-- 9. EXCHANGE RATES - Public read, Admin manage
-- =============================================================================
ALTER TABLE public.exchange_rates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Exchange rates viewable by everyone" ON public.exchange_rates;
DROP POLICY IF EXISTS "Exchange rates manageable by admins" ON public.exchange_rates;

CREATE POLICY "Exchange rates viewable by everyone"
ON public.exchange_rates FOR SELECT
TO anon, authenticated
USING (is_active = true);

CREATE POLICY "Exchange rates manageable by admins"
ON public.exchange_rates FOR ALL
TO authenticated
USING (public.current_user_role() IN ('admin', 'super_admin'))
WITH CHECK (public.current_user_role() IN ('admin', 'super_admin'));

GRANT SELECT ON public.exchange_rates TO anon;
GRANT ALL ON public.exchange_rates TO authenticated;

-- =============================================================================
-- 10. TESTIMONIALS - Public read verified, Admin manage
-- =============================================================================
ALTER TABLE public.testimonials ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Testimonials viewable by everyone" ON public.testimonials;
DROP POLICY IF EXISTS "Users can create testimonials" ON public.testimonials;
DROP POLICY IF EXISTS "Users can view own testimonials" ON public.testimonials;
DROP POLICY IF EXISTS "Testimonials manageable by admins" ON public.testimonials;

CREATE POLICY "Testimonials viewable by everyone"
ON public.testimonials FOR SELECT
TO anon, authenticated
USING (is_verified = true AND is_visible = true);

CREATE POLICY "Users can view own testimonials"
ON public.testimonials FOR SELECT
TO authenticated
USING (user_id = auth.uid());

CREATE POLICY "Users can create testimonials"
ON public.testimonials FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

CREATE POLICY "Testimonials manageable by admins"
ON public.testimonials FOR ALL
TO authenticated
USING (public.current_user_role() IN ('admin', 'super_admin'))
WITH CHECK (public.current_user_role() IN ('admin', 'super_admin'));

GRANT SELECT ON public.testimonials TO anon;
GRANT ALL ON public.testimonials TO authenticated;

-- =============================================================================
-- 11. VIDEOS - Public read, Admin manage
-- =============================================================================
ALTER TABLE public.videos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Videos viewable by everyone" ON public.videos;
DROP POLICY IF EXISTS "Videos manageable by admins" ON public.videos;

CREATE POLICY "Videos viewable by everyone"
ON public.videos FOR SELECT
TO anon, authenticated
USING (is_active = true);

CREATE POLICY "Videos manageable by admins"
ON public.videos FOR ALL
TO authenticated
USING (public.current_user_role() IN ('admin', 'super_admin'))
WITH CHECK (public.current_user_role() IN ('admin', 'super_admin'));

GRANT SELECT ON public.videos TO anon;
GRANT ALL ON public.videos TO authenticated;

-- =============================================================================
-- 12. REMITTANCE SERVICES - Public read, Admin manage
-- =============================================================================
ALTER TABLE public.remittance_services ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Remittance services viewable by everyone" ON public.remittance_services;
DROP POLICY IF EXISTS "Remittance services manageable by admins" ON public.remittance_services;

CREATE POLICY "Remittance services viewable by everyone"
ON public.remittance_services FOR SELECT
TO anon, authenticated
USING (is_active = true);

CREATE POLICY "Remittance services manageable by admins"
ON public.remittance_services FOR ALL
TO authenticated
USING (public.current_user_role() IN ('admin', 'super_admin'))
WITH CHECK (public.current_user_role() IN ('admin', 'super_admin'));

GRANT SELECT ON public.remittance_services TO anon;
GRANT ALL ON public.remittance_services TO authenticated;

-- =============================================================================
-- 13. ZELLE ACCOUNTS - Admin only
-- =============================================================================
ALTER TABLE public.zelle_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Zelle accounts viewable by admins" ON public.zelle_accounts;
DROP POLICY IF EXISTS "Zelle accounts manageable by admins" ON public.zelle_accounts;

CREATE POLICY "Zelle accounts viewable by admins"
ON public.zelle_accounts FOR SELECT
TO authenticated
USING (public.current_user_role() IN ('admin', 'super_admin'));

CREATE POLICY "Zelle accounts manageable by admins"
ON public.zelle_accounts FOR ALL
TO authenticated
USING (public.current_user_role() IN ('admin', 'super_admin'))
WITH CHECK (public.current_user_role() IN ('admin', 'super_admin'));

GRANT ALL ON public.zelle_accounts TO authenticated;

-- =============================================================================
-- 14. ZELLE PAYMENT STATS - Admin only
-- =============================================================================
ALTER TABLE public.zelle_payment_stats ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Zelle payment stats viewable by admins" ON public.zelle_payment_stats;
DROP POLICY IF EXISTS "Zelle payment stats manageable by admins" ON public.zelle_payment_stats;

CREATE POLICY "Zelle payment stats viewable by admins"
ON public.zelle_payment_stats FOR SELECT
TO authenticated
USING (public.current_user_role() IN ('admin', 'super_admin'));

CREATE POLICY "Zelle payment stats manageable by admins"
ON public.zelle_payment_stats FOR ALL
TO authenticated
USING (public.current_user_role() IN ('admin', 'super_admin'))
WITH CHECK (public.current_user_role() IN ('admin', 'super_admin'));

GRANT ALL ON public.zelle_payment_stats TO authenticated;

-- =============================================================================
-- 15. SHOPPING CARTS - User own + Admin
-- =============================================================================
ALTER TABLE public.shopping_carts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage own carts" ON public.shopping_carts;
DROP POLICY IF EXISTS "Admins can manage all carts" ON public.shopping_carts;

CREATE POLICY "Users can manage own carts"
ON public.shopping_carts FOR ALL
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

CREATE POLICY "Admins can manage all carts"
ON public.shopping_carts FOR ALL
TO authenticated
USING (public.current_user_role() IN ('admin', 'super_admin'))
WITH CHECK (public.current_user_role() IN ('admin', 'super_admin'));

GRANT ALL ON public.shopping_carts TO authenticated;

-- =============================================================================
-- 16. CART ITEMS - User own + Admin
-- =============================================================================
ALTER TABLE public.cart_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage own cart items" ON public.cart_items;
DROP POLICY IF EXISTS "Admins can manage all cart items" ON public.cart_items;

CREATE POLICY "Users can manage own cart items"
ON public.cart_items FOR ALL
TO authenticated
USING (EXISTS (
    SELECT 1 FROM public.shopping_carts
    WHERE shopping_carts.id = cart_items.cart_id
    AND shopping_carts.user_id = auth.uid()
));

CREATE POLICY "Admins can manage all cart items"
ON public.cart_items FOR ALL
TO authenticated
USING (public.current_user_role() IN ('admin', 'super_admin'))
WITH CHECK (public.current_user_role() IN ('admin', 'super_admin'));

GRANT ALL ON public.cart_items TO authenticated;

-- =============================================================================
-- 17. ORDER ITEMS - User own + Admin
-- =============================================================================
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own order items" ON public.order_items;
DROP POLICY IF EXISTS "Admins can manage all order items" ON public.order_items;

CREATE POLICY "Users can view own order items"
ON public.order_items FOR SELECT
TO authenticated
USING (EXISTS (
    SELECT 1 FROM public.orders
    WHERE orders.id = order_items.order_id
    AND orders.user_id = auth.uid()
));

CREATE POLICY "Admins can manage all order items"
ON public.order_items FOR ALL
TO authenticated
USING (public.current_user_role() IN ('admin', 'super_admin'))
WITH CHECK (public.current_user_role() IN ('admin', 'super_admin'));

GRANT ALL ON public.order_items TO authenticated;

-- =============================================================================
-- 18. ORDER STATUS HISTORY - User own + Admin
-- =============================================================================
ALTER TABLE public.order_status_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own order history" ON public.order_status_history;
DROP POLICY IF EXISTS "Admins can manage all order history" ON public.order_status_history;

CREATE POLICY "Users can view own order history"
ON public.order_status_history FOR SELECT
TO authenticated
USING (EXISTS (
    SELECT 1 FROM public.orders
    WHERE orders.id = order_status_history.order_id
    AND orders.user_id = auth.uid()
));

CREATE POLICY "Admins can manage all order history"
ON public.order_status_history FOR ALL
TO authenticated
USING (public.current_user_role() IN ('admin', 'super_admin'))
WITH CHECK (public.current_user_role() IN ('admin', 'super_admin'));

GRANT ALL ON public.order_status_history TO authenticated;

-- =============================================================================
-- 19. INVENTORY MOVEMENTS - Admin only
-- =============================================================================
ALTER TABLE public.inventory_movements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Inventory movements viewable by admins" ON public.inventory_movements;
DROP POLICY IF EXISTS "Inventory movements manageable by admins" ON public.inventory_movements;

CREATE POLICY "Inventory movements viewable by admins"
ON public.inventory_movements FOR SELECT
TO authenticated
USING (public.current_user_role() IN ('admin', 'super_admin'));

CREATE POLICY "Inventory movements manageable by admins"
ON public.inventory_movements FOR ALL
TO authenticated
USING (public.current_user_role() IN ('admin', 'super_admin'))
WITH CHECK (public.current_user_role() IN ('admin', 'super_admin'));

GRANT ALL ON public.inventory_movements TO authenticated;

-- =============================================================================
-- 20. NOTIFICATION LOGS - Admin only
-- =============================================================================
ALTER TABLE public.notification_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Notification logs viewable by admins" ON public.notification_logs;
DROP POLICY IF EXISTS "Notification logs manageable by admins" ON public.notification_logs;

CREATE POLICY "Notification logs viewable by admins"
ON public.notification_logs FOR SELECT
TO authenticated
USING (public.current_user_role() IN ('admin', 'super_admin'));

CREATE POLICY "Notification logs manageable by admins"
ON public.notification_logs FOR ALL
TO authenticated
USING (public.current_user_role() IN ('admin', 'super_admin'))
WITH CHECK (public.current_user_role() IN ('admin', 'super_admin'));

GRANT ALL ON public.notification_logs TO authenticated;

-- =============================================================================
-- 21. NOTIFICATION SETTINGS - Admin only
-- =============================================================================
ALTER TABLE public.notification_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Notification settings viewable by admins" ON public.notification_settings;
DROP POLICY IF EXISTS "Notification settings manageable by admins" ON public.notification_settings;

CREATE POLICY "Notification settings viewable by admins"
ON public.notification_settings FOR SELECT
TO authenticated
USING (public.current_user_role() IN ('admin', 'super_admin'));

CREATE POLICY "Notification settings manageable by admins"
ON public.notification_settings FOR ALL
TO authenticated
USING (public.current_user_role() IN ('admin', 'super_admin'))
WITH CHECK (public.current_user_role() IN ('admin', 'super_admin'));

GRANT ALL ON public.notification_settings TO authenticated;

-- =============================================================================
-- 22. SITE VISITS - Admin only
-- =============================================================================
ALTER TABLE public.site_visits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Site visits viewable by admins" ON public.site_visits;
DROP POLICY IF EXISTS "Site visits manageable by admins" ON public.site_visits;

CREATE POLICY "Site visits viewable by admins"
ON public.site_visits FOR SELECT
TO authenticated
USING (public.current_user_role() IN ('admin', 'super_admin'));

CREATE POLICY "Site visits manageable by admins"
ON public.site_visits FOR ALL
TO authenticated
USING (public.current_user_role() IN ('admin', 'super_admin'))
WITH CHECK (public.current_user_role() IN ('admin', 'super_admin'));

GRANT ALL ON public.site_visits TO authenticated;

-- =============================================================================
-- VERIFICATION QUERY
-- =============================================================================
-- Run this to verify all tables have RLS enabled
SELECT
    schemaname,
    tablename,
    rowsecurity as rls_enabled
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;

-- Run this to see all policies
SELECT
    schemaname,
    tablename,
    policyname,
    permissive,
    roles,
    cmd,
    qual
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;
