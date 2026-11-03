-- ============================================================================
-- orders.user_id / remittances.user_id can never be reassigned by a direct PATCH.   PREPARED, NOT APPLIED
-- ============================================================================
-- WHY (RB-01 R1): authenticated holds UPDATE on every column of orders and remittances and the RLS policies
--   (orders_update, "admins can update all remittances") have no column restriction. guard_orders_owner_update /
--   guard_remittance_owner_update stop the customer-owner, but admins and super_admins pass them untouched, so an admin
--   (or a compromised admin session) can PATCH user_id and move any order / remittance to another account. No guard
--   mentions user_id.
--
-- WHAT: one BEFORE UPDATE OF user_id row trigger per table, backed by a small SECURITY INVOKER function (it reads
--   current_user, which a DEFINER function would replace by its owner):
--     guard_orders_user_id_immutable        -> 42501 'orders_user_id_immutable'
--     guard_remittances_user_id_immutable   -> 42501 'remittances_user_id_immutable'
--   * current_user in (authenticated, anon) = a direct PostgREST request (customer, admin, super_admin): a changed user_id
--     is rejected. Writing the same value back is allowed.
--   * Any other current_user passes: SECURITY DEFINER RPCs run as the function owner, and postgres / service_role /
--     supabase_admin are the maintenance paths. Same criterion as guard_orders_money_columns (20261102100000).
--   * No SQL function in supabase/migrations and no client code (src/, supabase/functions/) updates user_id of either table
--     after creation; the FK to auth.users is NO ACTION, so no referential action rewrites it. Nothing legitimate is blocked.
--   * ENABLE ALWAYS like the sibling money guards: it also fires under session_replication_role = replica.
--   * Own functions and own triggers (additive): _order_transition, _remittance_transition and every existing guard are
--     NOT redefined.
--
-- DATA: no row is read or written (DDL on functions and triggers only). Idempotent (CREATE OR REPLACE / DROP TRIGGER IF EXISTS).
-- Needs the owner's "dale" to apply remotely.
-- ROLLBACK (one transaction): supabase/rollbacks/20261103130000_orders_remittances_user_id_immutable_down.sql
--   DROP TRIGGER IF EXISTS guard_orders_user_id_immutable ON public.orders;
--   DROP TRIGGER IF EXISTS guard_remittances_user_id_immutable ON public.remittances;  (+ DROP FUNCTION of both)
-- ============================================================================

BEGIN;

SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.guard_orders_user_id_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF current_user IN ('authenticated', 'anon') AND NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'orders_user_id_immutable' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.guard_orders_user_id_immutable() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS guard_orders_user_id_immutable ON public.orders;
CREATE TRIGGER guard_orders_user_id_immutable
  BEFORE UPDATE OF user_id ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.guard_orders_user_id_immutable();
ALTER TABLE public.orders ENABLE ALWAYS TRIGGER guard_orders_user_id_immutable;

CREATE OR REPLACE FUNCTION public.guard_remittances_user_id_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF current_user IN ('authenticated', 'anon') AND NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'remittances_user_id_immutable' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.guard_remittances_user_id_immutable() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS guard_remittances_user_id_immutable ON public.remittances;
CREATE TRIGGER guard_remittances_user_id_immutable
  BEFORE UPDATE OF user_id ON public.remittances
  FOR EACH ROW EXECUTE FUNCTION public.guard_remittances_user_id_immutable();
ALTER TABLE public.remittances ENABLE ALWAYS TRIGGER guard_remittances_user_id_immutable;

COMMIT;
