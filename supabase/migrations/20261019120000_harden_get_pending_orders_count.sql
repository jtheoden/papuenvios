-- ============================================================================
-- get_pending_orders_count(): staff-only caller check.                PREPARED, NOT APPLIED
-- ============================================================================
-- Problem: the function is SECURITY DEFINER and counts every pending order with NO caller check, so any
-- authenticated customer can call it through PostgREST (POST /rpc/get_pending_orders_count) and read the
-- platform-wide pending-orders count. Aggregate only (no rows, ids or personal data), hence low severity;
-- anon and PUBLIC were already revoked by 20261013180000_revoke_anon_secdef_rpcs.sql.
--
-- Fix: return the real count only to staff (is_admin_user(), which includes super_admin) and to callers
-- without a JWT subject (service_role / postgres). A customer gets 0, not an error, so a stale client never
-- breaks; the only front caller (Header.jsx via orderService.getPendingOrdersCount) already runs for
-- admin / super_admin only. search_path is pinned to public, pg_temp like the other hardened definers.
--
-- Grants: unchanged in effect (REVOKE from PUBLIC / anon, EXECUTE for authenticated and service_role).
-- Same signature and return type, so CREATE OR REPLACE is enough; idempotent.
--
-- Production verification (read-only, 2026-10-19): function exists, SECURITY DEFINER,
--   anon EXECUTE = false, authenticated EXECUTE = true, no is_admin_user() call in the body.
--
-- ROLLBACK (exact inverse: restores the previous body)
-- CREATE OR REPLACE FUNCTION public.get_pending_orders_count()
--  RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
-- AS $f$ SELECT COUNT(*)::integer FROM public.orders WHERE status = 'pending' OR payment_status = 'pending'; $f$;
-- ============================================================================

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
