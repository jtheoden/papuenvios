-- Zelle usage computed from real orders/remittances (replaces mutable counters).
--
-- PROBLEM
--   Usage was tracked in zelle_accounts.current_daily_amount / current_monthly_amount,
--   incremented only by reserve_zelle_account (SECURITY INVOKER: returns NULL for
--   customers because RLS blocks FOR UPDATE; with a 0 limit it returns NULL for
--   everyone) and decremented by update_zelle_account_usage (admin). No cron resets
--   them, manually picked accounts never touch them, so they drift forever.
--   Making reserve SECURITY DEFINER would let any logged-in user burn a limit by
--   calling it with large amounts.
--
-- DESIGN (limits are ADVISORY: nothing blocks a payment or an order)
--   Usage is DERIVED, never stored. Everything lives in ONE place:
--     zelle_account_usage(p_account_id)   usage per account (daily + monthly)
--     zelle_account_capacity(p_amount)    usage + "does p_amount fit?" per account
--   and the public functions are thin wrappers over them:
--     select_available_zelle_account      read-only pick for auto-assignment
--     list_zelle_accounts_public          customer list + advisory `available`
--     get_zelle_accounts_usage            admin-only usage per account
--
-- ASSUMPTIONS (each one is a single extension point for another payment method,
-- e.g. Bizum = EUR + phone number, or another currency):
--   1. Zelle-only: movements are read from orders.zelle_account_id and
--      remittances.zelle_account_id. Another method needs its own source in the
--      `movements` CTE of zelle_account_usage (or its own account table + usage fn).
--   2. Amounts are USD: v_currency constant in zelle_account_usage. Orders are
--      summed only when currencies.code = v_currency; remittances only when
--      currency_sent = v_currency. Nothing is converted. Another currency needs a
--      conversion (or a per-method usage function) there.
--   3. Day/month windows use America/New_York: v_tz constant in zelle_account_usage.
--   4. The cap rule (daily/monthly/security) lives only in zelle_account_capacity;
--      the `available` flag of the list RPC and the pick both inherit it.
--
-- USAGE RULES (verified against live data and application code)
--   Orders  : sum(total_amount) of orders with zelle_account_id = account, EXCLUDING
--             status = 'cancelled' (orderService reject-payment sets cancelled +
--             payment_status 'rejected') and payment_status = 'rejected'.
--             Pending / proof_uploaded / validated / processing / dispatched /
--             delivered / completed all count.
--   Remits  : sum(amount_sent + COALESCE(delivery_cost,0)) = calcTotalToPay in
--             src/lib/remittanceCalculations.js (what the customer actually pays via
--             Zelle; commission is taken out of the delivered amount, not added),
--             EXCLUDING status IN ('cancelled','payment_rejected').
--   Time    : created_at of the order/remittance. Window start =
--             date_trunc('day'|'month', now() AT TIME ZONE tz) AT TIME ZONE tz.
--   Live DB at authoring time: every order with a zelle_account_id has currency USD
--   and every remittance has currency_sent USD (no non-USD data found).
--
-- LIMIT SEMANTICS
--   daily_limit / monthly_limit / security_limit: NULL or 0 = no cap. The admin form
--                    writes 0 by default and its helper text says "0 or empty = no cap",
--                    so a literal-0 cap would make every newly created account
--                    unselectable. (Behavior change vs the old counters, which treated
--                    0 as a literal cap; no active live account has a 0 limit.)
--                    security_limit is compared against DAILY usage (as before).
--   Pick order : priority_order, then lowest computed daily usage, then account_name
--                (last_used_at is no longer maintained).
--
-- ROLLOUT ORDER
--   Apply this migration BEFORE the frontend deploy. It is additive and safe for the
--   deployed old frontend: reserve_zelle_account, get_zelle_account_public and
--   update_zelle_account_usage are untouched; list_zelle_accounts_public keeps its
--   named param p_usage and all old columns in the same order (`available` is
--   appended and p_amount is defaulted), so an old call with only p_usage works.
--   reserve_zelle_account and the counter columns are DEPRECATED (kept, unused by
--   the new frontend).
--
-- VERIFICATION (read-only)
--   SELECT * FROM public.zelle_account_usage();            -- service_role / owner only
--   SELECT * FROM public.get_zelle_accounts_usage();       -- as admin
--   SELECT * FROM public.list_zelle_accounts_public('products', 100);
--   SELECT public.select_available_zelle_account('product', 100);
--
-- ROLLBACK
--   DROP FUNCTION IF EXISTS public.get_zelle_accounts_usage();
--   DROP FUNCTION IF EXISTS public.list_zelle_accounts_public(text, numeric);
--   -- then re-create list_zelle_accounts_public(text) from
--   -- 20261014130000_zelle_accounts_list_public_rpc.sql and
--   -- select_available_zelle_account from 20241001000000_complete_schema.sql
--   DROP FUNCTION IF EXISTS public.zelle_account_capacity(numeric);
--   DROP FUNCTION IF EXISTS public.zelle_account_usage(uuid);

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Usage (single source of truth). Internal: not callable by API roles.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.zelle_account_usage(p_account_id uuid DEFAULT NULL)
 RETURNS TABLE (account_id uuid, daily_usage numeric, monthly_usage numeric)
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path = public
AS $function$
DECLARE
  v_tz       constant text := 'America/New_York';
  v_currency constant text := 'USD';
  v_day0     timestamptz;
  v_month0   timestamptz;
BEGIN
  v_day0   := date_trunc('day',   now() AT TIME ZONE v_tz) AT TIME ZONE v_tz;
  v_month0 := date_trunc('month', now() AT TIME ZONE v_tz) AT TIME ZONE v_tz;

  RETURN QUERY
  WITH movements AS (
    SELECT o.zelle_account_id AS aid, o.created_at AS ts, o.total_amount AS amt
    FROM orders o
    JOIN currencies c ON c.id = o.currency_id
    WHERE o.zelle_account_id IS NOT NULL
      AND c.code = v_currency
      AND o.status IS DISTINCT FROM 'cancelled'
      AND o.payment_status IS DISTINCT FROM 'rejected'
      AND o.created_at >= v_month0
    UNION ALL
    SELECT r.zelle_account_id, r.created_at, r.amount_sent + COALESCE(r.delivery_cost, 0)
    FROM remittances r
    WHERE r.zelle_account_id IS NOT NULL
      AND r.currency_sent = v_currency
      AND r.status NOT IN ('cancelled', 'payment_rejected')
      AND r.created_at >= v_month0
  )
  SELECT za.id,
         COALESCE(SUM(m.amt) FILTER (WHERE m.ts >= v_day0), 0)::numeric,
         COALESCE(SUM(m.amt), 0)::numeric
  FROM zelle_accounts za
  LEFT JOIN movements m ON m.aid = za.id
  WHERE p_account_id IS NULL OR za.id = p_account_id
  GROUP BY za.id;
END;
$function$;

REVOKE ALL ON FUNCTION public.zelle_account_usage(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.zelle_account_usage(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 2. Capacity: usage + advisory cap rule (single place for the cap semantics).
--    p_amount NULL => fits = true.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.zelle_account_capacity(p_amount numeric DEFAULT NULL)
 RETURNS TABLE (account_id uuid, daily_usage numeric, monthly_usage numeric, fits boolean)
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path = public
AS $function$
  SELECT za.id,
         u.daily_usage,
         u.monthly_usage,
         (
           p_amount IS NULL
           OR (
             (COALESCE(za.daily_limit, 0)    = 0 OR u.daily_usage   + p_amount <= za.daily_limit)
             AND (COALESCE(za.monthly_limit, 0)  = 0 OR u.monthly_usage + p_amount <= za.monthly_limit)
             AND (COALESCE(za.security_limit, 0) = 0 OR u.daily_usage   + p_amount <= za.security_limit)
           )
         )
  FROM zelle_accounts za
  JOIN public.zelle_account_usage() u ON u.account_id = za.id
$function$;

REVOKE ALL ON FUNCTION public.zelle_account_capacity(numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.zelle_account_capacity(numeric) TO service_role;

-- ---------------------------------------------------------------------------
-- 3. Read-only auto-assignment pick.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.select_available_zelle_account(p_transaction_type character varying, p_amount numeric)
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path = public
AS $function$
DECLARE
  v_account_id uuid;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'p_amount must be a positive number' USING ERRCODE = '22023';
  END IF;
  IF p_transaction_type IS NULL OR p_transaction_type NOT IN ('remittance', 'product', 'combo') THEN
    RAISE EXCEPTION 'invalid p_transaction_type: %', p_transaction_type USING ERRCODE = '22023';
  END IF;

  SELECT za.id INTO v_account_id
  FROM zelle_accounts za
  JOIN public.zelle_account_capacity(p_amount) cap ON cap.account_id = za.id
  WHERE za.is_active = true
    AND cap.fits
    AND (
      (p_transaction_type = 'remittance' AND za.for_remittances = true)
      OR (p_transaction_type IN ('product', 'combo') AND za.for_products = true)
    )
  ORDER BY za.priority_order ASC, cap.daily_usage ASC, za.account_name ASC
  LIMIT 1;

  RETURN v_account_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.select_available_zelle_account(character varying, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.select_available_zelle_account(character varying, numeric) TO authenticated, service_role;

COMMENT ON FUNCTION public.reserve_zelle_account(character varying, numeric) IS
  'DEPRECATED: mutable counters drift (no reset job, manual picks bypass them). Replaced by the '
  'read-only select_available_zelle_account over computed usage (zelle_account_usage). Kept only '
  'so the previously deployed frontend keeps working; do not call from new code.';

-- ---------------------------------------------------------------------------
-- 4. Customer list with advisory availability.
--    Replaces list_zelle_accounts_public(text): a defaulted extra param via
--    CREATE OR REPLACE would create an ambiguous overload and RETURNS TABLE
--    cannot change in place.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.list_zelle_accounts_public(text);

CREATE FUNCTION public.list_zelle_accounts_public(p_usage text DEFAULT NULL, p_amount numeric DEFAULT NULL)
 RETURNS TABLE (
   id uuid,
   account_name text,
   account_holder text,
   email text,
   phone text,
   priority_order integer,
   for_products boolean,
   for_remittances boolean,
   available boolean
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
  IF p_amount IS NOT NULL AND p_amount < 0 THEN
    RAISE EXCEPTION 'p_amount must not be negative' USING ERRCODE = '22023';
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
    za.for_remittances,
    cap.fits
  FROM zelle_accounts za
  JOIN public.zelle_account_capacity(p_amount) cap ON cap.account_id = za.id
  WHERE za.is_active = true
    AND (
      p_usage IS NULL
      OR (p_usage = 'products' AND za.for_products = true)
      OR (p_usage = 'remittances' AND za.for_remittances = true)
    )
  ORDER BY za.priority_order ASC, za.account_name ASC;
END;
$function$;

REVOKE ALL ON FUNCTION public.list_zelle_accounts_public(text, numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_zelle_accounts_public(text, numeric) FROM anon;
GRANT EXECUTE ON FUNCTION public.list_zelle_accounts_public(text, numeric) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Admin-only usage per account.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_zelle_accounts_usage()
 RETURNS TABLE (id uuid, daily_usage numeric, monthly_usage numeric)
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path = public
AS $function$
BEGIN
  IF NOT (public.is_admin_user() OR public.is_super_admin()) THEN
    RAISE EXCEPTION 'insufficient privileges' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT u.account_id, u.daily_usage, u.monthly_usage
  FROM public.zelle_account_usage() u;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_zelle_accounts_usage() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_zelle_accounts_usage() TO authenticated, service_role;

COMMIT;
