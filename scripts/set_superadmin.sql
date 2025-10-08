-- Enhanced super admin setup script with proper error handling and logging
DO $$
DECLARE
    user_id uuid;
    user_email text;
BEGIN
    -- Get the user ID and email from auth.users
    SELECT id, email INTO user_id, user_email
    FROM auth.users
    WHERE email = 'jtheoden@googlemail.com';

    -- Log the current state
    RAISE NOTICE 'Checking user state: ID %, Email %', COALESCE(user_id::text, 'not found'), COALESCE(user_email, 'not found');

    -- If user exists, ensure proper setup
    IF user_id IS NOT NULL THEN
        -- First, ensure user profile exists
        INSERT INTO public.user_profiles (
            id,
            role,
            is_enabled,
            created_at,
            updated_at
        )
        VALUES (
            user_id,
            'super_admin',
            true,
            NOW(),
            NOW()
        )
        ON CONFLICT (id) DO UPDATE
        SET role = 'super_admin',
            is_enabled = true,
            updated_at = NOW();

        -- Verify the profile was created/updated correctly
        RAISE NOTICE 'Verifying user profile...';
        
        IF EXISTS (
            SELECT 1 
            FROM public.user_profiles 
            WHERE id = user_id 
            AND role = 'super_admin' 
            AND is_enabled = true
        ) THEN
            RAISE NOTICE 'Successfully configured super admin profile for %', user_email;
            RAISE NOTICE 'Profile details: ID: %, Role: super_admin, Enabled: true', user_id;
        ELSE
            RAISE EXCEPTION 'Failed to verify user profile configuration';
        END IF;

        -- Grant necessary permissions
        -- Note: This assumes you have the proper policies set up
        RAISE NOTICE 'Super admin setup complete';
        
    ELSE
        RAISE EXCEPTION 'User jtheoden@googlemail.com not found in auth.users. Please ensure the user has logged in at least once with Google OAuth';
    END IF;

EXCEPTION
    WHEN OTHERS THEN
        RAISE EXCEPTION 'Error setting up super admin: % %', SQLERRM, SQLSTATE;
END $$;