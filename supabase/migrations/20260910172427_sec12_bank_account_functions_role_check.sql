-- SEC-12: get_recipient_bank_account_full / get_remittance_bank_accounts_admin
-- guarded access with `IF (auth.jwt() ->> 'user_role') NOT IN (...)`. No JWT
-- issued by this project ever carries a `user_role` claim (no Custom Access
-- Token Hook configured), so the condition is always NULL, and in PL/pgSQL
-- `IF NULL THEN ...` never executes — the check was a no-op. Both functions
-- also grant EXECUTE to anon. Replaced with the project-standard
-- is_admin_user(). Bodies below are verbatim (pg_proc.prosrc, confirmed live
-- 2026-09-10) — only the role check changed.

CREATE OR REPLACE FUNCTION public.get_recipient_bank_account_full(p_recipient_bank_account_id uuid)
RETURNS TABLE(recipient_bank_account_id uuid, bank_name text, account_type text, currency_code text,
              account_holder_name text, account_number_full text, account_number_last4 text, is_default boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT is_admin_user() THEN
    RAISE EXCEPTION 'Access denied: admin role required';
  END IF;

  RETURN QUERY
  SELECT
    rba.id AS recipient_bank_account_id,
    b.name AS bank_name,
    at.name AS account_type,
    c.code AS currency_code,
    ba.account_holder_name,
    ba.account_number_full,
    ba.account_number_last4,
    rba.is_default
  FROM public.recipient_bank_accounts rba
  INNER JOIN public.bank_accounts ba ON ba.id = rba.bank_account_id
  INNER JOIN public.banks b ON b.id = ba.bank_id
  INNER JOIN public.account_types at ON at.id = ba.account_type_id
  INNER JOIN public.currencies c ON c.id = ba.currency_id
  WHERE rba.id = p_recipient_bank_account_id
    AND rba.is_active = true
    AND ba.is_active = true
    AND ba.deleted_at IS NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_remittance_bank_accounts_admin(p_remittance_id uuid)
RETURNS TABLE(remittance_id uuid, recipient_name text, recipient_phone text, bank_name text,
              account_type text, currency_code text, account_holder_name text,
              account_number_full text, account_number_last4 text, delivery_amount numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT is_admin_user() THEN
    RAISE EXCEPTION 'Access denied: admin role required';
  END IF;

  RETURN QUERY
  SELECT
    r.id AS remittance_id,
    rec.full_name AS recipient_name,
    rec.phone AS recipient_phone,
    b.name AS bank_name,
    at.name AS account_type,
    c.code AS currency_code,
    ba.account_holder_name,
    ba.account_number_full,
    ba.account_number_last4,
    r.delivery_amount
  FROM public.remittances r
  INNER JOIN public.recipients rec ON rec.id = r.recipient_id
  LEFT JOIN public.remittance_bank_transfers rbt ON rbt.remittance_id = r.id
  LEFT JOIN public.recipient_bank_accounts rba ON rba.id = rbt.recipient_bank_account_id
  LEFT JOIN public.bank_accounts ba ON ba.id = rba.bank_account_id
  LEFT JOIN public.banks b ON b.id = ba.bank_id
  LEFT JOIN public.account_types at ON at.id = ba.account_type_id
  LEFT JOIN public.currencies c ON c.id = ba.currency_id
  WHERE r.id = p_remittance_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_recipient_bank_account_full(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_remittance_bank_accounts_admin(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.get_recipient_bank_account_full(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_remittance_bank_accounts_admin(uuid) FROM anon;
