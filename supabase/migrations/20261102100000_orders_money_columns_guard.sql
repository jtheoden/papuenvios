-- ============================================================================
-- Order money columns can only change through RPCs, never by a direct PATCH.   PREPARED, NOT APPLIED
-- ============================================================================
-- WHY: the policy orders_update has no WITH CHECK and guard_orders_owner_update returns NEW for admins, so an admin (or a
--   compromised admin session) can PATCH total_amount / subtotal / payment_amount ... straight through PostgREST. The
--   financial audit trail (audit_financial_update) RECORDS such a change but does not prevent it. status and
--   payment_status are already RPC-only (guard_status_via_rpc); this closes the money columns, mirroring
--   guard_remittance_money_columns (20261023110000).
--
-- WHAT: trigger guard_orders_money_columns, BEFORE UPDATE FOR EACH ROW, SECURITY INVOKER (it needs current_user, which a
--   DEFINER function would replace by its owner).
--   * current_user in (authenticated, anon) = a direct PostgREST request, admin, super_admin or owner: if a column of
--     financial_audit_columns('orders') changes it raises 42501 'order_money_columns_rpc_only: column <c>'. The list is
--     the single source of truth (a column added to the audit list is guarded too).
--   * Any other current_user passes: SECURITY DEFINER RPCs run as the function owner, and postgres / service_role /
--     supabase_admin are the maintenance paths. Same criterion as guard_status_via_rpc.
--   * No exception for shipping_zone_id / currency_id: their FKs are NO ACTION (verified in production), so no
--     referential action rewrites them.
--   * ENABLE ALWAYS: it also fires under session_replication_role = replica.
--   * The invoker cannot execute financial_audit_columns() (privileges pinned by the audit tests), so the guard reads
--     the list through order_money_columns(), a SECURITY DEFINER wrapper returning the same list (names only).
--   * Does not touch _order_transition, _remittance_transition or any other live body (test: md5 of prosrc).
--
-- Verified before writing: no client code updates orders (only .insert in orderService.js), no edge function or script
--   does, and no SQL function in production or in supabase/migrations updates a money column of orders.
--   Re-run both greps against main and `prosrc ~* 'update\s+(only\s+)?(public\.)?orders'` against production right before applying.
--
-- Preconditions: financial_audit_columns() (20261020100000). Idempotent. Needs the owner's "dale" to apply remotely.
-- ROLLBACK (one line): DROP TRIGGER IF EXISTS guard_orders_money_columns ON public.orders;
--   (supabase/rollbacks/20261102100000_orders_money_columns_guard_down.sql)
-- ============================================================================

BEGIN;

SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.order_money_columns()
RETURNS text[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT public.financial_audit_columns('orders');
$function$;

REVOKE ALL ON FUNCTION public.order_money_columns() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.order_money_columns() TO authenticated;

CREATE OR REPLACE FUNCTION public.guard_orders_money_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_old jsonb;
  v_new jsonb;
  v_col text;
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW; -- SECURITY DEFINER RPCs (function owner), postgres, service_role, supabase_admin
  END IF;
  v_old := to_jsonb(OLD);
  v_new := to_jsonb(NEW);
  FOREACH v_col IN ARRAY public.order_money_columns() LOOP
    IF (v_old -> v_col) IS DISTINCT FROM (v_new -> v_col) THEN
      RAISE EXCEPTION 'order_money_columns_rpc_only: column %', v_col USING ERRCODE = '42501';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.guard_orders_money_columns() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS guard_orders_money_columns ON public.orders;
CREATE TRIGGER guard_orders_money_columns
  BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.guard_orders_money_columns();
ALTER TABLE public.orders ENABLE ALWAYS TRIGGER guard_orders_money_columns;

COMMIT;
