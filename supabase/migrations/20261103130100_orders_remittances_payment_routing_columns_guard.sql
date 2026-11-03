-- ============================================================================
-- Payment-routing columns of orders / remittances can only change through RPCs.   PREPARED, NOT APPLIED
-- ============================================================================
-- WHY (RB-01 R2): authenticated holds UPDATE on every column. guard_orders_owner_update / guard_remittance_owner_update
--   already stop the customer-owner, but an admin (or a compromised admin session) can PATCH where the money is sent:
--   payment_method / zelle_account_id (orders, remittances), bizum_account_id / payment_quote_id (orders) and
--   zelle_transaction_id / recipient_bank_account_id (remittances). guard_bizum_quote_immutable covers only orders whose
--   OLD.payment_method is 'bizum'; the money guards' lists (order_money_columns / remittance_money_columns) cover none
--   of these columns.
--
-- WHAT: one BEFORE UPDATE row trigger per table, SECURITY INVOKER (it reads current_user):
--     guard_orders_payment_routing_columns       -> 42501 'order_payment_routing_columns_rpc_only: column <c>'
--     guard_remittances_payment_routing_columns  -> 42501 'remittance_payment_routing_columns_rpc_only: column <c>'
--   Same shape as guard_orders_money_columns: current_user in (authenticated, anon) and a listed column changed ->
--   reject; anything else (SECURITY DEFINER RPC owners, postgres, service_role, supabase_admin) passes; writing the same
--   value back is allowed; ENABLE ALWAYS.
--   Why a NEW function and not extending order_money_columns() / remittance_money_columns(): those lists mirror
--   financial_audit_columns() (single source of truth for the audit log); adding routing columns there would also change
--   what the audit trigger records (a behaviour change on a live, audited path). A separate hard-coded list is additive
--   and rolls back by itself.
--   Columns: orders = payment_method, zelle_account_id, bizum_account_id, payment_quote_id;
--            remittances = payment_method, zelle_account_id, zelle_transaction_id, recipient_bank_account_id
--   (taken from the live schema; remittances has no bizum / quote column yet).
--
-- Verified before writing (rg against this repo; repeat against main and prod right before applying):
--   * src/ never UPDATEs orders or remittances columns of this list (only INSERT at creation, and
--     delivery_proof_url on remittances); supabase/functions/ does not touch them.
--   * no SQL function in supabase/migrations UPDATEs them after creation: the order / remittance transition RPCs, the
--     commission / recalculate / refund RPCs and the sealing trigger (BEFORE INSERT) never set them in an UPDATE.
--     Any such RPC would run as its owner and pass anyway. supabase/maintenance/20261026_merge_duplicate_recipients.sql
--     rewrites remittances.recipient_bank_account_id as postgres: passes.
--   * INSERT is untouched (UPDATE-only triggers).
--
-- DATA: no row is read or written (DDL on functions and triggers only). Idempotent. Needs the owner's "dale" to apply.
-- ROLLBACK (one transaction): supabase/rollbacks/20261103130100_orders_remittances_payment_routing_columns_guard_down.sql
--   DROP TRIGGER IF EXISTS guard_orders_payment_routing_columns ON public.orders;
--   DROP TRIGGER IF EXISTS guard_remittances_payment_routing_columns ON public.remittances;  (+ DROP FUNCTION of both)
-- ============================================================================

BEGIN;

SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.guard_orders_payment_routing_columns()
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
  FOREACH v_col IN ARRAY ARRAY['payment_method', 'zelle_account_id', 'bizum_account_id', 'payment_quote_id'] LOOP
    IF (v_old -> v_col) IS DISTINCT FROM (v_new -> v_col) THEN
      RAISE EXCEPTION 'order_payment_routing_columns_rpc_only: column %', v_col USING ERRCODE = '42501';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.guard_orders_payment_routing_columns() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS guard_orders_payment_routing_columns ON public.orders;
CREATE TRIGGER guard_orders_payment_routing_columns
  BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.guard_orders_payment_routing_columns();
ALTER TABLE public.orders ENABLE ALWAYS TRIGGER guard_orders_payment_routing_columns;

CREATE OR REPLACE FUNCTION public.guard_remittances_payment_routing_columns()
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
  FOREACH v_col IN ARRAY ARRAY['payment_method', 'zelle_account_id', 'zelle_transaction_id', 'recipient_bank_account_id'] LOOP
    IF (v_old -> v_col) IS DISTINCT FROM (v_new -> v_col) THEN
      RAISE EXCEPTION 'remittance_payment_routing_columns_rpc_only: column %', v_col USING ERRCODE = '42501';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.guard_remittances_payment_routing_columns() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS guard_remittances_payment_routing_columns ON public.remittances;
CREATE TRIGGER guard_remittances_payment_routing_columns
  BEFORE UPDATE ON public.remittances
  FOR EACH ROW EXECUTE FUNCTION public.guard_remittances_payment_routing_columns();
ALTER TABLE public.remittances ENABLE ALWAYS TRIGGER guard_remittances_payment_routing_columns;

COMMIT;
