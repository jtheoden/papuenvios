# 🔧 PROYECTO RESTORATION PLAN

**Date:** October 27, 2025
**Status:** Waiting for Confirmation
**Priority:** CRITICAL - Blocks remittance workflow

---

## 📊 DIAGNOSTIC SUMMARY

### ✅ Components That Exist (Verified)
- `RecipientSelector.jsx` - Smart recipient selector
- `RecipientForm.jsx` - Recipient form
- `ProvinceSelector.jsx` - Province/municipality selector
- `AdminRemittancesTab.jsx` - Admin remittance view
- `MyRemittancesPage.jsx` - User remittance view
- `SendRemittancePage.jsx` - Remittance creation wizard

### ❌ Components That Are Missing (Verified)
- `FileUploadWithPreview.jsx` - **CRITICAL** - Needed in Step 4 of SendRemittancePage
- `ZelleAccountSelector.jsx` - **CRITICAL** - Needed to show payment account
- `MyRecipientsPage.jsx` - **CRITICAL** - Recipient management page

### ⚠️ Issues in Existing Code
- `UserPanel.jsx` - No navigation link to "Mis Remesas"
- `UserPanel.jsx` - No navigation link to "Mis Recipientes"
- `App.jsx` - No route for MyRecipientsPage (case statement missing)
- `SendRemittancePage.jsx` Step 4 - Basic file input, no preview

---

## 🎯 RESTORATION PLAN

### PHASE 1: Restore Missing Components (Safe Recovery from Git)

#### 1.1 FileUploadWithPreview.jsx
**Location:** `/src/components/FileUploadWithPreview.jsx`
**Action:** Search git history for implementation
**Why:** User needs to see file preview before uploading payment proof
**Risk:** LOW - New component, no existing dependencies
**Files to Check After:**
- SendRemittancePage.jsx (will import it)
- CartPage.jsx (might use it)

**Criteria for Completion:**
- [ ] File restored from git history
- [ ] Imports are correct
- [ ] npm run build succeeds
- [ ] Component renders without errors
- [ ] Preview functionality works

#### 1.2 ZelleAccountSelector.jsx / ZellePaymentInfo.jsx
**Location:** `/src/components/ZellePaymentInfo.jsx` (or similar name)
**Action:** Search git history for implementation
**Why:** User must know which Zelle account to transfer money to
**Risk:** MEDIUM - May depend on zelleService.js
**Files to Check:**
- zelleService.js (verify functions exist)
- remittanceService.js (verify it returns zelle_account data)

**Criteria for Completion:**
- [ ] Component found/created
- [ ] Shows available Zelle account
- [ ] Displays payment instructions
- [ ] npm run build succeeds
- [ ] Integration with SendRemittancePage works

#### 1.3 MyRecipientsPage.jsx
**Location:** `/src/components/MyRecipientsPage.jsx`
**Action:** Create new component based on patterns in project
**Why:** User needs page to manage their recipients
**Risk:** MEDIUM - New component but straightforward
**Components It Will Use:**
- RecipientSelector.jsx (already exists)
- RecipientForm.jsx (already exists)
- recipientService.js (already exists)

**Criteria for Completion:**
- [ ] Component created
- [ ] Lists user's recipients
- [ ] Can create new recipient
- [ ] Can edit recipient
- [ ] Can delete recipient
- [ ] npm run build succeeds

---

### PHASE 2: Update Existing Components (With Verification)

#### 2.1 Update SendRemittancePage.jsx
**Changes:**
- Import FileUploadWithPreview
- Import ZellePaymentInfo
- Replace basic file input with FileUploadWithPreview in Step 4
- Add ZellePaymentInfo display in Step 4

**Risk Assessment:**
- Risk Level: MEDIUM
- Dependent Files: None directly break
- Test Needed: Full remittance workflow

**Before Proceeding:**
- [ ] Verify FileUploadWithPreview component works
- [ ] Verify ZellePaymentInfo component works
- [ ] Confirm what Step 4 should display

#### 2.2 Update UserPanel.jsx
**Changes:**
- Add "Mis Remesas" button → navigate to 'my-remittances'
- Add "Mis Recipientes" button → navigate to 'my-recipients'

**Risk Assessment:**
- Risk Level: LOW
- Dependent Files: App.jsx needs 'my-recipients' route
- Test Needed: Navigation works

**Before Proceeding:**
- [ ] Confirm button placement in UI
- [ ] Verify App.jsx can handle 'my-recipients' route

#### 2.3 Update App.jsx
**Changes:**
- Add import: `import MyRecipientsPage from '@/components/MyRecipientsPage'`
- Add protected route: `const ProtectedMyRecipients = withProtectedRoute(MyRecipientsPage, 'user')`
- Add case statement: `case 'my-recipients': return <ProtectedMyRecipients onNavigate={handleNavigate} />`

**Risk Assessment:**
- Risk Level: LOW
- Dependent Files: UserPanel.jsx references this
- Test Needed: Route works, navigation works

**Before Proceeding:**
- [ ] Confirm this is the correct pattern for protected routes
- [ ] Verify no other routes use 'my-recipients'

---

## 📋 DEPENDENCY VERIFICATION

### Before Any Changes

**Files That Will Be Modified:**
1. `SendRemittancePage.jsx` - Check all imports
2. `UserPanel.jsx` - Check navigation references
3. `App.jsx` - Check route handlers

**Files That Will Be Created:**
1. `FileUploadWithPreview.jsx`
2. `ZellePaymentInfo.jsx` (or similar)
3. `MyRecipientsPage.jsx`

**Verification Checklist:**
- [ ] grep for all existing imports of FileUploadWithPreview → Should be 0
- [ ] grep for all existing imports of ZellePaymentInfo → Should be 0
- [ ] grep for all existing imports of MyRecipientsPage → Should be 0
- [ ] grep for 'my-recipients' route → Should be 0 (except our addition)
- [ ] grep for recipients management → Find existing pattern
- [ ] Verify zelleService.js has getAvailableZelleAccount() function
- [ ] Verify remittanceService.js returns zelle_account data

---

## 🧪 TESTING PLAN

### After Phase 1 (Component Restoration)
1. Build project → Must succeed
2. No TypeScript errors
3. No import errors
4. Visual inspection of restored components

### After Phase 2 (Integration)
1. SendRemittancePage Step 4 → FileUploadWithPreview renders
2. SendRemittancePage Step 4 → ZellePaymentInfo shows account
3. UserPanel → "Mis Remesas" link appears and works
4. UserPanel → "Mis Recipientes" link appears and works
5. MyRecipientsPage → Loads and displays recipients
6. MyRecipientsPage → Can create/edit recipients
7. Full remittance workflow → Works end-to-end

---

## ⚠️ RISKS & MITIGATION

### High Risk Items
1. **FileUploadWithPreview implementation** - May need iteration
   - Mitigation: Start with basic preview, iterate if needed
   - Fallback: Use simple input if component can't be recovered

2. **Zelle account display** - Depends on service layer
   - Mitigation: Verify zelleService first
   - Fallback: Create simple display component if recovered version broken

### Medium Risk Items
1. **Integration with SendRemittancePage** - May require prop adjustments
   - Mitigation: Test incrementally
   - Fallback: Keep original implementation if integration fails

2. **MyRecipientsPage routing** - May conflict with existing patterns
   - Mitigation: Follow existing protected route pattern
   - Fallback: Use different route name if needed

### Low Risk Items
1. **UserPanel navigation changes** - Simple button additions
   - Mitigation: Test links work
   - Fallback: Easy to revert

---

## 🚦 EXECUTION SEQUENCE

```
STEP 1: Search Git History
├─ Look for FileUploadWithPreview
├─ Look for ZelleAccountSelector or ZellePaymentInfo
├─ Look for MyRecipientsPage (or pattern to create it)
└─ Document what's available

STEP 2: Get Confirmation
├─ Present findings to user
├─ Ask for approval to proceed
├─ Clarify any questions
└─ Wait for GO signal

STEP 3: Restore Components (One at a Time)
├─ Restore FileUploadWithPreview
│  ├─ Verify build succeeds
│  └─ Commit with clear message
├─ Restore/Create ZellePaymentInfo
│  ├─ Verify build succeeds
│  └─ Commit with clear message
└─ Create MyRecipientsPage
   ├─ Verify build succeeds
   └─ Commit with clear message

STEP 4: Update Integration Points
├─ Update SendRemittancePage.jsx
│  ├─ Add imports
│  ├─ Modify Step 4 JSX
│  ├─ Verify build succeeds
│  └─ Commit
├─ Update UserPanel.jsx
│  ├─ Add navigation buttons
│  ├─ Verify build succeeds
│  └─ Commit
└─ Update App.jsx
   ├─ Add route
   ├─ Add protected wrapper
   ├─ Verify build succeeds
   └─ Commit

STEP 5: Full Testing
├─ Test each component individually
├─ Test integration
├─ Test full remittance workflow
└─ Document results in status file

STEP 6: Finalize
├─ Verify project state in status file
├─ Commit any final changes
└─ Ready for production
```

---

## 📌 CURRENT STATUS

- ✅ Analysis complete
- ⏳ Awaiting user confirmation to proceed
- ❌ Components not yet restored
- ❌ Integration not yet updated

---

## 🎯 SUCCESS CRITERIA

After restoration, the project should:

```
✅ BUILD
├─ npm run build succeeds
├─ No TypeScript errors
└─ No console errors

✅ COMPONENTS
├─ FileUploadWithPreview works
├─ ZellePaymentInfo displays correctly
└─ MyRecipientsPage renders

✅ NAVIGATION
├─ UserPanel has "Mis Remesas" link
├─ UserPanel has "Mis Recipientes" link
└─ Both links navigate correctly

✅ WORKFLOW
├─ SendRemittancePage Step 4 shows file preview
├─ SendRemittancePage Step 4 shows Zelle account
├─ User can manage recipients
└─ Full remittance flow works

✅ DOCUMENTATION
├─ Status file updated
├─ All changes documented in commits
└─ No temporary code left behind
```

---

## ❓ QUESTIONS FOR USER

Before proceeding with restoration:

1. **FileUploadWithPreview** - Should it show:
   - [ ] Image thumbnail preview inline?
   - [ ] File name and size?
   - [ ] Upload progress indicator?
   - [ ] Error messages for unsupported files?

2. **ZellePaymentInfo** - What information should it display:
   - [ ] Zelle email/phone?
   - [ ] Account holder name?
   - [ ] Amount to transfer?
   - [ ] Copy-to-clipboard button?
   - [ ] Instructions in Spanish/English?

3. **MyRecipientsPage** - Should users be able to:
   - [ ] See all their recipients in a list?
   - [ ] Create new recipients?
   - [ ] Edit existing recipients?
   - [ ] Delete recipients?
   - [ ] Mark recipients as favorites?
   - [ ] Set default recipient for quick selection?

4. **Navigation** - In UserPanel, where should the new buttons go:
   - [ ] In the stats section?
   - [ ] In the menu section?
   - [ ] As new cards below existing cards?

---

## ✋ READY FOR CONFIRMATION

This plan is ready for execution pending your approval.

Please confirm:
- [ ] I should proceed with component restoration
- [ ] I should follow the sequence outlined above
- [ ] I should stop and ask before each major step
- [ ] I understand the risks and mitigation strategies

**Action Required:** User confirmation to proceed
