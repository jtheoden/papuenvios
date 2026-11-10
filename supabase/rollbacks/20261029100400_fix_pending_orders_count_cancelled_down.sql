-- ROLLBACK of 20261029100400_fix_pending_orders_count_cancelled.sql: restores the body of 20261019120000 (counts cancelled
-- orders that still have payment_status = 'pending'). Same signature, settings and grants.
BEGIN;

SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.get_pending_orders_count()
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT CASE
           WHEN auth.uid() IS NULL OR public.is_admin_user()
           THEN (SELECT COUNT(*)::integer FROM public.orders WHERE status = 'pending' OR payment_status = 'pending')
           ELSE 0
         END;
$function$;

REVOKE ALL ON FUNCTION public.get_pending_orders_count() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_pending_orders_count() TO authenticated, service_role;

COMMIT;
