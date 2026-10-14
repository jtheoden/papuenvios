-- Zelle public list RPC (follow-up of PR-10 / F5, step 1 of 2).
--
-- ROLLOUT ORDER (read before applying):
--   1. Apply THIS migration (additive, safe at any time: nothing reads it yet and
--      no existing policy/grant changes).
--   2. Deploy the frontend that calls list_zelle_accounts_public
--      (src/lib/zelleService.js -> getZelleAccountsForCustomer, used by
--      ZelleAccountSelector).
--   3. ONLY THEN apply 20261014140000_zelle_accounts_select_admin_only.sql, which
--      removes customers' direct SELECT on zelle_accounts. Applying it before step 2
--      breaks checkout/remittances for the still-deployed old frontend.
--
-- What it does: adds a SECURITY DEFINER RPC returning the active Zelle accounts a
-- customer may pay into, with email/phone NULLed when the admin hid them
-- (show_email / show_phone). It returns ONLY what customer-facing UI needs
-- (selector + payment display); it never exposes limits, usage amounts, bank name,
-- notes or timestamps.
--
-- p_usage: NULL (all active accounts), 'products' or 'remittances' (filters on
-- for_products / for_remittances). Any other value raises 22023 (no dynamic SQL).
--
-- Idempotent: safe to run more than once.
--
-- Verification (read-only), as a customer (non-admin):
--   SELECT * FROM public.list_zelle_accounts_public('products');
--   SELECT * FROM public.list_zelle_accounts_public('bogus');  -- raises 22023
--
-- Rollback:
--   DROP FUNCTION IF EXISTS public.list_zelle_accounts_public(text);

BEGIN;

CREATE OR REPLACE FUNCTION public.list_zelle_accounts_public(p_usage text DEFAULT NULL)
 RETURNS TABLE (
   id uuid,
   account_name text,
   account_holder text,
   email text,
   phone text,
   priority_order integer,
   for_products boolean,
   for_remittances boolean
 )
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path = public
AS $function$
BEGIN
  IF p_usage IS NOT NULL AND p_usage NOT IN ('products', 'remittances') THEN
    RAISE EXCEPTION 'invalid p_usage: %', p_usage USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT
    za.id,
    za.account_name,
    za.account_holder,
    CASE WHEN za.show_email THEN za.email ELSE NULL END,
    CASE WHEN za.show_phone THEN za.phone ELSE NULL END,
    za.priority_order,
    za.for_products,
    za.for_remittances
  FROM zelle_accounts za
  WHERE za.is_active = true
    AND (
      p_usage IS NULL
      OR (p_usage = 'products' AND za.for_products = true)
      OR (p_usage = 'remittances' AND za.for_remittances = true)
    )
  ORDER BY za.priority_order ASC, za.account_name ASC;
END;
$function$;

REVOKE ALL ON FUNCTION public.list_zelle_accounts_public(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_zelle_accounts_public(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.list_zelle_accounts_public(text) TO authenticated, service_role;

COMMIT;
