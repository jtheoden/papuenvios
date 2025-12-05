# PapuEnvíos - Complete File Inventory & Paths

**Generated:** 2025-11-13 | **Total Files Analyzed:** 80+ source files + 80+ documentation files

---

## SOURCE CODE FILES (79 Total)

### React Components (47 Files)
Location: `/home/juan/Workspace/papuenvios/src/components/`

**Page Components (13):**
- `/src/components/HomePage.jsx`
- `/src/components/ProductsPage.jsx`
- `/src/components/ProductDetailPage.jsx`
- `/src/components/RemittancesPage.jsx`
- `/src/components/SendRemittancePage.jsx` - Remittance creation
- `/src/components/MyRemittancesPage.jsx`
- `/src/components/MyRecipientsPage.jsx`
- `/src/components/DashboardPage.jsx`
- `/src/components/CartPage.jsx` - **CONTAINS TODO: cross-currency**
- `/src/components/LoginPage.jsx`
- `/src/components/AdminPage.jsx`
- `/src/components/SettingsPage.jsx`
- `/src/components/NewsPage.jsx`

**Authentication Components (9):**
- `/src/components/LoginForm.jsx` - Email + OAuth
- `/src/components/RegisterForm.jsx`
- `/src/components/ForgotPasswordForm.jsx`
- `/src/components/ResetPasswordForm.jsx`
- `/src/components/PasswordStrengthMeter.jsx`
- `/src/components/EmailVerificationPending.jsx`
- `/src/components/AuthCallback.jsx`
- `/src/components/AuthLoadingScreen.jsx`
- `/src/components/LoginForm.jsx`

**Business Logic Components (8):**
- `/src/components/RecipientForm.jsx`
- `/src/components/RecipientSelector.jsx`
- `/src/components/BankAccountForm.jsx`
- `/src/components/BankAccountSelector.jsx`
- `/src/components/ZelleAccountSelector.jsx` - **CONTAINS TODO: UUID migration**
- `/src/components/ProvinceSelector.jsx`
- `/src/components/RemittanceTypesConfig.jsx`
- `/src/components/AdminOrdersTab.jsx`

**Admin/Management (4):**
- `/src/components/AdminRemittancesTab.jsx`
- `/src/components/UserManagement.jsx`
- `/src/components/UserPanel.jsx`
- `/src/components/VisualSettingsPanel.jsx`

**Utility/Layout Components (4):**
- `/src/components/Header.jsx`
- `/src/components/LoadingScreen.jsx`
- `/src/components/ErrorBoundary.jsx`
- `/src/components/withProtectedRoute.jsx` - Route protection HOC

**Other Components (5):**
- `/src/components/HeroImage.jsx`
- `/src/components/CallToAction.jsx`
- `/src/components/WelcomeMessage.jsx`
- `/src/components/FileUploadWithPreview.jsx`
- `/src/components/VendorPage.jsx`

**UI Components (5 files):**
Location: `/src/components/ui/`
- `button.jsx`
- `toaster.jsx`
- `toast.jsx`
- `user-avatar.jsx`
- `user-avatar-with-badge.jsx`

**Main Application:**
- `/src/App.jsx` - Root component with routing

### Context Providers (4 Files)
Location: `/home/juan/Workspace/papuenvios/src/contexts/`

- `/src/contexts/AuthContext.jsx` - Authentication state
- `/src/contexts/BusinessContext.jsx` - Business data & settings
- `/src/contexts/LanguageContext.jsx` - Multi-language support
- `/src/contexts/ModalContext.jsx` - Modal/dialog state

### Service/Library Files (24 Files)
Location: `/home/juan/Workspace/papuenvios/src/lib/`

**Core Services:**
- `/src/lib/supabase.js` - Supabase client configuration
- `/src/lib/userService.js` - User operations
- `/src/lib/passwordValidation.js` - Password validation

**Business Logic Services:**
- `/src/lib/productService.js` - Product CRUD
- `/src/lib/comboService.js` - Combo management
- `/src/lib/orderService.js` - Order processing
- `/src/lib/remittanceService.js` - **CONTAINS TODO: WhatsApp notifications**
- `/src/lib/recipientService.js` - Recipient management

**Financial Services:**
- `/src/lib/bankService.js` - Bank account management
- `/src/lib/zelleService.js` - Zelle integration
- `/src/lib/currencyService.js` - Currency & exchange

**Integration Services:**
- `/src/lib/whatsappService.js` - WhatsApp integration
- `/src/lib/testimonialService.js` - Testimonial management
- `/src/lib/systemMessageService.js` - System notifications

**Utility Services:**
- `/src/lib/storage.js` - File storage operations
- `/src/lib/shippingService.js` - Shipping calculations
- `/src/lib/carouselService.js` - Carousel data
- `/src/lib/imageUtils.js` - Image processing
- `/src/lib/styleUtils.js` - CSS utilities
- `/src/lib/utils.js` - General utilities
- `/src/lib/queryHelpers.js` - Database helpers
- `/src/lib/constants.js` - App constants
- `/src/lib/cubanLocations.js` - Geographic data
- `/src/lib/visualSettingsService.js` - Visual customization

### Hooks (1 File)
- `/src/hooks/useVisualSettings.js` - Visual settings hook

### Other Source Files
- `/src/main.jsx` - React bootstrap
- `/src/index.css` - Global styles
- `/src/translations/` - i18n files
- `/src/types/` - TypeScript type definitions

---

## DATABASE MIGRATION FILES (26 Total)
Location: `/home/juan/Workspace/papuenvios/supabase/migrations/`

### Core Migrations
1. `/supabase/migrations/03_fix_authorization.sql` - Authorization fixes
2. `/supabase/migrations/20241001000000_complete_schema.sql` - Complete schema
3. `/supabase/migrations/20241002000000_seed_initial_data.sql` - Initial seed

### Bank Account System
4. `/supabase/migrations/20250128000000_add_bank_accounts_system.sql`
5. `/supabase/migrations/20250128000001_fix_bank_rls_policies.sql`
6. `/supabase/migrations/20250128000002_add_account_full_number_and_logos.sql`

### Orders & Payments
7. `/supabase/migrations/20251007_orders_payment_system.sql`
8. `/supabase/migrations/20251030000001_add_payment_rejected_at.sql`

### Optimization & Features (CORRECTED Versions)
9. `/supabase/migrations/20251112000001_optimize_rls_policies_CORRECTED.sql` ⭐
10. `/supabase/migrations/20251112000001_optimize_rls_policies.sql` (original - don't use)
11. `/supabase/migrations/20251112000002_create_storage_buckets.sql` ✅
12. `/supabase/migrations/20251112000003_add_manager_role_CORRECTED.sql` ⭐
13. `/supabase/migrations/20251112000003_add_manager_role.sql` (original - don't use)
14. `/supabase/migrations/20251112000004_user_categorization_system_CORRECTED.sql` ⭐
15. `/supabase/migrations/20251112000004_user_categorization_system.sql` (original - don't use)
16. `/supabase/migrations/20251112000005_seed_initial_data.sql`
17. `/supabase/migrations/20251112000005_seed_initial_data_MINIMAL.sql` (lightweight variant)

### Rollback Files (9)
- `20250128000000_add_bank_accounts_system.rollback.sql`
- `20250128000001_fix_bank_rls_policies.rollback.sql`
- `20250128000002_add_account_full_number_and_logos.rollback.sql`
- `20251030000001_add_payment_rejected_at.rollback.sql`
- `20251112000001_optimize_rls_policies.rollback.sql`
- `20251112000002_create_storage_buckets.rollback.sql`
- `20251112000003_add_manager_role.rollback.sql`
- `20251112000004_user_categorization_system.rollback.sql`
- `20251112000005_seed_initial_data.rollback.sql`

---

## SCRIPT FILES (4 Total)
Location: `/home/juan/Workspace/papuenvios/scripts/`

1. `/scripts/migrate.js` (316 lines)
   - Direct PostgreSQL migration runner
   - No Supabase CLI required
   - Automatic tracking and error handling

2. `/scripts/apply-migration.js`
   - Legacy migration helper

3. `/scripts/createTestUser.js`
   - Test user creation utility

4. `/scripts/set_superadmin.sql`
   - SQL script for superadmin setup

---

## CONFIGURATION FILES (6 Total)

**Build Configuration:**
- `/vite.config.js` - Vite build settings
- `/package.json` - NPM dependencies & scripts
- `/package-lock.json` - Dependency lock file

**Styling Configuration:**
- `/tailwind.config.js` - Tailwind CSS settings
- `/postcss.config.js` - PostCSS configuration

**Environment:**
- `/.env.local.example` - Configuration template (COPY THIS!)
- `/.env.local` - Local environment (NEVER COMMIT!)
- `/.gitignore` - Git ignore rules

---

## DOCUMENTATION FILES (80+ Total)

### Critical Status Documents (Root Level)
Location: `/home/juan/Workspace/papuenvios/`

**Must Read First:**
- `/CURRENT_STATUS.md` (354 lines) - Latest project overview
- `/NEXT_STEPS.md` (270 lines) - Setup instructions
- `/MANUAL_EXECUTION_ORDER.md` (210 lines) - Migration checklist
- `/MIGRATION_2_FIX.md` (278 lines) - Migration error technical details
- `/MIGRATION_QUICK_START.md` - 5-minute quick reference

**New Analysis Reports:**
- `/PROJECT_ANALYSIS_2025-11-13.md` (809 lines) - Comprehensive analysis
- `/PROJECT_STRUCTURE_SUMMARY.md` - Quick reference guide
- `/FILE_INVENTORY.md` - This file

### Implementation & Feature Documentation
- `/RECENT_UPDATES_SUMMARY.md`
- `/PROJECT_DEVELOPMENT_STATUS.md`
- `/PHASE_2_COMPLETE_SUMMARY.md`
- `/REMITTANCE_SYSTEM_READY.md`
- `/CRUD_IMPROVEMENTS_COMPLETE.md`

### Bug Fixes & Technical Solutions
- `/AUTHORIZATION_FIX_INSTRUCTIONS.md`
- `/CONTEXT_ERROR_FIX.md`
- `/COMPLETE_FIX_SUMMARY.md`
- `/TESTIMONIALS_SCHEMA_FIX.md`
- `/TESTIMONIALS_JOIN_FIX.md`
- `/CART_FIXES_SUMMARY.md`
- `/CART_PRICE_FIX_TECHNICAL.md`
- `/FINAL_CART_FIXES.md`
- `/CURRENCY_EXCHANGE_REFACTOR.md`
- `/SOLUCION_ERROR_403.md` (Spanish)
- `/SITE_VISITS_FIX.md`
- `/VENDORPAGE_FIXES_SESSION8.md`
- `/CONTEXT_ERROR_FIX.md`
- `/DEBUG_UUID_ERROR.md`

### Feature Implementation Guides
- `/FINAL_OPTIMIZATION_SUMMARY.md`
- `/TRANSLATIONS_COMPLETE_2025-10-13.md`
- `/USER_PANEL_IMPROVEMENTS.md`
- `/UX_IMPROVEMENTS_PLAN.md`
- `/WORKFLOW_OPTIMIZATION_2025-10-12.md`
- `/ORDER_WORKFLOW_ANALYSIS.md`
- `/FINAL_FIXES_2025-10-10.md`
- `/FINAL_OPTIMIZATION_SUMMARY.md`
- `/FLUJO_WHATSAPP_DETALLADO.md` (Spanish - WhatsApp flow)

### Process & Standards Documentation
- `/AGENT_BEHAVIOR_GUIDELINES.md`
- `/DEVELOPMENT_STANDARDS.md`
- `/ESTADO_Y_PENDIENTES.md` (Spanish)
- `/ACCIONES_REQUERIDAS.md` (Spanish)
- `/INSTRUCCIONES_FINALES.md` (Spanish)
- `/APPLY_FIX_INSTRUCTIONS.md`
- `/EJECUTAR_MIGRACIONES.md` (Spanish)

### Reference & Legacy
- `/currentDBSchema.md` - Database schema reference
- `/developmentMap.md` - Development roadmap
- `/ecommerce_database_model.sql` - Original DB model
- `/README_COMPREHENSIVE.md` - Comprehensive README
- `/TESTING_MEMORY.md` - Testing notes

### Docs Folder (42 Files)
Location: `/home/juan/Workspace/papuenvios/docs/`

**Migration Documentation:**
- `MIGRATION_CLI_SETUP.md` - Complete setup guide
- `MIGRATION_EXECUTION_GUIDE.md` - Step-by-step execution
- `MIGRATION_CHECKLIST_CORRECTED.md` - Corrected checklist
- `MANUAL_MIGRATION_GUIDE.md` - Manual migration steps
- `SCHEMA_ADAPTATION_SUMMARY.md` - Schema compatibility
- `RLS_SETUP_INSTRUCTIONS.md` - RLS configuration
- `AUTH_DIAGNOSTICS.md` - Authentication troubleshooting
- `IMMEDIATE_ACTION_REQUIRED.md`

**Feature Documentation:**
- `BANK_ACCOUNTS_IMPLEMENTATION.md`
- `DATABASE_SCHEMA_CURRENT.md`
- `README.md`

**Implementation Guides (`docs/guides/`):**
- `COMPREHENSIVE_IMPLEMENTATION_PLAN.md`
- `IMPLEMENTATION_STATUS.md`
- `IMPLEMENTATION_COMPLETE_2025-10-07.md`
- `IMPLEMENTATION_SUMMARY.md`
- `PHASE_2_IMPLEMENTATION_PLAN.md`
- `PHASE_2_IMPLEMENTATION_COMPLETE.md`
- `PROJECT_STANDARDS.md`
- `CUSTOM_MODALS_IMPLEMENTATION_2025-10-13.md`
- `MULTI_CURRENCY_IMPLEMENTATION.md`
- `COMBO_QUANTITIES_IMPLEMENTATION.md`
- `ADMIN_ORDERS_TAB_IMPLEMENTATION.md`
- `PRODUCT_DETAIL_PAGE_IMPLEMENTATION.md`
- `ORDER_CONFIRMATION_IMPLEMENTATION.md`
- `NOTIFICATIONS_IMPLEMENTATION_GUIDE.md`
- `WHATSAPP_INTEGRATION_GUIDE.md`
- `WHATSAPP_FINAL_IMPLEMENTATION.md`

**Migration Guides (`docs/migrations/`):**
- `EXECUTION_GUIDE.md`
- `STORAGE_BUCKETS_SETUP.md`
- `MIGRACION_CORREGIDA_2025-10-13.md`
- `MIGRACION_EXITOSA_2025-10-13.md`
- `INSTRUCCIONES_MIGRACION_URGENTE.md`

**Session Documentation (`docs/sessions/`):**
- `SESSION_20250128_BANK_ACCOUNTS_COMPLETION.md`
- `SESSION_COMPLETE_2025-10-13.md`
- `SESSION_FINAL_2025-10-12.md`
- `SESSION_FIXES_2025-10-13.md`
- `SESSION_PHASE2_CONTINUATION_2025-10-12.md`
- `SESSION_REMITTANCE_DESIGN_2025-10-13.md`
- `SESSION_REMITTANCE_IMPLEMENTATION_2025-10-14.md`
- `SESSION_SUMMARY_2025-10-10.md`
- `SESSION_SUMMARY_2025-10-10_v2.md`
- `SESSION_SUMMARY_2025-10-12.md`

**Tracking Documents (`docs/tracking/`):**
- `REMITTANCE_SYSTEM_DESIGN.md`
- `REMITTANCE_IMPLEMENTATION_TASKS.md`

---

## BUILD & DISTRIBUTION FILES

### Build Output
Location: `/home/juan/Workspace/papuenvios/dist/`

- `index.html` - Built application entry point
- `assets/` - Compiled JavaScript & CSS bundles
- `bank-logos/` - Bank logo assets

**Last Build:** October 28, 2025

### Node Modules
Location: `/home/juan/Workspace/papuenvios/node_modules/`

**Total:** 445 packages installed

**Key Packages:**
- react@18.2.0
- vite@7.1.6
- @supabase/supabase-js@2.58.0
- tailwindcss@3.3.3
- [441 more packages]

---

## GIT REPOSITORY

Location: `/home/juan/Workspace/papuenvios/.git/`

**Current Branch:** main

**Recent Commits:**
1. `3445b9db` - otros archivos
2. `3988c6f5` - subiendo cambios totales finales
3. `bacd06ff` - feat: Implement direct CLI-based migration system without Supabase linking
4. `02667d5b` - feat: Add complete bank account management UI for non-cash remittances
5. `ca1b891b` - chore: Add Cuban bank seed data and currency-specific account types

---

## SPECIAL DIRECTORIES

### Public Assets
Location: `/home/juan/Workspace/papuenvios/public/`
- Static assets (images, logos, etc.)

### Database Directory (Hidden)
Location: `/home/juan/Workspace/papuenvios/database/`
- Local database files (if any)

### IDE Config
Location: `/home/juan/Workspace/papuenvios/.idea/`
- IntelliJ/WebStorm IDE configuration

### Claude Config
Location: `/home/juan/Workspace/papuenvios/.claude/`
- Claude-specific configuration files

---

## KEY FILE PATHS SUMMARY

### Start Here
```
1. /CURRENT_STATUS.md          - Latest overview
2. /NEXT_STEPS.md              - What to do next
3. /MANUAL_EXECUTION_ORDER.md  - Migration checklist
```

### Configuration
```
1. /.env.local.example         - Copy and fill this!
2. /package.json               - NPM config
3. /vite.config.js             - Build config
```

### Database Setup
```
1. /scripts/migrate.js         - Migration runner
2. /supabase/migrations/       - All SQL files
3. /MIGRATION_2_FIX.md         - Technical details
```

### Frontend Code
```
1. /src/App.jsx                - Main app
2. /src/components/            - All components
3. /src/lib/                   - All services
4. /src/contexts/              - Global state
```

### Comprehensive Information
```
1. /PROJECT_ANALYSIS_2025-11-13.md    - Full analysis
2. /PROJECT_STRUCTURE_SUMMARY.md      - Quick reference
3. /FILE_INVENTORY.md                 - This file
```

---

## FILE SIZE INSIGHTS

- **Largest Components:** CartPage.jsx, SendRemittancePage.jsx, RemittancesPage.jsx
- **Largest Services:** remittanceService.js, bankService.js, orderService.js
- **Largest Migration:** 20241001000000_complete_schema.sql
- **Documentation:** 80+ files, comprehensive coverage
- **Total Source Files:** 79 carefully organized
- **Total Packages:** 445 npm packages

---

## ABSOLUTE PATHS REFERENCE

All paths are absolute from project root:

**Project Root:** `/home/juan/Workspace/papuenvios/`

**Key Locations:**
- Source: `/home/juan/Workspace/papuenvios/src/`
- Components: `/home/juan/Workspace/papuenvios/src/components/`
- Services: `/home/juan/Workspace/papuenvios/src/lib/`
- Migrations: `/home/juan/Workspace/papuenvios/supabase/migrations/`
- Scripts: `/home/juan/Workspace/papuenvios/scripts/`
- Docs: `/home/juan/Workspace/papuenvios/docs/`
- Build: `/home/juan/Workspace/papuenvios/dist/`

---

**Generated:** 2025-11-13
**Status:** Complete and comprehensive
**Format:** Markdown with absolute file paths
