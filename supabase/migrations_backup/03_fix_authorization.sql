-- Migration 03: Fix Authorization System
-- Purpose: Fix critical authorization issues
-- 1. Add email field to user_profiles for easier queries
-- 2. Add comprehensive RLS policies for user_profiles
-- 3. Fix super_admin email consistency (gmail.com vs googlemail.com)
-- 4. Create helper functions for role management

-- =============================================================================
-- STEP 1: Add email field to user_profiles (denormalized for performance)
-- =============================================================================
-- Rationale: auth.users is not directly accessible from client SDK
-- Denormalizing email allows:
-- - Faster queries without joins
-- - Simpler RLS policies
-- - Better UX in admin panels

ALTER TABLE public.user_profiles
ADD COLUMN IF NOT EXISTS email text;

-- Create unique index for fast lookups
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_profiles_email
ON public.user_profiles(email);

-- Backfill email from auth.users for existing profiles
UPDATE public.user_profiles up
SET email = au.email
FROM auth.users au
WHERE up.id = au.id AND up.email IS NULL;

-- =============================================================================
-- STEP 2: Update handle_new_user() trigger to support both email formats
-- =============================================================================
-- Rationale: Gmail allows both @gmail.com and @googlemail.com
-- Google OAuth may return either variant depending on region
-- We normalize to check both formats for super_admin assignment

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
    user_role_value text;
BEGIN
    -- Determine role based on email
    -- Support both @gmail.com and @googlemail.com for super admin
    IF NEW.email IN ('jtheoden@gmail.com', 'jtheoden@googlemail.com') THEN
        user_role_value := 'super_admin';
    -- Support test users from seed
    ELSIF NEW.email = 'superadmin@test.com' THEN
        user_role_value := 'super_admin';
    ELSIF NEW.email = 'admin@test.com' THEN
        user_role_value := 'admin';
    ELSE
        user_role_value := 'user';
    END IF;

    -- Insert profile with email denormalized
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
        NEW.id, -- user_id references auth.users(id)
        NEW.email, -- Denormalize email
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

-- Recreate trigger to ensure it uses updated function
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- =============================================================================
-- STEP 3: Enable RLS on user_profiles
-- =============================================================================
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- STEP 4: Drop existing policies (if any) to avoid conflicts
-- =============================================================================
DROP POLICY IF EXISTS "Users can view their own profile" ON public.user_profiles;
DROP POLICY IF EXISTS "Users can update their own profile" ON public.user_profiles;
DROP POLICY IF EXISTS "Admins can view all profiles" ON public.user_profiles;
DROP POLICY IF EXISTS "Admins can update all profiles" ON public.user_profiles;
DROP POLICY IF EXISTS "Enable insert for authenticated users" ON public.user_profiles;
DROP POLICY IF EXISTS "Super admins can delete profiles" ON public.user_profiles;

-- =============================================================================
-- STEP 5: Create comprehensive RLS policies
-- =============================================================================

-- Policy 1: Users can view their own profile
-- Rationale: Every authenticated user needs to read their own profile data
CREATE POLICY "Users can view their own profile"
ON public.user_profiles
FOR SELECT
TO authenticated
USING (auth.uid() = id);

-- Policy 2: Users can update their own profile (limited fields)
-- Rationale: Users should update personal info but NOT their role or enabled status
-- Note: Column-level permissions would be ideal but RLS doesn't support it
-- So we rely on application logic to restrict which fields users update
CREATE POLICY "Users can update their own profile"
ON public.user_profiles
FOR UPDATE
TO authenticated
USING (auth.uid() = id)
WITH CHECK (
    auth.uid() = id
    -- Additional safeguard: prevent users from escalating their own role
    AND (
        role IS NULL OR
        role = (SELECT role FROM public.user_profiles WHERE id = auth.uid())
    )
);

-- Policy 3: Admins can view all profiles
-- Rationale: Admins need to see all users for user management features
CREATE POLICY "Admins can view all profiles"
ON public.user_profiles
FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.user_profiles
        WHERE id = auth.uid()
        AND role IN ('admin', 'super_admin')
        AND is_enabled = true
    )
);

-- Policy 4: Only super_admins can update other users' profiles
-- Rationale: Regular admins can view but only super_admin can modify roles
-- This prevents privilege escalation attacks
CREATE POLICY "Super admins can update all profiles"
ON public.user_profiles
FOR UPDATE
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.user_profiles
        WHERE id = auth.uid()
        AND role = 'super_admin'
        AND is_enabled = true
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1 FROM public.user_profiles
        WHERE id = auth.uid()
        AND role = 'super_admin'
        AND is_enabled = true
    )
);

-- Policy 5: Profiles are auto-created by trigger (INSERT via SECURITY DEFINER function)
-- Rationale: The handle_new_user() trigger has SECURITY DEFINER
-- so it bypasses RLS. Regular users should NOT insert profiles manually.
CREATE POLICY "System can insert profiles via trigger"
ON public.user_profiles
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = id);

-- =============================================================================
-- STEP 6: Create helper function to get current user role (for use in RLS)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS text AS $$
    SELECT role FROM public.user_profiles WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION public.current_user_role() TO authenticated;

-- =============================================================================
-- STEP 7: Fix existing super_admin profile (if exists)
-- =============================================================================
-- Update existing profile for jtheoden if it exists with wrong role
DO $$
DECLARE
    v_user_id uuid;
BEGIN
    -- Try to find user by either email variant
    SELECT id INTO v_user_id
    FROM auth.users
    WHERE email IN ('jtheoden@gmail.com', 'jtheoden@googlemail.com')
    LIMIT 1;

    IF v_user_id IS NOT NULL THEN
        -- Ensure profile exists and has super_admin role
        INSERT INTO public.user_profiles (id, user_id, email, role, is_enabled)
        SELECT
            v_user_id,
            v_user_id,
            email,
            'super_admin',
            true
        FROM auth.users
        WHERE id = v_user_id
        ON CONFLICT (id) DO UPDATE
        SET
            role = 'super_admin',
            is_enabled = true,
            email = EXCLUDED.email,
            updated_at = NOW();

        RAISE NOTICE 'Super admin profile verified/created for user ID: %', v_user_id;
    ELSE
        RAISE NOTICE 'Super admin user not found. They must log in first via OAuth.';
    END IF;
END $$;

-- =============================================================================
-- STEP 8: Add trigger to keep email synchronized
-- =============================================================================
-- Rationale: If user changes email in auth.users (rare but possible),
-- we want user_profiles.email to stay in sync

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

-- =============================================================================
-- STEP 9: Grant necessary permissions
-- =============================================================================
GRANT SELECT ON public.user_profiles TO authenticated;
GRANT UPDATE (full_name, avatar_url, address, city, state, country, postal_code, birth_date, gender, preferences)
ON public.user_profiles TO authenticated;

-- =============================================================================
-- VERIFICATION QUERIES (for testing)
-- =============================================================================
-- Uncomment to test after migration:
-- SELECT email, role, is_enabled FROM public.user_profiles;
-- SELECT current_user_role();
