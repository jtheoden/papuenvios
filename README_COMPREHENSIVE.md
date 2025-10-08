# Papuenvios - Complete Project Documentation

## 📚 Table of Contents

1. [Project Overview](#project-overview)
2. [Current State](#current-state)
3. [Standards & Guidelines](#standards--guidelines)
4. [Architecture](#architecture)
5. [Quick Start](#quick-start)
6. [Development Workflow](#development-workflow)
7. [Deployment](#deployment)
8. [Troubleshooting](#troubleshooting)

---

## 🎯 Project Overview

**Papuenvios** is a bilingual (ES/EN) digital commerce platform specializing in:
- E-commerce (products, combos) targeting Cuba
- Remittance services from USA and Spain to Cuba
- Multi-vendor support
- Admin dashboard for business management

**Tech Stack:**
- **Frontend:** React 18 + Vite + TailwindCSS
- **Backend:** Supabase (PostgreSQL + Auth + Storage)
- **State:** Context API
- **Styling:** TailwindCSS + Framer Motion
- **Language:** ES/EN with LanguageContext

---

## 🔄 Current State (As of 2025-10-01)

### ✅ Completed Features

#### Authentication
- Google OAuth integration
- Email/password login
- Role-based access (user, admin, super_admin)
- Protected routes
- User profile management

#### Products
- Full CRUD operations
- Category management with descriptions
- Image upload and optimization
- Inventory tracking
- Pricing with profit margins
- Multi-currency support (USD, EUR, CUP)

#### Categories
- **UUID-based CRUD** (fixed!)
- Auto-generated slugs
- Bilingual names and descriptions
- Proper display hierarchy

#### Combos
- Create product bundles
- Custom pricing
- Shipping options
- Product selection

#### Admin Features
- User management
- Order management
- Inventory control
- Settings (financial, visual, notifications)
- Analytics dashboard

#### UI/UX
- Fully responsive (mobile-first)
- Dark mode compatible
- Loading states everywhere
- Error handling throughout
- Empty states
- Bilingual interface

### 🐛 Known Fixed Issues

1. **Category CRUD UUID Error** ✅
   - Problem: Used slug instead of UUID for delete
   - Fix: Separated UUID (DB) from slug (display)

2. **Context Provider Error** ✅
   - Problem: react-helmet deprecated lifecycle
   - Fix: Migrated to react-helmet-async

3. **Missing Bilingual Support** ✅
   - Problem: Hardcoded Spanish strings
   - Fix: Language context throughout

4. **No Description Fields** ✅
   - Problem: Categories only had names
   - Fix: Added description_es/en fields

---

## 📋 Standards & Guidelines

**CRITICAL:** Read these documents before making ANY changes:

1. **[PROJECT_STANDARDS.md](./PROJECT_STANDARDS.md)**
   - Code quality standards
   - Security requirements
   - Performance guidelines
   - Bilingual requirements
   - Accessibility standards

2. **[TESTING_MEMORY.md](./TESTING_MEMORY.md)**
   - Testing checklists
   - Feature testing templates
   - Regression testing
   - Known issues log

3. **[SEO_OPTIMIZATION.md](./SEO_OPTIMIZATION.md)**
   - Meta tags implementation
   - Structured data (JSON-LD)
   - Sitemap generation
   - Performance optimization

4. **[COMPLETE_FIX_SUMMARY.md](./COMPLETE_FIX_SUMMARY.md)**
   - Recent fixes explained
   - Root cause analysis
   - Solution details

5. **[CONTEXT_ERROR_FIX.md](./CONTEXT_ERROR_FIX.md)**
   - Context provider issues
   - Error boundary implementation

---

## 🏗️ Architecture

### Directory Structure

```
papuenvios/
├── src/
│   ├── components/
│   │   ├── Header.jsx
│   │   ├── HomePage.jsx
│   │   ├── ProductsPage.jsx
│   │   ├── VendorPage.jsx (Admin)
│   │   ├── AdminPage.jsx
│   │   ├── DashboardPage.jsx
│   │   ├── SettingsPage.jsx
│   │   ├── UserManagement.jsx
│   │   ├── LoginPage.jsx
│   │   ├── AuthCallback.jsx
│   │   ├── ErrorBoundary.jsx
│   │   ├── withProtectedRoute.jsx
│   │   └── ui/ (shadcn components)
│   ├── contexts/
│   │   ├── AuthContext.jsx
│   │   ├── BusinessContext.jsx
│   │   └── LanguageContext.jsx
│   ├── lib/
│   │   ├── supabase.js
│   │   ├── productService.js
│   │   ├── comboService.js
│   │   ├── userService.js
│   │   └── imageUtils.js
│   ├── App.jsx
│   └── main.jsx
├── supabase/
│   ├── migrations/
│   │   ├── 20241001000000_complete_schema.sql
│   │   └── 20241002000000_seed_initial_data.sql
│   ├── FIX_ALL_ERRORS.sql (Run this!)
│   └── seed_users.sql
├── public/
│   ├── robots.txt (to create)
│   └── sitemap.xml (to generate)
├── scripts/
│   ├── createTestUser.js
│   └── generateSitemap.js (to create)
└── Documentation/
    ├── PROJECT_STANDARDS.md
    ├── TESTING_MEMORY.md
    ├── SEO_OPTIMIZATION.md
    └── COMPLETE_FIX_SUMMARY.md
```

### Data Flow

```
User Interaction
    ↓
Component (UI Layer)
    ↓
Context API (State Management)
    ↓
Service Layer (Business Logic)
    ↓
Supabase Client (Data Access)
    ↓
PostgreSQL + RLS (Database)
    ↓
Response → Context → Re-render
```

### Context Hierarchy

```jsx
<ErrorBoundary>
  <HelmetProvider>
    <LanguageProvider>
      <BusinessProvider>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BusinessProvider>
    </LanguageProvider>
  </HelmetProvider>
</ErrorBoundary>
```

---

## 🚀 Quick Start

### Prerequisites

```bash
Node.js >= 18
npm >= 9
Supabase account
```

### Environment Variables

Create `.env.local`:

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_KEY=your-service-key
VITE_GOOGLE_CLIENT_ID=your-google-client-id
```

### Installation

```bash
# Clone repository
git clone https://github.com/yourusername/papuenvios.git
cd papuenvios

# Install dependencies
npm install

# Run database migrations
# Go to Supabase SQL Editor and run:
# 1. supabase/migrations/20241001000000_complete_schema.sql
# 2. supabase/FIX_ALL_ERRORS.sql
# 3. supabase/migrations/20241002000000_seed_initial_data.sql

# Start development server
npm run dev
```

### First Time Setup

1. **Create Admin User:**
   ```bash
   node scripts/createTestUser.js
   ```

2. **Or Login with Google:**
   - Use jtheoden@gmail.com (auto super_admin)

3. **Access Admin Panel:**
   - Navigate to `/admin`
   - Create categories
   - Add products
   - Configure settings

---

## 💻 Development Workflow

### Before Starting Work

1. **Read Standards:**
   ```bash
   cat PROJECT_STANDARDS.md
   ```

2. **Check Current State:**
   ```bash
   cat TESTING_MEMORY.md
   ```

3. **Create Feature Branch:**
   ```bash
   git checkout -b feature/your-feature-name
   ```

### While Developing

1. **Follow Bilingual Pattern:**
   ```jsx
   // ✅ Correct
   {language === 'es' ? 'Texto' : 'Text'}

   // ❌ Wrong
   'Texto hardcoded'
   ```

2. **Use UUID for CRUD:**
   ```javascript
   // ✅ Correct
   deleteCategory(category.id) // UUID

   // ❌ Wrong
   deleteCategory(category.slug) // String
   ```

3. **Handle Errors:**
   ```javascript
   try {
     await operation();
     toast({ title: 'Success' });
   } catch (error) {
     toast({ title: 'Error', description: error.message });
   }
   ```

4. **Test in Both Languages:**
   - Switch language
   - Test all user flows
   - Verify all text changes

### Before Committing

```bash
# Run tests (if available)
npm test

# Check for errors
npm run build

# Manual testing checklist
# - Works in ES
# - Works in EN
# - Works on mobile
# - No console errors
# - No console warnings
```

### Committing

```bash
git add .
git commit -m "feat: descriptive commit message

- What was added/changed
- Why it was needed
- What was tested"

git push origin feature/your-feature-name
```

---

## 🚀 Deployment

### Build for Production

```bash
# Build optimized bundle
npm run build

# Preview production build
npm run preview

# Check bundle size
npm run build -- --report
```

### Pre-Deployment Checklist

```markdown
[ ] All tests pass
[ ] No console errors
[ ] No console warnings
[ ] Bilingual content verified
[ ] Mobile responsive
[ ] Images optimized
[ ] SEO meta tags present
[ ] Environment variables set
[ ] Database migrations run
[ ] RLS policies active
```

### Vercel Deployment

```bash
# Install Vercel CLI
npm i -g vercel

# Deploy to preview
vercel

# Deploy to production
vercel --prod
```

### Environment Variables (Production)

Set in Vercel dashboard:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_GOOGLE_CLIENT_ID`

⚠️ **NEVER** expose `SUPABASE_SERVICE_KEY` in frontend!

---

## 🔧 Troubleshooting

### Common Issues

#### 1. "useBusiness must be used within a BusinessProvider"

**Cause:** Component outside provider hierarchy

**Fix:**
```jsx
// Make sure App.jsx has this order:
<BusinessProvider>
  <AuthProvider>
    <YourComponent />
  </AuthProvider>
</BusinessProvider>
```

#### 2. "Permission denied for table X"

**Cause:** Missing RLS policies

**Fix:**
```bash
# Run in Supabase SQL Editor:
cat supabase/FIX_ALL_ERRORS.sql
```

#### 3. "invalid input syntax for type uuid"

**Cause:** Passing slug instead of UUID

**Fix:**
```javascript
// ❌ Wrong
deleteItem(item.slug)

// ✅ Correct
deleteItem(item.id) // UUID
```

#### 4. Toast messages in wrong language

**Cause:** Not using language context

**Fix:**
```jsx
import { useLanguage } from '@/contexts/LanguageContext';

const { language } = useLanguage();

toast({
  title: language === 'es' ? 'Éxito' : 'Success'
});
```

#### 5. Images not loading

**Cause:** Wrong path or missing optimization

**Fix:**
```jsx
// Check image is in public folder
// Use imageUtils for optimization
import { validateAndProcessImage } from '@/lib/imageUtils';

const result = await validateAndProcessImage(file, 'product');
```

---

## 📞 Support & Resources

### Documentation
- [Supabase Docs](https://supabase.com/docs)
- [React Docs](https://react.dev)
- [TailwindCSS Docs](https://tailwindcss.com/docs)
- [Framer Motion Docs](https://www.framer.com/motion/)

### Internal Docs
- `PROJECT_STANDARDS.md` - Code standards
- `TESTING_MEMORY.md` - Testing guide
- `SEO_OPTIMIZATION.md` - SEO guide
- `COMPLETE_FIX_SUMMARY.md` - Recent fixes

### Getting Help

1. Check documentation first
2. Search existing issues
3. Create detailed bug report
4. Include:
   - Steps to reproduce
   - Expected behavior
   - Actual behavior
   - Screenshots/videos
   - Console errors

---

## 📊 Project Metrics

### Performance Goals
- Page Load: < 2 seconds
- Time to Interactive: < 3 seconds
- First Contentful Paint: < 1.5 seconds
- Largest Contentful Paint: < 2.5 seconds

### Code Quality Goals
- Test Coverage: > 80%
- Lighthouse Score: > 90
- Accessibility: WCAG AA compliant
- SEO Score: > 90

### User Experience Goals
- Mobile responsive: 100%
- Bilingual support: 100%
- Error handling: 100% of operations
- Loading states: 100% of async operations

---

## 🎯 Roadmap

### Completed ✅
- Authentication system
- Product management
- Category management
- Combo management
- Order system
- Admin dashboard
- Bilingual support
- RLS security
- Error handling
- Image optimization

### In Progress 🚧
- SEO optimization
- Analytics integration
- Performance optimization
- Automated testing

### Planned 📅
- Payment integration
- Shipping calculator
- Email notifications
- Mobile app (React Native)
- Multi-vendor support
- Advanced analytics
- Customer reviews
- Wishlist feature
- Social media integration

---

## 🤝 Contributing

### Guidelines

1. **Fork the repository**
2. **Create feature branch**
3. **Follow project standards**
4. **Write tests**
5. **Update documentation**
6. **Submit pull request**

### Pull Request Template

```markdown
## Description
Brief description of changes

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Documentation update

## Checklist
- [ ] Code follows project standards
- [ ] All tests pass
- [ ] Bilingual support added
- [ ] Documentation updated
- [ ] No console errors/warnings
- [ ] Mobile responsive
- [ ] Accessible (a11y)

## Testing
- Tested in ES: ✅
- Tested in EN: ✅
- Tested on mobile: ✅
- Tested on desktop: ✅

## Screenshots
[Add screenshots if applicable]
```

---

## 📄 License

This project is proprietary and confidential.

---

## 👥 Team

- **Developer:** [Your Name]
- **Designer:** [Designer Name]
- **Project Manager:** [PM Name]

---

## 📝 Version History

### v1.0.0 (2025-10-01)
- Initial release
- Complete CRUD for products, categories, combos
- Bilingual support (ES/EN)
- Admin dashboard
- Authentication with Google OAuth
- Order management
- Inventory tracking

---

**Last Updated:** 2025-10-01
**Status:** ✅ Production Ready
**Next Release:** v1.1.0 (Planned)

---

**Remember:**
- Test in both languages
- Use UUID for database operations
- Handle all errors gracefully
- Keep code clean and documented
- Follow project standards
- Think about the user experience

🚀 **Happy Coding!**
