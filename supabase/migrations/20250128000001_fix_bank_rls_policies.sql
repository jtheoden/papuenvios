-- ============================================================================
-- FIX RLS POLICIES FOR MASTER TABLES AND RECIPIENT_BANK_ACCOUNTS
-- Migration: 20250128000001
-- Description: Clean and recreate all RLS policies with correct syntax
-- ============================================================================

-- PASO 1: ELIMINAR TODAS LAS POLÍTICAS EXISTENTES
DO $$
DECLARE
    pol RECORD;
BEGIN
    FOR pol IN
        SELECT policyname, tablename
        FROM pg_policies
        WHERE schemaname = 'public'
        AND tablename IN ('banks', 'account_types', 'currencies', 'recipient_bank_accounts')
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol.policyname, pol.tablename);
    END LOOP;
END $$;

-- PASO 2: HABILITAR RLS
ALTER TABLE public.banks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.currencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recipient_bank_accounts ENABLE ROW LEVEL SECURITY;

-- PASO 3: GRANT PERMISSIONS (CRÍTICO para que RLS funcione)
-- Sin estos GRANTs, las políticas RLS no funcionan y se reciben errores 403

-- Tablas maestras (lectura pública para usuarios autenticados y anónimos)
GRANT SELECT ON public.banks TO authenticated, anon;
GRANT SELECT ON public.account_types TO authenticated, anon;
GRANT SELECT ON public.currencies TO authenticated, anon;

-- Tablas de cuentas bancarias (usuarios pueden gestionar sus propias cuentas)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bank_accounts TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.recipient_bank_accounts TO authenticated;

-- ============================================================================
-- BANKS POLICIES (PUBLIC READ)
-- ============================================================================

CREATE POLICY "banks_select_all" ON public.banks
  FOR SELECT
  TO authenticated, anon
  USING (true);

CREATE POLICY "banks_insert_admin" ON public.banks
  FOR INSERT
  TO authenticated
  WITH CHECK ((auth.jwt() ->> 'user_role') = 'admin');

CREATE POLICY "banks_update_admin" ON public.banks
  FOR UPDATE
  TO authenticated
  USING ((auth.jwt() ->> 'user_role') = 'admin');

CREATE POLICY "banks_delete_admin" ON public.banks
  FOR DELETE
  TO authenticated
  USING ((auth.jwt() ->> 'user_role') = 'admin');

-- ============================================================================
-- ACCOUNT_TYPES POLICIES (PUBLIC READ)
-- ============================================================================

CREATE POLICY "account_types_select_all" ON public.account_types
  FOR SELECT
  TO authenticated, anon
  USING (true);

CREATE POLICY "account_types_insert_admin" ON public.account_types
  FOR INSERT
  TO authenticated
  WITH CHECK ((auth.jwt() ->> 'user_role') = 'admin');

CREATE POLICY "account_types_update_admin" ON public.account_types
  FOR UPDATE
  TO authenticated
  USING ((auth.jwt() ->> 'user_role') = 'admin');

CREATE POLICY "account_types_delete_admin" ON public.account_types
  FOR DELETE
  TO authenticated
  USING ((auth.jwt() ->> 'user_role') = 'admin');

-- ============================================================================
-- CURRENCIES POLICIES (PUBLIC READ)
-- ============================================================================

CREATE POLICY "currencies_select_all" ON public.currencies
  FOR SELECT
  TO authenticated, anon
  USING (true);

CREATE POLICY "currencies_insert_admin" ON public.currencies
  FOR INSERT
  TO authenticated
  WITH CHECK ((auth.jwt() ->> 'user_role') = 'admin');

CREATE POLICY "currencies_update_admin" ON public.currencies
  FOR UPDATE
  TO authenticated
  USING ((auth.jwt() ->> 'user_role') = 'admin');

CREATE POLICY "currencies_delete_admin" ON public.currencies
  FOR DELETE
  TO authenticated
  USING ((auth.jwt() ->> 'user_role') = 'admin');

-- ============================================================================
-- RECIPIENT_BANK_ACCOUNTS POLICIES (USER + ADMIN ACCESS)
-- ============================================================================

CREATE POLICY "recipient_bank_accounts_select" ON public.recipient_bank_accounts
  FOR SELECT
  TO authenticated
  USING (
    -- Usuarios pueden ver cuentas de sus propios recipients
    EXISTS (
      SELECT 1 FROM public.recipients
      WHERE recipients.id = recipient_bank_accounts.recipient_id
      AND recipients.user_id = auth.uid()
    )
    OR
    -- Admins pueden ver todas
    (auth.jwt() ->> 'user_role') = 'admin'
  );

CREATE POLICY "recipient_bank_accounts_insert" ON public.recipient_bank_accounts
  FOR INSERT
  TO authenticated
  WITH CHECK (
    -- Usuarios pueden crear cuentas para sus propios recipients
    EXISTS (
      SELECT 1 FROM public.recipients
      WHERE recipients.id = recipient_bank_accounts.recipient_id
      AND recipients.user_id = auth.uid()
    )
    OR
    -- Admins pueden crear para cualquiera
    (auth.jwt() ->> 'user_role') = 'admin'
  );

CREATE POLICY "recipient_bank_accounts_update" ON public.recipient_bank_accounts
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.recipients
      WHERE recipients.id = recipient_bank_accounts.recipient_id
      AND recipients.user_id = auth.uid()
    )
    OR
    (auth.jwt() ->> 'user_role') = 'admin'
  );

CREATE POLICY "recipient_bank_accounts_delete" ON public.recipient_bank_accounts
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.recipients
      WHERE recipients.id = recipient_bank_accounts.recipient_id
      AND recipients.user_id = auth.uid()
    )
    OR
    (auth.jwt() ->> 'user_role') = 'admin'
  );

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON POLICY "banks_select_all" ON public.banks IS
  'All users (authenticated and anon) can read banks - public master data';
COMMENT ON POLICY "account_types_select_all" ON public.account_types IS
  'All users (authenticated and anon) can read account types - public master data';
COMMENT ON POLICY "currencies_select_all" ON public.currencies IS
  'All users (authenticated and anon) can read currencies - public master data';
COMMENT ON POLICY "recipient_bank_accounts_select" ON public.recipient_bank_accounts IS
  'Users can view bank accounts for their own recipients, admins can view all';
