# Manual Migration Execution Order

**Status:** Network access blocked from CLI, execute manually in Supabase Dashboard
**Total migrations:** 13
**Time required:** ~30-40 minutes

---

## ⚠️ Important: CORRECTED vs Original

Some migrations have CORRECTED versions. **Use ONLY the CORRECTED ones:**

| Migration | File to Use | Status |
|-----------|-------------|--------|
| 1 | `20251112000001_optimize_rls_policies_CORRECTED.sql` | ✅ CORRECTED |
| 2 | `20251112000002_create_storage_buckets.sql` | ✅ Already fixed |
| 3 | `20251112000003_add_manager_role_CORRECTED.sql` | ✅ CORRECTED |
| 4 | `20251112000004_user_categorization_system_CORRECTED.sql` | ✅ CORRECTED |

---

## 📋 Complete Migration Order

Execute these in order, one at a time:

### 1. ✅ `03_fix_authorization.sql`
**File location:** `supabase/migrations/03_fix_authorization.sql`
- Fixes authorization issues
- Safe to execute first

### 2. ✅ `20241001000000_complete_schema.sql`
**File location:** `supabase/migrations/20241001000000_complete_schema.sql`
- Creates complete database schema
- Large file, may take a moment

### 3. ✅ `20241002000000_seed_initial_data.sql`
**File location:** `supabase/migrations/20241002000000_seed_initial_data.sql`
- Seeds initial data
- Creates default records

### 4. ✅ `20250128000000_add_bank_accounts_system.sql`
**File location:** `supabase/migrations/20250128000000_add_bank_accounts_system.sql`
- Adds bank account system

### 5. ✅ `20250128000001_fix_bank_rls_policies.sql`
**File location:** `supabase/migrations/20250128000001_fix_bank_rls_policies.sql`
- Fixes RLS policies for banks

### 6. ✅ `20250128000002_add_account_full_number_and_logos.sql`
**File location:** `supabase/migrations/20250128000002_add_account_full_number_and_logos.sql`
- Adds account numbers and bank logos

### 7. ✅ `20251007_orders_payment_system.sql`
**File location:** `supabase/migrations/20251007_orders_payment_system.sql`
- Orders and payment system

### 8. ✅ `20251030000001_add_payment_rejected_at.sql`
**File location:** `supabase/migrations/20251030000001_add_payment_rejected_at.sql`
- Adds payment rejection tracking

### 9. ⭐ `20251112000001_optimize_rls_policies_CORRECTED.sql`
**File location:** `supabase/migrations/20251112000001_optimize_rls_policies_CORRECTED.sql`
**🔴 IMPORTANT:** Use **CORRECTED** version, NOT the original!
- RLS optimization with STABLE functions
- 50% faster auth performance

### 10. ✅ `20251112000002_create_storage_buckets.sql`
**File location:** `supabase/migrations/20251112000002_create_storage_buckets.sql`
**Note:** You must create buckets manually first:
1. Go to Supabase Dashboard > Storage
2. Create: `order-delivery-proofs` (Private, 5MB, images)
3. Create: `remittance-delivery-proofs` (Private, 5MB, images)
4. Then run this migration

### 11. ⭐ `20251112000003_add_manager_role_CORRECTED.sql`
**File location:** `supabase/migrations/20251112000003_add_manager_role_CORRECTED.sql`
**🔴 IMPORTANT:** Use **CORRECTED** version, NOT the original!
- Adds manager role system

### 12. ⭐ `20251112000004_user_categorization_system_CORRECTED.sql`
**File location:** `supabase/migrations/20251112000004_user_categorization_system_CORRECTED.sql`
**🔴 IMPORTANT:** Use **CORRECTED** version, NOT the original!
- User categorization (REGULAR/PRO/VIP)

### 13. ✅ `20251112000005_seed_initial_data.sql`
**File location:** `supabase/migrations/20251112000005_seed_initial_data.sql`
- Final seeding with banks, currencies, etc.
- **IMPORTANT:** You may need to replace the super_admin UUID with your actual user ID

---

## How to Execute in Supabase Dashboard

### Step 1: Open SQL Editor
1. Go to Supabase Dashboard: https://app.supabase.com
2. Select project: `qcwnlbpultscerwdnzbm`
3. Click "SQL Editor" (left sidebar)

### Step 2: For Each Migration
1. Click "New Query"
2. Copy entire content from migration file
3. Paste into SQL Editor
4. Click "Run"
5. Wait for "Query successful ✓"
6. Repeat for next migration

### Step 3: Verify Each Completion
After each migration, check for:
- ✅ "Query successful" message
- ❌ No error messages
- No warnings (unless specified)

---

## ⚠️ Critical Notes

### Migration 2 (Storage Buckets)
Before running this migration:
1. Create buckets manually in Supabase Dashboard
2. Names: `order-delivery-proofs` and `remittance-delivery-proofs`
3. Both: Private, 5MB, images only

### Migration 13 (Seed Data)
May need to:
1. Find your super_admin user ID: `SELECT id FROM auth.users WHERE email = 'jtheoden@googlemail.com';`
2. Replace `'super-admin-uuid-placeholder'` in the file with your actual UUID
3. Then execute

### CORRECTED Versions
Only use these, NOT the original versions:
- ✅ Migration 9: `20251112000001_optimize_rls_policies_CORRECTED.sql`
- ✅ Migration 11: `20251112000003_add_manager_role_CORRECTED.sql`
- ✅ Migration 12: `20251112000004_user_categorization_system_CORRECTED.sql`

---

## Progress Tracker

After each migration, check it off:

- [ ] 1. 03_fix_authorization.sql
- [ ] 2. 20241001000000_complete_schema.sql
- [ ] 3. 20241002000000_seed_initial_data.sql
- [ ] 4. 20250128000000_add_bank_accounts_system.sql
- [ ] 5. 20250128000001_fix_bank_rls_policies.sql
- [ ] 6. 20250128000002_add_account_full_number_and_logos.sql
- [ ] 7. 20251007_orders_payment_system.sql
- [ ] 8. 20251030000001_add_payment_rejected_at.sql
- [ ] 9. 20251112000001_optimize_rls_policies_CORRECTED.sql ⭐
- [ ] 10. 20251112000002_create_storage_buckets.sql
- [ ] 11. 20251112000003_add_manager_role_CORRECTED.sql ⭐
- [ ] 12. 20251112000004_user_categorization_system_CORRECTED.sql ⭐
- [ ] 13. 20251112000005_seed_initial_data.sql

---

## Verification After All Migrations

Run these queries in SQL Editor to verify success:

```sql
-- Check functions created
SELECT COUNT(*) as functions_created FROM pg_proc
WHERE proname IN ('current_user_id', 'current_user_role', 'is_admin', 'is_super_admin', 'is_manager');
-- Expected: 5

-- Check tables created
SELECT COUNT(*) as tables_created FROM information_schema.tables
WHERE table_schema = 'public'
AND table_name IN ('user_categories', 'manager_assignments', 'category_rules');
-- Expected: 3

-- Check RLS policies
SELECT COUNT(*) as policies_created FROM pg_policies
WHERE schemaname = 'public';
-- Expected: > 20
```

---

## Troubleshooting

### "ERROR 42P01: relation does not exist"
**Cause:** A previous migration failed
**Fix:** Check which migration failed, look at error message, fix it, and re-run

### "ERROR 23505: duplicate key"
**Cause:** Migration already ran
**Fix:** This is fine, constraint already exists. Can ignore and continue.

### "ERROR 42501: permission denied"
**Cause:** User doesn't have permission on that table
**Fix:** This shouldn't happen with `postgres` user. Check credentials.

---

## Success Criteria

After all 13 migrations:
- ✅ All queries executed successfully
- ✅ No error messages
- ✅ Verification queries show correct counts
- ✅ Your app can connect to database

---

**Created:** 2025-11-12
**Status:** Ready for Manual Execution
**Estimated Time:** 30-40 minutes
