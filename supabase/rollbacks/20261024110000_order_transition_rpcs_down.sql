-- Rollback of 20261024110000_order_transition_rpcs.sql.
-- Revert the front of E6 in Vercel FIRST (redeploy the previous commit), otherwise every order status button breaks.
BEGIN;
SET LOCAL lock_timeout = '5s';

DROP FUNCTION IF EXISTS public.order_submit_proof(uuid, text, text, text);
DROP FUNCTION IF EXISTS public.order_validate_payment(uuid);
DROP FUNCTION IF EXISTS public.order_reject_payment(uuid, text);
DROP FUNCTION IF EXISTS public.order_start_processing(uuid);
DROP FUNCTION IF EXISTS public.order_dispatch(uuid, text);
DROP FUNCTION IF EXISTS public.order_mark_delivered(uuid, text);
DROP FUNCTION IF EXISTS public.order_complete(uuid, text);
DROP FUNCTION IF EXISTS public.order_cancel(uuid, text);
DROP FUNCTION IF EXISTS public.order_reopen(uuid);
DROP FUNCTION IF EXISTS public._order_transition(uuid, text, jsonb);

-- Previous body, verbatim from pg_get_functiondef (history rows only on a status change, no notes).
CREATE OR REPLACE FUNCTION public.audit_order_status_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF (TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status) THEN
    INSERT INTO order_status_history (
      order_id,
      previous_status,
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
