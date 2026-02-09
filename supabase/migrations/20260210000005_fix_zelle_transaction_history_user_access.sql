-- Fix: regular users need INSERT/SELECT on zelle_transaction_history when making Zelle payments.
-- The remittance creation flow records a transaction entry and queries existing ones.
-- Also: update_zelle_account_usage() is INVOKER and needs to UPDATE zelle_accounts
-- counters — changing it to SECURITY DEFINER so it bypasses RLS safely.

BEGIN;

-- 1. Allow authenticated users to INSERT transaction records (payment recording)
CREATE POLICY zth_insert_authenticated ON public.zelle_transaction_history
  FOR INSERT TO authenticated
  WITH CHECK (true);

-- 2. Allow authenticated users to SELECT transactions (needed during remittance flow)
CREATE POLICY zth_select_authenticated ON public.zelle_transaction_history
  FOR SELECT TO authenticated
  USING (true);

-- 3. Make update_zelle_account_usage SECURITY DEFINER so it can update
--    zelle_accounts counters without needing a user-level UPDATE policy.
--    This is safe because the function only increments specific counter columns.
CREATE OR REPLACE FUNCTION public.update_zelle_account_usage(p_account_id uuid, p_amount numeric)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE zelle_accounts
  SET
    current_daily_amount = current_daily_amount + p_amount,
    current_monthly_amount = current_monthly_amount + p_amount,
    last_used_at = now(),
    updated_at = now()
  WHERE id = p_account_id;
END;
$$;

COMMIT;
