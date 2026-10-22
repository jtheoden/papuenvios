-- Rollback of 20261024110100_remittance_transition_rpcs.sql.
-- Revert the front of E7 in Vercel FIRST (redeploy the previous commit), otherwise every remittance status button breaks.
BEGIN;
SET LOCAL lock_timeout = '5s';

DROP FUNCTION IF EXISTS public.remittance_submit_proof(uuid, text, text, text, text);
DROP FUNCTION IF EXISTS public.remittance_cancel(uuid, text);
DROP FUNCTION IF EXISTS public.remittance_validate_payment(uuid);
DROP FUNCTION IF EXISTS public.remittance_reject_payment(uuid, text);
DROP FUNCTION IF EXISTS public.remittance_start_processing(uuid);
DROP FUNCTION IF EXISTS public.remittance_confirm_delivery(uuid, text, text);
DROP FUNCTION IF EXISTS public.remittance_complete(uuid, text);
DROP FUNCTION IF EXISTS public._remittance_transition(uuid, text, jsonb);

-- Previous body, verbatim from pg_get_functiondef (no notes column in the insert).
CREATE OR REPLACE FUNCTION public.audit_remittance_status_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF (TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status) THEN
    INSERT INTO remittance_status_history (
      remittance_id,
      old_status,
      new_status,
      changed_by,
      created_at
    ) VALUES (
      NEW.id,
      OLD.status,
      NEW.status,
      auth.uid(),
      NOW()
    );
  END IF;
  RETURN NEW;
END;
$function$;

COMMIT;
