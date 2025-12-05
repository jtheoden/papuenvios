-- ============================================================================
-- CRITICAL: ADD MISSING INDICES FOR RLS PERFORMANCE
-- ============================================================================
-- This fixes ERROR 57014 (statement timeout) on profile fetch
-- Reason: RLS policies check user_profiles without indices
-- ============================================================================

-- STEP 1: The MOST CRITICAL index - used by ALL RLS policies
-- This is checked on EVERY query that evaluates RLS
CREATE INDEX IF NOT EXISTS idx_user_profiles_id_user_id
ON public.user_profiles(id, user_id);

-- Also create index on user_id alone for lookups
CREATE INDEX IF NOT EXISTS idx_user_profiles_user_id
ON public.user_profiles(user_id);

-- STEP 2: Indices for role lookups (used in RLS WHERE conditions)
CREATE INDEX IF NOT EXISTS idx_user_profiles_id_role
ON public.user_profiles(id, role);

CREATE INDEX IF NOT EXISTS idx_user_profiles_user_id_role
ON public.user_profiles(user_id, role);

-- STEP 3: Indices for data table queries (prevent timeouts on SELECT)
CREATE INDEX IF NOT EXISTS idx_products_is_active_created
ON public.products(is_active, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_product_categories_is_active_display
ON public.product_categories(is_active, display_order ASC);

CREATE INDEX IF NOT EXISTS idx_testimonials_is_visible_created
ON public.testimonials(is_visible, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_carousel_slides_display_order
ON public.carousel_slides(display_order ASC);

-- STEP 4: Indices for relational lookups in RLS policies
CREATE INDEX IF NOT EXISTS idx_orders_id_user_id
ON public.orders(id, user_id);

CREATE INDEX IF NOT EXISTS idx_remittances_id_user_id
ON public.remittances(id, user_id);

-- STEP 5: Analyze tables to update query planner statistics
ANALYZE public.user_profiles;
ANALYZE public.products;
ANALYZE public.testimonials;
ANALYZE public.carousel_slides;
ANALYZE public.product_categories;
ANALYZE public.orders;
ANALYZE public.remittances;

-- STEP 6: Record that we applied these indices
INSERT INTO _migrations_applied (migration) VALUES
('20251113000006_add_critical_indices_for_rls_performance')
ON CONFLICT (migration) DO NOTHING;

-- STEP 7: Verify indices were created
SELECT
    '✅ Critical Indices Created:' as status,
    COUNT(*) as index_count
FROM pg_indexes
WHERE schemaname = 'public'
AND indexname LIKE 'idx_%'
AND indexname IN (
    'idx_user_profiles_id_user_id',
    'idx_user_profiles_user_id',
    'idx_user_profiles_id_role',
    'idx_user_profiles_user_id_role',
    'idx_products_is_active_created',
    'idx_product_categories_is_active_display',
    'idx_testimonials_is_visible_created',
    'idx_carousel_slides_display_order',
    'idx_orders_id_user_id',
    'idx_remittances_id_user_id'
);

SELECT '✅ SUCCESS: Indices created and statistics updated!' as final_status;
