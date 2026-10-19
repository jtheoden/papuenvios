-- Disable a user with a reason (super_admin only) + database-level enforcement.
--
-- WHY: user_profiles.is_enabled existed, but it was only honoured by the browser (AuthContext signs the
--   session out). A disabled user with a still-valid JWT kept operating through PostgREST because no RLS
--   policy looked at is_enabled. There was also nowhere to record WHY a user was disabled.
--
-- WHAT:
--   1. user_profiles.disabled_reason / disabled_at / disabled_by (nullable, no FK so deleting the actor
--      never blocks) + a CHECK requiring a reason of >= 3 characters on every NEW disable.
--   2. guard_user_profiles_privileged_columns(): the three new columns are privileged like role/is_enabled
--      (only super_admin / service_role / postgres may change them directly).
--   3. set_user_enabled(p_user_id, p_enabled, p_reason): the only app path to (de)activate a user.
--      super_admin only, no self-disable, never leaves the platform without an enabled super_admin,
--      reason 3..500 chars on disable, idempotent, serialized with pg_advisory_xact_lock, audited in
--      activity_logs (user_disabled / user_enabled).
--   4. current_user_is_blocked() + one RESTRICTIVE "<table>_block_disabled_user" policy (TO authenticated,
--      FOR ALL) on the tables where an end user reads/writes their own business data.
--
-- DESIGN NOTES
--   * Policies use "blocked" (profile exists AND is_enabled IS FALSE), NOT the existing
--     current_user_is_enabled(): that one returns false when the profile row is missing, which would lock
--     out a brand-new user in the window between auth.users INSERT and the handle_new_user() trigger /
--     ensureProfile. Fail-open only for "no profile yet"; a disabled profile is always blocked.
--   * user_profiles is deliberately NOT restricted: AuthContext must read its own is_enabled to show
--     "Cuenta deshabilitada" and sign out.
--   * Admin / super_admin / service_role are unaffected as long as THEIR profile is enabled (is_admin_user()
--     already requires is_enabled = true). service_role and the table owner bypass RLS.
--   * LIMIT (documented, not fixed here): SECURITY DEFINER RPCs callable by customers (e.g.
--     create_bizum_quote) bypass RLS and are not covered by these policies. The complete fix is banning the
--     user in Supabase Auth (blocks login and token refresh); that needs an Edge Function with the service
--     key and is intentionally out of scope for this stage.
--   * Legacy: prod had 1 user with is_enabled = false and no reason (pre-dates this migration). The CHECK is
--     conditional on disabled_at, which only set_user_enabled() sets, so that row stays valid and untouched.
--
-- Prod pre-checks (read only, 2026-10-19): 41 profiles, 1 with is_enabled=false (no reason), 3 super_admin
--   all enabled, 3 auth.users without profile (hence the fail-open design), no NULL is_enabled,
--   activity_logs(action, entity_type, entity_id, performed_by text, description, metadata jsonb).
--
-- ROLLBACK (exact):
--   DO $$ DECLARE t text; BEGIN
--     FOREACH t IN ARRAY ARRAY['orders','order_items','order_status_history','remittances','remittance_status_history',
--       'recipients','recipient_addresses','recipient_bank_accounts','shopping_carts','cart_items','user_alerts','testimonials']
--     LOOP EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_block_disabled_user', t); END LOOP; END $$;
--   DROP FUNCTION IF EXISTS public.current_user_is_blocked();
--   DROP FUNCTION IF EXISTS public.set_user_enabled(uuid, boolean, text);
--   -- restore the previous guard body (role / is_enabled only): re-run the CREATE OR REPLACE of
--   -- guard_user_profiles_privileged_columns() from 20261014180000_user_profiles_role_guard_and_reset_disarm.sql
--   -- (previous body), then:
--   ALTER TABLE public.user_profiles DROP CONSTRAINT IF EXISTS user_profiles_disabled_reason_check;
--   ALTER TABLE public.user_profiles DROP COLUMN IF EXISTS disabled_reason, DROP COLUMN IF EXISTS disabled_at,
--     DROP COLUMN IF EXISTS disabled_by;
--   -- activity_logs rows (user_disabled / user_enabled) are history and are kept.

-- ----------------------------------------------------------------------------------------------------
-- 1. Columns + CHECK
-- ----------------------------------------------------------------------------------------------------
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS disabled_reason text,
  ADD COLUMN IF NOT EXISTS disabled_at     timestamptz,
  ADD COLUMN IF NOT EXISTS disabled_by     uuid;

ALTER TABLE public.user_profiles DROP CONSTRAINT IF EXISTS user_profiles_disabled_reason_check;
ALTER TABLE public.user_profiles
  ADD CONSTRAINT user_profiles_disabled_reason_check
  CHECK (
    is_enabled IS DISTINCT FROM false
    OR disabled_at IS NULL
    OR char_length(btrim(disabled_reason)) >= 3
  );

-- ----------------------------------------------------------------------------------------------------
-- 2. Profile guard: new columns are privileged too
-- ----------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_user_profiles_privileged_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF current_user IN ('postgres', 'service_role', 'supabase_admin')
     OR auth.uid() IS NULL
     OR public.is_super_admin() THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.role IS DISTINCT FROM 'user' OR COALESCE(NEW.is_enabled, true) IS DISTINCT FROM true
       OR NEW.disabled_reason IS NOT NULL OR NEW.disabled_at IS NOT NULL OR NEW.disabled_by IS NOT NULL THEN
      RAISE EXCEPTION 'role/is_enabled can only be set by a super admin'
        USING ERRCODE = '42501';
    END IF;
  ELSIF NEW.role IS DISTINCT FROM OLD.role
     OR NEW.is_enabled IS DISTINCT FROM OLD.is_enabled
     OR NEW.disabled_reason IS DISTINCT FROM OLD.disabled_reason
     OR NEW.disabled_at IS DISTINCT FROM OLD.disabled_at
     OR NEW.disabled_by IS DISTINCT FROM OLD.disabled_by THEN
    RAISE EXCEPTION 'role/is_enabled can only be changed by a super admin'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

-- ----------------------------------------------------------------------------------------------------
-- 3. RPC
-- ----------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_user_enabled(
  p_user_id uuid,
  p_enabled boolean,
  p_reason  text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_actor   uuid := auth.uid();
  v_reason  text := btrim(p_reason);
  v_target  public.user_profiles%ROWTYPE;
  v_now     timestamptz := now();
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE = '42501';
  END IF;
  IF p_user_id IS NULL OR p_enabled IS NULL THEN
    RAISE EXCEPTION 'user_invalid_arguments' USING ERRCODE = '22023';
  END IF;

  -- Serializes concurrent changes so two super_admins cannot disable each other at the same time.
  PERFORM pg_advisory_xact_lock(hashtext('user_enabled'));

  -- Re-check after the lock: the caller may have been disabled while waiting.
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE = '42501';
  END IF;

  IF NOT p_enabled THEN
    IF p_user_id = v_actor THEN
      RAISE EXCEPTION 'user_disable_self' USING ERRCODE = '22023';
    END IF;
    IF v_reason IS NULL OR char_length(v_reason) < 3 THEN
      RAISE EXCEPTION 'user_disable_reason_required' USING ERRCODE = '22023';
    END IF;
    IF char_length(v_reason) > 500 THEN
      RAISE EXCEPTION 'user_disable_reason_too_long' USING ERRCODE = '22023';
    END IF;
  END IF;

  SELECT * INTO v_target FROM public.user_profiles WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'user_not_found' USING ERRCODE = 'P0002';
  END IF;

  -- Idempotent: already in the requested state, nothing to write or audit.
  IF COALESCE(v_target.is_enabled, true) = p_enabled THEN
    RETURN jsonb_build_object('user_id', p_user_id, 'is_enabled', p_enabled, 'changed', false,
                              'disabled_reason', v_target.disabled_reason);
  END IF;

  -- Defensive: unreachable while the actor is an enabled super_admin other than the target, kept so the
  -- invariant survives a future change of the caller check.
  IF NOT p_enabled AND v_target.role = 'super_admin' AND NOT EXISTS (
       SELECT 1 FROM public.user_profiles
        WHERE role = 'super_admin' AND is_enabled = true AND id <> p_user_id) THEN
    RAISE EXCEPTION 'user_disable_last_super_admin' USING ERRCODE = '22023';
  END IF;

  IF p_enabled THEN
    UPDATE public.user_profiles
       SET is_enabled = true, disabled_reason = NULL, disabled_at = NULL, disabled_by = NULL
     WHERE id = p_user_id;
  ELSE
    UPDATE public.user_profiles
       SET is_enabled = false, disabled_reason = v_reason, disabled_at = v_now, disabled_by = v_actor
     WHERE id = p_user_id;
  END IF;

  INSERT INTO public.activity_logs (action, entity_type, entity_id, performed_by, description, metadata)
  VALUES (
    CASE WHEN p_enabled THEN 'user_enabled' ELSE 'user_disabled' END,
    'user_profile',
    p_user_id,
    COALESCE(v_actor::text, 'service_role'),
    CASE WHEN p_enabled THEN 'User enabled' ELSE 'User disabled' END,
    jsonb_build_object('actor_user_id', v_actor, 'target_user_id', p_user_id,
                       'reason', CASE WHEN p_enabled THEN NULL ELSE v_reason END,
                       'target_email', v_target.email)
  );

  RETURN jsonb_build_object('user_id', p_user_id, 'is_enabled', p_enabled, 'changed', true,
                            'disabled_reason', CASE WHEN p_enabled THEN NULL ELSE v_reason END,
                            'disabled_at', CASE WHEN p_enabled THEN NULL ELSE v_now END,
                            'disabled_by', CASE WHEN p_enabled THEN NULL ELSE v_actor END);
END;
$function$;

REVOKE ALL ON FUNCTION public.set_user_enabled(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_user_enabled(uuid, boolean, text) TO authenticated, service_role;

-- ----------------------------------------------------------------------------------------------------
-- 4. Enforcement
-- ----------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.current_user_is_blocked()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND is_enabled IS FALSE);
$function$;

REVOKE ALL ON FUNCTION public.current_user_is_blocked() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_user_is_blocked() TO authenticated, service_role;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'orders', 'order_items', 'order_status_history', 'remittances', 'remittance_status_history',
    'recipients', 'recipient_addresses', 'recipient_bank_accounts', 'shopping_carts', 'cart_items',
    'user_alerts', 'testimonials'
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_block_disabled_user', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR ALL TO authenticated '
      'USING ((SELECT NOT public.current_user_is_blocked())) '
      'WITH CHECK ((SELECT NOT public.current_user_is_blocked()))',
      t || '_block_disabled_user', t);
  END LOOP;
END $$;
