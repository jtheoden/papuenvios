-- ============================================================================
-- RB-25: get_my_role() must honour user_profiles.is_enabled (same pattern as 20261104130000).   PREPARED, NOT APPLIED
-- ============================================================================
-- WHY
--   20261104130000 (applied in prod as 20261104135313) put is_enabled back into is_admin_user / is_super_admin /
--   is_admin / is_manager / current_user_role, but get_my_role() was left out: a DISABLED admin/super_admin still gets
--   'admin'/'super_admin' from it and keeps admin access wherever a policy uses it.
--
-- LIVE STATE (read-only 2026-11-04): `LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'`, body
--   `SELECT COALESCE((SELECT role FROM user_profiles WHERE id = auth.uid() LIMIT 1), 'user')`,
--   proacl {=X/postgres,postgres=X/postgres,authenticated=X/postgres}. Identical in supabase/e2e/base-public-schema.sql.
--
-- CONSUMERS (prod pg_policies, 2026-11-04): 22 policies, all of the form get_my_role() = ANY ('{admin,super_admin}') as a
--   positive gate: bank_accounts (3), recipient_bank_accounts (4), business_visual_settings (3),
--   notification_settings (3), publications (3), remittance_bank_transfers (3), storage.objects publications bucket (3).
--   No SQL function or view calls it; src/ and supabase/functions do not call it (rg).
--
-- WHAT: CREATE OR REPLACE with the same signature, LANGUAGE sql, STABLE, SECURITY DEFINER, search_path (ACL and policy
--   inlining unchanged). An account with is_enabled not true reads as 'user'; no profile row / anon still 'user'.
--
-- DATA: nothing is written. Prod: 2 admins + 3 super_admins, all is_enabled = true (0 NULL) -> nobody's access changes;
--   only a future disabled admin loses the 22 gates above (intended).
-- ROLLBACK: supabase/rollbacks/20261104160400_get_my_role_is_enabled_down.sql (exact live body).
-- ============================================================================

BEGIN;

SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS text
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    (SELECT CASE WHEN is_enabled = true THEN role ELSE 'user' END
       FROM public.user_profiles
      WHERE id = auth.uid()
      LIMIT 1),
    'user');
$function$;

COMMIT;
