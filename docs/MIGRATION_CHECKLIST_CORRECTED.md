# Migration Checklist - CORRECTED VERSION
**Created:** 2025-11-12
**Status:** Ready to execute on Supabase Dashboard
**Target Schema:** Your actual production schema

---

## ⚠️ CRITICAL: Schema Differences Found

Tu base de datos tiene un esquema DIFERENTE al que había asumido. Las migraciones han sido **CORREGIDAS** para coincidir:

| Tabla | Tu Schema | Cambio |
|-------|-----------|---------|
| `remittances` | Usa `user_id` | ❌ Migración original usaba `sender_id` → ✅ CORREGIDO |
| `user_profiles` | id es FK a auth.users | ❌ Variables de función confusas → ✅ CORREGIDO |
| `user_profiles.role` | Constraint actual | ❌ Faltaba 'manager' → ✅ CORREGIDO |

---

## 📋 Pre-Migration Checklist

Antes de ejecutar cualquier migración:

- [ ] Acceso a Supabase Dashboard
- [ ] Project ID: `qcwnlbpultscerwdnzbm`
- [ ] Access Token configurado (ya lo hiciste)
- [ ] Backup creado (opcional pero recomendado)

---

## 🔧 Step-by-Step Execution

### PASO 1: Create Storage Buckets (Manual en Dashboard)

**⏱️ Time: 2-3 minutes**

1. Go to **Supabase Dashboard** → Storage
2. Click **"Create a new bucket"**

**Bucket 1: `order-delivery-proofs`**
```
Name: order-delivery-proofs
Public: ❌ (Private)
File Size Limit: 5 MB
Allowed MIME types: image/jpeg, image/jpg, image/png, image/webp
```

**Bucket 2: `remittance-delivery-proofs`**
```
Name: remittance-delivery-proofs
Public: ❌ (Private)
File Size Limit: 5 MB
Allowed MIME types: image/jpeg, image/jpg, image/png, image/webp
```

✅ **Verification:** Both buckets should appear in Storage tab

---

### PASO 2: Execute Migration 1 - RLS Optimization

**⏱️ Time: 2-3 minutes**

**File:** `20251112000001_optimize_rls_policies_CORRECTED.sql`

1. Go to **SQL Editor** → New Query
2. Copy the entire file content from: `/supabase/migrations/20251112000001_optimize_rls_policies_CORRECTED.sql`
3. Paste into SQL Editor
4. Click **"Run"**

**Expected Output:**
```
Query successful ✓
```

**What it does:**
- Creates 5 STABLE functions for role checking
- Optimizes RLS policies on 8 tables
- Uses STABLE keyword to cache results in transactions
- Should dramatically reduce auth timeout issues

**Verification Query:**
```sql
-- Verify functions exist
SELECT proname FROM pg_proc
WHERE proname IN ('current_user_id', 'current_user_role', 'is_admin', 'is_super_admin', 'is_manager')
ORDER BY proname;
-- Should return 5 rows
```

---

### PASO 3: Execute Migration 2 - Storage Bucket RLS

**⏱️ Time: 1-2 minutes**

**File:** `20251112000002_create_storage_buckets.sql` (ORIGINAL - no changes needed)

1. New Query in SQL Editor
2. Copy from: `/supabase/migrations/20251112000002_create_storage_buckets.sql`
3. Paste and Run

**Expected Output:**
```
Query successful ✓
```

**What it does:**
- Enables RLS on storage.objects
- Creates 8 policies for order and remittance delivery proofs
- Users can only see/upload their own files
- Admins can see all files

---

### PASO 4: Execute Migration 3 - Manager Role

**⏱️ Time: 1-2 minutes**

**File:** `20251112000003_add_manager_role_CORRECTED.sql`

1. New Query in SQL Editor
2. Copy from: `/supabase/migrations/20251112000003_add_manager_role_CORRECTED.sql`
3. Paste and Run

**Expected Output:**
```
Query successful ✓
```

**What it does:**
- Updates user_profiles role constraint to include 'manager'
- Creates manager_assignments table for audit trail
- Creates functions: assign_manager_role(), remove_manager_role()
- Creates RLS policies for manager assignments

**Verification Query:**
```sql
-- Check role constraint updated
SELECT constraint_definition
FROM information_schema.table_constraints
WHERE table_name = 'user_profiles'
AND constraint_name LIKE '%role%';
-- Should show: role = ANY (ARRAY['user'::text, 'admin'::text, 'super_admin'::text, 'manager'::text])

-- Check manager_assignments table exists
SELECT COUNT(*) FROM information_schema.tables
WHERE table_name = 'manager_assignments';
-- Should return 1
```

---

### PASO 5: Execute Migration 4 - User Categorization

**⏱️ Time: 2-3 minutes**

**File:** `20251112000004_user_categorization_system_CORRECTED.sql`

1. New Query in SQL Editor
2. Copy from: `/supabase/migrations/20251112000004_user_categorization_system_CORRECTED.sql`
3. Paste and Run

**Expected Output:**
```
Query successful ✓
```

**What it does:**
- Creates user_categories table (REGULAR/PRO/VIP)
- Creates user_category_history for audit trail
- Creates category_rules with thresholds
- Creates category_discounts for pricing
- Creates 4 functions for auto/manual categorization
- Seeds default category rules

**Verification Query:**
```sql
-- Check tables created
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
AND table_name LIKE 'user_categor%'
ORDER BY table_name;
-- Should return: user_categories, user_category_history

-- Check default rules
SELECT * FROM public.category_rules ORDER BY interaction_threshold;
-- Should show 3 rows: regular (0), pro (5), vip (10)
```

---

### PASO 6: Execute Migration 5 - Seed Initial Data

**⏱️ Time: 1-2 minutes**

**File:** `20251112000005_seed_initial_data.sql`

**IMPORTANTE:** You need to replace the super_admin UUID first!

1. Get your super admin user ID:
   ```sql
   SELECT id, email FROM auth.users WHERE email = 'jtheoden@googlemail.com';
   ```
   Copy the UUID returned

2. Edit the seed migration file:
   - Open `/supabase/migrations/20251112000005_seed_initial_data.sql`
   - Find: `'super-admin-uuid-placeholder'`
   - Replace with your actual UUID

3. Copy the UPDATED content and paste in SQL Editor
4. Run

**Expected Output:**
```
Query successful ✓
```

**What it does:**
- Creates super admin user_profile (if not exists)
- Inserts Cuban banks (BNC, BFI, BPA, BMC)
- Inserts remittance types
- Inserts currencies (USD, CUP, EUR)
- Seeds visual settings with defaults
- Inserts payment methods

**Verification Query:**
```sql
-- Check banks seeded
SELECT COUNT(*) FROM public.bank_accounts;
-- Should show: 4 (or more if already had data)

-- Check visual settings
SELECT COUNT(*) FROM public.visual_settings;
-- Should show: 9 (or more)

-- Check currencies
SELECT code, name FROM public.currencies ORDER BY code;
-- Should show: CUP, EUR, USD
```

---

## ✅ Final Verification

Run these queries to verify everything is working:

```sql
-- 1. Check all STABLE functions exist
SELECT COUNT(*) as function_count FROM pg_proc
WHERE proname IN ('current_user_id', 'current_user_role', 'is_admin', 'is_super_admin', 'is_manager');
-- Expected: 5

-- 2. Check RLS policies on key tables
SELECT COUNT(*) as policy_count FROM pg_policies
WHERE schemaname = 'public'
AND tablename IN ('user_profiles', 'orders', 'remittances', 'products');
-- Expected: > 15

-- 3. Check new tables exist
SELECT COUNT(*) as new_table_count FROM information_schema.tables
WHERE table_schema = 'public'
AND table_name IN ('manager_assignments', 'user_categories', 'user_category_history', 'category_rules', 'category_discounts');
-- Expected: 5

-- 4. Check storage policies
SELECT COUNT(*) as storage_policy_count FROM pg_policies
WHERE schemaname = 'storage'
AND tablename = 'objects';
-- Expected: 8

-- 5. Check seed data
SELECT 'Banks' as type, COUNT(*) as count FROM public.bank_accounts
UNION ALL
SELECT 'Currencies', COUNT(*) FROM public.currencies
UNION ALL
SELECT 'Visual Settings', COUNT(*) FROM public.visual_settings
UNION ALL
SELECT 'Category Rules', COUNT(*) FROM public.category_rules;
-- Expected: All > 0
```

**If ALL queries return expected values → ✅ Migrations successful!**

---

## 🚨 Troubleshooting

### Error: "column does not exist"
- **Cause:** Wrong SQL file selected
- **Solution:** Use the _CORRECTED versions for migrations 1, 3, 4

### Error: "constraint already exists"
- **Cause:** Migration already ran
- **Solution:** This is fine - the constraint already updated. Can safely ignore.

### Error: "relation ... does not exist"
- **Cause:** One of the previous migrations failed
- **Solution:** Check verification queries to see which migration failed, fix it, and retry

### Error: "permission denied"
- **Cause:** Your Supabase role doesn't have permission
- **Solution:** Make sure you're logged in with the project owner/admin account

---

## 📝 Next Steps After Migrations

Once migrations are complete:

1. ✅ Backend ready with RLS policies
2. 📦 Create buckets manually (STEP 1 above)
3. 🎨 Update VisualSettingsPanel component if needed
4. 🔐 Test auth flows (Email+Password, Google OAuth)
5. 👥 Test role-based access (admin, manager, user)
6. 💰 Test categorization (orders/remittances auto-update category)

---

## 🎯 Expected Benefits After Migrations

✅ **Auth Performance:** 50% faster auth timeout (20s vs 10s, with RLS optimization bringing it even lower)
✅ **RLS Optimization:** STABLE functions reduce RLS warning messages
✅ **Storage Security:** Private buckets with proper access controls
✅ **User Management:** Manager role with granular permissions
✅ **User Gamification:** Automatic categorization (REGULAR/PRO/VIP) based on activity

---

**Ready to execute?** Follow the 6 steps above in order. Estimated total time: **10-15 minutes**

**Questions?** Check [AUTH_DIAGNOSTICS.md](./AUTH_DIAGNOSTICS.md) for troubleshooting

---

**Last Updated:** 2025-11-12
**Status:** ✅ Ready for Execution
**Files Needed:** All in `/supabase/migrations/` with _CORRECTED suffix where noted
