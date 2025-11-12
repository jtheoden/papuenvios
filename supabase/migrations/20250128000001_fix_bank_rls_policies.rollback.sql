-- ============================================================================
-- ROLLBACK: FIX RLS POLICIES FOR MASTER TABLES AND RECIPIENT_BANK_ACCOUNTS
-- Migration: 20250128000001
-- ============================================================================

-- Eliminar todas las políticas creadas
DROP POLICY IF EXISTS "banks_select_all" ON public.banks;
DROP POLICY IF EXISTS "banks_insert_admin" ON public.banks;
DROP POLICY IF EXISTS "banks_update_admin" ON public.banks;
DROP POLICY IF EXISTS "banks_delete_admin" ON public.banks;

DROP POLICY IF EXISTS "account_types_select_all" ON public.account_types;
DROP POLICY IF EXISTS "account_types_insert_admin" ON public.account_types;
DROP POLICY IF EXISTS "account_types_update_admin" ON public.account_types;
DROP POLICY IF EXISTS "account_types_delete_admin" ON public.account_types;

DROP POLICY IF EXISTS "currencies_select_all" ON public.currencies;
DROP POLICY IF EXISTS "currencies_insert_admin" ON public.currencies;
DROP POLICY IF EXISTS "currencies_update_admin" ON public.currencies;
DROP POLICY IF EXISTS "currencies_delete_admin" ON public.currencies;

DROP POLICY IF EXISTS "recipient_bank_accounts_select" ON public.recipient_bank_accounts;
DROP POLICY IF EXISTS "recipient_bank_accounts_insert" ON public.recipient_bank_accounts;
DROP POLICY IF EXISTS "recipient_bank_accounts_update" ON public.recipient_bank_accounts;
DROP POLICY IF EXISTS "recipient_bank_accounts_delete" ON public.recipient_bank_accounts;

-- Deshabilitar RLS (revertir al estado original)
ALTER TABLE public.banks DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_types DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.currencies DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.recipient_bank_accounts DISABLE ROW LEVEL SECURITY;
