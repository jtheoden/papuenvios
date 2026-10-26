-- ============================================================================
-- Admin self-dealing S2: an admin cannot run admin-only transitions on his OWN order.   PREPARED, NOT APPLIED
-- ============================================================================
-- WHY: _order_transition authorizes validate/reject/process/dispatch/deliver/complete by role only; an admin who is also
--   the customer could validate his own payment (plan_admin-self-dealing-guard.md, gap b).
-- WHAT (_order_transition is NOT replaced): BEFORE UPDATE OF status, payment_status ON orders. It acts ONLY when
--   auth.uid() = orders.user_id AND is_admin_user() and the row's status/payment_status changes; then an ALLOWLIST of what a
--   plain customer could do is enforced (fail-closed), anything else -> 42501 admin_self_dealing_not_allowed:
--     submit_proof  status pending -> pending, payment pending|rejected|proof_uploaded -> proof_uploaded
--     cancel        pending -> cancelled while payment <> validated (payment unchanged or -> rejected)
--     reopen        cancelled -> pending while payment pending|rejected|proof_uploaded (payment unchanged or -> pending)
--   auth.uid() is the JWT subject, so the trigger sees the real user inside SECURITY DEFINER RPCs. postgres / service_role /
--   cron (auth.uid() NULL), customers and other admins are untouched. The attempt is only logged (RAISE WARNING, no ids).
-- ROLLBACK: supabase/rollbacks/20261101100100_orders_admin_self_dealing_guard_down.sql (DROP TRIGGER / FUNCTION; no data).
-- ============================================================================

BEGIN;

SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.guard_orders_admin_self_dealing()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_ok boolean;
BEGIN
  IF v_uid IS NULL OR v_uid IS DISTINCT FROM OLD.user_id OR NOT public.is_admin_user() THEN
    RETURN NEW;
  END IF;

  v_ok :=
    -- submit_proof
    (OLD.status = 'pending' AND NEW.status = 'pending'
       AND OLD.payment_status IN ('pending', 'rejected', 'proof_uploaded') AND NEW.payment_status = 'proof_uploaded')
    -- cancel
    OR (OLD.status = 'pending' AND NEW.status = 'cancelled' AND OLD.payment_status <> 'validated'
       AND NEW.payment_status IN (OLD.payment_status, 'rejected'))
    -- reopen
    OR (OLD.status = 'cancelled' AND NEW.status = 'pending'
       AND OLD.payment_status IN ('pending', 'rejected', 'proof_uploaded')
       AND NEW.payment_status IN (OLD.payment_status, 'pending'));

  IF NOT COALESCE(v_ok, false) THEN
    RAISE WARNING 'admin_self_dealing_blocked table=orders % / % -> % / %',
      OLD.status, OLD.payment_status, NEW.status, NEW.payment_status;
    RAISE EXCEPTION 'admin_self_dealing_not_allowed' USING ERRCODE = '42501',
      DETAIL = 'an administrator cannot run this transition on his own order';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.guard_orders_admin_self_dealing() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_orders_admin_self_dealing ON public.orders;
CREATE TRIGGER trg_orders_admin_self_dealing
  BEFORE UPDATE OF status, payment_status ON public.orders
  FOR EACH ROW WHEN (NEW.status IS DISTINCT FROM OLD.status OR NEW.payment_status IS DISTINCT FROM OLD.payment_status)
  EXECUTE FUNCTION public.guard_orders_admin_self_dealing();
ALTER TABLE public.orders ENABLE ALWAYS TRIGGER trg_orders_admin_self_dealing;

COMMIT;
