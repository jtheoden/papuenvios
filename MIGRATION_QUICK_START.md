# 🚀 Migration Quick Start Checklist

**Just added:** Direct CLI migration execution with no Supabase linking required!

---

## ✅ Before You Start (One-Time Setup)

- [ ] Get database password from Supabase > Settings > Database > Connection parameters
- [ ] Copy `.env.local.example` to `.env.local`
- [ ] Fill in database credentials in `.env.local`:
  ```
  DB_HOST=aws-0-[region].pooler.supabase.com
  DB_PORT=6543
  DB_USER=postgres
  DB_PASSWORD=your_password_here
  ```
- [ ] Run: `npm install`
- [ ] Verify connection: `npm run db:status`

---

## ✅ Migration Execution (First Time)

### 1️⃣ Create Storage Buckets (Manual)
```
Supabase Dashboard > Storage > Create new bucket
- Name: order-delivery-proofs (Private, 5MB, images only)
- Name: remittance-delivery-proofs (Private, 5MB, images only)
```

### 2️⃣ Run All Migrations
```bash
npm run db:migrate
```

### 3️⃣ Verify Success
```bash
npm run db:status
# Should show: Applied: 25, Pending: 0 (all ✅)
```

---

## ✅ When Adding New Migrations Later

```bash
# Just add the SQL file to: supabase/migrations/20YYMMDD_*.sql
# Then run:
npm run db:migrate

# It automatically runs only new migrations
```

---

## 🔧 All Available Commands

| Command | Purpose |
|---------|---------|
| `npm run db:migrate` | Run pending migrations |
| `npm run db:status` | Show status (no changes) |
| `npm run db:list` | List all migrations |
| `npm run db:reset` | Clear tracking (caution!) |

---

## ⚠️ Troubleshooting

### "Missing database configuration"
→ Check `.env.local` has all DB_* variables

### "Connection refused"
→ Verify `DB_HOST` includes `.pooler.supabase.com` and `DB_PORT=6543`

### "Password authentication failed"
→ Get correct password from Supabase Settings > Database

### "must be owner of table objects" (Migration 2)
→ **FIXED!** Just run `npm run db:migrate` again

---

## 📚 Full Guides

- **Setup Details:** [MIGRATION_CLI_SETUP.md](docs/MIGRATION_CLI_SETUP.md)
- **Step-by-Step:** [MIGRATION_EXECUTION_GUIDE.md](docs/MIGRATION_EXECUTION_GUIDE.md)
- **Schema Info:** [SCHEMA_ADAPTATION_SUMMARY.md](docs/SCHEMA_ADAPTATION_SUMMARY.md)

---

**Status:** ✅ Ready to execute
**Time required:** ~15 minutes
**Database migrations:** 25 total files

Ready to get started? Run:
```bash
npm run db:status
```
