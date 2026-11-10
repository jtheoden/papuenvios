-- Emergency hardening:
--  1. user_profiles: an authenticated non-super-admin could UPDATE its own row
--     (users_can_update_own_profile) including role/is_enabled => self escalation.
--     Also INSERT own row (user_profiles_insert_own) with any role.
--  2. platform_reset_control was left armed (enabled = true).
-- Rollback:
--   DROP TRIGGER IF EXISTS guard_user_profiles_privileged_update ON public.user_profiles;
--   DROP TRIGGER IF EXISTS guard_user_profiles_privileged_insert ON public.user_profiles;
--   DROP FUNCTION IF EXISTS public.guard_user_profiles_privileged_columns();

CREATE OR REPLACE FUNCTION public.guard_user_profiles_privileged_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  -- Trusted contexts: DB owner roles, server-side calls without JWT, super admins.
  IF current_user IN ('postgres', 'service_role', 'supabase_admin')
     OR auth.uid() IS NULL
     OR public.is_super_admin() THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.role IS DISTINCT FROM 'user' OR COALESCE(NEW.is_enabled, true) IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'role/is_enabled can only be set by a super admin'
        USING ERRCODE = '42501';
    END IF;
  ELSIF NEW.role IS DISTINCT FROM OLD.role
     OR NEW.is_enabled IS DISTINCT FROM OLD.is_enabled THEN
    RAISE EXCEPTION 'role/is_enabled can only be changed by a super admin'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.guard_user_profiles_privileged_columns() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS guard_user_profiles_privileged_update ON public.user_profiles;
CREATE TRIGGER guard_user_profiles_privileged_update
  BEFORE UPDATE ON public.user_profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_user_profiles_privileged_columns();

DROP TRIGGER IF EXISTS guard_user_profiles_privileged_insert ON public.user_profiles;
CREATE TRIGGER guard_user_profiles_privileged_insert
  BEFORE INSERT ON public.user_profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_user_profiles_privileged_columns();

UPDATE public.platform_reset_control SET enabled = false, updated_at = now() WHERE id = 1;
