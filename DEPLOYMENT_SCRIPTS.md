# Deployment Scripts - PapuEnvíos

Complete automated deployment scripts to take your application to production.

---

## Overview

Three scripts are available to automate the deployment process:

1. **`npm run deploy`** ⭐ **RECOMMENDED** - Node.js version
2. **`npm run deploy:bash`** - Bash version (Linux/Mac)
3. **`npm run setup`** - Quick setup (install + migrate + build)

---

## Script 1: npm run deploy (Recommended)

### What it does
```
1. Verifies Node.js, npm, .env.local configuration
2. Checks migration files and scripts
3. Installs npm dependencies
4. Executes all database migrations (5-15 minutes)
5. Verifies migration status
6. Builds for production
7. Provides deployment instructions
```

### How to use

```bash
# From project root directory
npm run deploy
```

### Output
```
✅ Environment verified
✅ Dependencies installed
✅ All migrations executed (completed in 180.4s)
✅ Status verified
✅ Production build created

REQUIRED NEXT STEPS:
1️⃣  CREATE STORAGE BUCKETS (5 minutes)
2️⃣  TEST IN DEVELOPMENT (10 minutes)
3️⃣  DEPLOY TO PRODUCTION (5-20 minutes)
```

### Advantages
- Colored output for easy reading
- Progress indicators
- Automatic error detection
- Helpful error messages
- Works on all platforms (Windows, Mac, Linux)
- Best error handling

---

## Script 2: bash deploy.sh

### What it does
Same as npm run deploy, but using Bash

### How to use (Mac/Linux)

```bash
# From project root directory
chmod +x deploy.sh  # Make executable (one time)
./deploy.sh
```

### How to use (Windows)
Not recommended on Windows. Use `npm run deploy` instead.

Or use WSL (Windows Subsystem for Linux):
```bash
wsl bash deploy.sh
```

### Advantages
- Native bash execution
- Lightweight
- Traditional Unix approach

### Disadvantages
- Only works on Mac/Linux/WSL
- No fancy error handling on Windows

---

## Script 3: npm run setup (Quick)

### What it does
Combines three commands into one:
```
1. npm install
2. npm run db:migrate
3. npm run build
```

### How to use

```bash
npm run setup
```

### Use when
- You want everything in one command
- You don't need detailed progress output
- You prefer minimal feedback

---

## Manual Commands (For Reference)

If you prefer to run each step manually:

```bash
# Step 1: Install dependencies
npm install

# Step 2: Execute migrations
npm run db:migrate

# Step 3: Verify migrations
npm run db:status

# Step 4: List applied migrations
npm run db:list

# Step 5: Build for production
npm run build

# Step 6: Test locally
npm run dev
```

---

## Detailed Execution Steps

### Before Running Any Script

**Create storage buckets in Supabase Dashboard** (REQUIRED - do this BEFORE running scripts):

1. Go to: https://app.supabase.com/project/qcwnlbpultscerwdnzbm/storage/buckets
2. Click "New Bucket"
3. Create **order-delivery-proofs**
   - Privacy: Private
   - Max file size: 5MB
   - File types: Images
4. Create **remittance-delivery-proofs**
   - Privacy: Private
   - Max file size: 5MB
   - File types: Images

**Status:** Storage buckets must exist before migrations run.

---

### Step 1: Run Deployment Script

```bash
# Using npm (Recommended)
npm run deploy

# OR using bash (Mac/Linux only)
./deploy.sh

# OR using quick setup
npm run setup
```

**Expected duration:** 1-2 hours (most time is npm install and migrations)

**Expected output:**
```
✅ All critical tasks completed
✅ Environment verified
✅ Dependencies installed
✅ Database migrations executed
✅ Status verified
✅ Production build created
```

---

### Step 2: Test in Development

After script completes:

```bash
npm run dev
```

Open http://localhost:5173 and verify:

```
✅ Page loads quickly
✅ Products visible (should show ~20-50 items)
✅ Categories visible
✅ Testimonials visible
✅ Carousel slides rotate
✅ User profile loads
✅ No ERROR 57014 in console (F12)
✅ No "timeout" errors
```

**Issues?** See Troubleshooting section below.

---

### Step 3: Deploy to Production

```bash
# Build already done by script, but rebuild if needed
npm run build

# Deploy to your hosting provider:

# Option A: Vercel (automatic)
# Just push to GitHub: git push origin main

# Option B: Netlify
netlify deploy --prod --dir=dist

# Option C: Custom hosting
# Upload ./dist/ folder to your web server root
# Configure .env variables on server
```

---

## Troubleshooting

### "npm: command not found"

**Cause:** Node.js not installed

**Solution:**
```bash
# Install Node.js from https://nodejs.org
# Choose LTS version (18.x or 20.x)
# Then restart terminal and try again

node --version  # Should show v18.x.x or v20.x.x
npm --version   # Should show 9.x.x or higher
```

---

### ".env.local not found"

**Cause:** Configuration file missing

**Solution:**
```bash
# Copy template
cp .env.local.example .env.local

# Add credentials:
# DB_HOST, DB_PORT, DB_USER, DB_PASSWORD from Supabase
nano .env.local
```

---

### Migrations fail with "Tenant or user not found"

**Cause:** Database credentials incorrect

**Solution:**
1. Verify DB credentials in `.env.local`
2. Check credentials in Supabase Dashboard → Database → Connection string
3. Update `.env.local` with correct values
4. Run `npm run db:reset` to clear failed migrations
5. Run `npm run db:migrate` again

---

### "Still seeing ERROR 57014 timeouts"

**Cause:** Indices not yet created or used by PostgreSQL

**Solution:**
```bash
# Wait 5-10 minutes for database to use new indices
# Then test again

# Force index usage:
# In Supabase SQL Editor, run:
ANALYZE public.user_profiles;
ANALYZE public.products;
ANALYZE public.testimonials;

# Then test in app
```

---

### Products/categories don't appear

**Cause:** Data not seeded or RLS policies blocking access

**Solution:**
```bash
# Check data exists in Supabase SQL Editor:
SELECT COUNT(*) FROM public.products;
SELECT COUNT(*) FROM public.product_categories;

# If count is 0, seed data not inserted
# Run Migration 5 manually in Supabase SQL Editor
```

---

### Build fails with "out of memory"

**Cause:** Not enough memory for build

**Solution:**
```bash
# Increase Node memory limit
export NODE_OPTIONS=--max-old-space-size=4096
npm run build

# Or use manual build
vite build
```

---

### "Cannot find module 'pg'"

**Cause:** Dependencies not installed

**Solution:**
```bash
rm -rf node_modules package-lock.json
npm install
npm run deploy
```

---

## Environment Variables

**Required in `.env.local`:**

```bash
# Supabase (Frontend)
VITE_SUPABASE_URL=https://qcwnlbpultscerwdnzbm.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# Database (Migrations)
DB_HOST=qcwnlbpultscerwdnzbm.supabase.co
DB_PORT=5432
DB_NAME=postgres
DB_USER=postgres
DB_PASSWORD=your_password_here
```

Get credentials from:
- Supabase Dashboard → Settings → API
- Supabase Dashboard → Database → Connection string (for DB credentials)

---

## Performance Expectations

After successful deployment:

| Query | Time |
|-------|------|
| GET /products | <100ms |
| GET /categories | <50ms |
| GET /testimonials | <100ms |
| GET /carousel | <40ms |
| GET /profile | <20ms |

If any query takes >500ms, something is wrong.

---

## Post-Deployment Checklist

- [ ] Storage buckets created in Supabase
- [ ] Deployment script completed without errors
- [ ] Dev server works: npm run dev
- [ ] All products/categories/testimonials visible
- [ ] No timeout errors in console
- [ ] No ERROR 57014 in network tab
- [ ] Production build created: npm run build
- [ ] Deployed to hosting provider
- [ ] Tested on production URL
- [ ] Mobile friendly (test on phone)
- [ ] All forms work (login, register, etc.)
- [ ] Payment flow works
- [ ] Remittance flow works

---

## Support

If you encounter issues:

1. **Check logs:**
   ```bash
   npm run db:status
   ```

2. **Review documentation:**
   - `PRODUCTION_DEPLOYMENT_GUIDE.md`
   - `QUICK_START_PRODUCTION.md`
   - `PROYECTO_ESTADO_FINAL_2025-11-13.md`

3. **Debug migrations:**
   ```bash
   npm run db:list
   ```

4. **Check database directly:**
   - Supabase Dashboard → SQL Editor
   - Run: `SELECT * FROM _migrations_applied;`

---

## Next Steps After Deployment

1. **Monitor production**
   - Check error logs regularly
   - Monitor performance metrics
   - Set up alerts for downtime

2. **Gather user feedback**
   - Test all features with real users
   - Collect bug reports
   - Monitor user experience

3. **Optimize further**
   - Analyze slow queries
   - Add caching if needed
   - Optimize images
   - Monitor database performance

4. **Keep updated**
   - Update dependencies monthly
   - Apply security patches
   - Review Supabase announcements

---

**Happy Deploying!** 🚀

For questions, see: `PRODUCTION_DEPLOYMENT_GUIDE.md`
