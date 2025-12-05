# Database Timeout Fixes - Complete Checklist

## Files Created
- [x] DATABASE_TIMEOUT_ROOT_CAUSE_ANALYSIS.md
- [x] TIMEOUT_VISUAL_BREAKDOWN.txt  
- [x] FIXES_CHECKLIST.md (this file)

---

## CRITICAL FIXES - DO FIRST

### Fix #1: Add LIMIT 1 to Storage Bucket Policies
**File:** `/home/juan/Workspace/papuenvios/supabase/migrations/20251112000002_create_storage_buckets.sql`

**Changes Required:**

1. **Line 30 - ADD LIMIT 1**
   ```sql
   CREATE POLICY "managers can upload order delivery proofs"
   ON storage.objects
   FOR INSERT
   TO authenticated
   WITH CHECK (
     bucket_id = 'order-delivery-proofs' AND
     EXISTS (
       SELECT 1 FROM public.user_profiles
       WHERE id = auth.uid()
       AND role IN ('admin', 'super_admin', 'manager')
   +   LIMIT 1
     )
   );
   ```

2. **Lines 48-61 - ADD LIMIT 1 TO BOTH NESTED EXISTS**
   ```sql
   CREATE POLICY "users can view order delivery proofs"
   ON storage.objects
   FOR SELECT
   TO authenticated
   USING (
     bucket_id = 'order-delivery-proofs' AND
     (
       (auth.uid())::text = (storage.foldername(name))[1] OR
       EXISTS (
         SELECT 1 FROM public.orders
         WHERE id = (storage.foldername(name))[2]::uuid
         AND (
           orders.user_id = auth.uid() OR
           EXISTS (
             SELECT 1 FROM public.user_profiles
             WHERE id = auth.uid()
             AND role IN ('admin', 'super_admin', 'manager')
   +         LIMIT 1
           )
         )
   +     LIMIT 1
       )
     )
   );
   ```

3. **Line 84 - ADD LIMIT 1**
   ```sql
   CREATE POLICY "admins can view all order delivery proofs"
   ON storage.objects
   FOR SELECT
   TO authenticated
   USING (
     bucket_id = 'order-delivery-proofs' AND
     EXISTS (
       SELECT 1 FROM public.user_profiles
       WHERE id = auth.uid()
       AND role IN ('admin', 'super_admin')
   +   LIMIT 1
     )
   );
   ```

4. **Line 104 - ADD LIMIT 1**
   ```sql
   CREATE POLICY "managers can upload remittance delivery proofs"
   ON storage.objects
   FOR INSERT
   TO authenticated
   WITH CHECK (
     bucket_id = 'remittance-delivery-proofs' AND
     EXISTS (
       SELECT 1 FROM public.user_profiles
       WHERE id = auth.uid()
       AND role IN ('admin', 'super_admin', 'manager')
   +   LIMIT 1
     )
   );
   ```

5. **Lines 122-135 - ADD LIMIT 1 TO BOTH NESTED EXISTS**
   ```sql
   CREATE POLICY "users can view remittance delivery proofs"
   ON storage.objects
   FOR SELECT
   TO authenticated
   USING (
     bucket_id = 'remittance-delivery-proofs' AND
     (
       (auth.uid())::text = (storage.foldername(name))[1] OR
       EXISTS (
         SELECT 1 FROM public.remittances
         WHERE id = (storage.foldername(name))[2]::uuid
         AND (
           remittances.user_id = auth.uid() OR
           EXISTS (
             SELECT 1 FROM public.user_profiles
             WHERE id = auth.uid()
             AND role IN ('admin', 'super_admin', 'manager')
   +         LIMIT 1
           )
         )
   +     LIMIT 1
       )
     )
   );
   ```

6. **Line 158 - ADD LIMIT 1**
   ```sql
   CREATE POLICY "admins can view all remittance delivery proofs"
   ON storage.objects
   FOR SELECT
   TO authenticated
   USING (
     bucket_id = 'remittance-delivery-proofs' AND
     EXISTS (
       SELECT 1 FROM public.user_profiles
       WHERE id = auth.uid()
       AND role IN ('admin', 'super_admin', 'manager')
   +   LIMIT 1
     )
   );
   ```

---

### Fix #2: Create Performance Indices Migration
**File:** `/home/juan/Workspace/papuenvios/supabase/migrations/20251113000000_add_rls_performance_indices.sql` (CREATE NEW FILE)

```sql
-- ============================================================================
-- ADD PERFORMANCE INDICES FOR RLS POLICIES
-- Created: 2025-11-13
-- Purpose: Speed up RLS policy evaluation
-- ============================================================================

-- 1. Speed up is_admin(), is_super_admin(), is_manager() checks
CREATE INDEX IF NOT EXISTS idx_user_profiles_id_role 
  ON public.user_profiles(id) INCLUDE (role) 
  WHERE is_enabled = true;

-- 2. Speed up user-based access control
CREATE INDEX IF NOT EXISTS idx_user_profiles_role_id
  ON public.user_profiles(role, id);

-- 3. Speed up product queries
CREATE INDEX IF NOT EXISTS idx_products_active_created
  ON public.products(is_active, created_at DESC);

-- 4. Speed up inventory lookups
CREATE INDEX IF NOT EXISTS idx_inventory_product_active
  ON public.inventory(product_id, is_active);

-- 5. Speed up testimonial lookups
CREATE INDEX IF NOT EXISTS idx_testimonials_visible_user
  ON public.testimonials(is_visible, user_id);

-- 6. Speed up order lookups in storage policies
CREATE INDEX IF NOT EXISTS idx_orders_user_id_id
  ON public.orders(user_id, id);

-- 7. Speed up remittance lookups in storage policies
CREATE INDEX IF NOT EXISTS idx_remittances_user_id_id
  ON public.remittances(user_id, id);

-- 8. Speed up carousel queries
CREATE INDEX IF NOT EXISTS idx_carousel_slides_active_order
  ON public.carousel_slides(is_active, display_order);

-- 9. Speed up category lookups
CREATE INDEX IF NOT EXISTS idx_product_categories_active_order
  ON public.product_categories(is_active, display_order);

-- 10. Speed up manager_assignments lookups
CREATE INDEX IF NOT EXISTS idx_manager_assignments_manager_active
  ON public.manager_assignments(manager_id)
  WHERE removed_at IS NULL;

-- 11. Speed up category checks
CREATE INDEX IF NOT EXISTS idx_user_categories_user_id
  ON public.user_categories(user_id)
  WHERE effective_to IS NULL;

-- 12. Speed up category history lookups
CREATE INDEX IF NOT EXISTS idx_user_category_history_user_changed
  ON public.user_category_history(user_id, changed_at DESC);

-- ============================================================================
```

---

## HIGH PRIORITY FIXES

### Fix #3: Update Frontend Timeouts
**File:** `/home/juan/Workspace/papuenvios/src/lib/constants.js`

**Lines 23-28 - CHANGE TIMEOUT VALUES:**
```diff
export const TIMEOUTS = {
-  PROFILE_FETCH: 15000,     // 15s
-  INIT_AUTH: 20000,         // 20s
-  DEFAULT_QUERY: 10000,     // 10s
-  CAROUSEL_SLIDE: 5000,     // 5s
+  PROFILE_FETCH: 30000,     // 30s - Give RLS time to evaluate
+  INIT_AUTH: 45000,         // 45s - Give all 5 parallel queries time
+  DEFAULT_QUERY: 25000,     // 25s - Increased for complex queries
+  CAROUSEL_SLIDE: 15000,    // 15s - Increased for RLS evaluation
};
```

---

### Fix #4: Optimize Testimonials Service
**File:** `/home/juan/Workspace/papuenvios/src/lib/testimonialService.js`

**Lines 17-62 - REFACTOR getTestimonials():**
```diff
export const getTestimonials = async (adminView = false) => {
  try {
    let query = supabase
      .from('testimonials')
      .select('*')
      .order('created_at', { ascending: false });

    // Public view: only show visible testimonials
    if (!adminView) {
      query = query.eq('is_visible', true);
    }

    const { data: testimonials, error } = await query;

    if (error) throw error;

-   // Fetch user profiles for all testimonials
+   // FOR ADMIN VIEW ONLY: Fetch user profiles with limit
-   if (testimonials && testimonials.length > 0) {
+   if (adminView && testimonials && testimonials.length > 0) {
      const userIds = [...new Set(testimonials.map(t => t.user_id))];

      const { data: profiles } = await supabase
        .from('user_profiles')
        .select('user_id, full_name, avatar_url')
-       .in('user_id', userIds);
+       .in('user_id', userIds)
+       .limit(100);  // IMPORTANT: Limit RLS evaluations

      // Create a map and attach profiles to testimonials
      const profileMap = {};
      if (profiles) {
        profiles.forEach(profile => {
          profileMap[profile.user_id] = profile;
        });
      }

      testimonials.forEach(testimonial => {
        const profile = profileMap[testimonial.user_id];
        testimonial.user_name = profile?.full_name || 'Usuario';
        testimonial.user_avatar = profile?.avatar_url || testimonial.user_photo;
      });
    }

    return { data: testimonials, error: null };
  } catch (error) {
    console.error('Error fetching testimonials:', error);
    return { data: null, error };
  }
};
```

---

## MEDIUM PRIORITY FIXES

### Fix #5: Batch Initial Queries
**File:** `/home/juan/Workspace/papuenvios/src/contexts/BusinessContext.jsx`

**Lines 222-236 - STAGGER REQUESTS:**
```diff
const loadInitialData = async () => {
  setLoading(true);
+  // Load critical data first (products, categories)
+  // Then load secondary data (testimonials, slides)
+  
+  // First batch: Essential table data
-  await Promise.all([
+  await Promise.all([
    refreshProducts(),
    refreshCategories(),
-   refreshCombos(),
-   refreshTestimonials(false), // Public view
-   refreshCarouselSlides(false) // All slides for admin
  ]);
+  
+  // Second batch: UI enhancement data (after essential data loads)
+  await Promise.all([
+   refreshCombos(),
+   refreshTestimonials(false), // Public view
+   refreshCarouselSlides(false) // All slides for admin
  ]);
  setLoading(false);
};
```

---

## OPTIONAL IMPROVEMENTS

### Fix #6: Optimize Product Inventory Query
**File:** `/home/juan/Workspace/papuenvios/src/lib/productService.js`

**Lines 28-33 - ADD LIMIT:**
```diff
const { data: inventoryData } = await supabase
  .from('inventory')
  .select('product_id, quantity, available_quantity, expiry_date')
  .in('product_id', productIds)
  .eq('is_active', true)
  .order('created_at', { ascending: false })
+ .limit(productIds.length);  // Limit RLS evaluations
```

---

## VERIFICATION STEPS

After making all changes:

1. **Deploy migrations to Supabase:**
   ```bash
   npx supabase migration push
   ```

2. **Verify indices were created:**
   ```sql
   SELECT indexname FROM pg_indexes 
   WHERE tablename IN ('user_profiles', 'products', 'inventory', 'testimonials', 'orders', 'remittances', 'carousel_slides', 'product_categories')
   ORDER BY indexname;
   ```

3. **Test each query:**
   - Load homepage and check browser console
   - Should see all 5 queries complete within 2-3 seconds
   - No ERROR 57014 timeouts

4. **Monitor query performance:**
   - Use Supabase dashboard to check query times
   - Expect <500ms per query
   - RLS evaluation should be <50ms per row

---

## DEPLOYMENT CHECKLIST

- [ ] Update `20251112000002_create_storage_buckets.sql` with LIMIT 1
- [ ] Create `20251113000000_add_rls_performance_indices.sql`
- [ ] Update `src/lib/constants.js` timeouts
- [ ] Update `src/lib/testimonialService.js` to skip profile fetch
- [ ] Update `src/contexts/BusinessContext.jsx` to batch queries
- [ ] Update `src/lib/productService.js` to add inventory limit
- [ ] Deploy migrations to Supabase
- [ ] Deploy frontend code
- [ ] Test homepage load
- [ ] Monitor for ERROR 57014
- [ ] Verify query performance in Supabase logs

---

## EXPECTED RESULTS

**Before Fixes:**
- GET /products: ERROR 57014 (timeout after 5s)
- GET /categories: ERROR 57014 (timeout after 5s)
- GET /testimonials: ERROR 57014 (timeout after 5s)
- GET /carousel_slides: ERROR 57014 (timeout after 5s)
- GET /user_profiles: ERROR 57014 (timeout after 5s)

**After Fixes:**
- GET /products: 200 OK (completed in ~300ms)
- GET /categories: 200 OK (completed in ~150ms)
- GET /testimonials: 200 OK (completed in ~200ms)
- GET /carousel_slides: 200 OK (completed in ~100ms)
- GET /user_profiles: 200 OK (completed in ~100ms)

Total page load time: 1-2 seconds (vs. failing at 5 seconds currently)

---

## ESTIMATED EFFORT

| Task | Time | Complexity |
|------|------|-----------|
| Fix #1: Storage bucket LIMIT 1 | 30 min | Low |
| Fix #2: Create indices migration | 30 min | Low |
| Fix #3: Update timeouts | 5 min | Trivial |
| Fix #4: Testimonials optimization | 30 min | Low |
| Fix #5: Batch queries | 20 min | Low |
| Fix #6: Inventory limit | 10 min | Trivial |
| Testing & verification | 30 min | Medium |
| **TOTAL** | **~2.5 hours** | **Low-Medium** |

