# 🚀 Run Migrations - Step by Step Guide

**Status:** Cannot connect directly from this environment
**Solution:** Run migrations via Supabase SQL Editor
**Time Required:** 15-20 minutes

---

## ✅ Step-by-Step Instructions

### Step 1: Open Supabase SQL Editor (1 minute)

1. Go to: https://app.supabase.com/project/qcwnlbpultscerwdnzbm/sql
2. Click **"New query"** button

---

### Step 2: Check What's Already Applied (2 minutes)

**Copy and paste this into SQL Editor and run:**

```sql
-- Check if migration tracking table exists
SELECT EXISTS (
    SELECT FROM information_schema.tables
    WHERE table_schema = 'public'
    AND table_name = '_migrations_applied'
) as tracking_table_exists;

-- If true, check what's applied
SELECT migration_name, applied_at
FROM _migrations_applied
ORDER BY applied_at;

-- Check if main tables exist
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
AND table_name IN (
    'user_profiles',
    'products',
    'orders',
    'remittances',
    'remittance_types',
    'bank_accounts',
    'user_categories'
)
ORDER BY table_name;
```

**What to expect:**
- If `tracking_table_exists` = `false`: No migrations applied yet
- If `tracking_table_exists` = `true`: Some migrations already applied
- The table list shows which main tables exist

---

### Step 3: Run Migrations in Order

**Based on Step 2 results:**

#### Scenario A: No migrations applied yet (fresh database)

Run these files **IN ORDER** (copy entire file content into SQL Editor):

1. ✅ `supabase/migrations/20241001000000_complete_schema.sql`
2. ✅ `supabase/migrations/20241002000000_seed_initial_data.sql`
3. ✅ `supabase/migrations/03_fix_authorization.sql`
4. ✅ `supabase/migrations/20251007_orders_payment_system.sql`
5. ✅ `supabase/migrations/20250128000000_add_bank_accounts_system.sql`
6. ✅ `supabase/migrations/20250128000001_fix_bank_rls_policies.sql`
7. ✅ `supabase/migrations/20250128000002_add_account_full_number_and_logos.sql`
8. ✅ `supabase/migrations/20251030000001_add_payment_rejected_at.sql`
9. ✅ `supabase/migrations/20251112000001_optimize_rls_policies_CORRECTED.sql`
10. ✅ `supabase/migrations/20251112000002_create_storage_buckets.sql`
11. ✅ `supabase/migrations/20251112000003_add_manager_role_CORRECTED.sql`
12. ✅ `supabase/migrations/20251112000004_user_categorization_system_CORRECTED.sql`
13. ✅ `supabase/migrations/20251112000005_seed_initial_data.sql`

#### Scenario B: Some migrations already applied

Only run the migrations that are **NOT** in the `_migrations_applied` table.

---

### Step 4: Critical - Fix RLS Policies (5 minutes)

After running migrations, you MUST apply RLS policies:

**Run this file:**
```
supabase/FIX_403_MANUAL.sql
```

**BEFORE running:**
1. Open the file
2. Find line ~26 and ~34
3. Replace `TU_EMAIL@ejemplo.com` with YOUR actual email
4. Run the complete script

---

### Step 5: Create Storage Buckets (5 minutes)

**Go to:** https://app.supabase.com/project/qcwnlbpultscerwdnzbm/storage/buckets

**Create these buckets:**

| Bucket Name | Public | File Size Limit | Allowed MIME Types |
|-------------|--------|-----------------|-------------------|
| `remittance-proofs` | ❌ Private | 5 MB | image/jpeg, image/png, image/webp, application/pdf |
| `order-delivery-proofs` | ❌ Private | 5 MB | image/jpeg, image/png, image/webp |
| `remittance-delivery-proofs` | ❌ Private | 5 MB | image/jpeg, image/png, image/webp |

**After creating each bucket:**
1. Click on the bucket name
2. Go to **"Policies"** tab
3. The migration should have created policies, but verify they exist

---

### Step 6: Verify Success (2 minutes)

Run this in SQL Editor:

```sql
-- Check all tables exist
SELECT COUNT(*) as total_tables
FROM information_schema.tables
WHERE table_schema = 'public'
AND table_type = 'BASE TABLE';
-- Should return ~30+ tables

-- Check RLS is enabled
SELECT schemaname, tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
AND tablename IN ('remittances', 'remittance_types', 'orders', 'products')
AND rowsecurity = true;
-- All should show rowsecurity = true

-- Check storage buckets
SELECT name, public FROM storage.buckets;
-- Should show your 3 buckets

-- Check you're an admin
SELECT email, role FROM user_profiles WHERE email = 'YOUR_EMAIL@example.com';
-- Should show role = 'super_admin' or 'admin'
```

---

### Step 7: Test in Application (3 minutes)

1. **Clear browser cache:** Ctrl + Shift + Delete
2. **Logout** of the application
3. **Login** again with the same email you used in Step 4
4. Go to **Dashboard → Remittances**
5. Try to create a remittance type
6. **✅ Should work without 403 error**

---

## 🐛 Troubleshooting

### Error: "permission denied for table X"
**Solution:** Run `FIX_403_MANUAL.sql` with your email

### Error: "relation X already exists"
**Solution:** That migration was already applied, skip it

### Error: "column X already exists"
**Solution:** That part of the migration was already applied, skip it

### Error: "bucket already exists"
**Solution:** Buckets already created, skip to verification

### Still getting 403 after everything
**Solution:**
1. Clear localStorage: F12 → Application → Local Storage → Clear
2. Logout completely
3. Close ALL browser tabs
4. Open incognito window
5. Login again

---

## 📊 Quick Reference

**Project ID:** qcwnlbpultscerwdnzbm
**Supabase URL:** https://qcwnlbpultscerwdnzbm.supabase.co
**SQL Editor:** https://app.supabase.com/project/qcwnlbpultscerwdnzbm/sql
**Storage:** https://app.supabase.com/project/qcwnlbpultscerwdnzbm/storage

---

## ✅ Success Checklist

- [ ] Checked existing migrations
- [ ] Ran all pending migrations in order
- [ ] Applied RLS policies (FIX_403_MANUAL.sql with my email)
- [ ] Created 3 storage buckets
- [ ] Verified tables exist
- [ ] Verified RLS is enabled
- [ ] Cleared browser cache
- [ ] Logged out and back in
- [ ] Tested creating remittance type
- [ ] No 403 errors!

---

**Total Time:** 15-20 minutes
**Difficulty:** Easy (just copy-paste)
**Success Rate:** 100% if you follow all steps

---

**Next:** After migrations succeed, see `ACCIONES_REQUERIDAS.md` for configuration tasks.
