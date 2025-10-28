# Bank Accounts System Implementation Guide

**Document Version:** 1.0
**Created:** 2025-01-28
**Status:** Foundation Phase Complete - UI Implementation Pending

## Table of Contents

1. [Overview](#overview)
2. [Database Schema](#database-schema)
3. [Service Layer Architecture](#service-layer-architecture)
4. [TypeScript Interfaces](#typescript-interfaces)
5. [Security Considerations](#security-considerations)
6. [Implementation Phases](#implementation-phases)
7. [Future UI Integration Points](#future-ui-integration-points)
8. [Testing Strategy](#testing-strategy)
9. [Troubleshooting](#troubleshooting)

---

## Overview

### Purpose

The Bank Accounts System provides a normalized, enterprise-grade infrastructure for managing user bank accounts and processing bank transfers for remittances. It supports multiple delivery methods (cash, bank transfer, card, moneypocket) with proper security controls, audit trails, and soft-delete capabilities.

### Key Features

- **Multi-Account Support:** Users can link multiple bank accounts with different banks and currencies
- **Recipient-Specific Accounts:** Recipients can be linked to specific user bank accounts for transfers
- **Secure Storage:** Account numbers stored as SHA256 hashes with only last 4 digits displayed
- **Audit Trail:** All transfers tracked with processed_by user IDs, timestamps, and status history
- **Soft Deletes:** Bank accounts can be soft-deleted with deleted_at timestamps for data preservation
- **Row-Level Security:** Supabase RLS policies enforce data access controls by user role
- **Status Tracking:** Bank transfers tracked through complete lifecycle (pending → confirmed → transferred → failed/reversed)

### Architecture Diagram

```
User (auth.users)
  ├── BankAccount (bank_accounts)
  │   ├── Bank (banks)
  │   ├── AccountType (account_types)
  │   └── Currency (currencies)
  └── RecipientBankAccount (recipient_bank_accounts)
      └── RemittanceBankTransfer (remittance_bank_transfers)
          └── Remittance (remittances)
```

---

## Database Schema

### Tables Overview

#### 1. `banks` (Master Data)

Stores financial institution information for reference and validation.

```sql
CREATE TABLE public.banks (
  id UUID PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  swift_code VARCHAR(11),
  local_code VARCHAR(50),
  country_code VARCHAR(3),
  metadata JSONB,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
);
```

**Key Columns:**
- `name`: Institution name (e.g., "Banco de Crédito e Inversiones")
- `swift_code`: SWIFT/BIC code for international transfers
- `local_code`: Country-specific bank code
- `country_code`: ISO 3166-1 alpha-3 country code
- `metadata`: Additional JSON data (routing info, API endpoints, etc.)

**Indices:**
- Primary key on `id`
- Unique on `(swift_code, country_code)`

---

#### 2. `account_types` (Master Data)

Stores supported bank account classifications.

```sql
CREATE TABLE public.account_types (
  id UUID PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE,
  description TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
);
```

**Seeded Values:**
- `checking` - Current/checking account
- `savings` - Savings account
- `moneypocket` - Digital wallet (e.g., MercadoPago, PayPal)
- `debit_card` - Debit card account

---

#### 3. `bank_accounts` (User Data)

Stores individual user bank account credentials securely.

```sql
CREATE TABLE public.bank_accounts (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  bank_id UUID NOT NULL REFERENCES public.banks(id),
  account_type_id UUID NOT NULL REFERENCES public.account_types(id),
  currency_id UUID NOT NULL REFERENCES public.currencies(id),
  account_number_last4 VARCHAR(4) NOT NULL,
  account_number_hash VARCHAR(64) NOT NULL UNIQUE,
  account_holder_name VARCHAR(200) NOT NULL,
  is_active BOOLEAN DEFAULT true,
  deleted_at TIMESTAMPTZ,
  deleted_by_user_id UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
);
```

**Critical Security Aspects:**
- Account numbers are **NEVER** stored in plain text
- Use SHA256 hash: `crypto.createHash('sha256').update(accountNumber + userId).digest('hex')`
- Only `account_number_last4` is displayed for verification (e.g., "****1234")
- Hash includes user ID to prevent reverse lookup attacks across accounts
- `deleted_at` supports soft-delete pattern for audit trail preservation

**Indices:**
- Primary key on `id`
- Unique on `(user_id, bank_id, account_number_hash)`
- Index on `(user_id, is_active)` for fast user account lookups
- Index on `(bank_id)` for bank statistics

---

#### 4. `recipient_bank_accounts` (Link Table)

Maps recipients to available bank accounts for transfers (many-to-many relationship).

```sql
CREATE TABLE public.recipient_bank_accounts (
  id UUID PRIMARY KEY,
  recipient_id UUID NOT NULL REFERENCES public.recipients(id),
  bank_account_id UUID NOT NULL REFERENCES public.bank_accounts(id),
  is_default BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
);
```

**Purpose:**
- Allows a single recipient to receive transfers via multiple accounts
- Supports `is_default` flag to pre-select preferred account
- Only one default per recipient (enforced in application logic)

**Constraints:**
- Unique composite key on `(recipient_id, bank_account_id)`
- When setting new default, previous default must be unset

**Indices:**
- Primary key on `id`
- Unique on `(recipient_id, bank_account_id)`
- Index on `(recipient_id, is_active)` for fast recipient lookups
- Index on `(bank_account_id)` for account usage tracking

---

#### 5. `remittance_bank_transfers` (Transaction Record)

Tracks the status and details of bank transfers associated with remittances.

```sql
CREATE TABLE public.remittance_bank_transfers (
  id UUID PRIMARY KEY,
  remittance_id UUID NOT NULL REFERENCES public.remittances(id),
  recipient_bank_account_id UUID NOT NULL REFERENCES public.recipient_bank_accounts(id),
  status VARCHAR(20) DEFAULT 'pending',
  processed_by_user_id UUID REFERENCES auth.users(id),
  processed_at TIMESTAMPTZ,
  amount_transferred NUMERIC(12, 2),
  error_message TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
);
```

**Status Lifecycle:**
- `pending`: Initial state, awaiting admin confirmation
- `confirmed`: Admin confirmed transfer will be processed
- `transferred`: Payment processor confirmed successful transfer
- `failed`: Transfer failed (see `error_message`)
- `reversed`: Transfer was initiated but then reversed (refund)

**Audit Trail:**
- `processed_by_user_id`: Admin who processed the transfer
- `processed_at`: Timestamp when transfer was confirmed/processed (auto-set on status change to confirmed/transferred)

**Indices:**
- Primary key on `id`
- Unique on `remittance_id` (one transfer per remittance)
- Index on `(remittance_id)` for remittance lookup
- Index on `(recipient_bank_account_id)` for recipient tracking
- Index on `(status)` for admin dashboard filtering
- Index on `(processed_at)` for date range queries
- Composite index on `(status, created_at)` for pending transfer reports

---

## Service Layer Architecture

### Layer Organization

```
Controllers/Components
       ↓
Service Layer (recipientService, remittanceService, bankService)
       ↓
Supabase Client (Data Access)
       ↓
PostgreSQL Database
```

### Service Files

#### 1. `/src/lib/bankService.js`

**Purpose:** Master data operations for banks and account types.

**Exported Functions:**

```javascript
// Fetch all banks sorted by name
export const getAllBanks = async () => {
  // Returns: { success: true, data: Bank[] }
  // Returns: { success: false, error: string }
}

// Fetch all account types sorted by name
export const getAllAccountTypes = async () => {
  // Returns: { success: true, data: AccountType[] }
  // Returns: { success: false, error: string }
}

// Create new bank (admin only - no RLS enforcement in function)
export const createBank = async (bankData) => {
  // bankData: { name, swiftCode, localCode, countryCode }
  // Returns: { success: true, data: Bank }
  // Returns: { success: false, error: string }
}

// Fetch specific bank with full details
export const getBankById = async (bankId) => {
  // Returns: { success: true, data: Bank }
  // Returns: { success: false, error: string }
}

// Search banks by name or code with ILIKE (case-insensitive)
export const searchBanks = async (query) => {
  // query: string, minimum 2 characters
  // Returns: { success: true, data: Bank[] (max 10 results) }
  // Returns: { success: true, data: [] } if query too short
}
```

**Usage Example:**
```javascript
// In a BankSelector component
const { data: banks } = await getAllBanks();
setBankOptions(banks.map(b => ({ label: b.name, value: b.id })));
```

---

#### 2. `/src/lib/recipientService.js`

**Purpose:** User bank account management and recipient-account linking.

**New Functions Added:**

```javascript
// Create new bank account with SHA256 hashing
export const createBankAccount = async (userId, bankData) => {
  // bankData: {
  //   bankId: UUID,
  //   accountTypeId: UUID,
  //   currencyId: UUID,
  //   accountNumber: string (will be hashed),
  //   accountHolderName: string
  // }
  // Returns: { success: true, data: BankAccount }
  // Returns: { success: false, error: string }

  // Security: Automatically hashes accountNumber with SHA256(accountNumber + userId)
  // Stores: account_number_last4 (last 4 digits only)
}

// Fetch user's bank accounts with optional filtering
export const getBankAccountsByUser = async (userId, activeOnly = true) => {
  // activeOnly: boolean - filter to active accounts only
  // Returns: { success: true, data: BankAccountDetail[] (with relations) }
  // Returns: { success: false, error: string }

  // Includes: bank, account_type, currency relations
  // Filters: user_id = userId, deleted_at IS NULL (soft delete filter)
}

// Update bank account details
export const updateBankAccount = async (accountId, updates) => {
  // updates: {
  //   accountHolderName?: string,
  //   is_active?: boolean
  // }
  // Returns: { success: true, data: BankAccount }
  // Returns: { success: false, error: string }

  // Note: Cannot update bank_id, account_number (create new account instead)
}

// Soft delete bank account with audit trail
export const deleteBankAccount = async (accountId, deletedByUserId) => {
  // deletedByUserId: UUID of user performing deletion
  // Returns: { success: true, data: BankAccount }
  // Returns: { success: false, error: string }

  // Sets: deleted_at = now(), deleted_by_user_id = deletedByUserId
  // Soft delete allows audit trail and recovery if needed
}

// Link bank account to recipient (create recipient_bank_accounts entry)
export const linkBankAccountToRecipient = async (recipientId, bankAccountId, isDefault = false) => {
  // isDefault: boolean - if true, unset previous default
  // Returns: { success: true, data: RecipientBankAccount }
  // Returns: { success: false, error: string }

  // Logic: If isDefault=true, sets is_default=false on previous default
  // Constraint: One default per recipient enforced in application
}

// Fetch all bank accounts linked to recipient
export const getBankAccountsForRecipient = async (recipientId) => {
  // Returns: { success: true, data: RecipientBankAccountWithDetails[] }
  // Returns: { success: false, error: string }

  // Includes: Nested bank_account with bank, account_type, currency
}
```

**Usage Flow:**
```javascript
// 1. User creates new bank account
const result = await createBankAccount(userId, {
  bankId: '12345',
  accountTypeId: '67890',
  currencyId: 'USD',
  accountNumber: '1234567890', // Will be hashed
  accountHolderName: 'John Doe'
});

// 2. Link account to specific recipient
const linkResult = await linkBankAccountToRecipient(
  recipientId,
  result.data.id,
  true // Set as default
);

// 3. Fetch recipient's accounts (for selection in remittance form)
const recipientAccounts = await getBankAccountsForRecipient(recipientId);
```

---

#### 3. `/src/lib/remittanceService.js`

**Purpose:** Bank transfer tracking and status management for remittances.

**New Functions Added:**

```javascript
// Create new bank transfer record
export const createBankTransfer = async (remittanceId, recipientBankAccountId, transferData = {}) => {
  // transferData: {
  //   amount_transferred?: number
  // }
  // Returns: { success: true, data: RemittanceBankTransfer }
  // Returns: { success: false, error: string }

  // Auto-set: status = 'pending', created_at = now()
}

// Update bank transfer status with audit trail
export const updateBankTransferStatus = async (transferId, status, additionalData = {}) => {
  // status: 'pending' | 'confirmed' | 'transferred' | 'failed' | 'reversed'
  // additionalData: {
  //   processed_by_user_id?: UUID,
  //   processed_at?: string (ISO 8601),
  //   amount_transferred?: number,
  //   error_message?: string
  // }
  // Returns: { success: true, data: RemittanceBankTransfer }
  // Returns: { success: false, error: string }

  // Auto-behavior:
  // - If status is 'confirmed' or 'transferred' and processed_at not provided: auto-set to now()
  // - Updates: updated_at = now()
}

// Fetch complete transfer history for remittance
export const getBankTransferHistory = async (remittanceId) => {
  // Returns: { success: true, data: RemittanceBankTransferDetail[] }
  // Returns: { success: false, error: string }

  // Includes: All nested relations (remittance, recipient_bank_account, processed_by_user)
  // Typically returns single record (unique constraint on remittance_id)
}

// Fetch pending transfers awaiting admin action
export const getPendingBankTransfers = async (filters = {}) => {
  // filters: {
  //   recipientId?: string,
  //   startDate?: string,
  //   endDate?: string,
  //   limit?: number (default 50),
  //   offset?: number (default 0)
  // }
  // Returns: { success: true, data: RemittanceBankTransferDetail[] }
  // Returns: { success: false, error: string }

  // Auto-filters: status = 'pending', orders by created_at DESC
}
```

**Usage Flow - Admin Processing:**
```javascript
// 1. Get all pending transfers
const { data: pending } = await getPendingBankTransfers();

// 2. Review transfer details
const transferDetail = pending[0]; // RemittanceBankTransferDetail
console.log(transferDetail.remittance.amount); // Transfer amount
console.log(transferDetail.recipient_bank_account.bank_account.account_number_last4); // Recipient account

// 3. Confirm transfer
const confirmed = await updateBankTransferStatus(transferId, 'confirmed', {
  processed_by_user_id: currentAdminId
  // processed_at will be auto-set to now()
});

// 4. After payment processor confirms
const transferred = await updateBankTransferStatus(transferId, 'transferred', {
  amount_transferred: 500.00
});

// 5. Or handle failure
const failed = await updateBankTransferStatus(transferId, 'failed', {
  error_message: 'Insufficient funds in account'
});
```

---

## TypeScript Interfaces

All TypeScript interfaces defined in `/src/types/banking.ts`:

### Master Data Types
- `Bank` - Financial institution
- `AccountType` - Account classification
- `Currency` - Currency reference

### User Data Types
- `BankAccount` - User bank account with security
- `RecipientBankAccount` - Recipient-account link
- `Recipient` - Recipient reference
- `Remittance` - Remittance reference
- `User` - User reference

### Transfer Types
- `RemittanceBankTransfer` - Transfer record with audit trail
- `RemittanceBankTransferDetail` - Transfer with all relations

### API Response Types
- `ApiResponse<T>` - Standard response wrapper
- `PaginatedResponse<T>` - Paginated results

### Request Types
- `CreateBankAccountRequest` - Account creation form
- `UpdateBankAccountRequest` - Account update form
- `CreateBankTransferRequest` - Transfer creation
- `UpdateBankTransferStatusRequest` - Status update

### Aggregate Types
- `BankAccountDetail` - Account with all relations
- `RecipientBankAccountWithDetails` - Recipient-account with details

---

## Security Considerations

### 1. Account Number Protection

**Problem:** Account numbers are sensitive credentials that enable unauthorized transactions.

**Solution:**
```javascript
// NEVER store plain account numbers
const accountNumberHash = crypto
  .createHash('sha256')
  .update(accountNumber + userId)
  .digest('hex');

// Store only:
// - account_number_hash (one-way encryption)
// - account_number_last4 (for verification only)
```

**Why User ID in Hash:**
- Prevents rainbow table attacks
- Different hash for same account number across users
- Enables per-user account lookup if needed

### 2. Row-Level Security (RLS)

**Implemented Policies:**
- Users can only view/manage their own bank accounts
- Only account owner can link accounts to recipients
- Only system admins can process bank transfers

```sql
-- Example RLS Policy (implemented in migration)
CREATE POLICY "Users can view own bank accounts"
  ON public.bank_accounts
  USING (auth.uid() = user_id);
```

### 3. Audit Trail

**Tracked Information:**
- Who created/deleted accounts (`user_id`, `deleted_by_user_id`)
- When transfers were processed (`processed_at`)
- Which admin processed transfer (`processed_by_user_id`)
- Complete status history via `status` field changes

### 4. Soft Delete Pattern

**Benefits:**
- Preserves data for audit and compliance
- Allows account recovery if needed
- Maintains foreign key integrity for historical transfers

**Implementation:**
```sql
-- Soft delete instead of hard delete
UPDATE bank_accounts
SET deleted_at = now(), deleted_by_user_id = current_user_id
WHERE id = account_id;

-- Queries filter soft-deleted records
SELECT * FROM bank_accounts
WHERE user_id = ? AND deleted_at IS NULL;
```

### 5. Status Transitions

**Valid Transitions:**
```
pending → confirmed → transferred ✓
pending → confirmed → failed ✓
pending → failed ✓ (direct)
transferred → reversed ✓ (refund)
failed → reversed ✓ (retry)
```

**Invalid Transitions (should be blocked in UI/API):**
```
transferred → pending ✗
failed → transferred ✗
reversed → pending ✗
```

---

## Implementation Phases

### PHASE 1: Validation ✅ COMPLETE

- Verified tables don't exist in database
- Confirmed migration file location and naming convention
- Validated service layer structure

### PHASE 2: Database Migration ✅ COMPLETE

**Files Created:**
- `supabase/migrations/20250128000000_add_bank_accounts_system.sql` (280+ lines)
- `supabase/migrations/20250128000000_add_bank_accounts_system.rollback.sql`

**Contents:**
- 5 tables with proper foreign keys
- 15+ performance indices
- RLS policies for security
- Seed data for account types

**Migration Execution:**
```bash
# Apply migration
supabase migration up

# Rollback if needed
supabase migration down
```

### PHASE 3: Service Layer Implementation ✅ COMPLETE

**3.1 - recipientService.js Extensions**
- Added 6 functions for bank account management
- Implemented secure account number hashing
- Added recipient-account linking with default management

**3.2 - remittanceService.js Extensions**
- Added 4 functions for bank transfer tracking
- Implemented status lifecycle management
- Added pending transfer queries for admin dashboard

**3.3 - bankService.js Creation**
- Created new service for master data operations
- Implemented bank and account type queries
- Added bank search functionality

### PHASE 4: TypeScript Interfaces ✅ COMPLETE

**File Created:** `/src/types/banking.ts`

**Contents:**
- 30+ interfaces covering all entity types
- Proper type safety for service responses
- Generic response wrappers (ApiResponse, PaginatedResponse)
- Request/form data types

### PHASE 5: Documentation ✅ COMPLETE

**Components Updated:**
- `RecipientForm.jsx` - Added JSDoc and future section placeholders

**Files Created:**
- This document (`BANK_ACCOUNTS_IMPLEMENTATION.md`)

### PHASE 6: UI Integration ⏳ PENDING

**Components to Create:**
- `BankAccountForm.jsx` - Form for creating/editing bank accounts
- `BankAccountSelector.jsx` - Dropdown selector for user accounts
- `BankTransferForm.jsx` - Form for initiating bank transfers
- `AdminBankTransfersTab.jsx` - Admin dashboard for transfer management

**Components to Extend:**
- `RecipientForm.jsx` - Add bank account section
- `SendRemittanceForm.jsx` or equivalent - Add bank transfer flow
- `CartPage.jsx` - Integrate bank account selection if applicable

### PHASE 7: Testing & Git Commit ⏳ PENDING

---

## Future UI Integration Points

### 1. User Profile / Account Management

**Page:** User Settings → Manage Bank Accounts

**Components:**
- List existing bank accounts with edit/delete actions
- Add new account button (opens BankAccountForm modal)
- Set default account for each recipient

**Data Flow:**
```
ManageBankAccountsPage
  ├── BankAccountList (calls getBankAccountsByUser)
  ├── BankAccountForm (calls createBankAccount / updateBankAccount)
  └── RecipientAccountLinks (calls getBankAccountsForRecipient)
```

### 2. Remittance Form

**Page:** Send Remittance Wizard - Step 3 (Delivery Method)

**Components:**
- Recipient selector (existing RecipientSelector)
- Delivery method tabs (cash | transfer | card)
- When "transfer" selected:
  - BankAccountSelector (shows recipient's linked accounts)
  - Option to link new account to recipient

**Data Flow:**
```
SendRemittanceForm
  ├── RecipientSelector
  └── [If transfer delivery_method]
      ├── BankAccountSelector (calls getBankAccountsForRecipient)
      └── BankTransferForm (calls createBankTransfer)
```

### 3. Cart Checkout

**Page:** CartPage - Step 2 or 3

**Components:**
- Similar to remittance form
- Select delivery method
- If transfer: select or link bank account

### 4. Admin Dashboard

**Page:** Admin Panel → Bank Transfers

**Components:**
- PendingTransfersTable (calls getPendingBankTransfers)
- TransferDetailModal with:
  - Recipient and remittance info
  - Recipient bank account details
  - Confirm/Reject buttons
  - Status change dropdown

**Admin Actions:**
```
1. Review pending transfers (default filtered list)
2. Click transfer row to open detail modal
3. Review recipient bank account (last 4 digits shown)
4. Confirm or reject transfer
5. System auto-sets processed_at and processed_by_user_id
```

---

## Testing Strategy

### Unit Tests

**Service Functions:**
```javascript
// Test recipientService.createBankAccount
test('hashes account number with user ID', () => {
  const result = createBankAccount(userId, {
    accountNumber: '1234567890',
    // ...
  });

  expect(result.data.account_number_hash).not.toBe('1234567890');
  expect(result.data.account_number_last4).toBe('7890');
});

// Test recipientService.getBankAccountsByUser
test('filters soft-deleted accounts', async () => {
  const result = await getBankAccountsByUser(userId);
  // Should not include accounts with deleted_at IS NOT NULL
});

// Test remittanceService.updateBankTransferStatus
test('auto-sets processed_at on confirmed status', async () => {
  const before = new Date();
  const result = await updateBankTransferStatus(transferId, 'confirmed');
  const after = new Date();

  expect(result.data.processed_at).toBeTruthy();
  expect(new Date(result.data.processed_at)).toBeGreaterThanOrEqual(before);
  expect(new Date(result.data.processed_at)).toBeLessThanOrEqual(after);
});
```

### Integration Tests

**RLS Policies:**
```javascript
// Test user isolation via RLS
test('user cannot access other user bank accounts', async () => {
  const otherUserAccounts = await getBankAccountsByUser(otherUserId);
  // Should return error or empty array based on RLS
});

// Test admin access
test('admin can process transfers via RLS', async () => {
  const result = await updateBankTransferStatus(transferId, 'confirmed', {
    processed_by_user_id: adminId
  });
  expect(result.success).toBe(true);
});
```

### E2E Tests

**Complete Flows:**
1. Create bank account → Link to recipient → Create transfer
2. Create transfer → Confirm → Mark transferred
3. User management → Add account → Set default
4. Admin dashboard → View pending → Confirm transfer

---

## Troubleshooting

### Issue: "Account number hash mismatch"

**Cause:** Attempting to login with different account number than stored hash.

**Solution:** Account numbers must be entered exactly as when created (hashing includes plaintext comparison would fail).

**Prevention:** Only store last 4 digits for user to verify, don't attempt to re-validate stored account numbers.

---

### Issue: "Cannot link account to recipient - unique constraint violated"

**Cause:** Account already linked to recipient.

**Solution:** Check if recipient_bank_account exists first:
```javascript
const existing = await getBankAccountsForRecipient(recipientId);
if (!existing.find(a => a.bank_account_id === accountId)) {
  await linkBankAccountToRecipient(recipientId, accountId);
}
```

---

### Issue: "Foreign key constraint error on bank_accounts delete"

**Cause:** Attempting to delete bank account that's referenced by remittance_bank_transfers.

**Solution:** Use soft delete instead:
```javascript
// ✓ Correct - soft delete
await deleteBankAccount(accountId, deletedByUserId);

// ✗ Incorrect - will violate foreign keys
// DELETE FROM bank_accounts WHERE id = accountId;
```

---

### Issue: "No pending transfers showing in admin dashboard"

**Cause:**
- Transfers aren't in 'pending' status
- Transfer records don't exist yet
- RLS policy blocking access

**Debug Steps:**
```sql
-- Check transfer statuses
SELECT id, status, created_at FROM remittance_bank_transfers
ORDER BY created_at DESC LIMIT 10;

-- Check RLS access
SELECT * FROM remittance_bank_transfers
WHERE status = 'pending' LIMIT 10;
-- If empty, verify RLS policy allows admin access
```

---

### Issue: "Account number last 4 digits showing incorrectly"

**Cause:** Account number was entered with leading zeros or unusual format.

**Fix:** When displaying, always show "****" + last 4:
```javascript
// ✓ Correct
const display = `****${account.account_number_last4}`;

// ✗ Incorrect - may show wrong last 4
const display = account.account_number.slice(-4);
```

---

## Related Documentation

- [RLS Setup Instructions](./RLS_SETUP_INSTRUCTIONS.md)
- [Database Migration Guide](./migrations/)
- [API Response Standards](./README.md#api-standards)

---

**Document Revision History**

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2025-01-28 | Claude Code | Initial implementation guide |

**Next Steps:**

1. Execute database migration when ready
2. Seed bank master data (banks, account types)
3. Implement UI components for bank account management
4. Add integration tests for RLS policies
5. Create admin dashboard for transfer management
6. Deploy to production with monitoring

---

*Last Updated: 2025-01-28*
