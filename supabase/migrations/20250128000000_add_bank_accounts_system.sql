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
-- SEED DATA - Common account types
-- ============================================================================

INSERT INTO public.account_types (name, description) VALUES
  ('checking', 'Cuenta corriente / Checking account'),
  ('savings', 'Cuenta de ahorro / Savings account'),
  ('moneypocket', 'Monedero móvil / Mobile wallet'),
  ('debit_card', 'Tarjeta de débito / Debit card')
ON CONFLICT (name) DO NOTHING;

-- ============================================================================
-- COMMENTS - Documentation
-- ============================================================================

COMMENT ON TABLE public.banks IS 'Master list of banks for bank transfers';
COMMENT ON TABLE public.account_types IS 'Types of bank accounts (checking, savings, etc)';
COMMENT ON TABLE public.bank_accounts IS 'User bank accounts for receiving transfers';
COMMENT ON TABLE public.recipient_bank_accounts IS 'Link between recipients and their bank accounts';
COMMENT ON TABLE public.remittance_bank_transfers IS 'Audit trail for bank transfers';

COMMENT ON COLUMN public.bank_accounts.account_number_hash IS 'SHA256 hash of account number + user_id for secure matching';
COMMENT ON COLUMN public.bank_accounts.account_number_last4 IS 'Last 4 digits for display in UI only';
COMMENT ON COLUMN public.bank_accounts.deleted_at IS 'Soft delete timestamp - NULL means active';
COMMENT ON COLUMN public.remittance_bank_transfers.status IS 'Transfer status: pending, confirmed, transferred, failed, reversed';

-- ============================================================================
-- END MIGRATION
-- ============================================================================
