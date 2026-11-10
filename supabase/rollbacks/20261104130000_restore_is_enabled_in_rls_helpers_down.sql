-- ROLLBACK of 20261104130000_restore_is_enabled_in_rls_helpers.sql: restores the exact LIVE production bodies
-- (no is_enabled check, NULL for a caller without profile). Function bodies only; ACLs and data are untouched.
-- Re-opens the hole where a disabled admin/super_admin keeps admin RLS access.
BEGIN;

SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.is_admin_user()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT COALESCE(role IN ('admin', 'super_admin'), false)
  FROM public.user_profiles
  WHERE id = auth.uid()
  LIMIT 1;
$function$;

CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT COALESCE(role = 'super_admin', false)
  FROM public.user_profiles
  WHERE id = auth.uid()
  LIMIT 1;
$function$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT COALESCE(role = 'admin', false)
  FROM public.user_profiles
  WHERE id = auth.uid()
  LIMIT 1;
$function$;

CREATE OR REPLACE FUNCTION public.is_manager()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT COALESCE(role = 'manager', false)
  FROM public.user_profiles
  WHERE id = auth.uid()
  LIMIT 1;
$function$;

CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS text
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT COALESCE(role, 'user')
  FROM public.user_profiles
  WHERE id = auth.uid()
  LIMIT 1;
$function$;

COMMIT;
