# Migration CLI Setup Guide

**Updated:** 2025-11-12
**Status:** Direct CLI execution enabled (no Supabase CLI linking required)

---

## Overview

This guide walks you through setting up and executing database migrations directly from your project using Node.js. This approach works without requiring the Supabase CLI to be linked to your project.

### What's New

✅ **Direct execution** via npm scripts
✅ **No CLI linking** required
✅ **Automatic tracking** of applied migrations
✅ **Clear error reporting** with helpful messages

---

## Prerequisites

1. **Node.js** (v18+) - already installed
2. **npm** - already installed
3. **Supabase Project** - already created (qcwnlbpultscerwdnzbm)
4. **Database credentials** - from Supabase dashboard

---

## Step 1: Get Your Database Credentials

### From Supabase Dashboard

1. Go to [app.supabase.com](https://app.supabase.com)
2. Select your project: **`qcwnlbpultscerwdnzbm`**
3. Go to **Settings** > **Database** (left sidebar)
4. Look for the **Connection parameters** section

You should see:
```
Host: aws-0-[region].pooler.supabase.com
Port: 6543
Database: postgres
User: postgres
Password: [your-password]
```

> **Tip:** Use the **pooler** host (port 6543) for migrations. It's more stable for long-running operations.

### Alternative: Connection String

If you see a connection string format, extract these values:
```
postgresql://postgres:[PASSWORD]@aws-0-[region].pooler.supabase.com:6543/postgres
                       ^^^^^^^^
                       This is your DB_PASSWORD
```

---

## Step 2: Configure Environment Variables

### Create/Update `.env.local`

```bash
# From project root
cp .env.local.example .env.local
```

### Edit `.env.local`

Add your database credentials:

```env
# Database connection (use pooler for migrations)
DB_HOST=aws-0-[region].pooler.supabase.com
DB_PORT=6543
DB_NAME=postgres
DB_USER=postgres
DB_PASSWORD=your_actual_database_password

# Keep these as-is
SUPABASE_PROJECT_ID=qcwnlbpultscerwdnzbm
SUPABASE_ACCESS_TOKEN=sbp_660a64450ab81afe4c6e80fa4b2c8ff5cfd7ee9a
```

> **Security Note:** `.env.local` is in `.gitignore` - it's never committed to git

### Verify Configuration

```bash
# Check if database connection works
npm run db:status
```

Expected output:
```
🔌 Connecting to database...
✅ Connected

📋 Migration Status

Total migrations: 25
Applied: 0
Pending: 25

Migration List:
...
```

If you get a connection error, check:
- ✅ DB_HOST is correct (includes `.pooler.supabase.com` for pooler)
- ✅ DB_PORT is 6543 (for pooler) or 5432 (for direct)
- ✅ DB_USER is `postgres`
- ✅ DB_PASSWORD is correct (from Supabase Settings > Database)

---

## Step 3: Install Dependencies

```bash
npm install
```

This installs `pg` (PostgreSQL client) and `dotenv` needed for migrations.

---

## Step 4: Run Migrations

### Check Status Before Running

```bash
npm run db:status
```

Shows which migrations are applied and which are pending.

### Execute All Pending Migrations

```bash
npm run db:migrate
```

This will:
1. ✅ Create `_migrations_applied` tracking table
2. ▶️ Run all pending migrations in order
3. 📝 Record which ones were successful
4. ❌ Stop on first error (unless you use `--force`)

**Example output:**
```
▶️  Running 25 pending migration(s)...

✅ 20241001000000_complete_schema (245ms)
✅ 20241002000000_seed_initial_data (156ms)
✅ 20251007_orders_payment_system (89ms)
✅ 20250128000000_add_bank_accounts_system (134ms)
✅ 20251112000001_optimize_rls_policies_CORRECTED (289ms)
✅ 20251112000002_create_storage_buckets (67ms)
✅ 20251112000003_add_manager_role_CORRECTED (123ms)
✅ 20251112000004_user_categorization_system_CORRECTED (201ms)
✅ 20251112000005_seed_initial_data (45ms)

✅ Migration run completed!
```

### IMPORTANT: First Migration Only

Since this is your first run, it will **execute all 25 migrations**. This is normal and expected.

The system tracks which migrations have run, so subsequent runs will only execute new migrations.

---

## Available Commands

### 1. `npm run db:migrate`

**Runs all pending migrations**

```bash
npm run db:migrate
```

Options:
- `--force` - Continue despite errors (dangerous, use carefully)

### 2. `npm run db:status`

**Show migration status and list**

```bash
npm run db:status
```

Shows:
- Total migrations available
- How many have been applied
- How many are pending
- Full list with ✅ (applied) or ⏳ (pending)

### 3. `npm run db:list`

**List all available migrations**

```bash
npm run db:list
```

Useful for:
- Verifying migration files exist
- Checking file naming
- Seeing execution order

### 4. `npm run db:reset`

**Delete migration tracking and restart**

```bash
npm run db:reset
```

> ⚠️ This only removes the `_migrations_applied` table from the database. It does NOT delete the actual schema changes. Use only if you need to re-track migrations.

---

## Troubleshooting

### "Missing required database configuration"

```
❌ Missing required database configuration:
   - DB_HOST (or SUPABASE_DB_HOST)
   - DB_PASSWORD (or SUPABASE_DB_PASSWORD)
```

**Fix:** Check `.env.local` has all required variables.

```bash
# Verify
grep "^DB_" .env.local
```

### "ECONNREFUSED: Connection refused"

```
Error: connect ECONNREFUSED [host]:6543
```

**Cause:** Can't reach database server

**Fix:**
- Verify host is correct: `aws-0-[region].pooler.supabase.com`
- Verify port is 6543 (pooler) or 5432 (direct)
- Check if Supabase project is active
- Try direct host instead of pooler (change port to 5432)

### "FATAL: password authentication failed"

```
Error: password authentication failed for user "postgres"
```

**Fix:**
- Get correct password from Supabase Dashboard > Settings > Database
- Ensure no extra spaces in `DB_PASSWORD`
- Try copying/pasting directly from Supabase

### "relation '_migrations_applied' does not exist"

This shouldn't happen - script auto-creates it. If it does:

```bash
# Try running again
npm run db:migrate

# Or manually create it
psql -h [host] -U postgres -d postgres -c "
  CREATE TABLE IF NOT EXISTS public._migrations_applied (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text UNIQUE NOT NULL,
    executed_at timestamp with time zone DEFAULT now(),
    duration_ms integer,
    success boolean DEFAULT true,
    error_message text
  );"
```

### Migration Stuck or Hanging

If a migration seems to hang:

1. **Wait** - Long migrations can take time (check duration output)
2. **Check logs** - Look for actual error messages
3. **Cancel** - Press `Ctrl+C` to stop
4. **Investigate** - Check which migration failed
5. **Manual fix** - Fix the SQL in the migration file
6. **Retry** - Run `npm run db:migrate` again

---

## Migration File Organization

### Files Used

The system automatically:
- ✅ Reads all `.sql` files in `supabase/migrations/`
- ✅ Sorts them chronologically by timestamp
- ❌ Ignores `.rollback.sql` files
- ❌ Ignores non-migration files

### Naming Convention

```
supabase/migrations/
├── 20241001000000_complete_schema.sql          ← Executes
├── 20241001000000_complete_schema.rollback.sql ← Ignored
├── 20251112000001_optimize_rls_policies_CORRECTED.sql  ← Executes (CORRECTED)
├── 20251112000001_optimize_rls_policies.sql            ← Would execute (original)
└── docs/
    └── SCHEMA_ADAPTATION_SUMMARY.md           ← Not a migration
```

> **Note:** CORRECTED files are preferred over original versions for migrations 1, 3, 4

---

## Advanced: Tracking Applied Migrations

### View Migration History

```bash
# Connect to database (using psql, DBeaver, etc.)
SELECT name, executed_at, duration_ms, success FROM public._migrations_applied ORDER BY executed_at;
```

### Example Output

```
name                                      executed_at              duration_ms  success
20241001000000_complete_schema           2025-11-12 14:32:45      245         true
20241002000000_seed_initial_data         2025-11-12 14:32:46      156         true
20251112000001_optimize_rls_policies...  2025-11-12 14:32:47      289         true
```

### Check Failed Migrations

```sql
SELECT name, error_message FROM public._migrations_applied WHERE success = false;
```

---

## Migration Execution Plan

### For First-Time Setup

Run these steps in order:

```bash
# 1. Verify setup
npm run db:status

# 2. Create storage buckets manually
#    (See: docs/migrations/STORAGE_BUCKETS_SETUP.md)

# 3. Run all migrations
npm run db:migrate

# 4. Verify success
npm run db:status  # Should show all applied

# 5. Seed visual settings if needed
#    (Migration 5 includes seed data)
```

### For New Migrations Later

When you add new migration files:

```bash
# Add your new SQL file to supabase/migrations/
# File format: 20YYMMDD000000_description.sql

# Check status
npm run db:migrate  # Automatically runs only new migrations
```

---

## Security Best Practices

1. **Never commit `.env.local`**
   - It's in `.gitignore` - ensure it stays protected
   - Check before pushing: `git status`

2. **Rotate database passwords periodically**
   - Generate new password in Supabase > Settings > Database
   - Update `DB_PASSWORD` in `.env.local`

3. **Use pooler for connections**
   - More stable (port 6543)
   - Better for batch operations like migrations

4. **Keep access token secure**
   - Only stored in `.env.local` (not in code)
   - Regenerate if compromised

5. **Audit migration history**
   - Check `_migrations_applied` table periodically
   - Verify all migrations are accounted for

---

## Reference

### Environment Variables

| Variable | Required | Source | Example |
|----------|----------|--------|---------|
| DB_HOST | ✅ | Supabase Settings > Database | aws-0-us-west-1.pooler.supabase.com |
| DB_PORT | ✅ | Supabase | 6543 (pooler) or 5432 (direct) |
| DB_NAME | ✅ | Supabase | postgres |
| DB_USER | ✅ | Supabase | postgres |
| DB_PASSWORD | ✅ | Supabase | your-secure-password |
| SUPABASE_PROJECT_ID | ❌ | Supabase | qcwnlbpultscerwdnzbm |
| SUPABASE_ACCESS_TOKEN | ❌ | Supabase | sbp_... |

### npm Scripts

| Command | Purpose |
|---------|---------|
| `npm run db:migrate` | Run pending migrations |
| `npm run db:status` | Show migration status |
| `npm run db:list` | List all migrations |
| `npm run db:reset` | Clear migration tracking |

---

## Need Help?

1. **Check status first:** `npm run db:status`
2. **Review error messages** - they usually describe the problem
3. **Check `.env.local`** - verify all DB variables are set correctly
4. **Test connection manually:**

```bash
# Using PostgreSQL CLI (if installed)
psql -h aws-0-[region].pooler.supabase.com -U postgres -d postgres -c "SELECT 1"
# Should return: 1 (if connection works)
```

---

**Last Updated:** 2025-11-12
**Migration Runner:** Ready for Production
**Status:** ✅ All systems ready
