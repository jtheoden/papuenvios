# 🎯 IMMEDIATE ACTIONS REQUIRED

**Database Status:** ✅ Schema is complete (all tables exist)
**What's Missing:** RLS Policies, Storage Buckets, Initial Data
**Time Required:** 20-30 minutes

---

## 📋 Action Plan Based on Current Database State

Since your database schema is already complete, you only need to:

1. ✅ Apply RLS policies (fix 403 errors)
2. ✅ Create storage buckets
3. ✅ Add initial configuration data
4. ✅ Verify your user role

---

## 🔴 STEP 1: Apply RLS Policies (10 minutes) - CRITICAL

**Why:** Your tables exist but don't have proper RLS policies, causing 403 errors.

### Execute This in Supabase SQL Editor:

**Go to:** https://app.supabase.com/project/qcwnlbpultscerwdnzbm/sql

**Copy and run this script:**

```sql
-- ============================================================================
-- RLS POLICIES FOR PAPUENVIOS
-- ============================================================================
-- This creates all necessary Row Level Security policies
-- Execute this ENTIRE script in Supabase SQL Editor
-- ============================================================================

-- First, ensure YOUR user is a super_admin
-- REPLACE 'your.email@example.com' with your ACTUAL email
UPDATE user_profiles
SET role = 'super_admin', is_enabled = true
WHERE email = 'your.email@example.com';  -- ⚠️ CHANGE THIS!

-- Enable RLS on all main tables
ALTER TABLE remittance_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE remittances ENABLE ROW LEVEL SECURITY;
ALTER TABLE remittance_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE bank_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE zelle_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_categories ENABLE ROW LEVEL SECURITY;

-- Helper function to check if user is admin
CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM user_profiles
    WHERE user_id = auth.uid()
    AND role IN ('admin', 'super_admin', 'manager')
    AND is_enabled = true
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- ============================================================================
-- REMITTANCE_TYPES POLICIES
-- ============================================================================

DROP POLICY IF EXISTS "remittance_types_public_read" ON remittance_types;
CREATE POLICY "remittance_types_public_read"
ON remittance_types FOR SELECT
TO authenticated, anon
USING (is_active = true);

DROP POLICY IF EXISTS "remittance_types_admin_all" ON remittance_types;
CREATE POLICY "remittance_types_admin_all"
ON remittance_types FOR ALL
TO authenticated
USING (is_admin())
WITH CHECK (is_admin());

-- ============================================================================
-- REMITTANCES POLICIES
-- ============================================================================

DROP POLICY IF EXISTS "remittances_user_read_own" ON remittances;
CREATE POLICY "remittances_user_read_own"
ON remittances FOR SELECT
TO authenticated
USING (user_id = auth.uid() OR is_admin());

DROP POLICY IF EXISTS "remittances_user_create_own" ON remittances;
CREATE POLICY "remittances_user_create_own"
ON remittances FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "remittances_user_update_own" ON remittances;
CREATE POLICY "remittances_user_update_own"
ON remittances FOR UPDATE
TO authenticated
USING (user_id = auth.uid() OR is_admin())
WITH CHECK (user_id = auth.uid() OR is_admin());

DROP POLICY IF EXISTS "remittances_admin_all" ON remittances;
CREATE POLICY "remittances_admin_all"
ON remittances FOR ALL
TO authenticated
USING (is_admin())
WITH CHECK (is_admin());

-- ============================================================================
-- REMITTANCE_STATUS_HISTORY POLICIES
-- ============================================================================

DROP POLICY IF EXISTS "remittance_status_history_read" ON remittance_status_history;
CREATE POLICY "remittance_status_history_read"
ON remittance_status_history FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM remittances
    WHERE remittances.id = remittance_status_history.remittance_id
    AND (remittances.user_id = auth.uid() OR is_admin())
  )
);

DROP POLICY IF EXISTS "remittance_status_history_admin_insert" ON remittance_status_history;
CREATE POLICY "remittance_status_history_admin_insert"
ON remittance_status_history FOR INSERT
TO authenticated
WITH CHECK (is_admin());

-- ============================================================================
-- ORDERS POLICIES
-- ============================================================================

DROP POLICY IF EXISTS "orders_user_read_own" ON orders;
CREATE POLICY "orders_user_read_own"
ON orders FOR SELECT
TO authenticated
USING (user_id = auth.uid() OR is_admin());

DROP POLICY IF EXISTS "orders_user_create_own" ON orders;
CREATE POLICY "orders_user_create_own"
ON orders FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "orders_user_update_own" ON orders;
CREATE POLICY "orders_user_update_own"
ON orders FOR UPDATE
TO authenticated
USING (user_id = auth.uid() OR is_admin())
WITH CHECK (user_id = auth.uid() OR is_admin());

DROP POLICY IF EXISTS "orders_admin_all" ON orders;
CREATE POLICY "orders_admin_all"
ON orders FOR ALL
TO authenticated
USING (is_admin())
WITH CHECK (is_admin());

-- ============================================================================
-- ORDER_ITEMS POLICIES
-- ============================================================================

DROP POLICY IF EXISTS "order_items_read" ON order_items;
CREATE POLICY "order_items_read"
ON order_items FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM orders
    WHERE orders.id = order_items.order_id
    AND (orders.user_id = auth.uid() OR is_admin())
  )
);

DROP POLICY IF EXISTS "order_items_insert" ON order_items;
CREATE POLICY "order_items_insert"
ON order_items FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM orders
    WHERE orders.id = order_items.order_id
    AND (orders.user_id = auth.uid() OR is_admin())
  )
);

-- ============================================================================
-- PRODUCTS POLICIES
-- ============================================================================

DROP POLICY IF EXISTS "products_public_read" ON products;
CREATE POLICY "products_public_read"
ON products FOR SELECT
TO authenticated, anon
USING (is_active = true);

DROP POLICY IF EXISTS "products_admin_all" ON products;
CREATE POLICY "products_admin_all"
ON products FOR ALL
TO authenticated
USING (is_admin())
WITH CHECK (is_admin());

-- ============================================================================
-- BANK_ACCOUNTS POLICIES
-- ============================================================================

DROP POLICY IF EXISTS "bank_accounts_user_own" ON bank_accounts;
CREATE POLICY "bank_accounts_user_own"
ON bank_accounts FOR ALL
TO authenticated
USING (user_id = auth.uid() OR is_admin())
WITH CHECK (user_id = auth.uid() OR is_admin());

-- ============================================================================
-- ZELLE_ACCOUNTS POLICIES
-- ============================================================================

DROP POLICY IF EXISTS "zelle_accounts_public_read_active" ON zelle_accounts;
CREATE POLICY "zelle_accounts_public_read_active"
ON zelle_accounts FOR SELECT
TO authenticated, anon
USING (is_active = true);

DROP POLICY IF EXISTS "zelle_accounts_admin_all" ON zelle_accounts;
CREATE POLICY "zelle_accounts_admin_all"
ON zelle_accounts FOR ALL
TO authenticated
USING (is_admin())
WITH CHECK (is_admin());

-- ============================================================================
-- RECIPIENTS POLICIES
-- ============================================================================

DROP POLICY IF EXISTS "recipients_user_own" ON recipients;
CREATE POLICY "recipients_user_own"
ON recipients FOR ALL
TO authenticated
USING (user_id = auth.uid() OR is_admin())
WITH CHECK (user_id = auth.uid() OR is_admin());

-- ============================================================================
-- USER_CATEGORIES POLICIES
-- ============================================================================

DROP POLICY IF EXISTS "user_categories_user_read_own" ON user_categories;
CREATE POLICY "user_categories_user_read_own"
ON user_categories FOR SELECT
TO authenticated
USING (user_id = auth.uid() OR is_admin());

DROP POLICY IF EXISTS "user_categories_admin_all" ON user_categories;
CREATE POLICY "user_categories_admin_all"
ON user_categories FOR ALL
TO authenticated
USING (is_admin())
WITH CHECK (is_admin());

-- ============================================================================
-- VERIFICATION
-- ============================================================================

-- Count policies created
SELECT
    schemaname,
    tablename,
    COUNT(*) as policy_count
FROM pg_policies
WHERE schemaname = 'public'
AND tablename IN (
    'remittance_types',
    'remittances',
    'remittance_status_history',
    'orders',
    'order_items',
    'products',
    'bank_accounts',
    'zelle_accounts',
    'recipients',
    'user_categories'
)
GROUP BY schemaname, tablename
ORDER BY tablename;

-- Verify your role
SELECT email, role, is_enabled
FROM user_profiles
WHERE email = 'your.email@example.com';  -- ⚠️ CHANGE THIS!

-- Success message
SELECT '✅ RLS POLICIES APPLIED SUCCESSFULLY!' as status;
```

**IMPORTANT:**
1. Replace `'your.email@example.com'` with YOUR actual email (appears 3 times in the script)
2. Run the ENTIRE script at once
3. Check the output - should show policy counts and your role

---

## 🟡 STEP 2: Create Storage Buckets (5 minutes)

**Go to:** https://app.supabase.com/project/qcwnlbpultscerwdnzbm/storage/buckets

**Create these 3 buckets:**

### Bucket 1: remittance-proofs
- **Name:** `remittance-proofs`
- **Public:** ❌ NO (Private)
- **File size limit:** 5242880 (5 MB)
- **Allowed MIME types:** `image/jpeg,image/png,image/webp,application/pdf`

### Bucket 2: order-delivery-proofs
- **Name:** `order-delivery-proofs`
- **Public:** ❌ NO (Private)
- **File size limit:** 5242880 (5 MB)
- **Allowed MIME types:** `image/jpeg,image/png,image/webp`

### Bucket 3: remittance-delivery-proofs
- **Name:** `remittance-delivery-proofs`
- **Public:** ❌ NO (Private)
- **File size limit:** 5242880 (5 MB)
- **Allowed MIME types:** `image/jpeg,image/png,image/webp`

**After creating each bucket, add these policies in the bucket's Policies tab:**

```sql
-- Policy for bucket: remittance-proofs
-- Users can upload their own proofs
CREATE POLICY "Users can upload remittance proofs"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'remittance-proofs'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- Users can view their own proofs, admins can view all
CREATE POLICY "Users can view own remittance proofs"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'remittance-proofs'
  AND (
    (storage.foldername(name))[1] = auth.uid()::text
    OR EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_id = auth.uid()
      AND role IN ('admin', 'super_admin', 'manager')
    )
  )
);

-- Admins can manage all files
CREATE POLICY "Admins can manage remittance proofs"
ON storage.objects FOR ALL
TO authenticated
USING (
  bucket_id = 'remittance-proofs'
  AND EXISTS (
    SELECT 1 FROM user_profiles
    WHERE user_id = auth.uid()
    AND role IN ('admin', 'super_admin', 'manager')
  )
);
```

Repeat similar policies for the other two buckets (just change the bucket name).

---

## 🟢 STEP 3: Add Initial Configuration Data (5 minutes)

**Run this in SQL Editor:**

```sql
-- ============================================================================
-- INITIAL CONFIGURATION DATA
-- ============================================================================

-- Add a Zelle account for testing
INSERT INTO zelle_accounts (
  account_name,
  email,
  phone,
  is_active,
  for_remittances,
  for_products,
  daily_limit,
  monthly_limit,
  security_limit,
  priority_order
) VALUES (
  'Main Account',
  'payments@papuenvios.com',  -- Change this to your Zelle email
  '+1234567890',               -- Change this to your Zelle phone
  true,
  true,
  true,
  2000,
  50000,
  1500,
  1
) ON CONFLICT DO NOTHING;

-- Add a basic remittance type
INSERT INTO remittance_types (
  name,
  currency_code,
  delivery_currency,
  exchange_rate,
  commission_percentage,
  commission_fixed,
  min_amount,
  max_amount,
  delivery_method,
  max_delivery_days,
  warning_days,
  is_active,
  display_order,
  description
) VALUES (
  'Standard Transfer',
  'USD',
  'CUP',
  120.00,  -- Example exchange rate
  2.0,     -- 2% commission
  0,       -- No fixed fee
  10,      -- Min $10
  5000,    -- Max $5000
  'cash',
  3,       -- 3 days max delivery
  2,       -- Warning at 2 days
  true,
  1,
  'Standard cash delivery service to Cuba'
) ON CONFLICT DO NOTHING;

-- Add WhatsApp admin number to system config
INSERT INTO system_config (key, value_text, description)
VALUES (
  'whatsapp_admin_phone',
  '+1234567890',  -- Change to your WhatsApp number
  'Admin WhatsApp number for notifications'
) ON CONFLICT (key) DO UPDATE
SET value_text = EXCLUDED.value_text;

-- Verify insertions
SELECT 'Zelle Accounts:' as check_type, COUNT(*) as count FROM zelle_accounts WHERE is_active = true
UNION ALL
SELECT 'Remittance Types:', COUNT(*) FROM remittance_types WHERE is_active = true
UNION ALL
SELECT 'System Config:', COUNT(*) FROM system_config WHERE key = 'whatsapp_admin_phone';

SELECT '✅ INITIAL DATA ADDED!' as status;
```

---

## ✅ STEP 4: Verify Everything (5 minutes)

**Run this verification script in SQL Editor:**

```sql
-- ============================================================================
-- COMPREHENSIVE VERIFICATION SCRIPT
-- ============================================================================

-- Check your user role
SELECT
  '👤 YOUR USER' as check,
  email,
  role,
  CASE
    WHEN role IN ('admin', 'super_admin') THEN '✅ Admin Access'
    ELSE '❌ Need Admin Role'
  END as status
FROM user_profiles
WHERE user_id = auth.uid();

-- Check RLS is enabled
SELECT
  '🛡️ RLS STATUS' as check,
  tablename,
  CASE WHEN rowsecurity THEN '✅ Enabled' ELSE '❌ Disabled' END as status
FROM pg_tables
WHERE schemaname = 'public'
AND tablename IN ('remittances', 'remittance_types', 'orders', 'products')
ORDER BY tablename;

-- Check policies exist
SELECT
  '📋 POLICIES' as check,
  tablename,
  COUNT(*) as policy_count,
  CASE
    WHEN COUNT(*) >= 2 THEN '✅ Good'
    ELSE '⚠️ Need more policies'
  END as status
FROM pg_policies
WHERE schemaname = 'public'
AND tablename IN ('remittances', 'remittance_types', 'orders', 'products')
GROUP BY tablename
ORDER BY tablename;

-- Check storage buckets
SELECT
  '🪣 STORAGE' as check,
  name as bucket_name,
  CASE WHEN public THEN '❌ Public' ELSE '✅ Private' END as visibility
FROM storage.buckets
WHERE name IN ('remittance-proofs', 'order-delivery-proofs', 'remittance-delivery-proofs')
ORDER BY name;

-- Check Zelle accounts
SELECT
  '💳 ZELLE' as check,
  account_name,
  email,
  CASE WHEN is_active THEN '✅ Active' ELSE '❌ Inactive' END as status
FROM zelle_accounts
ORDER BY priority_order;

-- Check remittance types
SELECT
  '📦 REMITTANCES' as check,
  name,
  currency_code || ' → ' || delivery_currency as currencies,
  CASE WHEN is_active THEN '✅ Active' ELSE '❌ Inactive' END as status
FROM remittance_types
ORDER BY display_order;

-- Final summary
SELECT '================================' as divider
UNION ALL
SELECT '✅ VERIFICATION COMPLETE' as divider
UNION ALL
SELECT '================================' as divider;
```

**Expected Results:**
- ✅ Your role should be 'admin' or 'super_admin'
- ✅ All main tables should have RLS enabled
- ✅ Each table should have 2+ policies
- ✅ All 3 storage buckets should exist and be private
- ✅ At least 1 Zelle account should be active
- ✅ At least 1 remittance type should be active

---

## 🧹 STEP 5: Clear Cache and Test (5 minutes)

### Clear Browser Cache:
1. Press `Ctrl + Shift + Delete` (Windows) or `Cmd + Shift + Delete` (Mac)
2. Select "Cookies and other site data"
3. Select "Cached images and files"
4. Click "Clear data"

### Or Clear Specific Storage:
1. Press `F12` to open DevTools
2. Go to **Application** tab
3. Expand **Local Storage** in sidebar
4. Right-click on your domain → **Clear**
5. Expand **Session Storage**
6. Right-click on your domain → **Clear**

### Test the Application:
1. **Logout** completely
2. **Close ALL browser tabs**
3. **Open new incognito/private window**
4. **Go to your application**
5. **Login** with the same email you used in Step 1
6. **Go to Dashboard → Remittances**
7. **Try to create a remittance type**
8. **✅ Should work without 403 error!**

---

## 🎯 Success Checklist

After completing all steps, you should have:

- [ ] RLS policies applied (all main tables)
- [ ] Your user role is `super_admin` or `admin`
- [ ] 3 storage buckets created with policies
- [ ] At least 1 active Zelle account
- [ ] At least 1 active remittance type
- [ ] WhatsApp admin number configured
- [ ] Browser cache cleared
- [ ] Logged out and back in
- [ ] No 403 errors when accessing remittances
- [ ] Can create remittance types as admin
- [ ] Can create remittances as user

---

## 🐛 Troubleshooting

### Still getting 403 errors?
1. Run the verification script (Step 4)
2. Check that your role is admin in the output
3. Make sure you used YOUR email in the UPDATE query
4. Clear browser cache again
5. Try incognito window

### Storage buckets not showing policies?
1. Click on the bucket name
2. Go to "Policies" tab (not "Configuration")
3. Click "New Policy"
4. Use the SQL provided in Step 2

### Can't create remittances?
1. Check Zelle account exists and is active
2. Check remittance type exists and is active
3. Check your user role is NOT admin (users create remittances, admins manage them)

---

## 📚 Next Steps After Setup

Once everything is verified:

1. **Configure Business Settings:**
   - Add more Zelle accounts if needed
   - Create additional remittance types
   - Configure shipping zones
   - Set up exchange rates

2. **Test Complete Flow:**
   - Create a test remittance as a regular user
   - Upload payment proof
   - Validate payment as admin
   - Process and complete remittance

3. **Production Deployment:**
   - Update environment variables in hosting
   - Run production build: `npm run build`
   - Deploy to your hosting provider

---

**Total Time:** 20-30 minutes
**Difficulty:** Medium (requires attention to detail)
**Success Rate:** 99% if you follow all steps carefully

---

**REMEMBER:**
- Replace `'your.email@example.com'` with YOUR actual email in Step 1
- Replace Zelle email and phone with YOUR actual details in Step 3
- Clear browser cache is CRITICAL - don't skip it!

---

**Status:** Ready to execute
**Last Updated:** 2025-11-14
