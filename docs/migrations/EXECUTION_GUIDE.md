# Supabase Migrations - Execution Guide
**Created:** 2025-10-30
**Last Updated:** 2025-10-30
**Purpose:** Complete guide for creating, testing, and applying database migrations

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Migration Workflow](#migration-workflow)
3. [Creating Migrations](#creating-migrations)
4. [Testing Migrations Locally](#testing-migrations-locally)
5. [Applying to Production](#applying-to-production)
6. [Rollback Procedures](#rollback-procedures)
7. [Best Practices](#best-practices)
8. [Troubleshooting](#troubleshooting)

---

## Prerequisites

### 1. Install Supabase CLI

**Option A: npm (Global)**
```bash
npm install -g supabase
```

**Option B: Homebrew (macOS/Linux)**
```bash
brew install supabase/tap/supabase
```

**Verify Installation:**
```bash
supabase --version
```

### 2. Link to Supabase Project

```bash
# Link to remote project
supabase link --project-ref qcwnlbpultscerwdnzbm

# Enter your database password when prompted
```

### 3. Verify Connection

```bash
# Check migration status
npm run db:status

# Or directly
supabase migration list
```

---

## Migration Workflow

```
┌─────────────────┐
│ Create Migration│
│    File         │
└────────┬────────┘
         │
         v
┌─────────────────┐
│  Test Locally   │
│  (if possible)  │
└────────┬────────┘
         │
         v
┌─────────────────┐
│ Review SQL Code │
│  with Team      │
└────────┬────────┘
         │
         v
┌─────────────────┐
│ Commit to Git   │
└────────┬────────┘
         │
         v
┌─────────────────┐
│ Apply to Prod   │
│  via CLI        │
└────────┬────────┘
         │
         v
┌─────────────────┐
│ Verify Success  │
│   & Document    │
└─────────────────┘
```

---

## Creating Migrations

### Naming Convention

```
YYYYMMDDHHMMSS_descriptive_name.sql
YYYYMMDDHHMMSS_descriptive_name.rollback.sql
```

**Examples:**
- `20251030000001_add_payment_rejected_at.sql`
- `20251030000002_fix_rls_policies_orders.sql`
- `20251030000003_add_index_remittances_status.sql`

### Migration Template

**Main Migration File:**
```sql
-- ============================================================================
-- [TITLE OF MIGRATION]
-- Created: YYYY-MM-DD
-- Purpose: [Brief description of what this migration does]
-- Related Issue: [Issue number or description]
-- ============================================================================

-- Step 1: [Description]
ALTER TABLE public.table_name
ADD COLUMN new_column type;

-- Step 2: [Description]
CREATE INDEX idx_name ON public.table_name(column);

-- Step 3: [Description]
COMMENT ON COLUMN public.table_name.new_column IS
  'Detailed description of the column purpose';

-- ============================================================================
-- VERIFICATION QUERY (for manual testing)
-- ============================================================================
-- SELECT column_name, data_type
-- FROM information_schema.columns
-- WHERE table_schema = 'public'
--   AND table_name = 'table_name'
--   AND column_name = 'new_column';
-- ============================================================================
```

**Rollback File:**
```sql
-- ============================================================================
-- ROLLBACK: [TITLE OF MIGRATION]
-- Created: YYYY-MM-DD
-- Purpose: Revert changes from main migration
-- ============================================================================

-- Revert in REVERSE ORDER
DROP INDEX IF EXISTS public.idx_name;

ALTER TABLE public.table_name
DROP COLUMN IF EXISTS new_column;

-- ============================================================================
-- VERIFICATION QUERY (for manual testing after rollback)
-- ============================================================================
-- [Query to verify rollback was successful]
-- ============================================================================
```

### Create Migration Command

```bash
# Auto-generate timestamp
supabase migration new add_payment_rejected_at

# This creates:
# supabase/migrations/20251030120000_add_payment_rejected_at.sql
```

---

## Testing Migrations Locally

### Option A: Local Supabase Instance (Recommended)

```bash
# Start local Supabase
supabase start

# Apply pending migrations
supabase db push

# Test application against local DB
npm run dev

# View local database
supabase db url
```

### Option B: Staging Environment

```bash
# Link to staging project
supabase link --project-ref YOUR_STAGING_REF

# Apply migrations
supabase migration up

# Test thoroughly
```

### Option C: Direct SQL Testing

```bash
# Connect to database
psql "postgresql://..."

# Copy-paste SQL from migration file
# Test queries manually
# Verify results

# Run rollback SQL if needed
```

---

## Applying to Production

### Pre-Flight Checklist

- [ ] Migration tested locally or in staging
- [ ] Rollback file created and tested
- [ ] Team reviewed SQL code
- [ ] Backup created (automatic in Supabase, verify)
- [ ] Downtime estimated (if any)
- [ ] Users notified (if downtime expected)

### Execution Steps

**Step 1: Verify Current State**
```bash
# Check pending migrations
npm run db:status

# Or
supabase migration list
```

**Step 2: Apply Migration**

**Option A: Apply All Pending (Recommended)**
```bash
# Apply all pending migrations
npm run db:migrate

# Or
supabase migration up
```

**Option B: Apply Specific Migration**
```bash
# Apply specific migration file
supabase migration up --file 20251030000001_add_payment_rejected_at.sql
```

**Step 3: Verify Success**

```bash
# Check migration status
npm run db:status

# Should show migration as applied
```

**Step 4: Verify in Dashboard**

1. Go to Supabase Dashboard
2. Navigate to SQL Editor
3. Run verification queries from migration file
4. Check that changes are applied correctly

**Step 5: Test Application**

```bash
# Test critical flows
1. Login/Logout
2. Create remittance
3. Upload payment proof
4. Admin operations
```

---

## Rollback Procedures

### When to Rollback

- Migration causes errors in production
- Data corruption detected
- Performance degradation
- Critical bug introduced

### Rollback Steps

**Step 1: Immediate Rollback**
```bash
# Rollback last migration
npm run db:rollback

# Or
supabase migration down
```

**Step 2: Manual Rollback (if CLI fails)**

```bash
# Connect to database
psql "postgresql://..."

# Execute rollback SQL from .rollback.sql file
# Or manually reverse changes
```

**Step 3: Verify Rollback**

```bash
# Check migration status
npm run db:status

# Verify data integrity
# Run verification queries
```

**Step 4: Investigation**

```bash
# Review logs
supabase logs

# Check for errors
# Identify root cause
# Fix migration
# Test again
```

---

## Best Practices

### DO:

✅ **Always create rollback files**
```sql
-- Each migration should have a corresponding .rollback.sql
```

✅ **Use IF NOT EXISTS / IF EXISTS**
```sql
ALTER TABLE public.users
ADD COLUMN IF NOT EXISTS new_field text;

DROP INDEX IF EXISTS idx_old_index;
```

✅ **Add comments and documentation**
```sql
COMMENT ON TABLE public.new_table IS
  'Stores X for purpose Y';
```

✅ **Use transactions for multi-step migrations**
```sql
BEGIN;
  -- Step 1
  ALTER TABLE...

  -- Step 2
  UPDATE...

  -- Verify
  DO $$
  BEGIN
    IF NOT EXISTS (SELECT...) THEN
      RAISE EXCEPTION 'Verification failed';
    END IF;
  END $$;
COMMIT;
```

✅ **Test migrations thoroughly**
- Test on local database
- Test on staging environment
- Review with team before production

✅ **Create indices for performance**
```sql
CREATE INDEX CONCURRENTLY idx_name
  ON public.table_name(column)
  WHERE condition;
```

✅ **Document verification queries**
```sql
-- Always include verification queries in comments
```

### DON'T:

❌ **Don't modify existing migrations**
- Once applied, create a new migration to fix

❌ **Don't delete data without backup**
```sql
-- BAD: Direct delete
DELETE FROM users WHERE...

-- GOOD: Soft delete
ALTER TABLE users ADD COLUMN deleted_at timestamptz;
UPDATE users SET deleted_at = now() WHERE...
```

❌ **Don't use DROP without IF EXISTS**
```sql
-- BAD
DROP TABLE users;

-- GOOD
DROP TABLE IF EXISTS users;
```

❌ **Don't forget foreign key constraints**
```sql
-- Always define relationships properly
ALTER TABLE orders
ADD CONSTRAINT fk_user
FOREIGN KEY (user_id)
REFERENCES users(id)
ON DELETE CASCADE;
```

❌ **Don't skip RLS policies**
```sql
-- Always add RLS policies for new tables
ALTER TABLE new_table ENABLE ROW LEVEL SECURITY;

CREATE POLICY policy_name ON new_table
FOR SELECT USING (...);
```

---

## Troubleshooting

### Issue: Migration fails with "column already exists"

**Cause:** Migration was partially applied or run multiple times

**Solution:**
```sql
-- Use IF NOT EXISTS
ALTER TABLE users
ADD COLUMN IF NOT EXISTS email text;
```

### Issue: Permission denied

**Cause:** Insufficient database permissions

**Solution:**
```bash
# Check your role
SELECT current_user, current_database();

# Verify you're using service_role key
# Or grant permissions:
GRANT ALL ON TABLE table_name TO your_user;
```

### Issue: Migration hangs / times out

**Cause:** Long-running operation (e.g., creating index without CONCURRENTLY)

**Solution:**
```sql
-- Use CONCURRENTLY for large tables
CREATE INDEX CONCURRENTLY idx_name
  ON large_table(column);
```

### Issue: Rollback fails

**Cause:** Dependencies prevent reverting changes

**Solution:**
```bash
# Manual rollback
# 1. Identify dependent objects
SELECT * FROM pg_depend WHERE...

# 2. Drop dependencies first
DROP VIEW dependent_view;

# 3. Then rollback migration
```

### Issue: "migration already applied"

**Cause:** Migration file renamed or moved

**Solution:**
```bash
# Check migration history
SELECT * FROM supabase_migrations.schema_migrations;

# If needed, manually mark as not applied
DELETE FROM supabase_migrations.schema_migrations
WHERE version = '20251030000001';
```

---

## Common Migration Patterns

### Add Column
```sql
ALTER TABLE public.table_name
ADD COLUMN IF NOT EXISTS column_name type DEFAULT value;

-- Rollback
ALTER TABLE public.table_name
DROP COLUMN IF EXISTS column_name;
```

### Add Index
```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_name
  ON public.table_name(column);

-- Rollback
DROP INDEX IF EXISTS public.idx_name;
```

### Add Foreign Key
```sql
ALTER TABLE public.child_table
ADD CONSTRAINT fk_name
FOREIGN KEY (column)
REFERENCES public.parent_table(id)
ON DELETE CASCADE;

-- Rollback
ALTER TABLE public.child_table
DROP CONSTRAINT IF EXISTS fk_name;
```

### Modify Column
```sql
-- Add new column
ALTER TABLE public.users
ADD COLUMN new_email text;

-- Migrate data
UPDATE public.users
SET new_email = old_email;

-- Drop old column (in separate migration after verification)

-- Rollback
ALTER TABLE public.users
DROP COLUMN IF EXISTS new_email;
```

### Add RLS Policy
```sql
CREATE POLICY policy_name
ON public.table_name
FOR SELECT
TO authenticated
USING (user_id = auth.uid());

-- Rollback
DROP POLICY IF EXISTS policy_name ON public.table_name;
```

---

## npm Scripts Reference

```bash
# List migration status
npm run db:status

# Apply pending migrations
npm run db:migrate

# Rollback last migration
npm run db:rollback

# Reset database (⚠️ DESTRUCTIVE - dev only)
npm run db:reset

# Pull remote schema changes
npm run db:pull
```

---

## Related Documentation

- [Storage Buckets Setup](./STORAGE_BUCKETS_SETUP.md)
- [Database Schema](../database/SCHEMA_CURRENT.md)
- [RLS Setup Instructions](../RLS_SETUP_INSTRUCTIONS.md)

---

## Support

**Issues with migrations?**
1. Check logs: `supabase logs`
2. Verify SQL syntax
3. Test rollback before applying
4. Consult team before production changes

**Emergency?**
1. Rollback immediately
2. Notify team
3. Check application status
4. Investigate root cause

---

**Last Updated:** 2025-10-30
**Maintained By:** Development Team
