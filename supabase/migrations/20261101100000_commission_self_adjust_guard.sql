-- ============================================================================
-- Admin self-dealing S1: nobody adjusts the commission of his OWN remittance.   PREPARED, NOT APPLIED
-- ============================================================================
-- WHY: admin_set_remittance_commission only requires an admin role; an admin who is also the customer could lower
--   (or raise and then accept) the commission of his own remittance (plan_admin-self-dealing-guard.md, gaps a and c).
-- WHAT (no live function is replaced):
--   * BEFORE INSERT ON remittance_commission_overrides: set_by = remittances.user_id -> 42501 commission_self_adjust_not_allowed.
--     The RPC inserts the override first, so the exception rolls the whole call back (no override, proposal, alert or update).
--   * BEFORE UPDATE OF status ON remittance_commission_proposals: accepting a proposal whose created_by = responded_by -> same error
--     (belt and braces: unreachable once the first trigger is in place, covers historical or manually inserted rows).
--   Another admin adjusts normally; customers and service_role are unaffected. The blocked attempt is only logged (RAISE WARNING,
--   no ids): an exception rolls back any audit row.
-- ROLLBACK: supabase/rollbacks/20261101100000_commission_self_adjust_guard_down.sql (DROP TRIGGER / FUNCTION; no data involved).
-- ============================================================================

BEGIN;

SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.guard_commission_self_adjust()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF NEW.set_by IS NOT NULL
     AND NEW.set_by IS NOT DISTINCT FROM (SELECT r.user_id FROM public.remittances r WHERE r.id = NEW.remittance_id) THEN
    RAISE WARNING 'commission_self_adjust_blocked';
    RAISE EXCEPTION 'commission_self_adjust_not_allowed' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.guard_commission_accept_self()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF NEW.created_by IS NOT NULL AND NEW.created_by IS NOT DISTINCT FROM NEW.responded_by THEN
    RAISE WARNING 'commission_self_accept_blocked';
    RAISE EXCEPTION 'commission_self_adjust_not_allowed' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.guard_commission_self_adjust() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_commission_accept_self() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_commission_override_self_adjust ON public.remittance_commission_overrides;
CREATE TRIGGER trg_commission_override_self_adjust
  BEFORE INSERT ON public.remittance_commission_overrides
  FOR EACH ROW EXECUTE FUNCTION public.guard_commission_self_adjust();
ALTER TABLE public.remittance_commission_overrides ENABLE ALWAYS TRIGGER trg_commission_override_self_adjust;

DROP TRIGGER IF EXISTS trg_commission_accept_self ON public.remittance_commission_proposals;
CREATE TRIGGER trg_commission_accept_self
  BEFORE UPDATE OF status ON public.remittance_commission_proposals
  FOR EACH ROW WHEN (NEW.status = 'accepted' AND OLD.status IS DISTINCT FROM 'accepted')
  EXECUTE FUNCTION public.guard_commission_accept_self();
ALTER TABLE public.remittance_commission_proposals ENABLE ALWAYS TRIGGER trg_commission_accept_self;

COMMIT;
