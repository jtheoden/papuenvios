-- MANDATORY ORDER: M3 -> M2 -> M1 (this file is step 2 of 3).
-- ROLLBACK of 20261028100200_commission_acceptance_guard.sql. Proposals already closed stay closed.
BEGIN;

SET LOCAL lock_timeout = '5s';

-- Without the guard nothing enforces pending raises any more: dismiss their live alerts so the UI stops asking.
UPDATE public.user_alerts
   SET is_dismissed = true, dismissed_at = now(), action_required = false
 WHERE alert_type = 'commission_change_pending' AND NOT is_dismissed;

DROP TRIGGER IF EXISTS guard_commission_acceptance ON public.remittances;
DROP FUNCTION IF EXISTS public.guard_commission_acceptance();

COMMIT;
