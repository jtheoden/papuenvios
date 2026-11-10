-- ROLLBACK of 20261111120400_get_my_role_is_enabled.sql: restores the exact live body (a disabled admin reads as admin).
BEGIN;

SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS text
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    (SELECT role FROM user_profiles WHERE id = auth.uid() LIMIT 1),
    'user'
  )
$function$;

COMMIT;
