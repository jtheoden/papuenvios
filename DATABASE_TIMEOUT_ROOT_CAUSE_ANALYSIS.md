# Database Timeout Analysis: ERROR 57014 (Statement Timeout)

## EXECUTIVE SUMMARY

All database queries timeout with ERROR 57014 due to **nested EXISTS subqueries in RLS policies WITHOUT LIMIT 1**, causing the database to scan entire tables instead of early-stopping. The RLS policy functions are being called multiple times per request, and storage bucket policies have DEEPLY NESTED EXISTS clauses that scan the entire `user_profiles` table for EVERY ROW being evaluated.

---

## ROOT CAUSES IDENTIFIED

### 1. CRITICAL: Nested EXISTS Subqueries WITHOUT LIMIT 1 in RLS Policies

**Location:** `/home/juan/Workspace/papuenvios/supabase/migrations/20251112000002_create_storage_buckets.sql`

**Problem:** Storage bucket RLS policies have nested EXISTS subqueries that REQUIRE the database to scan entire tables. Each policy without LIMIT 1 performs a full table scan.

**Example from lines 48-61:**
```sql
-- Lines 48-61 have nested EXISTS without LIMIT 1
EXISTS (
  SELECT 1 FROM public.orders              -- Scans all orders
  WHERE id = (storage.foldername(name))[2]::uuid
  AND (
    orders.user_id = auth.uid() OR
    EXISTS (                               -- NESTED: Scans all user_profiles
      SELECT 1 FROM public.user_profiles
      WHERE id = auth.uid()
      AND role IN ('admin', 'super_admin', 'manager')
      -- MISSING: LIMIT 1
    )
  )
)
```

**Impact:** For every file object in storage, PostgreSQL evaluates:
- Outer EXISTS: Scans entire `orders` table
- Inner EXISTS: Scans entire `user_profiles` table
- With multiple storage objects, this is O(n*m) complexity

**Similar Issues in:**
- Lines 30-35: "managers can upload order delivery proofs"
- Lines 84-89: "admins can view all order delivery proofs"
- Lines 104-109: "managers can upload remittance delivery proofs"
- Lines 122-135: "users can view remittance delivery proofs" (WORST: double nested)
- Lines 158-163: "admins can view all remittance delivery proofs"

---

### 2. MISSING INDICES FOR RLS POLICY EVALUATION

**Missing indices that would speed up RLS policy checks:**

```sql
-- Missing indices for RLS policies
CREATE INDEX IF NOT EXISTS idx_user_profiles_id_role 
  ON public.user_profiles(id) INCLUDE (role);
  -- Speeds up: is_admin(), is_super_admin(), is_manager() lookups

CREATE INDEX IF NOT EXISTS idx_user_profiles_role 
  ON public.user_profiles(role) 
  WHERE is_enabled = true;
  -- Speeds up: role-based policy checks

CREATE INDEX IF NOT EXISTS idx_orders_user_id_id
  ON public.orders(user_id, id);
  -- Speeds up: "users can view own orders" policy

CREATE INDEX IF NOT EXISTS idx_remittances_user_id_id
  ON public.remittances(user_id, id);
  -- Speeds up: "users can view own remittances" policy

CREATE INDEX IF NOT EXISTS idx_testimonials_user_id
  ON public.testimonials(user_id);
  -- Speeds up: testimonial ownership checks
```

---

### 3. CRITICAL: Functions Being Called Multiple Times Per Request

**Location:** `/home/juan/Workspace/papuenvios/supabase/migrations/20251112000001_optimize_rls_policies_CORRECTED.sql` lines 16-42

**Problem:** RLS functions `is_admin()`, `is_super_admin()`, `is_manager()` are STABLE (not IMMUTABLE), causing them to be re-executed for every row evaluation instead of being cached.

**Current Definition:**
```sql
CREATE OR REPLACE FUNCTION is_admin() RETURNS boolean AS $$
  SELECT COALESCE(role = 'admin', false)
  FROM public.user_profiles
  WHERE id = auth.uid()
  LIMIT 1;  -- GOOD: Has LIMIT 1
$$ LANGUAGE sql STABLE;   -- PROBLEM: STABLE, not IMMUTABLE
```

**Why It's Slow:**
- Each time a row is evaluated, PostgreSQL re-executes these functions
- With 1000 products returned, `is_admin()` is called 1000+ times
- Each call hits `user_profiles` table

---

### 4. N+1 Query Pattern in testimonialService.js

**Location:** `/home/juan/Workspace/papuenvios/src/lib/testimonialService.js` lines 17-62

**Problem:** Two separate queries instead of a JOIN:

```javascript
// Lines 19-29: First query gets all testimonials
const { data: testimonials, error } = await query;

// Lines 34-48: Second query gets user profiles
const { data: profiles } = await supabase
  .from('user_profiles')
  .select('user_id, full_name, avatar_url')
  .in('user_id', userIds);  // This still requires RLS evaluation!
```

**Why It Times Out:**
1. Query 1: Fetch testimonials (RLS checks every row: `is_visible = true`)
2. Query 2: Fetch profiles (RLS checks every profile: `user_id = auth.uid() OR is_admin()`)
3. With RLS, the second query MUST re-evaluate `is_admin()` for EVERY profile row
4. If 100 testimonials → 100 user profiles → 100 `is_admin()` calls

---

### 5. Frontend Timeout Configuration Too Short

**Location:** `/home/juan/Workspace/papuenvios/src/lib/constants.js` lines 23-28

**Current:**
```javascript
export const TIMEOUTS = {
  PROFILE_FETCH: 15000,     // 15s - TOO SHORT for slow RLS evaluation
  INIT_AUTH: 20000,         // 20s - TOO SHORT for initial data load
  DEFAULT_QUERY: 10000,     // 10s - WAY TOO SHORT for multiple joins + RLS
  CAROUSEL_SLIDE: 5000,     // 5s  - EXTREMELY SHORT
};
```

**Problem:** Frontend timeouts are too short. The queries hit Supabase's default statement timeout (usually 5-10s) BEFORE these timeouts, but increasing them buys time for RLS evaluation.

---

## DETAILED QUERY FAILURE ANALYSIS

### Query 1: GET /products (timeout)

**Flow:**
1. BusinessContext.jsx line 102: `getProducts()` called
2. productService.js lines 15-22: `.select(*) with category join + .eq('is_active', true)`
3. RLS Policy (migration 20251112000001 lines 188-192):
   ```sql
   CREATE POLICY "anyone can view products"
   ON public.products
   FOR SELECT
   TO public
   USING (true);  -- No RLS check, should be fast
   ```
4. Then productService.js lines 28-33: **SECOND query hits inventory**
   ```javascript
   const { data: inventoryData } = await supabase
     .from('inventory')
     .select('product_id, quantity, available_quantity, expiry_date')
     .in('product_id', productIds)  // Multiple products
     .eq('is_active', true)
     .order('created_at', { ascending: false });
   ```

**Why it times out:**
- First query: Fast (no RLS)
- Second query: Inventory RLS policies check `is_admin()` for every row
- With 50+ products, 50+ inventory records are checked
- Each check calls `is_admin()` function → hits `user_profiles` table → FULL SCAN

---

### Query 2: GET /testimonials (timeout)

**Flow:**
1. BusinessContext.jsx line 197: `getTestimonials(false)`
2. testimonialService.js lines 19-29: Query 1 gets testimonials
3. testimonialService.js lines 34-48: Query 2 gets user profiles
   - Tries to fetch profiles for N testimonials
   - RLS Policy (migration 20251112000001 lines 340-344):
     ```sql
     USING (user_id = auth.uid());  -- Can view own category
     ```

**Why it times out:**
- The second query tries to fetch `user_profiles` with `.in('user_id', userIds)`
- Each profile row checked against RLS: `user_id = auth.uid() OR is_admin()`
- For public user (not admin), EVERY profile row causes RLS to fail
- Database tries to check ALL profiles before denying

---

### Query 3: GET /carousel_slides (timeout)

**Flow:**
1. BusinessContext.jsx line 211: `getCarouselSlides(false)`
2. carouselService.js lines 15-24: `.select(*) .eq('is_active', true)`
3. RLS Policy: **NO EXPLICIT POLICY**
   - Falls back to default deny
   - EVERY carousel slide row is checked

---

### Query 4: GET /product_categories (timeout)

**Flow:**
1. BusinessContext.jsx line 117: `getCategories()`
2. productService.js lines 259-263: `.select(...) .eq('is_active', true)`
3. **NO EXPLICIT RLS POLICY for product_categories**
   - RLS enabled but no policy → implicit deny
   - Every row scanned to check permissions

---

### Query 5: GET /user_profiles in auth fetch (timeout)

**Flow:**
1. AuthContext.jsx line 81: `.from('user_profiles').select('role, is_enabled...').eq('id', uid)`
2. RLS Policy (migration 20251112000001 lines 54-58):
   ```sql
   CREATE POLICY "users can view own profile"
   ON public.user_profiles
   FOR SELECT
   TO authenticated
   USING (id = current_user_id());
   ```

**Why it times out:**
- `current_user_id()` is STABLE, not IMMUTABLE
- PostgreSQL evaluates policy for EVERY row in table, not just the target row

---

## SPECIFIC LINES TO FIX

### FIX 1: Storage Bucket Policies - Add LIMIT 1 to ALL nested EXISTS

**File:** `supabase/migrations/20251112000002_create_storage_buckets.sql`

**Line 30-35:** Add LIMIT 1
```sql
  EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = auth.uid()
    AND role IN ('admin', 'super_admin', 'manager')
    LIMIT 1
  )
```

**Line 48-61:** Add LIMIT 1 to BOTH nested EXISTS
```sql
  EXISTS (
    SELECT 1 FROM public.orders
    WHERE id = (storage.foldername(name))[2]::uuid
    AND (
      orders.user_id = auth.uid() OR
      EXISTS (
        SELECT 1 FROM public.user_profiles
        WHERE id = auth.uid()
        AND role IN ('admin', 'super_admin', 'manager')
        LIMIT 1
      )
    )
    LIMIT 1
  )
```

**Line 84-89:** Add LIMIT 1
**Line 104-109:** Add LIMIT 1
**Line 122-135:** Add LIMIT 1 to BOTH
**Line 158-163:** Add LIMIT 1

---

### FIX 2: Create Missing Performance Indices

**Create new migration:** `supabase/migrations/20251113000000_add_rls_performance_indices.sql`

```sql
-- ============================================================================
-- ADD PERFORMANCE INDICES FOR RLS POLICIES
-- Created: 2025-11-13
-- Purpose: Speed up RLS policy evaluation
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_user_profiles_id_role 
  ON public.user_profiles(id) INCLUDE (role) 
  WHERE is_enabled = true;

CREATE INDEX IF NOT EXISTS idx_user_profiles_role_id
  ON public.user_profiles(role, id);

CREATE INDEX IF NOT EXISTS idx_products_active_created
  ON public.products(is_active, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_inventory_product_active
  ON public.inventory(product_id, is_active);

CREATE INDEX IF NOT EXISTS idx_testimonials_visible_user
  ON public.testimonials(is_visible, user_id);

CREATE INDEX IF NOT EXISTS idx_orders_user_id_id
  ON public.orders(user_id, id);

CREATE INDEX IF NOT EXISTS idx_remittances_user_id_id
  ON public.remittances(user_id, id);

CREATE INDEX IF NOT EXISTS idx_carousel_slides_active_order
  ON public.carousel_slides(is_active, display_order);

CREATE INDEX IF NOT EXISTS idx_product_categories_active_order
  ON public.product_categories(is_active, display_order);

CREATE INDEX IF NOT EXISTS idx_manager_assignments_manager_active
  ON public.manager_assignments(manager_id)
  WHERE removed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_user_categories_user_id
  ON public.user_categories(user_id)
  WHERE effective_to IS NULL;

CREATE INDEX IF NOT EXISTS idx_user_category_history_user_changed
  ON public.user_category_history(user_id, changed_at DESC);
```

---

### FIX 3: Frontend Timeout Configuration

**File:** `src/lib/constants.js` lines 23-28

```javascript
export const TIMEOUTS = {
  PROFILE_FETCH: 30000,     // 30s - Give RLS time to evaluate
  INIT_AUTH: 45000,         // 45s - Give all 5 parallel queries time
  DEFAULT_QUERY: 25000,     // 25s - Increased for complex queries
  CAROUSEL_SLIDE: 15000,    // 15s - Increased for RLS evaluation
};
```

---

### FIX 4: Testimonials Service Optimization

**File:** `src/lib/testimonialService.js` lines 17-62

Skip profile fetch for public view:
```javascript
export const getTestimonials = async (adminView = false) => {
  try {
    let query = supabase
      .from('testimonials')
      .select('*')
      .order('created_at', { ascending: false });

    if (!adminView) {
      query = query.eq('is_visible', true);
    }

    const { data: testimonials, error } = await query;

    if (error) throw error;

    // FOR ADMIN VIEW ONLY: Batch fetch with limit
    if (adminView && testimonials && testimonials.length > 0) {
      const userIds = [...new Set(testimonials.map(t => t.user_id))];
      
      const { data: profiles } = await supabase
        .from('user_profiles')
        .select('user_id, full_name, avatar_url')
        .in('user_id', userIds)
        .limit(100);  // IMPORTANT: Add limit
      
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

### FIX 5: Business Context Request Batching

**File:** `src/contexts/BusinessContext.jsx` lines 222-231

Stagger requests instead of firing all 5 simultaneously:
```javascript
const loadInitialData = async () => {
  setLoading(true);
  
  // First batch: Critical data
  await Promise.all([
    refreshProducts(),
    refreshCategories(),
  ]);
  
  // Second batch: UI enhancements (after critical data loads)
  await Promise.all([
    refreshCombos(),
    refreshTestimonials(false),
    refreshCarouselSlides(false)
  ]);
  
  setLoading(false);
};
```

---

## SUMMARY OF FIXES BY PRIORITY

| Priority | Issue | File | Lines | Type | Effort |
|----------|-------|------|-------|------|--------|
| CRITICAL | Missing LIMIT 1 in nested EXISTS | migration 20251112000002 | 30, 48-61, 84, 104, 122-135, 158 | SQL | 1 hour |
| CRITICAL | Missing RLS indices | New migration | N/A | SQL | 1 hour |
| HIGH | Testimonials N+1 query | testimonialService.js | 17-62 | JS | 30 min |
| MEDIUM | Frontend timeout too short | constants.js | 23-28 | JS | 5 min |
| MEDIUM | Sequential vs parallel loading | BusinessContext.jsx | 222-231 | JS | 20 min |
| LOW | Inventory query optimization | productService.js | 28-33 | JS | 15 min |

---

## IMPLEMENTATION ORDER

1. Create new migration `20251113000000_add_rls_performance_indices.sql` with all indices
2. Update `20251112000002_create_storage_buckets.sql` to add LIMIT 1 to all nested EXISTS
3. Update `src/lib/constants.js` timeout values
4. Update `src/lib/testimonialService.js` to skip profile fetch for public view
5. Update `src/contexts/BusinessContext.jsx` to stagger requests
6. Deploy all changes and test

