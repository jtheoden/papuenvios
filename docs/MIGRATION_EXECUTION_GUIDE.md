# Migration Execution Guide - Step by Step

**Updated:** 2025-11-12
**Status:** Ready for CLI-based execution

---

## Quick Start

```bash
# 1. Set up database credentials (ONE TIME)
# Edit .env.local with your database connection details
# See: .env.local.example for template

# 2. Install dependencies (ONE TIME)
npm install

# 3. Check migration status
npm run db:status

# 4. Run pending migrations
npm run db:migrate

# 5. Verify success
npm run db:status
```

---

## Detailed Steps

### Step 1: Configure Database Connection

**File:** `.env.local`

```env
# Get these from Supabase > Settings > Database
DB_HOST=aws-0-[region].pooler.supabase.com
DB_PORT=6543
DB_NAME=postgres
DB_USER=postgres
DB_PASSWORD=your_actual_database_password
```

**To find your password:**
1. Open Supabase Dashboard
2. Select your project
3. Go to Settings > Database
4. Look for "Connection parameters" or "Connection string"
5. Copy the password value

### Step 2: Install Dependencies

```bash
npm install
```

This installs:
- `pg` - PostgreSQL database client
- `dotenv` - Environment variable loader

### Step 3: Verify Database Connection

```bash
npm run db:status
```

**Expected output:**
```
🔌 Connecting to database...
✅ Connected

📋 Migration Status

Total migrations: 25
Applied: 0
Pending: 25

Migration List:
─────────────────────────────────────────────────────────────────────────────
⏳ 20241001000000_complete_schema
⏳ 20241002000000_seed_initial_data
⏳ 20251007_orders_payment_system
...
```

If connection fails:
- Check `.env.local` has correct values
- Verify DB_HOST includes `.pooler.supabase.com`
- Verify DB_PORT is 6543 (for pooler)
- Verify DB_PASSWORD is correct (no extra spaces)

### Step 4: Create Storage Buckets (Manual)

Before running migrations, create these buckets in Supabase Dashboard:

1. Go to **Storage** tab
2. Click **Create a new bucket**
3. Create first bucket:
   - Name: `order-delivery-proofs`
   - Public: ❌ (Private)
   - File size limit: 5 MB
   - Allowed MIME types: `image/jpeg`, `image/jpg`, `image/png`, `image/webp`

4. Click **Create a new bucket** again
5. Create second bucket:
   - Name: `remittance-delivery-proofs`
   - Public: ❌ (Private)
   - File size limit: 5 MB
   - Allowed MIME types: `image/jpeg`, `image/jpg`, `image/png`, `image/webp`

### Step 5: Run Migrations

```bash
npm run db:migrate
```

**What happens:**
1. Connects to database
2. Creates migration tracking table (if needed)
3. Reads all migration files from `supabase/migrations/`
4. Executes pending migrations in chronological order
5. Records which ones succeeded/failed
6. Shows progress with timing

**Expected output (first run):**
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
... more migrations ...

✅ Migration run completed!
```

### Step 6: Verify Success

```bash
npm run db:status
```

**Expected output:**
```
Total migrations: 25
Applied: 25
Pending: 0

Migration List:
─────────────────────────────────────────────────────────────────────────────
✅ 20241001000000_complete_schema
✅ 20241002000000_seed_initial_data
✅ 20251007_orders_payment_system
... (all should have ✅)
```

All ✅ marks mean **success!**

---

## Migration Files Reference

### Files Being Executed

| # | File | Purpose | Status |
|---|------|---------|--------|
| 1 | 20241001000000_complete_schema.sql | Initial schema | ✅ |
| 2 | 20241002000000_seed_initial_data.sql | Seed data | ✅ |
| 3 | 20251007_orders_payment_system.sql | Payment system | ✅ |
| 4 | 20250128000000_add_bank_accounts_system.sql | Bank accounts | ✅ |
| 5 | 20251112000001_optimize_rls_policies_CORRECTED.sql | RLS optimization | ✅ CORRECTED |
| 6 | 20251112000002_create_storage_buckets.sql | Storage policies | ✅ FIXED |
| 7 | 20251112000003_add_manager_role_CORRECTED.sql | Manager role | ✅ CORRECTED |
| 8 | 20251112000004_user_categorization_system_CORRECTED.sql | User categories | ✅ CORRECTED |
| 9 | 20251112000005_seed_initial_data.sql | Final seeding | ✅ |

### CORRECTED Files

These migrations were fixed to match your actual schema:

- ✅ **20251112000001** - Uses `user_id` instead of `sender_id`
- ✅ **20251112000002** - Removed permission issues, fixed column references
- ✅ **20251112000003** - Uses correct constraint format for 'manager' role
- ✅ **20251112000004** - Uses `auth.users(id)` for correct relationships

---

## Common Scenarios

### Scenario 1: Running for the First Time

```bash
# 1. Configure .env.local
echo "DB_HOST=..." >> .env.local

# 2. Install dependencies
npm install

# 3. Run migrations
npm run db:migrate

# All 25 migrations run on first execution
```

### Scenario 2: Adding New Migrations Later

After adding a new migration file to `supabase/migrations/`:

```bash
# Only new migrations run
npm run db:migrate

# Old ones are skipped (already tracked)
```

### Scenario 3: Checking Status Without Running

```bash
npm run db:status

# Shows which are pending (⏳) and applied (✅)
# Does NOT execute anything
```

### Scenario 4: Getting Migration List

```bash
npm run db:list

# Lists all available migrations
# Useful for debugging or verification
```

---

## Troubleshooting

### Problem: "Missing required database configuration"

```
❌ Missing required database configuration:
   - DB_HOST (or SUPABASE_DB_HOST)
```

**Solution:**
1. Check `.env.local` exists
2. Add missing variables
3. Verify no typos (must be exact: `DB_HOST`, `DB_PORT`, etc.)

### Problem: "ECONNREFUSED: Connection refused"

```
Error: connect ECONNREFUSED 127.0.0.1:6543
```

**Solution:**
1. Verify `DB_HOST` is correct (includes `.pooler.supabase.com`)
2. Verify `DB_PORT` is 6543 (not 5432)
3. Try alternative host:
   ```env
   DB_HOST=qcwnlbpultscerwdnzbm.supabase.co
   DB_PORT=5432
   ```

### Problem: "FATAL: password authentication failed"

```
Error: password authentication failed for user "postgres"
```

**Solution:**
1. Go to Supabase > Settings > Database
2. Look for password in "Connection parameters"
3. Copy it exactly (including special characters)
4. Paste into `.env.local` as `DB_PASSWORD`
5. Try again

### Problem: "ERROR 42501: must be owner of table objects"

```
ERROR 42501: must be owner of table objects
```

**This is FIXED in the updated migration 2.**

- If you hit this during migration 2:
  - The fix has been applied
  - Try again: `npm run db:migrate`

### Problem: Migration Hangs

If a migration seems stuck:

1. Wait 30 seconds (some are slow)
2. Check if you see progress messages
3. If truly stuck, press `Ctrl+C` to cancel
4. Investigate which migration failed
5. Check database directly:
   ```bash
   # See which migrations completed
   psql -h [host] -U postgres -d postgres -c \
     "SELECT name, success FROM public._migrations_applied"
   ```

### Problem: "relation X does not exist"

```
ERROR 42P01: relation "user_categories" does not exist
```

**Cause:** A previous migration failed

**Solution:**
1. Check which migration failed: `npm run db:status`
2. Look at the error message
3. Fix the issue (usually schema mismatch)
4. Run again: `npm run db:migrate`

---

## Advanced: Manual Migration Tracking

If needed, you can view migration history directly:

```bash
# Connect to database
psql -h aws-0-[region].pooler.supabase.com -U postgres -d postgres

# List applied migrations
SELECT name, executed_at, duration_ms, success
FROM public._migrations_applied
ORDER BY executed_at;

# Check for failures
SELECT name, error_message
FROM public._migrations_applied
WHERE success = false;
```

---

## Next Steps After Migrations

Once all migrations complete:

1. ✅ Database schema ready
2. ✅ RLS policies configured
3. ✅ Storage buckets configured
4. ⏳ Configure frontend environment:
   - Set `VITE_SUPABASE_URL`
   - Set `VITE_SUPABASE_ANON_KEY`
5. ⏳ Test authentication flows
6. ⏳ Test role-based access control
7. ⏳ Test user categorization system

---

## Reference: All Commands

```bash
# Check migration status (no changes)
npm run db:status

# Run pending migrations
npm run db:migrate

# List all available migrations
npm run db:list

# Reset migration tracking (careful!)
npm run db:reset

# Force continue despite errors
npm run db:migrate -- --force
```

---

**Created:** 2025-11-12
**Last Updated:** 2025-11-12
**Status:** ✅ Ready for Production
