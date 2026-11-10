-- handle_new_user(): stop granting privileged roles to the two @test.com accounts.
--
-- WHY: the trigger function on auth.users granted super_admin to 'superadmin@test.com' and admin to
--   'admin@test.com' purely by email. Both accounts exist in production (created 2025-09-27, never signed
--   in, no user_profiles row), so today they hold no privileges, but anyone able to (re)create those emails
--   (e.g. after the auth rows are removed, or on a project with open sign-ups and no email verification)
--   would receive admin / super_admin. The owner approved removing the two rules.
--
-- WHAT: one CREATE OR REPLACE of public.handle_new_user(). Identical to the live definition except:
--   * 'superadmin@test.com' is removed from the super_admin list (the owner's two emails keep super_admin),
--   * the ELSIF branch for 'admin@test.com' is deleted.
--   Signature, SECURITY DEFINER, SET search_path TO 'public' and the whole INSERT ... ON CONFLICT body are
--   unchanged. CREATE OR REPLACE keeps the function's existing ACL (EXECUTE already revoked from API roles
--   by 20261014120000 / 20261024100100) and the on_auth_user_created trigger binding.
--
-- DATA: no existing row is read, inserted, updated or deleted (no data migration, no backfill, the auth
--   accounts are NOT deleted). Only users created AFTER this migration are affected.
--
-- ROLLBACK: supabase/rollbacks/20261103120000_handle_new_user_remove_test_email_roles_down.sql
--   (restores the previous definition, including the two @test.com rules).
BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    user_role_value text;
BEGIN
    IF NEW.email IN ('jtheoden@gmail.com', 'jtheoden@googlemail.com') THEN
        user_role_value := 'super_admin';
    ELSE
        user_role_value := 'user';
    END IF;

    INSERT INTO public.user_profiles (
        id,
        user_id,
        email,
        role,
        full_name,
        avatar_url,
        is_enabled
    )
    VALUES (
        NEW.id,
        NEW.id,
        NEW.email,
        user_role_value,
        COALESCE(
            NEW.raw_user_meta_data->>'full_name',
            NEW.raw_user_meta_data->>'name',
            split_part(NEW.email, '@', 1)
        ),
        COALESCE(
            NEW.raw_user_meta_data->>'avatar_url',
            NEW.raw_user_meta_data->>'picture',
            'https://api.dicebear.com/7.x/avataaars/svg?seed=' || encode(sha256(NEW.email::bytea), 'hex')
        ),
        true
    )
    ON CONFLICT (id) DO UPDATE
    SET
        email = EXCLUDED.email,
        role = EXCLUDED.role,
        full_name = COALESCE(EXCLUDED.full_name, user_profiles.full_name),
        avatar_url = COALESCE(EXCLUDED.avatar_url, user_profiles.avatar_url),
        updated_at = NOW();

    RETURN NEW;
END;
$function$;

COMMIT;
