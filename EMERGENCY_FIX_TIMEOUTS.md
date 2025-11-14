# 🚨 EMERGENCY FIX - Database Statement Timeouts

**Error:** `code: '57014' - canceling statement due to statement timeout`
**Status:** ALL database queries are timing out (500 errors)
**Severity:** CRITICAL - Application is completely broken

---

## 🎯 Root Cause Analysis

Your database is timing out on **every single query**, including simple ones. This is NOT a migration issue.

**Possible causes (in order of likelihood):**

1. ✅ **Database is paused** (free tier auto-pauses after inactivity)
2. ✅ **Problematic RLS policies** causing infinite loops/recursion
3. ✅ **Missing indexes** on large tables
4. ✅ **Statement timeout too low**

---

## 🔥 IMMEDIATE FIXES (Do these NOW)

### FIX 1: Check if Database is Paused (2 minutes)

1. **Go to:** https://app.supabase.com/project/qcwnlbpultscerwdnzbm/settings/general
2. **Look for:** "Database Status" or any pause message
3. **If paused:** Click **"Resume"** or **"Restore"**
4. **Wait 2-3 minutes** for database to wake up
5. **Refresh your application**

---

### FIX 2: Temporarily Disable RLS (5 minutes) - DIAGNOSTIC ONLY

This will help us identify if RLS policies are the problem.

**Run this in Supabase SQL Editor:**

```sql
-- ============================================================================
-- TEMPORARY FIX - DISABLE RLS TO TEST
-- WARNING: This makes all data public temporarily!
-- Only for diagnosis - re-enable after testing
-- ============================================================================

-- Disable RLS on all tables temporarily
ALTER TABLE user_profiles DISABLE ROW LEVEL SECURITY;
ALTER TABLE products DISABLE ROW LEVEL SECURITY;
ALTER TABLE product_categories DISABLE ROW LEVEL SECURITY;
ALTER TABLE orders DISABLE ROW LEVEL SECURITY;
ALTER TABLE order_items DISABLE ROW LEVEL SECURITY;
ALTER TABLE testimonials DISABLE ROW LEVEL SECURITY;
ALTER TABLE combo_products DISABLE ROW LEVEL SECURITY;
ALTER TABLE carousel_slides DISABLE ROW LEVEL SECURITY;
ALTER TABLE remittances DISABLE ROW LEVEL SECURITY;
ALTER TABLE remittance_types DISABLE ROW LEVEL SECURITY;

-- Check if queries work now
SELECT COUNT(*) FROM products;
SELECT COUNT(*) FROM orders;
SELECT COUNT(*) FROM user_profiles;

-- Show results
SELECT '✅ If you see results above, RLS policies were the problem' as diagnosis;
```

**If queries work after this:**
- Problem = Bad RLS policies
- Solution = Apply correct policies (see FIX 3)

**If queries still timeout:**
- Problem = Database configuration or indexing
- Solution = See FIX 4

---

### FIX 3: Apply Correct RLS Policies (10 minutes)

**ONLY run this if FIX 2 showed that RLS was the problem.**

```sql
-- ============================================================================
-- CORRECT RLS POLICIES - NO RECURSION
-- ============================================================================

-- First, drop ALL existing policies
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN (
        SELECT schemaname, tablename, policyname
        FROM pg_policies
        WHERE schemaname = 'public'
    ) LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I',
            r.policyname, r.schemaname, r.tablename);
    END LOOP;
END $$;

-- Create simple helper function (no recursion)
CREATE OR REPLACE FUNCTION public.get_user_role(user_uuid uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT role FROM user_profiles WHERE user_id = user_uuid LIMIT 1;
$$;

-- Re-enable RLS
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE testimonials ENABLE ROW LEVEL SECURITY;
ALTER TABLE combo_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE carousel_slides ENABLE ROW LEVEL SECURITY;
ALTER TABLE remittances ENABLE ROW LEVEL SECURITY;
ALTER TABLE remittance_types ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- SIMPLE POLICIES (NO RECURSION)
-- ============================================================================

-- USER_PROFILES: Everyone can read own, admins can read all
CREATE POLICY "user_profiles_read_own"
ON user_profiles FOR SELECT
USING (user_id = auth.uid() OR get_user_role(auth.uid()) IN ('admin', 'super_admin'));

CREATE POLICY "user_profiles_update_own"
ON user_profiles FOR UPDATE
USING (user_id = auth.uid() OR get_user_role(auth.uid()) IN ('admin', 'super_admin'));

-- PRODUCTS: Everyone can read active, admins can manage
CREATE POLICY "products_read_public"
ON products FOR SELECT
USING (is_active = true OR get_user_role(auth.uid()) IN ('admin', 'super_admin'));

CREATE POLICY "products_admin_all"
ON products FOR ALL
USING (get_user_role(auth.uid()) IN ('admin', 'super_admin'));

-- PRODUCT_CATEGORIES: Everyone can read active
CREATE POLICY "categories_read_public"
ON product_categories FOR SELECT
USING (is_active = true OR get_user_role(auth.uid()) IN ('admin', 'super_admin'));

CREATE POLICY "categories_admin_all"
ON product_categories FOR ALL
USING (get_user_role(auth.uid()) IN ('admin', 'super_admin'));

-- ORDERS: Users read own, admins read all
CREATE POLICY "orders_read"
ON orders FOR SELECT
USING (user_id = auth.uid() OR get_user_role(auth.uid()) IN ('admin', 'super_admin'));

CREATE POLICY "orders_insert"
ON orders FOR INSERT
WITH CHECK (user_id = auth.uid());

CREATE POLICY "orders_update"
ON orders FOR UPDATE
USING (user_id = auth.uid() OR get_user_role(auth.uid()) IN ('admin', 'super_admin'));

-- ORDER_ITEMS: Match parent order
CREATE POLICY "order_items_read"
ON order_items FOR SELECT
USING (EXISTS (
  SELECT 1 FROM orders
  WHERE orders.id = order_items.order_id
  AND (orders.user_id = auth.uid() OR get_user_role(auth.uid()) IN ('admin', 'super_admin'))
));

-- TESTIMONIALS: Public can read visible
CREATE POLICY "testimonials_read_public"
ON testimonials FOR SELECT
USING (is_visible = true OR user_id = auth.uid() OR get_user_role(auth.uid()) IN ('admin', 'super_admin'));

CREATE POLICY "testimonials_insert"
ON testimonials FOR INSERT
WITH CHECK (user_id = auth.uid());

-- COMBO_PRODUCTS: Everyone can read active
CREATE POLICY "combos_read_public"
ON combo_products FOR SELECT
USING (is_active = true OR get_user_role(auth.uid()) IN ('admin', 'super_admin'));

CREATE POLICY "combos_admin_all"
ON combo_products FOR ALL
USING (get_user_role(auth.uid()) IN ('admin', 'super_admin'));

-- CAROUSEL_SLIDES: Everyone can read active
CREATE POLICY "carousel_read_public"
ON carousel_slides FOR SELECT
USING (is_active = true OR get_user_role(auth.uid()) IN ('admin', 'super_admin'));

-- REMITTANCES: Users read own, admins read all
CREATE POLICY "remittances_read"
ON remittances FOR SELECT
USING (user_id = auth.uid() OR get_user_role(auth.uid()) IN ('admin', 'super_admin'));

CREATE POLICY "remittances_insert"
ON remittances FOR INSERT
WITH CHECK (user_id = auth.uid());

CREATE POLICY "remittances_update"
ON remittances FOR UPDATE
USING (user_id = auth.uid() OR get_user_role(auth.uid()) IN ('admin', 'super_admin'));

-- REMITTANCE_TYPES: Everyone can read active
CREATE POLICY "remittance_types_read_public"
ON remittance_types FOR SELECT
USING (is_active = true OR get_user_role(auth.uid()) IN ('admin', 'super_admin'));

CREATE POLICY "remittance_types_admin_all"
ON remittance_types FOR ALL
USING (get_user_role(auth.uid()) IN ('admin', 'super_admin'));

-- Verify
SELECT
    tablename,
    COUNT(*) as policy_count
FROM pg_policies
WHERE schemaname = 'public'
GROUP BY tablename
ORDER BY tablename;

SELECT '✅ RLS POLICIES APPLIED SUCCESSFULLY' as status;
```

---

### FIX 4: Increase Statement Timeout (3 minutes)

If RLS is not the issue, increase timeout:

```sql
-- Increase statement timeout to 30 seconds
ALTER DATABASE postgres SET statement_timeout = '30s';

-- For current session
SET statement_timeout = '30s';

-- Check current setting
SHOW statement_timeout;
```

---

### FIX 5: Add Missing Indexes (5 minutes)

Large tables without indexes cause timeouts:

```sql
-- Add essential indexes
CREATE INDEX IF NOT EXISTS idx_products_is_active ON products(is_active);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_remittances_user_id ON remittances(user_id);
CREATE INDEX IF NOT EXISTS idx_remittances_status ON remittances(status);
CREATE INDEX IF NOT EXISTS idx_user_profiles_user_id ON user_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_user_profiles_role ON user_profiles(role);

SELECT '✅ INDEXES CREATED' as status;
```

---

## 📊 Diagnosis Steps

### Step 1: Check Database Status
```sql
-- Check if database is responding
SELECT NOW() as current_time;

-- Check table sizes
SELECT
    schemaname,
    tablename,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC
LIMIT 10;
```

### Step 2: Check for Slow Queries
```sql
-- Check current activity
SELECT
    pid,
    usename,
    application_name,
    state,
    query,
    query_start,
    NOW() - query_start as duration
FROM pg_stat_activity
WHERE state != 'idle'
ORDER BY query_start;
```

### Step 3: Check RLS Status
```sql
SELECT
    schemaname,
    tablename,
    CASE WHEN rowsecurity THEN 'ENABLED' ELSE 'DISABLED' END as rls_status
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;
```

---

## ✅ Recommended Action Plan

**Do these IN ORDER:**

1. ✅ Check if database is paused → Resume if needed
2. ✅ If still broken: Run FIX 2 (disable RLS temporarily)
3. ✅ If that fixes it: Run FIX 3 (apply correct policies)
4. ✅ Run FIX 5 (add indexes)
5. ✅ Test application
6. ✅ If still broken: Check Supabase dashboard logs

---

## 🔍 Check Supabase Dashboard Logs

1. Go to: https://app.supabase.com/project/qcwnlbpultscerwdnzbm/logs/postgres-logs
2. Look for errors related to:
   - Statement timeout
   - RLS policy errors
   - Slow queries
3. Screenshot and share if you see anything unusual

---

## ⚠️ IMPORTANT NOTES

**DO NOT run migrations yet!**
- Your schema already exists (you shared it earlier)
- The problem is NOT missing tables
- The problem is PERFORMANCE/CONFIGURATION

**After fixing:**
- Re-enable RLS properly
- Never leave RLS disabled in production
- Add proper indexes
- Monitor query performance

---

## 📞 If Nothing Works

Check these:
1. Supabase project isn't paused
2. You didn't hit free tier limits
3. Database hasn't run out of space
4. No runaway queries consuming resources

Go to: https://app.supabase.com/project/qcwnlbpultscerwdnzbm/settings/database
Check "Connection pooling" and "Database health"

---

**Next Step:** Start with FIX 1 (check if database is paused)
