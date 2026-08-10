-- SEC-09: select_available_zelle_account (plain SELECT) and update_zelle_account_usage
-- (separate RPC, called later in the flow) are not atomic with each other. Two concurrent
-- createRemittance/checkout calls can both pass the daily/monthly/security limit check on
-- the same account before either registers usage, exceeding the configured limit.
--
-- Fix: a single SECURITY INVOKER function that selects and reserves an account atomically,
-- using FOR UPDATE SKIP LOCKED so concurrent callers do not block on each other and cannot
-- both land on the same account. A locked row is skipped in favor of the next eligible
-- account by priority_order/last_used_at rather than waiting for the lock to release.
--
-- This supersedes the "evita race conditions" conclusion in the 2026-04-20 audit for this
-- function pair — that conclusion was based on the RPC existing, not on the two calls being
-- atomic with each other.

BEGIN;

CREATE OR REPLACE FUNCTION public.reserve_zelle_account(p_transaction_type character varying, p_amount numeric)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path = public
AS $function$
DECLARE
  v_account_id uuid;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'p_amount must be a positive number';
  END IF;

  SELECT id INTO v_account_id
  FROM zelle_accounts
  WHERE is_active = true
    AND (
      (p_transaction_type = 'remittance' AND for_remittances = true) OR
      (p_transaction_type IN ('product', 'combo') AND for_products = true)
    )
    AND (current_daily_amount + p_amount) <= COALESCE(daily_limit, 999999)
    AND (current_monthly_amount + p_amount) <= COALESCE(monthly_limit, 999999)
    AND (current_daily_amount + p_amount) <= COALESCE(security_limit, 999999)
  ORDER BY priority_order ASC, last_used_at ASC NULLS FIRST
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF v_account_id IS NOT NULL THEN
    UPDATE zelle_accounts
    SET current_daily_amount = current_daily_amount + p_amount,
        current_monthly_amount = current_monthly_amount + p_amount,
        last_used_at = now(),
        updated_at = now()
    WHERE id = v_account_id;
  END IF;

  RETURN v_account_id;
END;
$function$;

COMMENT ON FUNCTION public.reserve_zelle_account(character varying, numeric) IS
  'Atomic account selection + usage reservation (SEC-09 fix). Replaces the non-atomic '
  'select_available_zelle_account + update_zelle_account_usage pair for the forward-reservation '
  'path. update_zelle_account_usage is kept only for the reversal path in rejectZelleTransaction.';

GRANT EXECUTE ON FUNCTION public.reserve_zelle_account(character varying, numeric) TO authenticated;

COMMIT;
