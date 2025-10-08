# Testing & Memory - Papuenvios Project

## 🧠 Project Memory (Current State)

### Last Working Session: 2025-10-01

#### ✅ What Was Fixed Today

1. **Category CRUD Complete Overhaul**
   - Issue: Edit created duplicates instead of updating
   - Issue: Delete failed with UUID error (22P02)
   - Issue: Button always said "Nueva Categoría" when editing
   - Fix: Separated UUID (database) from slug (display)
   - Fix: Added bilingual support throughout
   - Fix: Added description fields (ES/EN)
   - Fix: Auto-generate slug from name
   - Status: ✅ WORKING

2. **BusinessContext Provider Error**
   - Issue: "useBusiness must be used within a BusinessProvider"
   - Issue: React Helmet deprecated lifecycle warnings
   - Fix: Replaced react-helmet with react-helmet-async
   - Fix: Fixed context validation (undefined vs null)
   - Fix: Added ErrorBoundary component
   - Fix: Added error state tracking
   - Status: ✅ WORKING

3. **Database Schema & RLS**
   - Added: slug column to product_categories
   - Fixed: RLS policies for all public tables
   - Fixed: Admin CRUD permissions
   - Fixed: Order access policies
   - Status: ✅ CONFIGURED

#### 🎯 Current Architecture Understanding

**Data Flow:**
```
User Action
  ↓
Component (VendorPage.jsx)
  ↓
Service Layer (productService.js)
  ↓
Supabase Client
  ↓
PostgreSQL + RLS
  ↓
Response
  ↓
Context Update (BusinessContext)
  ↓
UI Re-render
```

**Context Hierarchy:**
```
ErrorBoundary
  ↓
HelmetProvider
  ↓
LanguageProvider
  ↓
BusinessProvider
  ↓
AuthProvider
    ↓
  App Components
```

**ID Management:**
- UUID: Used for ALL database operations (CRUD)
- Slug: Used for display, URLs, human-readable IDs
- Never mix them!

#### 🔑 Key Decisions Made

1. **UUID Primary, Slug Secondary**
   - Database ID = UUID (immutable, secure)
   - Display ID = Slug (readable, SEO-friendly)
   - Transform in BusinessContext to provide both

2. **Bilingual Everything**
   - All user text must be in ES/EN
   - Use language context, not hardcoded strings
   - Toast messages, labels, buttons, errors - all bilingual

3. **Auto-Generate Where Possible**
   - Slugs auto-generated from Spanish name
   - SKUs auto-generated with timestamp
   - Display order defaults to 0

4. **Soft Deletes Always**
   - Never hard delete (data integrity)
   - Use is_active = false
   - Allows recovery, maintains relationships

---

## 🧪 Test-Driven Development (TDD) Checklist

### For Every New Feature

#### 1. **Pre-Development (Think First)**
```markdown
[ ] What is the feature?
[ ] Who will use it?
[ ] What data does it need?
[ ] What can go wrong?
[ ] How to handle errors?
[ ] Is it bilingual?
[ ] Is it secure?
[ ] Is it performant?
```

#### 2. **Write Tests (Before Code)**
```markdown
[ ] Happy path test
[ ] Error scenario test
[ ] Edge case tests
[ ] Bilingual text test
[ ] Security test
[ ] Performance test
```

#### 3. **Implement Feature**
```markdown
[ ] Database schema (if needed)
[ ] RLS policies
[ ] Service layer function
[ ] Component UI
[ ] Bilingual support
[ ] Error handling
[ ] Loading states
[ ] Empty states
```

#### 4. **Manual Testing**
```markdown
[ ] Test in Spanish
[ ] Test in English
[ ] Test on mobile
[ ] Test on desktop
[ ] Test with slow network
[ ] Test with no network
[ ] Test with invalid data
[ ] Test with valid data
```

#### 5. **Code Review**
```markdown
[ ] Follows project standards
[ ] No console errors
[ ] No console warnings
[ ] Properly commented
[ ] No security issues
[ ] Accessible (a11y)
[ ] SEO friendly
```

---

## 📋 Feature Testing Templates

### CRUD Operation Test

```markdown
## Feature: [Entity] CRUD

### CREATE Test
1. Navigate to [page]
2. Click "New [Entity]" button
3. Fill form with valid data:
   - Name ES: [value]
   - Name EN: [value]
   - Description ES: [value]
   - Description EN: [value]
4. Click "Create" button
5. **Expected:**
   - Success toast in current language
   - Form clears
   - New item appears in list
   - Database has UUID + slug

### READ Test
1. Navigate to [page]
2. **Expected:**
   - All active items shown
   - Names displayed in current language
   - Descriptions shown (if any)
   - Loading state while fetching
   - Empty state if no items

### UPDATE Test
1. Navigate to [page]
2. Click edit button on item
3. Form populates with existing data
4. Button text changes to "Update"
5. Cancel button appears
6. Modify fields
7. Click "Update"
8. **Expected:**
   - Success toast in current language
   - Item updates (not duplicates!)
   - Form clears/resets
   - Changes visible in list

### DELETE Test
1. Navigate to [page]
2. Click delete button on item
3. **Expected:**
   - Confirmation dialog in current language
   - On confirm: success toast
   - Item removed from list
   - Database: is_active = false (not deleted!)
   - Item still in DB with UUID

### BILINGUAL Test
1. Switch to Spanish
2. All text in Spanish
3. Perform CRUD operations
4. All toasts in Spanish
5. Switch to English
6. All text in English
7. Perform CRUD operations
8. All toasts in English

### ERROR Test
1. Try to create without required fields
   - **Expected:** Validation error in current language
2. Try to create with duplicate slug
   - **Expected:** Database error handled gracefully
3. Disconnect network, try to create
   - **Expected:** Network error shown
4. Try to delete item used elsewhere
   - **Expected:** Constraint error handled

### EDGE CASES
1. Create with very long name (>255 chars)
2. Create with special characters (!@#$%^&*)
3. Create with emoji 😀
4. Create with accented characters (á é í ó ú ñ)
5. Rapid creation (click save multiple times)
6. Edit immediately after create
7. Delete while another user is editing
```

---

## 🔍 Regression Testing Checklist

Run this after ANY change:

### Core Features
```markdown
[ ] Login with Google OAuth
[ ] Login with email/password
[ ] Logout
[ ] Language switching (ES ↔ EN)
[ ] Navigate between pages
[ ] Protected routes (admin pages)
[ ] Public routes (home, products)
```

### Category Management
```markdown
[ ] View categories
[ ] Create category
[ ] Edit category
[ ] Delete category
[ ] Category appears in product form
[ ] Slug auto-generates correctly
[ ] Both languages work
```

### Product Management
```markdown
[ ] View products
[ ] Create product
[ ] Edit product
[ ] Delete product (soft delete)
[ ] Select category
[ ] Upload image
[ ] Set pricing
[ ] Both languages work
```

### Combo Management
```markdown
[ ] View combos
[ ] Create combo
[ ] Edit combo
[ ] Delete combo
[ ] Add products to combo
[ ] Remove products from combo
[ ] Both languages work
```

### User Management (Admin)
```markdown
[ ] View users
[ ] Change user role
[ ] Enable/disable user
[ ] View user profile
[ ] Both languages work
```

### Settings (Admin)
```markdown
[ ] Update financial settings
[ ] Update notification settings
[ ] Update visual settings
[ ] Manage carousel slides
[ ] Both languages work
```

---

## 🐛 Known Issues & Workarounds

### Current Issues
```markdown
None! 🎉 All major issues resolved.
```

### Resolved Issues (For Memory)
```markdown
✅ Category edit creating duplicates
   - Was: Using slug instead of UUID
   - Fixed: Use UUID for all CRUD operations

✅ Category delete UUID error
   - Was: Passing slug to delete function
   - Fixed: Pass UUID from category.id

✅ Context provider error
   - Was: react-helmet deprecated lifecycle
   - Fixed: Replaced with react-helmet-async

✅ Missing bilingual support
   - Was: Hardcoded Spanish strings
   - Fixed: Language context throughout

✅ No description fields
   - Was: Only name fields existed
   - Fixed: Added description_es/en everywhere

✅ Manual slug entry
   - Was: User had to type slug
   - Fixed: Auto-generate from Spanish name
```

---

## 📊 Performance Benchmarks

Track these metrics:

```markdown
### Page Load Times (Target: < 2s)
- Home: ___ ms
- Products: ___ ms
- Admin Dashboard: ___ ms
- Categories Management: ___ ms

### Database Queries (Target: < 100ms)
- Get all products: ___ ms
- Get all categories: ___ ms
- Get all combos: ___ ms
- Create category: ___ ms
- Update category: ___ ms
- Delete category: ___ ms

### Bundle Size (Target: < 500KB)
- Main bundle: ___ KB
- Vendor bundle: ___ KB
- Total: ___ KB

### Lighthouse Scores (Target: > 90)
- Performance: ___ / 100
- Accessibility: ___ / 100
- Best Practices: ___ / 100
- SEO: ___ / 100
```

---

## 🎯 Test Scenarios by User Role

### Anonymous User
```markdown
[ ] Can view home page
[ ] Can view products
[ ] Can add to cart
[ ] Cannot access admin pages
[ ] Cannot create/edit/delete
[ ] Can switch language
[ ] Can see testimonials
[ ] Can see carousel
```

### Regular User (Authenticated)
```markdown
[ ] Can do everything anonymous can
[ ] Can view own profile
[ ] Can view own orders
[ ] Can create testimonial
[ ] Cannot access admin pages
[ ] Cannot manage products
[ ] Cannot manage users
```

### Admin User
```markdown
[ ] Can do everything regular user can
[ ] Can access admin dashboard
[ ] Can manage products
[ ] Can manage categories
[ ] Can manage combos
[ ] Can manage carousel
[ ] Can view all orders
[ ] Can update order status
[ ] Cannot manage super admin settings
```

### Super Admin
```markdown
[ ] Can do everything admin can
[ ] Can manage users
[ ] Can change user roles
[ ] Can access all settings
[ ] Can manage system config
[ ] Can view analytics
```

---

## 🔐 Security Testing Checklist

```markdown
### SQL Injection
[ ] Try SQL in text fields: `'; DROP TABLE users--`
[ ] Try in search: `' OR '1'='1`
[ ] Expected: Input sanitized, no DB impact

### XSS (Cross-Site Scripting)
[ ] Try script in text: `<script>alert('XSS')</script>`
[ ] Try in URL params: `?name=<img src=x onerror=alert(1)>`
[ ] Expected: HTML escaped, script not executed

### Authentication Bypass
[ ] Try accessing /admin without login
[ ] Try accessing /dashboard as regular user
[ ] Try changing role via browser console
[ ] Expected: Redirected or access denied

### CSRF (Cross-Site Request Forgery)
[ ] Try form submission from external site
[ ] Expected: Request rejected

### Data Exposure
[ ] Check browser console for sensitive data
[ ] Check network tab for exposed tokens
[ ] Check localStorage for passwords
[ ] Expected: No sensitive data exposed
```

---

## 📱 Mobile Testing Checklist

```markdown
### Devices to Test
[ ] iPhone (Safari)
[ ] Android (Chrome)
[ ] iPad (Safari)
[ ] Android Tablet (Chrome)

### Interactions
[ ] Touch targets min 44x44px
[ ] No hover-only features
[ ] Swipe gestures work
[ ] Forms keyboard friendly
[ ] No horizontal scroll
[ ] Zoom works properly

### Layout
[ ] All content visible
[ ] No overlapping elements
[ ] Text readable (min 16px)
[ ] Buttons accessible
[ ] Images responsive
```

---

## ♿ Accessibility Testing Checklist

```markdown
### Keyboard Navigation
[ ] Can tab through all interactive elements
[ ] Can activate buttons with Enter/Space
[ ] Can close modals with Escape
[ ] Focus visible on all elements
[ ] Tab order logical

### Screen Reader
[ ] All images have alt text
[ ] Form inputs have labels
[ ] Buttons have descriptive text/aria-label
[ ] Error messages announced
[ ] Success messages announced

### Color & Contrast
[ ] Text contrast ratio ≥ 4.5:1
[ ] Link text distinguishable
[ ] Error states not color-only
[ ] Focus indicators visible

### ARIA
[ ] Proper heading hierarchy (h1 → h2 → h3)
[ ] Landmark regions (nav, main, footer)
[ ] Live regions for dynamic content
[ ] ARIA labels on icon-only buttons
```

---

## 📝 Test Results Log

Keep track of testing:

```markdown
### [Date] - [Feature] - [Tester Name]

#### Tests Passed ✅
- [Test name]: PASS
- [Test name]: PASS

#### Tests Failed ❌
- [Test name]: FAIL
  - Issue: [Description]
  - Steps to reproduce: [Steps]
  - Expected: [Expected behavior]
  - Actual: [Actual behavior]

#### Bugs Found 🐛
- [Bug description]
  - Severity: Critical/High/Medium/Low
  - Steps to reproduce: [Steps]
  - Screenshot/Video: [Link]

#### Notes 📌
- [Any observations]
- [Suggestions]
- [Questions]
```

---

## 🎓 Testing Best Practices

1. **Test in Both Languages**
   - Always switch language and re-test
   - Verify all text changes

2. **Test Real User Flows**
   - Don't just test individual features
   - Test complete user journeys

3. **Test Error Scenarios**
   - Network failures
   - Invalid input
   - Permissions issues

4. **Test Edge Cases**
   - Empty data
   - Very long strings
   - Special characters
   - Concurrent operations

5. **Test Performance**
   - With slow network
   - With large datasets
   - Repeated operations

6. **Document Everything**
   - What you tested
   - What passed
   - What failed
   - How to reproduce issues

---

**Remember:**
- Testing is not optional
- Manual testing catches what automated tests miss
- Every bug found in testing is one less in production
- Good testing = confident deployment

---

**Last Updated:** 2025-10-01
**Testing Coverage Goal:** 90%+
**Current Status:** Major features tested ✅
