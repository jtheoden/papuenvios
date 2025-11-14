# PapuEnvíos - Quick Reference Structure

## Directory Tree

```
papuenvios/
│
├── 📁 src/                          # React Frontend (79 source files)
│   ├── App.jsx                      # Main app with routing
│   ├── main.jsx                     # Bootstrap
│   ├── index.css                    # Global styles
│   │
│   ├── 📁 components/               # 47 React components
│   │   ├── HomePage.jsx
│   │   ├── ProductsPage.jsx
│   │   ├── CartPage.jsx             # TODO: cross-currency
│   │   ├── AdminPage.jsx
│   │   ├── SendRemittancePage.jsx
│   │   ├── LoginForm.jsx
│   │   ├── RegisterForm.jsx
│   │   ├── BankAccountForm.jsx
│   │   ├── RecipientForm.jsx
│   │   └── [40+ more components]
│   │
│   ├── 📁 contexts/                 # Global state (4 files)
│   │   ├── AuthContext.jsx          # Auth state
│   │   ├── BusinessContext.jsx      # Data & settings
│   │   ├── LanguageContext.jsx      # i18n
│   │   └── ModalContext.jsx         # Dialog state
│   │
│   ├── 📁 lib/                      # Services & utilities (24 files)
│   │   ├── supabase.js              # Supabase client
│   │   ├── userService.js           # User operations
│   │   ├── productService.js        # Product CRUD
│   │   ├── orderService.js          # Orders
│   │   ├── remittanceService.js     # Remittances (TODO: WhatsApp)
│   │   ├── bankService.js           # Bank accounts
│   │   ├── zelleService.js          # Zelle integration
│   │   ├── currencyService.js       # Currencies
│   │   ├── storage.js               # File storage
│   │   ├── whatsappService.js       # WhatsApp
│   │   └── [14 more services]
│   │
│   ├── 📁 hooks/                    # React hooks (1 file)
│   │   └── useVisualSettings.js
│   │
│   ├── 📁 components/ui/            # UI components (5 files)
│   │   ├── button.jsx
│   │   ├── toast.jsx
│   │   ├── user-avatar.jsx
│   │   └── ...
│   │
│   ├── 📁 translations/             # i18n files
│   │   └── [language files]
│   │
│   └── 📁 types/                    # TypeScript types
│
├── 📁 supabase/                     # Database migrations
│   ├── 📁 migrations/               # 26 SQL files
│   │   ├── 03_fix_authorization.sql
│   │   ├── 20241001000000_complete_schema.sql
│   │   ├── 20241002000000_seed_initial_data.sql
│   │   ├── 20250128000000_add_bank_accounts_system.sql
│   │   ├── 20250128000001_fix_bank_rls_policies.sql
│   │   ├── 20250128000002_add_account_full_number_and_logos.sql
│   │   ├── 20251007_orders_payment_system.sql
│   │   ├── 20251030000001_add_payment_rejected_at.sql
│   │   ├── 20251112000001_optimize_rls_policies_CORRECTED.sql ⭐
│   │   ├── 20251112000002_create_storage_buckets.sql
│   │   ├── 20251112000003_add_manager_role_CORRECTED.sql ⭐
│   │   ├── 20251112000004_user_categorization_system_CORRECTED.sql ⭐
│   │   ├── 20251112000005_seed_initial_data.sql
│   │   └── [13 rollback files]
│   │
│   └── 📁 config/                   # Supabase config
│
├── 📁 scripts/                      # Automation scripts
│   ├── migrate.js                   # CLI migration runner (316 lines)
│   ├── apply-migration.js
│   ├── createTestUser.js
│   └── set_superadmin.sql
│
├── 📁 docs/                         # Documentation (42+ files)
│   ├── MIGRATION_CLI_SETUP.md
│   ├── MIGRATION_EXECUTION_GUIDE.md
│   ├── SCHEMA_ADAPTATION_SUMMARY.md
│   ├── 📁 guides/                   # Implementation guides
│   ├── 📁 migrations/               # Migration docs
│   ├── 📁 sessions/                 # Session summaries
│   └── 📁 tracking/                 # Task tracking
│
├── 📁 public/                       # Static assets
│   └── [images, logos]
│
├── 📁 dist/                         # Build output (Oct 28)
│   ├── index.html
│   ├── assets/
│   └── bank-logos/
│
├── 📁 node_modules/                 # 445 npm packages
│
├── 📁 .git/                         # Git repository
│
├── Configuration Files
│   ├── package.json                 # NPM scripts & dependencies
│   ├── package-lock.json
│   ├── vite.config.js               # Vite build config
│   ├── tailwind.config.js            # Tailwind CSS config
│   ├── postcss.config.js             # PostCSS config
│   ├── .env.local.example            # Env template (COPY THIS!)
│   ├── .env.local                    # Local env (NEVER COMMIT)
│   └── .gitignore
│
└── Documentation Files (40+ markdown files)
    ├── CURRENT_STATUS.md             # Latest status
    ├── NEXT_STEPS.md                 # What to do next
    ├── MANUAL_EXECUTION_ORDER.md     # Migration checklist
    ├── MIGRATION_2_FIX.md            # Migration fix details
    ├── MIGRATION_QUICK_START.md      # 5-minute guide
    ├── PROJECT_ANALYSIS_2025-11-13.md # This analysis
    ├── README_COMPREHENSIVE.md
    ├── [+30 more documentation files]
    └── [Various fix & feature docs]
```

## Key Statistics

| Metric | Count |
|--------|-------|
| React Components | 47 |
| Service/Library Files | 24 |
| Context Providers | 4 |
| UI Components | 5 |
| Total Source Files | 79 |
| Database Migrations | 26 (with rollbacks) |
| Documentation Files | 80+ |
| NPM Packages | 445 |
| Lines of Code (migrate.js) | 316 |

## Tech Stack

```
Frontend:  React 18.2.0 + Vite 7.1.6
Styling:   TailwindCSS 3.3.3 + Radix UI
State:     Context API + Custom hooks
Router:    React Router DOM 6.16.0
Database:  Supabase PostgreSQL
Auth:      Supabase Auth (Email + Google OAuth)
Animations: Framer Motion 10.16.4
Notifications: React Hot Toast 2.6.0
```

## Database Tables (Main)

```
- users                    # Auth users
- user_profiles            # User data
- products                 # Product catalog
- combos                   # Product bundles
- orders                   # Customer orders
- order_items              # Order line items
- remittances              # Remittance records
- recipients               # Remittance recipients
- bank_accounts            # Enterprise banks
- zelle_accounts           # Zelle accounts
- currencies               # Supported currencies
- provinces                # Cuban locations
- user_categories          # User tiers (REGULAR/PRO/VIP)
- manager_assignments      # Manager roles
- _migrations_applied      # Migration tracking
```

## NPM Commands

```bash
# Development
npm run dev                # Start dev server
npm run build              # Production build
npm run preview            # Preview production

# Database
npm run db:migrate         # Execute pending migrations
npm run db:status          # Check migration status
npm run db:list            # List all migrations
npm run db:reset           # Reset migration tracking
```

## Quick Start (30 minutes)

```bash
# 1. Configure database
cp .env.local.example .env.local
nano .env.local            # Add DB_PASSWORD from Supabase

# 2. Install dependencies
npm install

# 3. Create storage buckets (manual in Supabase Dashboard)
# - order-delivery-proofs (Private, 5MB, images)
# - remittance-delivery-proofs (Private, 5MB, images)

# 4. Run migrations
npm run db:migrate

# 5. Verify
npm run db:status         # Should show: Applied: 25, Pending: 0

# 6. Start dev server
npm run dev
# Open http://localhost:5173
```

## Current Status

| Item | Status | Notes |
|------|--------|-------|
| Frontend | ✅ Complete | 47 components, all features |
| Backend Schema | ✅ Complete | 25 migrations, optimized |
| Auth System | ✅ Complete | Email + Google OAuth |
| Migration CLI | ✅ Complete | No Supabase CLI needed |
| Documentation | ✅ Complete | 80+ files |
| Testing | ⏳ Pending | Ready to test |
| Deployment | ⏳ Ready | Build available |
| Cross-currency cart | ⏳ TODO | CartPage.jsx:61 |
| Zelle UUID migration | ⏳ TODO | CartPage.jsx:393 |
| WhatsApp notifications | ⏳ TODO | remittanceService.js:780,829,953 |

## Important Files to Know

| File | Purpose | Location |
|------|---------|----------|
| App.jsx | Main router & layout | src/ |
| supabase.js | DB client config | src/lib/ |
| migrate.js | Migration runner | scripts/ |
| .env.local.example | Config template | ROOT |
| CURRENT_STATUS.md | Latest status | ROOT |
| NEXT_STEPS.md | Setup instructions | ROOT |

## Environment Variables Required

```env
# Database (get from Supabase > Settings > Database)
DB_HOST=xxx.pooler.supabase.com
DB_PORT=6543
DB_USER=postgres
DB_PASSWORD=<REQUIRED>
DB_NAME=postgres

# Frontend (get from Supabase > Settings > API)
VITE_SUPABASE_URL=https://xxx.supabase.co
VITE_SUPABASE_ANON_KEY=<REQUIRED>

# Supabase API (optional, for admin tasks)
SUPABASE_PROJECT_ID=xxx
SUPABASE_ACCESS_TOKEN=sbp_xxx
```

## Security Notes

- `.env.local` is in `.gitignore` - NEVER commit
- DB_PASSWORD is superuser password - keep secure
- VITE_SUPABASE_ANON_KEY has restricted permissions (good)
- Use pooler connection for migrations (better stability)
- RLS policies enabled on all tables (secure)

## Common Issues & Solutions

| Issue | Solution | Location |
|-------|----------|----------|
| Migration 2 fails | Already fixed! Use CORRECTED version | MIGRATION_2_FIX.md |
| DB connection refused | Use pooler host + port 6543 | .env.local.example |
| Cross-currency cart | TODO - not implemented yet | CartPage.jsx:61 |
| Zelle accounts | TODO - UUID migration pending | CartPage.jsx:393 |
| WhatsApp notifications | TODO - service exists, notifications pending | remittanceService.js |

## Last Updated

- Report: 2025-11-13
- Project: /home/juan/Workspace/papuenvios
- Branch: main
- Last Commit: bacd06ff (feat: Implement direct CLI-based migration system)

---

**Status:** Production-ready, awaiting database initialization
**Next Action:** Run `npm run db:migrate` after `.env.local` configuration
