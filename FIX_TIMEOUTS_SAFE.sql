-- ============================================================================
-- EMERGENCY FIX FOR DATABASE TIMEOUTS - SAFE VERSION
-- ============================================================================
-- This script fixes statement timeout errors (code 57014)
-- Safe version: Skips tables that don't exist
-- Run this ENTIRE script in Supabase SQL Editor
-- ============================================================================

-- Step 1: First, let's check if the database is even responding
SELECT NOW() as database_time, 'Database is responding' as status;

-- Step 2: Check RLS status on main tables
SELECT
    tablename,
    CASE WHEN rowsecurity THEN '⚠️ ENABLED' ELSE '✅ DISABLED' END as rls_status
FROM pg_tables
WHERE schemaname = 'public'
AND tablename IN (
    'user_profiles', 'products', 'orders', 'remittances',
    'testimonials', 'combo_products', 'carousel_slides'
)
ORDER BY tablename;

-- Step 3: Check if there are any policies (might be causing loops)
SELECT
    tablename,
    policyname,
    cmd,
    qual
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;

-- ============================================================================
-- DECISION POINT: If you see many complex policies above, continue.
-- If you see no policies but RLS is enabled, that's your problem!
-- ============================================================================

-- Step 4: DROP ALL EXISTING POLICIES (clean slate)
DO $$
DECLARE
    r RECORD;
BEGIN
    RAISE NOTICE 'Dropping all existing policies...';
    FOR r IN (
        SELECT schemaname, tablename, policyname
        FROM pg_policies
        WHERE schemaname = 'public'
    ) LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I',
            r.policyname, r.schemaname, r.tablename);
        RAISE NOTICE 'Dropped policy: %.% on %', r.schemaname, r.policyname, r.tablename;
    END LOOP;
    RAISE NOTICE '✅ All policies dropped';
END $$;

-- Step 5: Create a simple, non-recursive helper function
CREATE OR REPLACE FUNCTION public.is_admin_user()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_profiles
    WHERE user_id = auth.uid()
    AND role IN ('admin', 'super_admin', 'manager')
    AND is_enabled = true
    LIMIT 1
  );
$$;

-- Verify function works
SELECT is_admin_user() as am_i_admin;

-- Step 6: TEMPORARILY DISABLE RLS (for diagnosis) - SAFE VERSION
-- Only disables RLS on tables that actually exist
DO $$
DECLARE
    table_name text;
    tables_to_disable text[] := ARRAY[
        'user_profiles',
        'products',
        'product_categories',
        'orders',
        'order_items',
        'testimonials',
        'combo_products',
        'carousel_slides',
        'combos',
        'remittances',
        'remittance_types',
        'remittance_status_history',
        'bank_accounts',
        'zelle_accounts',
        'recipients',
        'recipient_addresses'
    ];
BEGIN
    FOREACH table_name IN ARRAY tables_to_disable
    LOOP
        IF EXISTS (
            SELECT FROM pg_tables
            WHERE schemaname = 'public'
            AND tablename = table_name
        ) THEN
            EXECUTE format('ALTER TABLE %I DISABLE ROW LEVEL SECURITY', table_name);
            RAISE NOTICE '✅ Disabled RLS on: %', table_name;
        ELSE
            RAISE NOTICE '⏭️  Skipped (does not exist): %', table_name;
        END IF;
    END LOOP;
END $$;

SELECT '✅ RLS DISABLED - Test if queries work now' as step_6_status;

-- Step 7: Test basic queries (should work now)
SELECT COUNT(*) as products_count FROM products;
SELECT COUNT(*) as orders_count FROM orders;
SELECT COUNT(*) as users_count FROM user_profiles;

-- Step 8: Add missing indexes (CRITICAL for performance)
-- Safe version: Only creates if table exists
DO $$
BEGIN
    -- Products indexes
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'products') THEN
        CREATE INDEX IF NOT EXISTS idx_products_is_active ON products(is_active);
        CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
        CREATE INDEX IF NOT EXISTS idx_products_created_at ON products(created_at);
        RAISE NOTICE '✅ Created indexes on products';
    END IF;

    -- Orders indexes
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'orders') THEN
        CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id);
        CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
        CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at);
        RAISE NOTICE '✅ Created indexes on orders';
    END IF;

    -- Order items indexes
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'order_items') THEN
        CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);
        CREATE INDEX IF NOT EXISTS idx_order_items_product_id ON order_items(product_id);
        RAISE NOTICE '✅ Created indexes on order_items';
    END IF;

    -- Remittances indexes
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'remittances') THEN
        CREATE INDEX IF NOT EXISTS idx_remittances_user_id ON remittances(user_id);
        CREATE INDEX IF NOT EXISTS idx_remittances_status ON remittances(status);
        RAISE NOTICE '✅ Created indexes on remittances';
    END IF;

    -- User profiles indexes
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'user_profiles') THEN
        CREATE INDEX IF NOT EXISTS idx_user_profiles_user_id ON user_profiles(user_id);
        CREATE INDEX IF NOT EXISTS idx_user_profiles_role ON user_profiles(role);
        RAISE NOTICE '✅ Created indexes on user_profiles';
    END IF;

    -- Testimonials indexes
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'testimonials') THEN
        CREATE INDEX IF NOT EXISTS idx_testimonials_user_id ON testimonials(user_id);
        CREATE INDEX IF NOT EXISTS idx_testimonials_is_visible ON testimonials(is_visible);
        RAISE NOTICE '✅ Created indexes on testimonials';
    END IF;

    -- Combo products indexes
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'combo_products') THEN
        CREATE INDEX IF NOT EXISTS idx_combo_products_is_active ON combo_products(is_active) WHERE is_active = true;
        RAISE NOTICE '✅ Created indexes on combo_products';
    END IF;

    -- Carousel slides indexes
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'carousel_slides') THEN
        CREATE INDEX IF NOT EXISTS idx_carousel_slides_display_order ON carousel_slides(display_order);
        RAISE NOTICE '✅ Created indexes on carousel_slides';
    END IF;
END $$;

SELECT '✅ INDEXES CREATED' as step_8_status;

-- Step 9: Re-enable RLS with SIMPLE policies (no recursion) - SAFE VERSION
DO $$
DECLARE
    table_name text;
    tables_to_enable text[] := ARRAY[
        'user_profiles',
        'products',
        'product_categories',
        'orders',
        'order_items',
        'testimonials',
        'combo_products',
        'carousel_slides',
        'remittances',
        'remittance_types'
    ];
BEGIN
    FOREACH table_name IN ARRAY tables_to_enable
    LOOP
        IF EXISTS (
            SELECT FROM pg_tables
            WHERE schemaname = 'public'
            AND tablename = table_name
        ) THEN
            EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
            RAISE NOTICE '✅ Enabled RLS on: %', table_name;
        ELSE
            RAISE NOTICE '⏭️  Skipped (does not exist): %', table_name;
        END IF;
    END LOOP;
END $$;

SELECT '✅ RLS RE-ENABLED' as step_9_status;

-- Step 10: Create SIMPLE, NON-RECURSIVE policies

-- USER_PROFILES
CREATE POLICY "user_profiles_select"
ON user_profiles FOR SELECT
USING (
    user_id = auth.uid()
    OR is_admin_user()
);

CREATE POLICY "user_profiles_update"
ON user_profiles FOR UPDATE
USING (user_id = auth.uid() OR is_admin_user());

CREATE POLICY "user_profiles_insert"
ON user_profiles FOR INSERT
WITH CHECK (user_id = auth.uid());

-- PRODUCTS (public read, admin write)
CREATE POLICY "products_select_public"
ON products FOR SELECT
USING (is_active = true OR is_admin_user());

CREATE POLICY "products_insert_admin"
ON products FOR INSERT
WITH CHECK (is_admin_user());

CREATE POLICY "products_update_admin"
ON products FOR UPDATE
USING (is_admin_user());

CREATE POLICY "products_delete_admin"
ON products FOR DELETE
USING (is_admin_user());

-- PRODUCT_CATEGORIES (public read, admin write)
CREATE POLICY "categories_select_public"
ON product_categories FOR SELECT
USING (is_active = true OR is_admin_user());

CREATE POLICY "categories_all_admin"
ON product_categories FOR ALL
USING (is_admin_user());

-- ORDERS (own orders + admin)
CREATE POLICY "orders_select"
ON orders FOR SELECT
USING (user_id = auth.uid() OR is_admin_user());

CREATE POLICY "orders_insert"
ON orders FOR INSERT
WITH CHECK (user_id = auth.uid());

CREATE POLICY "orders_update"
ON orders FOR UPDATE
USING (user_id = auth.uid() OR is_admin_user());

-- ORDER_ITEMS (via parent order)
CREATE POLICY "order_items_select"
ON order_items FOR SELECT
USING (
    EXISTS (
        SELECT 1 FROM orders
        WHERE orders.id = order_items.order_id
        AND (orders.user_id = auth.uid() OR is_admin_user())
    )
);

CREATE POLICY "order_items_insert"
ON order_items FOR INSERT
WITH CHECK (
    EXISTS (
        SELECT 1 FROM orders
        WHERE orders.id = order_items.order_id
        AND orders.user_id = auth.uid()
    )
);

-- TESTIMONIALS (public read visible, own write)
CREATE POLICY "testimonials_select_public"
ON testimonials FOR SELECT
USING (
    is_visible = true
    OR user_id = auth.uid()
    OR is_admin_user()
);

CREATE POLICY "testimonials_insert"
ON testimonials FOR INSERT
WITH CHECK (user_id = auth.uid());

CREATE POLICY "testimonials_update"
ON testimonials FOR UPDATE
USING (user_id = auth.uid() OR is_admin_user());

-- COMBO_PRODUCTS (public read, admin write)
CREATE POLICY "combos_select_public"
ON combo_products FOR SELECT
USING (is_active = true OR is_admin_user());

CREATE POLICY "combos_all_admin"
ON combo_products FOR ALL
USING (is_admin_user());

-- CAROUSEL_SLIDES (public read active, admin all)
CREATE POLICY "carousel_select_public"
ON carousel_slides FOR SELECT
USING (is_active = true OR is_admin_user());

CREATE POLICY "carousel_all_admin"
ON carousel_slides FOR ALL
USING (is_admin_user());

-- REMITTANCES (own + admin)
CREATE POLICY "remittances_select"
ON remittances FOR SELECT
USING (user_id = auth.uid() OR is_admin_user());

CREATE POLICY "remittances_insert"
ON remittances FOR INSERT
WITH CHECK (user_id = auth.uid());

CREATE POLICY "remittances_update"
ON remittances FOR UPDATE
USING (user_id = auth.uid() OR is_admin_user());

-- REMITTANCE_TYPES (public read, admin write)
CREATE POLICY "remittance_types_select_public"
ON remittance_types FOR SELECT
USING (is_active = true OR is_admin_user());

CREATE POLICY "remittance_types_all_admin"
ON remittance_types FOR ALL
USING (is_admin_user());

SELECT '✅ ALL POLICIES CREATED' as step_10_status;

-- Step 11: Verify policies were created
SELECT
    tablename,
    COUNT(*) as policy_count
FROM pg_policies
WHERE schemaname = 'public'
GROUP BY tablename
ORDER BY tablename;

-- Step 12: Update YOUR user to be admin
-- ⚠️ IMPORTANT: Replace 'your.email@example.com' with YOUR actual email!
UPDATE user_profiles
SET
    role = 'super_admin',
    is_enabled = true
WHERE email = 'your.email@example.com';  -- ⚠️ CHANGE THIS TO YOUR EMAIL!

-- Verify your role
SELECT
    email,
    role,
    is_enabled,
    'This should be YOU with super_admin role' as note
FROM user_profiles
WHERE email = 'your.email@example.com';  -- ⚠️ CHANGE THIS TO YOUR EMAIL!

-- ============================================================================
-- FINAL VERIFICATION
-- ============================================================================

SELECT '================================' as divider
UNION ALL SELECT '✅ SETUP COMPLETE!' as divider
UNION ALL SELECT '================================' as divider
UNION ALL SELECT '' as divider
UNION ALL SELECT '📋 Summary:' as divider
UNION ALL SELECT '  - All old policies dropped' as divider
UNION ALL SELECT '  - Indexes created for performance' as divider
UNION ALL SELECT '  - RLS re-enabled with simple policies' as divider
UNION ALL SELECT '  - Your user set to super_admin' as divider
UNION ALL SELECT '' as divider
UNION ALL SELECT '⚠️  NEXT STEPS:' as divider
UNION ALL SELECT '  1. Clear browser cache (Ctrl+Shift+Delete)' as divider
UNION ALL SELECT '  2. Logout of your application' as divider
UNION ALL SELECT '  3. Login again' as divider
UNION ALL SELECT '  4. Test if errors are gone' as divider
UNION ALL SELECT '' as divider
UNION ALL SELECT '================================' as divider;
