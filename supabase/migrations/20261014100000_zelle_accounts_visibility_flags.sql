-- PR-10 / F5 (client observation #5): per-account control over whether a Zelle
-- account's email and phone are shown to customers.
--
-- Adds two INDEPENDENT flags to zelle_accounts plus a "at least one visible"
-- safeguard, and a SECURITY DEFINER RPC that returns only the customer-safe
-- shape of an active account (email/phone NULLed when their flag is false).
--
-- Defaults keep ALL current behavior: existing rows get show_email = true and
-- show_phone = true (fully visible). No data is modified.
--
-- NOT part of this migration (deliberate): the policy zelle_accounts_select_active
-- is left untouched. Customer-facing code still has direct SELECT paths to the
-- table (the ZelleAccountSelector list via getAllZelleAccounts, the realtime
-- subscription), so restricting the policy now would break checkout. Until a
-- follow-up moves the selector list to an RPC and replaces that policy with an
-- admin-only SELECT, an authenticated customer can still read email/phone through
-- a direct select. The flags + RPC are the foundation for that follow-up.
--
-- Idempotent: safe to run more than once.
--
-- Verification (read-only):
--   SELECT column_name, data_type, column_default, is_nullable
--   FROM information_schema.columns
--   WHERE table_schema = 'public' AND table_name = 'zelle_accounts'
--     AND column_name IN ('show_email', 'show_phone');
--   SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--   WHERE conname = 'zelle_accounts_at_least_one_contact_visible';
--   -- As a customer (non-admin): SELECT * FROM get_zelle_account_public('<active account id>');
--
-- Rollback:
--   DROP FUNCTION IF EXISTS public.get_zelle_account_public(uuid);
--   ALTER TABLE public.zelle_accounts DROP CONSTRAINT IF EXISTS zelle_accounts_at_least_one_contact_visible;
--   ALTER TABLE public.zelle_accounts DROP COLUMN IF EXISTS show_email;
--   ALTER TABLE public.zelle_accounts DROP COLUMN IF EXISTS show_phone;

BEGIN;

ALTER TABLE public.zelle_accounts
  ADD COLUMN IF NOT EXISTS show_email boolean NOT NULL DEFAULT true;

ALTER TABLE public.zelle_accounts
  ADD COLUMN IF NOT EXISTS show_phone boolean NOT NULL DEFAULT true;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'zelle_accounts_at_least_one_contact_visible'
      AND conrelid = 'public.zelle_accounts'::regclass
  ) THEN
    ALTER TABLE public.zelle_accounts
      ADD CONSTRAINT zelle_accounts_at_least_one_contact_visible
      CHECK (show_email OR show_phone);
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.get_zelle_account_public(p_id uuid)
 RETURNS TABLE (
   id uuid,
   account_name text,
   account_holder text,
   email text,
   phone text
 )
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path = public
AS $function$
  SELECT
    za.id,
    za.account_name,
    za.account_holder,
    CASE WHEN za.show_email THEN za.email ELSE NULL END,
    CASE WHEN za.show_phone THEN za.phone ELSE NULL END
  FROM zelle_accounts za
  WHERE za.id = p_id
    AND za.is_active = true
$function$;

REVOKE ALL ON FUNCTION public.get_zelle_account_public(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_zelle_account_public(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_zelle_account_public(uuid) TO authenticated, service_role;

COMMIT;
