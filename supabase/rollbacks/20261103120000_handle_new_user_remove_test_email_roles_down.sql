-- Rollback of 20261103120000_handle_new_user_remove_test_email_roles.sql: restores the exact definition
-- that was live before it (verified in production on 2026-11-03), including the two @test.com role rules.
-- WARNING: re-applying this re-opens the email-based privilege grant for superadmin@test.com (super_admin)
-- and admin@test.com (admin). Only use it if the removal itself breaks something. Existing rows are untouched.
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
    IF NEW.email IN ('jtheoden@gmail.com', 'jtheoden@googlemail.com', 'superadmin@test.com') THEN
        user_role_value := 'super_admin';
    ELSIF NEW.email = 'admin@test.com' THEN
        user_role_value := 'admin';
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
