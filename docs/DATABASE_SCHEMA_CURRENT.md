# Current Database Schema - Papuenvios
**Last Updated:** 2025-10-28
**Migration Status:** All migrations applied successfully

## Key Tables for Bank Accounts & Remittances System

### remittance_types
Defines types of remittances with delivery methods configured by admin.

```sql
CREATE TABLE public.remittance_types (
  id uuid PRIMARY KEY,
  name varchar NOT NULL,
  currency_code varchar NOT NULL,
  delivery_currency varchar NOT NULL,
  exchange_rate numeric NOT NULL,
  commission_percentage numeric DEFAULT 0,
  commission_fixed numeric DEFAULT 0,
  min_amount numeric NOT NULL,
  max_amount numeric,
  delivery_method varchar NOT NULL,  -- 'cash', 'transfer', 'card', 'moneypocket'
  max_delivery_days integer DEFAULT 3,
  warning_days integer DEFAULT 2,
  is_active boolean DEFAULT true,
  display_order integer DEFAULT 0,
  description text,
  icon varchar,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  created_by uuid REFERENCES auth.users(id)
);
```

**Current Data Examples:**
- "Dólares a CUP (Efectivo)" - delivery_method: 'cash'
- "Dólares a USD (Transferencia)" - delivery_method: 'transfer'
- "Dólares a MLC (Tarjeta)" - delivery_method: 'card'

### remittances
Stores remittance transactions created by users.

```sql
CREATE TABLE public.remittances (
  id uuid PRIMARY KEY,
  remittance_number varchar UNIQUE NOT NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id),
  remittance_type_id uuid NOT NULL REFERENCES public.remittance_types(id),

  -- Amounts and Exchange
  amount_sent numeric NOT NULL,
  exchange_rate numeric NOT NULL,
  commission_percentage numeric NOT NULL,
  commission_fixed numeric NOT NULL,
  commission_total numeric NOT NULL,
  amount_to_deliver numeric NOT NULL,
  currency_sent varchar NOT NULL,
  currency_delivered varchar NOT NULL,

  -- Recipient Information
  recipient_name varchar NOT NULL,
  recipient_phone varchar NOT NULL,
  recipient_id_number varchar,
  recipient_address text,
  recipient_province varchar,
  recipient_municipality varchar,
  recipient_email varchar,
  recipient_id uuid REFERENCES public.recipients(id),
  recipient_address_id uuid REFERENCES public.recipient_addresses(id),

  -- Payment Information
  payment_proof_url text,
  payment_reference varchar,
  payment_proof_uploaded_at timestamptz,
  payment_proof_notes text,
  payment_validated boolean DEFAULT false,
  payment_validated_at timestamptz,
  payment_validated_by uuid REFERENCES auth.users(id),
  payment_rejection_reason text,

  -- Delivery Information
  delivery_notes text,
  delivery_proof_url text,
  delivery_notes_admin text,
  delivered_to_name varchar,
  delivered_to_id varchar,
  delivered_at timestamptz,
  delivered_by uuid REFERENCES auth.users(id),

  -- Status and Tracking
  status varchar NOT NULL DEFAULT 'payment_pending',
  processing_started_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  cancellation_reason text,
  cancelled_by uuid REFERENCES auth.users(id),

  -- Zelle Account
  zelle_account_id uuid REFERENCES public.zelle_accounts(id),
  zelle_transaction_id uuid REFERENCES public.zelle_transaction_history(id),

  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
```

**Note:** The `delivery_method` is derived from the linked `remittance_types` table, NOT stored directly in `remittances`.

### banks
Master list of Cuban banks.

```sql
CREATE TABLE public.banks (
  id uuid PRIMARY KEY,
  name varchar UNIQUE NOT NULL,
  swift_code varchar,
  local_code varchar,
  country_code varchar,
  metadata jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
```

**Seeded Data:**
- BANDEC (Banco Nacional de Desarrollo Económico y Social de Cuba)
- BPA (Banco Popular de Ahorros)
- BANCO METROPOLITANO
- BFI (Banco de Financiamientos e Inversiones)

### account_types
Types of bank accounts with currency support.

```sql
CREATE TABLE public.account_types (
  id uuid PRIMARY KEY,
  name varchar UNIQUE NOT NULL,
  description text,
  metadata jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
```

**Seeded Data:**
- checking - Cuenta corriente (USD)
- savings - Cuenta de ahorro (USD)
- moneypocket - Monedero móvil (USD)
- debit_card - Tarjeta de débito (USD)
- clasica - Cuenta Clásica USD
- cup_account - Cuenta en Pesos CUP
- mlc_account - Cuenta en MLC

### bank_accounts
User bank accounts with secure storage.

```sql
CREATE TABLE public.bank_accounts (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id),
  bank_id uuid NOT NULL REFERENCES public.banks(id),
  account_type_id uuid NOT NULL REFERENCES public.account_types(id),
  currency_id uuid NOT NULL REFERENCES public.currencies(id),

  -- Secure Storage (SHA256 hash)
  account_number_last4 varchar(4) NOT NULL CHECK (length(account_number_last4) = 4),
  account_number_hash varchar(64) UNIQUE NOT NULL,
  account_holder_name varchar(200) NOT NULL CHECK (length(TRIM(account_holder_name)) > 0),

  -- Status
  is_active boolean DEFAULT true,

  -- Soft Delete
  deleted_at timestamptz,
  deleted_by_user_id uuid REFERENCES auth.users(id),

  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
```

**Security:** Account numbers stored as `SHA256(accountNumber + userId)` hash. Only last 4 digits displayed.

### recipient_bank_accounts
Links recipients to bank accounts (M:N relationship).

```sql
CREATE TABLE public.recipient_bank_accounts (
  id uuid PRIMARY KEY,
  recipient_id uuid NOT NULL REFERENCES public.recipients(id),
  bank_account_id uuid NOT NULL REFERENCES public.bank_accounts(id),
  is_default boolean DEFAULT false,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT unique_recipient_bank_account UNIQUE(recipient_id, bank_account_id)
);
```

**Purpose:** Allows recipients to have multiple linked bank accounts with default preference.

### remittance_bank_transfers
Tracks bank transfers for remittances with complete audit trail.

```sql
CREATE TABLE public.remittance_bank_transfers (
  id uuid PRIMARY KEY,
  remittance_id uuid NOT NULL REFERENCES public.remittances(id),
  recipient_bank_account_id uuid NOT NULL REFERENCES public.recipient_bank_accounts(id),

  -- Status Tracking
  status varchar DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'transferred', 'failed', 'reversed')),

  -- Audit Trail
  processed_by_user_id uuid REFERENCES auth.users(id),
  processed_at timestamptz,
  amount_transferred numeric CHECK (amount_transferred IS NULL OR amount_transferred > 0),

  -- Error Handling
  error_message text,

  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
```

**Status Lifecycle:**
1. `pending` - Awaiting admin confirmation
2. `confirmed` - Admin confirmed, will be processed
3. `transferred` - Payment processor confirmed successful transfer
4. `failed` - Transfer failed (see error_message)
5. `reversed` - Transfer was initiated but reversed (refund)

---

## Related Tables

### recipients
Recipient contact information.

```sql
CREATE TABLE public.recipients (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id),
  full_name varchar NOT NULL,
  phone varchar NOT NULL,
  id_number varchar,
  email varchar,
  notes text,
  is_favorite boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
```

### recipient_addresses
Multiple addresses per recipient for cash deliveries.

```sql
CREATE TABLE public.recipient_addresses (
  id uuid PRIMARY KEY,
  recipient_id uuid NOT NULL REFERENCES public.recipients(id),
  address_type varchar DEFAULT 'home',
  province varchar NOT NULL,
  municipality varchar,
  address_line_1 text NOT NULL,
  address_line_2 text,
  postal_code varchar,
  reference_point text,
  is_default boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
```

### currencies
Supported currencies for transactions.

```sql
CREATE TABLE public.currencies (
  id uuid PRIMARY KEY,
  code text UNIQUE NOT NULL,
  name_es text NOT NULL,
  name_en text NOT NULL,
  symbol text NOT NULL,
  is_base boolean DEFAULT false,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
```

**Active Currencies:** USD, EUR, CUP, MLC

---

## Indexes

### Performance Indices

**bank_accounts:**
- `idx_bank_accounts_user_id` ON (user_id) WHERE deleted_at IS NULL
- `idx_bank_accounts_bank_id` ON (bank_id)
- `idx_bank_accounts_active` ON (user_id, is_active, deleted_at)
- `idx_bank_accounts_account_hash` ON (account_number_hash)
- `idx_bank_accounts_created_at` ON (created_at DESC)

**recipient_bank_accounts:**
- `idx_recipient_bank_accounts_recipient_id` ON (recipient_id)
- `idx_recipient_bank_accounts_bank_account_id` ON (bank_account_id)
- `idx_recipient_bank_accounts_is_default` ON (recipient_id, is_default)

**remittance_bank_transfers:**
- `idx_remittance_bank_transfers_remittance_id` ON (remittance_id)
- `idx_remittance_bank_transfers_bank_account_id` ON (recipient_bank_account_id)
- `idx_remittance_bank_transfers_status` ON (status)
- `idx_remittance_bank_transfers_created_at` ON (created_at DESC)
- `idx_remittance_bank_transfers_processed_by` ON (processed_by_user_id)

---

## Row-Level Security (RLS)

### bank_accounts Policies

```sql
-- Users can view their own accounts, admins see all
CREATE POLICY bank_accounts_user_view ON bank_accounts
  FOR SELECT USING (
    auth.uid() = user_id OR
    (auth.jwt() ->> 'user_role') = 'admin'
  );

-- Users can insert their own accounts
CREATE POLICY bank_accounts_user_insert ON bank_accounts
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Users can update their own accounts
CREATE POLICY bank_accounts_user_update ON bank_accounts
  FOR UPDATE USING (
    auth.uid() = user_id OR
    (auth.jwt() ->> 'user_role') = 'admin'
  );

-- Users can delete their own accounts
CREATE POLICY bank_accounts_user_delete ON bank_accounts
  FOR DELETE USING (
    auth.uid() = user_id OR
    (auth.jwt() ->> 'user_role') = 'admin'
  );
```

### recipient_bank_accounts Policies

```sql
-- Users and admins can view
CREATE POLICY recipient_bank_accounts_view ON recipient_bank_accounts
  FOR SELECT USING (
    (auth.jwt() ->> 'user_role') = 'admin' OR
    EXISTS (
      SELECT 1 FROM recipients
      WHERE recipients.id = recipient_bank_accounts.recipient_id
      AND recipients.user_id = auth.uid()
    )
  );
```

### remittance_bank_transfers Policies

```sql
-- Admins only for all operations
CREATE POLICY remittance_bank_transfers_view ON remittance_bank_transfers
  FOR SELECT USING ((auth.jwt() ->> 'user_role') = 'admin');

CREATE POLICY remittance_bank_transfers_insert ON remittance_bank_transfers
  FOR INSERT WITH CHECK ((auth.jwt() ->> 'user_role') = 'admin');

CREATE POLICY remittance_bank_transfers_update ON remittance_bank_transfers
  FOR UPDATE USING ((auth.jwt() ->> 'user_role') = 'admin');
```

---

## Data Flow: Remittance with Bank Transfer

### Step-by-Step Process

1. **User selects remittance_type** (Step 1)
   - System reads `delivery_method` from `remittance_types` table
   - If `delivery_method = 'cash'` → Show address selection
   - If `delivery_method != 'cash'` → Show bank account selection

2. **User selects recipient** (Step 2)
   - RecipientSelector loads recipient's linked bank accounts
   - BankAccountSelector displays accounts or allows creating new one
   - User must select a bank account to continue

3. **User confirms remittance** (Step 3)
   - createRemittance() creates remittance record
   - Includes `recipient_id` and selected bank account data

4. **System creates bank_transfer record** (Backend)
   - createBankTransfer() creates entry in `remittance_bank_transfers`
   - Initial status: 'pending'
   - Links: remittance_id → recipient_bank_account_id

5. **Admin processes transfer** (Admin Dashboard)
   - Admin reviews pending transfers
   - Updates status: pending → confirmed → transferred
   - Records: processed_by_user_id, processed_at, amount_transferred

---

## Migration Files

1. **20241001000000_complete_schema.sql** - Base schema
2. **20241002000000_seed_initial_data.sql** - Initial data
3. **20250128000000_add_bank_accounts_system.sql** - Bank accounts system ✅
4. **20251007_orders_payment_system.sql** - Orders payment enhancements

---

## Notes

- **delivery_method is NOT stored in remittances table** - It's derived from remittance_types
- **Bank account numbers are NEVER stored in plain text** - SHA256 hashed
- **Soft delete pattern used** - deleted_at timestamp for audit trail
- **Complete audit trail** - All bank transfers tracked with admin info
- **M:N relationship** - Recipients can have multiple bank accounts

---

*Document maintained as part of project tracking for bank accounts implementation.*
*Last schema verification: 2025-10-28*
