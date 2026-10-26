-- ============================================================================
-- get_pending_orders_count: stop counting cancelled orders.   PREPARED, NOT APPLIED
-- ============================================================================
-- WHY: an admin cancel from pending/pending leaves payment_status = 'pending', so `status = 'pending' OR payment_status =
--   'pending'` kept counting the cancelled order in the admin badge forever. Only the predicate changes.
-- Live body, ACL and settings verified against production before writing (SELECT only): LANGUAGE sql, STABLE, SECURITY
--   DEFINER, SET search_path = public, pg_temp, ACL {postgres, authenticated, service_role}, body md5
--   9795f84533a81d45742aeb3347e5674f (identical to 20261019120000).
-- ROLLBACK: supabase/rollbacks/20261029100400_fix_pending_orders_count_cancelled_down.sql
-- Apply order: 20261029100000 .. 20261029100300 (refunds) are independent of this one; apply in filename order.
-- ============================================================================

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
           THEN (SELECT COUNT(*)::integer FROM public.orders
                  WHERE status <> 'cancelled' AND (status = 'pending' OR payment_status = 'pending'))
           ELSE 0
         END;
$function$;

REVOKE ALL ON FUNCTION public.get_pending_orders_count() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_pending_orders_count() TO authenticated, service_role;

COMMIT;
