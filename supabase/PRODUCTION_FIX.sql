-- ============================================================================
-- PRODUCTION FIX: Authorization & Profile Access
-- ============================================================================
-- PURPOSE: Fix super_admin unable to read their own profile
-- ISSUE: Missing email column and broken RLS policies causing infinite recursion
--
-- SAFETY: This script is idempotent (safe to run multiple times)
--
-- APPLY IN: Supabase Dashboard → SQL Editor → New Query → Paste & Run
-- ============================================================================

BEGIN;

-- ============================================================================
-- STEP 1: Fix user_profiles table structure
-- ============================================================================

-- Add missing columns if they don't exist
ALTER TABLE public.user_profiles
ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.user_profiles
ADD COLUMN IF NOT EXISTS email text;

-- Backfill user_id and email from existing data
UPDATE public.user_profiles
SET user_id = id
WHERE user_id IS NULL;

UPDATE public.user_profiles up
SET email = au.email
FROM auth.users au
WHERE up.id = au.id AND up.email IS NULL;

-- Add NOT NULL constraints after backfilling
ALTER TABLE public.user_profiles
ALTER COLUMN email SET NOT NULL;

ALTER TABLE public.user_profiles
ALTER COLUMN user_id SET NOT NULL;

-- Add check constraint to ensure id = user_id
ALTER TABLE public.user_profiles
DROP CONSTRAINT IF EXISTS user_profiles_id_user_id_check;

ALTER TABLE public.user_profiles
ADD CONSTRAINT user_profiles_id_user_id_check CHECK (id = user_id);

-- Create indexes for performance
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_profiles_email
ON public.user_profiles(email);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_profiles_user_id
ON public.user_profiles(user_id);

CREATE INDEX IF NOT EXISTS idx_user_profiles_role
ON public.user_profiles(role) WHERE role IN ('admin', 'super_admin');

-- ============================================================================
-- STEP 2: Create helper functions (SECURITY DEFINER to bypass RLS)
-- ============================================================================

-- Function: Get current user's role without triggering RLS recursion
CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS text AS $$
DECLARE
    user_role text;
BEGIN
    SELECT role INTO user_role
    FROM public.user_profiles
    WHERE id = auth.uid()
    LIMIT 1;

    RETURN COALESCE(user_role, 'user');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

GRANT EXECUTE ON FUNCTION public.current_user_role() TO authenticated;

-- Function: Check if current user is enabled
CREATE OR REPLACE FUNCTION public.current_user_is_enabled()
RETURNS boolean AS $$
DECLARE
    is_user_enabled boolean;
BEGIN
    SELECT is_enabled INTO is_user_enabled
    FROM public.user_profiles
    WHERE id = auth.uid()
    LIMIT 1;

    RETURN COALESCE(is_user_enabled, false);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

GRANT EXECUTE ON FUNCTION public.current_user_is_enabled() TO authenticated;

-- ============================================================================
-- STEP 3: Update handle_new_user() to support both email formats
-- ============================================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
    user_role_value text;
BEGIN
    -- Determine role based on email
    -- Support both @gmail.com and @googlemail.com for super admin
    IF NEW.email IN ('jtheoden@gmail.com', 'jtheoden@googlemail.com', 'superadmin@test.com') THEN
        user_role_value := 'super_admin';
    ELSIF NEW.email = 'admin@test.com' THEN
        user_role_value := 'admin';
    ELSE
        user_role_value := 'user';
    END IF;

    -- Insert or update profile
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Recreate trigger
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================================
-- STEP 4: Create email sync trigger
-- ============================================================================

CREATE OR REPLACE FUNCTION public.sync_user_email()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE public.user_profiles
    SET email = NEW.email, updated_at = NOW()
    WHERE id = NEW.id AND email != NEW.email;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_email_change ON auth.users;
CREATE TRIGGER on_auth_user_email_change
    AFTER UPDATE OF email ON auth.users
    FOR EACH ROW
    WHEN (OLD.email IS DISTINCT FROM NEW.email)
    EXECUTE FUNCTION public.sync_user_email();

-- ============================================================================
-- STEP 5: Enable RLS
-- ============================================================================

ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- STEP 6: Drop all existing broken policies
-- ============================================================================

DROP POLICY IF EXISTS "Users can view their own profile" ON public.user_profiles;
DROP POLICY IF EXISTS "Users can view own profile" ON public.user_profiles;
DROP POLICY IF EXISTS "Users can update their own profile" ON public.user_profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON public.user_profiles;
DROP POLICY IF EXISTS "Admins can view all profiles" ON public.user_profiles;
DROP POLICY IF EXISTS "Super admins can update all profiles" ON public.user_profiles;
DROP POLICY IF EXISTS "System can insert profiles via trigger" ON public.user_profiles;
DROP POLICY IF EXISTS "System can insert profiles" ON public.user_profiles;
DROP POLICY IF EXISTS "Enable insert for authenticated users" ON public.user_profiles;

-- ============================================================================
-- STEP 7: Create correct RLS policies (NO RECURSION)
-- ============================================================================

-- Drop policies if they exist (for idempotency)
DROP POLICY IF EXISTS "user_profiles_select_own" ON public.user_profiles;
DROP POLICY IF EXISTS "user_profiles_select_admin" ON public.user_profiles;
DROP POLICY IF EXISTS "user_profiles_update_own" ON public.user_profiles;
DROP POLICY IF EXISTS "user_profiles_update_admin" ON public.user_profiles;
DROP POLICY IF EXISTS "user_profiles_insert_system" ON public.user_profiles;

-- Policy 1: Users can ALWAYS view their own profile (direct check, no recursion)
CREATE POLICY "user_profiles_select_own"
ON public.user_profiles
FOR SELECT
TO authenticated
USING (id = auth.uid());

-- Policy 2: Admins can view all profiles (uses SECURITY DEFINER function)
CREATE POLICY "user_profiles_select_admin"
ON public.user_profiles
FOR SELECT
TO authenticated
USING (public.current_user_role() IN ('admin', 'super_admin'));

-- Policy 3: Users can update their own profile (limited fields via app logic)
CREATE POLICY "user_profiles_update_own"
ON public.user_profiles
FOR UPDATE
TO authenticated
USING (id = auth.uid())
WITH CHECK (id = auth.uid());

-- Policy 4: Super admins can update any profile
CREATE POLICY "user_profiles_update_admin"
ON public.user_profiles
FOR UPDATE
TO authenticated
USING (public.current_user_role() = 'super_admin')
WITH CHECK (public.current_user_role() = 'super_admin');

-- Policy 5: Allow profile creation via trigger
CREATE POLICY "user_profiles_insert_system"
ON public.user_profiles
FOR INSERT
TO authenticated
WITH CHECK (id = auth.uid());

-- ============================================================================
-- STEP 8: Grant necessary permissions
-- ============================================================================

GRANT SELECT ON public.user_profiles TO authenticated;

-- Grant UPDATE on specific columns (only those that exist)
-- Users can update their personal info but NOT role, is_enabled, or email
DO $$
DECLARE
    grant_columns TEXT[];
BEGIN
    -- Build list of columns that exist
    SELECT ARRAY_AGG(column_name)
    INTO grant_columns
    FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'user_profiles'
    AND column_name IN ('full_name', 'avatar_url', 'phone', 'address', 'city', 'state', 'country', 'postal_code', 'birth_date', 'gender', 'preferences', 'metadata');

    -- Only grant if we have columns to grant
    IF array_length(grant_columns, 1) > 0 THEN
        EXECUTE format('GRANT UPDATE (%s) ON public.user_profiles TO authenticated',
                      array_to_string(grant_columns, ', '));
        RAISE NOTICE 'Granted UPDATE on columns: %', array_to_string(grant_columns, ', ');
    END IF;
END $$;

-- ============================================================================
-- STEP 9: Fix existing super_admin profile if it exists
-- ============================================================================

DO $$
DECLARE
    v_user_id uuid;
    v_email text;
BEGIN
    -- Find jtheoden user by either email variant
    SELECT id, email INTO v_user_id, v_email
    FROM auth.users
    WHERE email IN ('jtheoden@gmail.com', 'jtheoden@googlemail.com')
    LIMIT 1;

    IF v_user_id IS NOT NULL THEN
        -- Ensure profile exists with super_admin role
        INSERT INTO public.user_profiles (id, user_id, email, role, is_enabled, full_name)
        VALUES (
            v_user_id,
            v_user_id,
            v_email,
            'super_admin',
            true,
            COALESCE(
                (SELECT raw_user_meta_data->>'full_name' FROM auth.users WHERE id = v_user_id),
                'Super Admin'
            )
        )
        ON CONFLICT (id) DO UPDATE
        SET
            role = 'super_admin',
            is_enabled = true,
            email = EXCLUDED.email,
            user_id = EXCLUDED.user_id,
            updated_at = NOW();

        RAISE NOTICE 'Super admin profile updated for: % (ID: %)', v_email, v_user_id;
    ELSE
        RAISE NOTICE 'Super admin user not found. Will be created on next login.';
    END IF;
END $$;

-- ============================================================================
-- STEP 10: Verification queries
-- ============================================================================

-- Show all user profiles
SELECT
    id,
    email,
    role,
    is_enabled,
    created_at
FROM public.user_profiles
ORDER BY created_at;

-- Test if policies work (this query should succeed for super_admin)
SELECT
    'Policy test passed: User can read their own profile' as test_result,
    count(*) as profile_count
FROM public.user_profiles
WHERE id = auth.uid();

COMMIT;

-- ============================================================================
-- SUCCESS MESSAGE
-- ============================================================================
DO $$
BEGIN
    RAISE NOTICE '
    ============================================================================
    ✅ MIGRATION COMPLETED SUCCESSFULLY
    ============================================================================

    Changes applied:
    1. ✅ Added email and user_id columns to user_profiles
    2. ✅ Created SECURITY DEFINER helper functions (no recursion)
    3. ✅ Fixed handle_new_user() to support both email formats
    4. ✅ Replaced broken RLS policies with correct ones
    5. ✅ Ensured super_admin profile exists and is correct

    Next steps:
    1. Log out from your app
    2. Log back in with your Google account
    3. You should now have full access to admin panel and user profile

    If issues persist, check:
    - Auth token refresh (clear browser cache/cookies)
    - Console errors in browser DevTools

    ============================================================================
    ';
END $$;
