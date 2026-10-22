-- ============================================================================
-- Status changes only through the transition RPCs (W5b / E8).   PREPARED, NOT APPLIED
-- ============================================================================
-- ##########################################################################
-- #  APPLY LAST.  ONLY WHEN THE E6/E7 FRONT (status changes via order_* /  #
-- #  remittance_* RPCs) IS ALREADY LIVE IN VERCEL.                         #
-- #  Applied earlier, every status button of the OLD front (direct PATCH   #
-- #  on orders / remittances) fails with 42501 status_rpc_only.            #
-- ##########################################################################
--
-- WHY: the RPCs of E4/E5 own lock, matrix, stock effect and history, but a PostgREST PATCH of
--   orders.status / orders.payment_status / remittances.status by an authenticated user still bypasses all of
--   it (the owner/admin guards only restrict WHICH columns, not through WHICH path).
--
-- WHAT: BEFORE UPDATE triggers on orders and remittances (SECURITY INVOKER, so current_user is the caller's
--   role). When status / payment_status (orders) or status (remittances) changes and current_user is
--   authenticated or anon, the update is refused with 42501 'status_rpc_only'. Passes untouched for:
--   - the SECURITY DEFINER RPCs (current_user = postgres inside them);
--   - service_role / postgres / supabase_admin (cron, expire_stale_order_reservations, edge functions);
--   - any update that does not change those columns (delivery_proof_url, notes, ...).
--   INSERTs are not affected (checkout creates orders with status 'pending').
--
-- Idempotent. ROLLBACK: supabase/rollbacks/20261024120000_status_rpc_only_guard_down.sql (two DROP TRIGGER).
-- ============================================================================

BEGIN;

SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.guard_status_via_rpc()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'orders' THEN
    IF NEW.status IS DISTINCT FROM OLD.status OR NEW.payment_status IS DISTINCT FROM OLD.payment_status THEN
      RAISE EXCEPTION 'status_rpc_only' USING ERRCODE = '42501',
        DETAIL = 'orders.status and orders.payment_status change only through the order_* RPCs';
    END IF;
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'status_rpc_only' USING ERRCODE = '42501',
      DETAIL = 'remittances.status changes only through the remittance_* RPCs';
  END IF;

  RETURN NEW;
END;
$function$;

-- Trigger functions are never called by users; keep the grant surface closed like E2.
REVOKE ALL ON FUNCTION public.guard_status_via_rpc() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS guard_status_via_rpc ON public.orders;
CREATE TRIGGER guard_status_via_rpc
  BEFORE UPDATE OF status, payment_status ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.guard_status_via_rpc();

DROP TRIGGER IF EXISTS guard_status_via_rpc ON public.remittances;
CREATE TRIGGER guard_status_via_rpc
  BEFORE UPDATE OF status ON public.remittances
  FOR EACH ROW EXECUTE FUNCTION public.guard_status_via_rpc();

COMMIT;
