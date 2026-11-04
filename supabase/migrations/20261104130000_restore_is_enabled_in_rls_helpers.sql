-- RLS-01: the five role helpers (is_admin_user, is_super_admin, is_admin, is_manager, current_user_role) must honour
-- user_profiles.is_enabled again.
--
-- WHY
--   A disabled admin / super_admin keeps full admin RLS access with a still-valid token, because production's
--   helpers do not check is_enabled. SEC-11 (20260910172412_sec11_is_enabled_checks.sql, applied in prod) had put
--   the check in. It was later undone out of band.
--
-- DRIFT FINDING (repo archaeology, 2026-11-04)
--   Live definitions are all `LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'` with
--   `SELECT COALESCE(role IN ('admin','super_admin'), false) FROM public.user_profiles WHERE id = auth.uid() LIMIT 1`
--   (is_super_admin: `COALESCE(role = 'super_admin', false)`; is_admin: `role = 'admin'`; is_manager: `role = 'manager'`;
--   current_user_role: `COALESCE(role, 'user')`). The only source in git history is
--   supabase/migrations/20261101180000_fix_rls_functions_security_definer.sql (commit bb8a9c50, cherry-picked in
--   48f6ac40), later DELETED from the repo by the e2e PR #144 (658bd94a) but registered/applied in prod. It replaced
--   SEC-11's plpgsql variants (to fix "permission denied for user_profiles") and dropped is_enabled. The rebuilt
--   local DB (supabase/e2e/base-public-schema.sql) is built from the pre-20261101180000 repo, hence the divergence.
--
-- WHAT
--   Five CREATE OR REPLACE FUNCTION. Same signature, LANGUAGE sql, STABLE, SECURITY DEFINER, SET search_path TO
--   'public' as live, so ACLs (CREATE OR REPLACE keeps them) and policy inlining are unchanged. Body adds
--   `AND is_enabled = true`. The lookup sits in a scalar subquery inside COALESCE so a caller with no profile row
--   (anon / NULL uid) gets false instead of NULL: the live bodies return NULL there, and `IF NOT is_admin_user()`
--   guards (plpgsql) treat NULL as "not true" and silently skip the RAISE.
--   current_user_role() returns 'user' for a disabled account (instead of its admin/manager role); with no profile
--   row it still returns NULL as before. Evidence it is safe: every use in the repo (policies of notification_settings,
--   products, etc.) only compares it to 'admin'/'super_admin' as a positive gate, nothing in src/ or the edge
--   functions calls it, and a disabled account is already cut off by the RESTRICTIVE *_block_disabled_user policies.
--   Check prod pg_policies/pg_proc for other consumers before applying (see report).
--
-- DATA
--   No row is read for write, inserted, updated or deleted. Prod today: 2 admins + 3 super_admins, all enabled, so
--   nobody's access changes. Only DISABLED admin/super_admin accounts lose access (the intended effect).
--
-- ROLLBACK
--   supabase/rollbacks/20261104130000_restore_is_enabled_in_rls_helpers_down.sql (restores the exact live bodies).
BEGIN;

SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.is_admin_user()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    (SELECT role IN ('admin', 'super_admin') AND is_enabled = true
       FROM public.user_profiles
      WHERE id = auth.uid()
      LIMIT 1),
    false);
$function$;

CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    (SELECT role = 'super_admin' AND is_enabled = true
       FROM public.user_profiles
      WHERE id = auth.uid()
      LIMIT 1),
    false);
$function$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    (SELECT role = 'admin' AND is_enabled = true
       FROM public.user_profiles
      WHERE id = auth.uid()
      LIMIT 1),
    false);
$function$;

CREATE OR REPLACE FUNCTION public.is_manager()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    (SELECT role = 'manager' AND is_enabled = true
       FROM public.user_profiles
      WHERE id = auth.uid()
      LIMIT 1),
    false);
$function$;

CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS text
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT CASE WHEN is_enabled = true THEN COALESCE(role, 'user') ELSE 'user' END
  FROM public.user_profiles
  WHERE id = auth.uid()
  LIMIT 1;
$function$;

COMMIT;
