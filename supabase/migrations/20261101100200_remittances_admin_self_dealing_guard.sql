-- ============================================================================
-- Admin self-dealing S3: an admin cannot run admin-only transitions on his OWN remittance.   PREPARED, NOT APPLIED
-- ============================================================================
-- WHY: same gap as S2 for _remittance_transition (validate/reject payment, processing, delivery, complete are role-only).
-- WHAT (_remittance_transition is NOT replaced): BEFORE UPDATE OF status ON remittances. It acts ONLY when
--   auth.uid() = remittances.user_id AND is_admin_user() and status changes; ALLOWLIST (what a customer can do), else
--   42501 admin_self_dealing_not_allowed:
--     submit_proof  payment_pending|payment_rejected -> payment_proof_uploaded
--     cancel        payment_pending|payment_rejected|payment_proof_uploaded -> cancelled
--   postgres / service_role / cron (auth.uid() NULL), customers and other admins are untouched.
--   Runs next to guard_commission_acceptance and guard_status_via_rpc (both unchanged).
-- ROLLBACK: supabase/rollbacks/20261101100200_remittances_admin_self_dealing_guard_down.sql (DROP TRIGGER / FUNCTION; no data).
-- ============================================================================

BEGIN;

SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.guard_remittances_admin_self_dealing()
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
    (OLD.status IN ('payment_pending', 'payment_rejected') AND NEW.status = 'payment_proof_uploaded')
    OR (OLD.status IN ('payment_pending', 'payment_rejected', 'payment_proof_uploaded') AND NEW.status = 'cancelled');

  IF NOT COALESCE(v_ok, false) THEN
    RAISE WARNING 'admin_self_dealing_blocked table=remittances % -> %', OLD.status, NEW.status;
    RAISE EXCEPTION 'admin_self_dealing_not_allowed' USING ERRCODE = '42501',
      DETAIL = 'an administrator cannot run this transition on his own remittance';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.guard_remittances_admin_self_dealing() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_remittances_admin_self_dealing ON public.remittances;
CREATE TRIGGER trg_remittances_admin_self_dealing
  BEFORE UPDATE OF status ON public.remittances
  FOR EACH ROW WHEN (NEW.status IS DISTINCT FROM OLD.status)
  EXECUTE FUNCTION public.guard_remittances_admin_self_dealing();
ALTER TABLE public.remittances ENABLE ALWAYS TRIGGER trg_remittances_admin_self_dealing;

COMMIT;
