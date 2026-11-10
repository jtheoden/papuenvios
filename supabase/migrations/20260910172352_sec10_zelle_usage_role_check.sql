-- SEC-10: update_zelle_account_usage had no internal role check and EXECUTE
-- was granted to anon — anyone could arbitrarily adjust Zelle account daily/
-- monthly usage counters. Adds is_admin_user() gate (project standard) and
-- GREATEST(0, ...) to avoid negative balances on out-of-order reversals.

CREATE OR REPLACE FUNCTION public.update_zelle_account_usage(p_account_id uuid, p_amount numeric)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT is_admin_user() THEN
    RAISE EXCEPTION 'No autorizado: se requiere rol admin' USING ERRCODE = '42501';
  END IF;

  UPDATE zelle_accounts
  SET
    current_daily_amount = GREATEST(0, current_daily_amount + p_amount),
    current_monthly_amount = GREATEST(0, current_monthly_amount + p_amount),
    last_used_at = now(),
    updated_at = now()
  WHERE id = p_account_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_zelle_account_usage(uuid, numeric) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.update_zelle_account_usage(uuid, numeric) FROM anon;
