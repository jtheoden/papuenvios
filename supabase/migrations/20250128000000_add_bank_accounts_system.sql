-- ============================================================================
-- BANCO ACCOUNTS SYSTEM - Complete Migration
-- Created: 2025-01-28
-- Purpose: Support bank transfers for remittances with full audit trail
-- ============================================================================

-- TABLE 1: banks (Independent - no FK)
CREATE TABLE IF NOT EXISTS public.banks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(200) NOT NULL UNIQUE,
  swift_code VARCHAR(11),
  local_code VARCHAR(50),
  country_code VARCHAR(2),
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_banks_swift_code ON public.banks(swift_code);
CREATE INDEX idx_banks_local_code ON public.banks(local_code);
CREATE INDEX idx_banks_name ON public.banks(name);

-- TABLE 2: account_types (Renamed from bank_account_types)
CREATE TABLE IF NOT EXISTS public.account_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(50) NOT NULL UNIQUE,
  description TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- TABLE 3: bank_accounts (Core - stores user accounts)
CREATE TABLE IF NOT EXISTS public.bank_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  bank_id UUID NOT NULL REFERENCES public.banks(id) ON DELETE RESTRICT,
  account_type_id UUID NOT NULL REFERENCES public.account_types(id) ON DELETE RESTRICT,
  currency_id UUID NOT NULL REFERENCES public.currencies(id) ON DELETE RESTRICT,

  -- Account Details
  account_number_last4 VARCHAR(4) NOT NULL,
  account_number_hash VARCHAR(64) NOT NULL UNIQUE,
  account_holder_name VARCHAR(200) NOT NULL,

  -- Status
  is_active BOOLEAN DEFAULT true,

  -- Soft Delete
  deleted_at TIMESTAMPTZ,
  deleted_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  -- Auditing
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  CONSTRAINT check_account_number_last4_length CHECK (LENGTH(account_number_last4) = 4),
  CONSTRAINT check_account_holder_not_empty CHECK (LENGTH(TRIM(account_holder_name)) > 0)
);

CREATE INDEX idx_bank_accounts_user_id ON public.bank_accounts(user_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_bank_accounts_bank_id ON public.bank_accounts(bank_id);
CREATE INDEX idx_bank_accounts_active ON public.bank_accounts(user_id, is_active, deleted_at);
CREATE INDEX idx_bank_accounts_account_hash ON public.bank_accounts(account_number_hash);
CREATE INDEX idx_bank_accounts_created_at ON public.bank_accounts(created_at DESC);

-- TABLE 4: recipient_bank_accounts (Link recipients to bank accounts)
CREATE TABLE IF NOT EXISTS public.recipient_bank_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id UUID NOT NULL REFERENCES public.recipients(id) ON DELETE CASCADE,
  bank_account_id UUID NOT NULL REFERENCES public.bank_accounts(id) ON DELETE CASCADE,

  -- Flags
  is_default BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,

  -- Auditing
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  CONSTRAINT unique_recipient_bank_account UNIQUE(recipient_id, bank_account_id)
);

CREATE INDEX idx_recipient_bank_accounts_recipient_id ON public.recipient_bank_accounts(recipient_id);
CREATE INDEX idx_recipient_bank_accounts_bank_account_id ON public.recipient_bank_accounts(bank_account_id);
CREATE INDEX idx_recipient_bank_accounts_is_default ON public.recipient_bank_accounts(recipient_id, is_default);

-- TABLE 5: remittance_bank_transfers (Audit trail for bank transfers)
CREATE TABLE IF NOT EXISTS public.remittance_bank_transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  remittance_id UUID NOT NULL REFERENCES public.remittances(id) ON DELETE CASCADE,
  recipient_bank_account_id UUID NOT NULL REFERENCES public.recipient_bank_accounts(id) ON DELETE RESTRICT,

  -- Status tracking
  status VARCHAR(20) DEFAULT 'pending',

  -- Audit trail
  processed_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  processed_at TIMESTAMPTZ,
  amount_transferred NUMERIC(15, 2),

  -- Error tracking
  error_message TEXT,

  -- Auditing
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  CONSTRAINT check_status CHECK (status IN ('pending', 'confirmed', 'transferred', 'failed', 'reversed')),
  CONSTRAINT check_amount_positive CHECK (amount_transferred IS NULL OR amount_transferred > 0)
);

CREATE INDEX idx_remittance_bank_transfers_remittance_id ON public.remittance_bank_transfers(remittance_id);
CREATE INDEX idx_remittance_bank_transfers_bank_account_id ON public.remittance_bank_transfers(recipient_bank_account_id);
CREATE INDEX idx_remittance_bank_transfers_status ON public.remittance_bank_transfers(status);
CREATE INDEX idx_remittance_bank_transfers_created_at ON public.remittance_bank_transfers(created_at DESC);
CREATE INDEX idx_remittance_bank_transfers_processed_by ON public.remittance_bank_transfers(processed_by_user_id);

-- ============================================================================
-- ROW LEVEL SECURITY (RLS) - Protecting sensitive bank data
-- ============================================================================

-- Enable RLS
ALTER TABLE public.banks DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_types DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recipient_bank_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.remittance_bank_transfers ENABLE ROW LEVEL SECURITY;

-- bank_accounts: Users can only see their own accounts, admins see all
CREATE POLICY bank_accounts_user_view ON public.bank_accounts
  FOR SELECT USING (
    auth.uid() = user_id OR
    (auth.jwt() ->> 'user_role') = 'admin'
  );

CREATE POLICY bank_accounts_user_insert ON public.bank_accounts
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY bank_accounts_user_update ON public.bank_accounts
  FOR UPDATE USING (
    auth.uid() = user_id OR
    (auth.jwt() ->> 'user_role') = 'admin'
  );

CREATE POLICY bank_accounts_user_delete ON public.bank_accounts
  FOR DELETE USING (
    auth.uid() = user_id OR
    (auth.jwt() ->> 'user_role') = 'admin'
  );

-- recipient_bank_accounts: Allow view to users and admins
CREATE POLICY recipient_bank_accounts_view ON public.recipient_bank_accounts
  FOR SELECT USING (
    (auth.jwt() ->> 'user_role') = 'admin' OR
    EXISTS (
      SELECT 1 FROM public.recipients
      WHERE recipients.id = recipient_bank_accounts.recipient_id
      AND recipients.user_id = auth.uid()
    )
  );

-- remittance_bank_transfers: Admins only
CREATE POLICY remittance_bank_transfers_view ON public.remittance_bank_transfers
  FOR SELECT USING ((auth.jwt() ->> 'user_role') = 'admin');

CREATE POLICY remittance_bank_transfers_insert ON public.remittance_bank_transfers
  FOR INSERT WITH CHECK ((auth.jwt() ->> 'user_role') = 'admin');

CREATE POLICY remittance_bank_transfers_update ON public.remittance_bank_transfers
  FOR UPDATE USING ((auth.jwt() ->> 'user_role') = 'admin');

-- ============================================================================
-- SEED DATA - Banks (Cuban institutions)
-- ============================================================================

INSERT INTO public.banks (name, swift_code, local_code, country_code, metadata) VALUES
  ('BANDEC', 'BANDECUCU', 'BANDEC', 'CU', '{"full_name": "Banco Nacional de Desarrollo Económico y Social de Cuba", "logo": "bandec"}'),
  ('BPA', 'BPAACUCH', 'BPA', 'CU', '{"full_name": "Banco Popular de Ahorros", "logo": "bpa"}'),
  ('BANCO METROPOLITANO', 'BMTCUCU', 'BMT', 'CU', '{"full_name": "Banco Metropolitano", "logo": "metropolitan"}'),
  ('BFI', 'BFICCUCH', 'BFI', 'CU', '{"full_name": "Banco de Financiamientos e Inversiones", "logo": "bfi"}')
ON CONFLICT (name) DO NOTHING;

-- ============================================================================
-- SEED DATA - Account Types (with currency support)
-- ============================================================================

INSERT INTO public.account_types (name, description, metadata) VALUES
  ('checking', 'Cuenta corriente / Checking account', '{"currency": "USD", "type_code": "CHK"}'),
  ('savings', 'Cuenta de ahorro / Savings account', '{"currency": "USD", "type_code": "SAV"}'),
  ('moneypocket', 'Monedero móvil / Mobile wallet', '{"currency": "USD", "type_code": "MWL"}'),
  ('debit_card', 'Tarjeta de débito / Debit card', '{"currency": "USD", "type_code": "DBC"}'),
  ('clasica', 'Cuenta Clásica USD / Classic USD Account', '{"currency": "USD", "type_code": "CLASICA_USD"}'),
  ('cup_account', 'Cuenta en Pesos CUP / CUP Account', '{"currency": "CUP", "type_code": "CUP_ACC"}'),
  ('mlc_account', 'Cuenta en MLC / MLC Account', '{"currency": "MLC", "type_code": "MLC_ACC"}')
ON CONFLICT (name) DO NOTHING;

-- ============================================================================
-- COMMENTS - Documentation
-- ============================================================================

COMMENT ON TABLE public.banks IS 'Master list of banks for bank transfers. Seeded with Cuban banks: BANDEC, BPA, BANCO METROPOLITANO, BFI';
COMMENT ON TABLE public.account_types IS 'Types of bank accounts (checking, savings, currency-specific). Maps to currencies: USD (checking, savings, moneypocket, debit_card, clasica), CUP (cup_account), MLC (mlc_account)';
COMMENT ON TABLE public.bank_accounts IS 'User bank accounts for receiving transfers. Account numbers stored as SHA256 hashes with only last 4 digits displayed';
COMMENT ON TABLE public.recipient_bank_accounts IS 'Link between recipients and their bank accounts (many-to-many relationship). Supports default account flag';
COMMENT ON TABLE public.remittance_bank_transfers IS 'Audit trail for bank transfers. Tracks complete lifecycle from pending to transferred/failed/reversed';

COMMENT ON COLUMN public.banks.swift_code IS 'SWIFT/BIC code for international transfers (e.g., BANDECUCU, BPAACUCH)';
COMMENT ON COLUMN public.banks.local_code IS 'Local bank code used in Cuba (e.g., BANDEC, BPA, BMT, BFI)';
COMMENT ON COLUMN public.banks.metadata IS 'Additional bank info: full_name, logo, routing_info, API endpoints, etc';

COMMENT ON COLUMN public.account_types.metadata IS 'Account type metadata: currency (USD/CUP/MLC), type_code for integration';

COMMENT ON COLUMN public.bank_accounts.account_number_hash IS 'SHA256(account_number + user_id) for secure matching without storing plain account numbers';
COMMENT ON COLUMN public.bank_accounts.account_number_last4 IS 'Last 4 digits only for UI display/verification (e.g., ****1234)';
COMMENT ON COLUMN public.bank_accounts.is_active IS 'Soft flag to disable accounts without deletion';
COMMENT ON COLUMN public.bank_accounts.deleted_at IS 'Soft delete timestamp - NULL means active record';
COMMENT ON COLUMN public.bank_accounts.deleted_by_user_id IS 'User who deleted the account (for audit trail)';

COMMENT ON COLUMN public.recipient_bank_accounts.is_default IS 'Flag for default account per recipient. Only one default per recipient';
COMMENT ON COLUMN public.recipient_bank_accounts.is_active IS 'Active flag for link between recipient and account';

COMMENT ON COLUMN public.remittance_bank_transfers.status IS 'Transfer lifecycle: pending → confirmed → transferred/failed → reversed. Pending awaits admin confirmation';
COMMENT ON COLUMN public.remittance_bank_transfers.processed_by_user_id IS 'Admin user who confirmed/processed the transfer';
COMMENT ON COLUMN public.remittance_bank_transfers.processed_at IS 'Timestamp when transfer was confirmed or moved to transferred status';
COMMENT ON COLUMN public.remittance_bank_transfers.amount_transferred IS 'Actual amount transferred (may differ from remittance amount due to fees/rates)';
COMMENT ON COLUMN public.remittance_bank_transfers.error_message IS 'Error details if transfer failed (insufficient funds, invalid account, etc)';

-- ============================================================================
-- END MIGRATION
-- ============================================================================
