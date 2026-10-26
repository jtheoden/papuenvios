-- ============================================================================
-- Commission client acceptance, M2: status guard trigger.   PREPARED, NOT APPLIED
-- ============================================================================
-- WHY: "accept" would be decorative if the customer could still upload the payment proof without answering a pending
--   commission RAISE; and a cancelled remittance must not keep an open proposal.
-- WHAT: BEFORE UPDATE OF status ON remittances (SECURITY DEFINER, ENABLE ALWAYS):
--     * entering payment_proof_uploaded with a 'pending' proposal -> 22023 commission_pending_acceptance
--       (the only way into that status is remittance_submit_proof / _remittance_transition, which is NOT modified:
--       its production body comes from 20261025110000);
--     * entering cancelled -> 'pending' proposals become 'cancelled' and their alert is dismissed.
--   Race safety: _remittance_transition, remittance_accept_commission and admin_set_remittance_commission all hold the
--   FOR UPDATE lock of the remittance row before this trigger reads or writes proposals.
-- Apply order: M1 (table) -> M2 -> M3. Requires M1 first. Rollback order: M3 -> M2 -> M1.
-- ROLLBACK: supabase/rollbacks/20261028100200_commission_acceptance_guard_down.sql (DROP TRIGGER / FUNCTION).
-- ============================================================================

BEGIN;

SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.guard_commission_acceptance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'payment_proof_uploaded' THEN
    IF EXISTS (SELECT 1 FROM public.remittance_commission_proposals
                WHERE remittance_id = NEW.id AND status = 'pending') THEN
      RAISE EXCEPTION 'commission_pending_acceptance' USING ERRCODE = '22023';
    END IF;
  ELSIF NEW.status = 'cancelled' THEN
    UPDATE public.remittance_commission_proposals
       SET status = 'cancelled', responded_at = now(), responded_by = auth.uid()
     WHERE remittance_id = NEW.id AND status = 'pending';
    UPDATE public.user_alerts
       SET is_dismissed = true, dismissed_at = now(), action_required = false
     WHERE metadata ->> 'remittanceId' = NEW.id::text
       AND alert_type = 'commission_change_pending' AND NOT is_dismissed;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.guard_commission_acceptance() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS guard_commission_acceptance ON public.remittances;
CREATE TRIGGER guard_commission_acceptance
  BEFORE UPDATE OF status ON public.remittances
  FOR EACH ROW EXECUTE FUNCTION public.guard_commission_acceptance();
ALTER TABLE public.remittances ENABLE ALWAYS TRIGGER guard_commission_acceptance;

COMMIT;
