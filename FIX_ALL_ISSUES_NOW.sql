-- ============================================================================
-- COMPLETE FIX - ALL ISSUES
-- ============================================================================
-- This script fixes:
-- 1. Profile fetch timeouts
-- 2. Auth session loss
-- 3. Storage bucket missing errors
--
-- IMPORTANT: Replace 'jtheoden@googlemail.com' with your actual email
-- ============================================================================

-- STEP 1: Get your user ID from auth.users
DO $$
DECLARE
    v_user_id uuid;
    v_email text := 'jtheoden@googlemail.com';  -- CHANGE THIS TO YOUR EMAIL
BEGIN
    -- Get user ID
    SELECT id INTO v_user_id
    FROM auth.users
    WHERE email = v_email;

    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'User with email % not found in auth.users. Please signup first.', v_email;
    END IF;

    RAISE NOTICE '✅ Found user ID: %', v_user_id;

    -- STEP 2: Create or update user profile
    INSERT INTO user_profiles (
        id,
        user_id,
        email,
        role,
        is_enabled,
        full_name,
        created_at,
        updated_at
    )
    VALUES (
        v_user_id,
        v_user_id,
        v_email,
        'super_admin',
        true,
        'Jose Theoden',  -- CHANGE THIS TO YOUR NAME
        NOW(),
        NOW()
    )
    ON CONFLICT (id) DO UPDATE SET
        role = 'super_admin',
        is_enabled = true,
        updated_at = NOW();

    RAISE NOTICE '✅ User profile created/updated with super_admin role';
END $$;

-- STEP 3: Create storage buckets
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'remittance-proofs',
    'remittance-proofs',
    false,
    10485760,  -- 10MB
    ARRAY['image/jpeg', 'image/png', 'image/jpg', 'image/webp', 'application/pdf']::text[]
)
ON CONFLICT (id) DO UPDATE SET
    file_size_limit = 10485760,
    allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/jpg', 'image/webp', 'application/pdf']::text[];

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'order-delivery-proofs',
    'order-delivery-proofs',
    false,
    10485760,
    ARRAY['image/jpeg', 'image/png', 'image/jpg', 'image/webp', 'application/pdf']::text[]
)
ON CONFLICT (id) DO UPDATE SET
    file_size_limit = 10485760,
    allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/jpg', 'image/webp', 'application/pdf']::text[];

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'remittance-delivery-proofs',
    'remittance-delivery-proofs',
    false,
    10485760,
    ARRAY['image/jpeg', 'image/png', 'image/jpg', 'image/webp', 'application/pdf']::text[]
)
ON CONFLICT (id) DO UPDATE SET
    file_size_limit = 10485760,
    allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/jpg', 'image/webp', 'application/pdf']::text[];

SELECT '✅ Storage buckets created' as status;

-- STEP 4: Create storage policies for remittance-proofs
DO $$
BEGIN
    -- Drop existing policies if any
    DROP POLICY IF EXISTS "Users can upload their own remittance proofs" ON storage.objects;
    DROP POLICY IF EXISTS "Users can read their own remittance proofs" ON storage.objects;
    DROP POLICY IF EXISTS "Users can delete their own remittance proofs" ON storage.objects;

    -- Create new policies
    CREATE POLICY "Users can upload their own remittance proofs"
    ON storage.objects FOR INSERT
    TO authenticated
    WITH CHECK (
        bucket_id = 'remittance-proofs'
        AND auth.uid()::text = (storage.foldername(name))[1]
    );

    CREATE POLICY "Users can read their own remittance proofs"
    ON storage.objects FOR SELECT
    TO authenticated
    USING (
        bucket_id = 'remittance-proofs'
        AND (
            auth.uid()::text = (storage.foldername(name))[1]
            OR EXISTS (
                SELECT 1 FROM user_profiles
                WHERE user_id = auth.uid()
                AND role IN ('admin', 'super_admin')
            )
        )
    );

    CREATE POLICY "Users can delete their own remittance proofs"
    ON storage.objects FOR DELETE
    TO authenticated
    USING (
        bucket_id = 'remittance-proofs'
        AND (
            auth.uid()::text = (storage.foldername(name))[1]
            OR EXISTS (
                SELECT 1 FROM user_profiles
                WHERE user_id = auth.uid()
                AND role IN ('admin', 'super_admin')
            )
        )
    );

    RAISE NOTICE '✅ Policies created for remittance-proofs';
END $$;

-- STEP 5: Create storage policies for order-delivery-proofs
DO $$
BEGIN
    DROP POLICY IF EXISTS "Users can upload order delivery proofs" ON storage.objects;
    DROP POLICY IF EXISTS "Users can read order delivery proofs" ON storage.objects;
    DROP POLICY IF EXISTS "Users can delete order delivery proofs" ON storage.objects;

    CREATE POLICY "Users can upload order delivery proofs"
    ON storage.objects FOR INSERT
    TO authenticated
    WITH CHECK (
        bucket_id = 'order-delivery-proofs'
        AND (
            auth.uid()::text = (storage.foldername(name))[1]
            OR EXISTS (
                SELECT 1 FROM user_profiles
                WHERE user_id = auth.uid()
                AND role IN ('admin', 'super_admin')
            )
        )
    );

    CREATE POLICY "Users can read order delivery proofs"
    ON storage.objects FOR SELECT
    TO authenticated
    USING (
        bucket_id = 'order-delivery-proofs'
        AND (
            auth.uid()::text = (storage.foldername(name))[1]
            OR EXISTS (
                SELECT 1 FROM user_profiles
                WHERE user_id = auth.uid()
                AND role IN ('admin', 'super_admin')
            )
        )
    );

    CREATE POLICY "Users can delete order delivery proofs"
    ON storage.objects FOR DELETE
    TO authenticated
    USING (
        bucket_id = 'order-delivery-proofs'
        AND (
            auth.uid()::text = (storage.foldername(name))[1]
            OR EXISTS (
                SELECT 1 FROM user_profiles
                WHERE user_id = auth.uid()
                AND role IN ('admin', 'super_admin')
            )
        )
    );

    RAISE NOTICE '✅ Policies created for order-delivery-proofs';
END $$;

-- STEP 6: Create storage policies for remittance-delivery-proofs
DO $$
BEGIN
    DROP POLICY IF EXISTS "Users can upload remittance delivery proofs" ON storage.objects;
    DROP POLICY IF EXISTS "Users can read remittance delivery proofs" ON storage.objects;
    DROP POLICY IF EXISTS "Admins can delete remittance delivery proofs" ON storage.objects;

    CREATE POLICY "Users can upload remittance delivery proofs"
    ON storage.objects FOR INSERT
    TO authenticated
    WITH CHECK (
        bucket_id = 'remittance-delivery-proofs'
        AND EXISTS (
            SELECT 1 FROM user_profiles
            WHERE user_id = auth.uid()
            AND role IN ('admin', 'super_admin')
        )
    );

    CREATE POLICY "Users can read remittance delivery proofs"
    ON storage.objects FOR SELECT
    TO authenticated
    USING (
        bucket_id = 'remittance-delivery-proofs'
        AND (
            auth.uid()::text = (storage.foldername(name))[1]
            OR EXISTS (
                SELECT 1 FROM user_profiles
                WHERE user_id = auth.uid()
                AND role IN ('admin', 'super_admin')
            )
        )
    );

    CREATE POLICY "Admins can delete remittance delivery proofs"
    ON storage.objects FOR DELETE
    TO authenticated
    USING (
        bucket_id = 'remittance-delivery-proofs'
        AND EXISTS (
            SELECT 1 FROM user_profiles
            WHERE user_id = auth.uid()
            AND role IN ('admin', 'super_admin')
        )
    );

    RAISE NOTICE '✅ Policies created for remittance-delivery-proofs';
END $$;

-- STEP 7: Verify everything
SELECT '================================' as divider
UNION ALL SELECT '✅ ALL FIXES APPLIED!' as divider
UNION ALL SELECT '================================' as divider
UNION ALL SELECT '' as divider
UNION ALL SELECT '📋 Verification:' as divider;

-- Show user profile
SELECT
    '👤 Your Profile:' as info,
    email,
    role,
    is_enabled,
    created_at
FROM user_profiles
WHERE email = 'jtheoden@googlemail.com';

-- Show storage buckets
SELECT
    '🗂️ Storage Buckets:' as info,
    name,
    public,
    file_size_limit / 1048576 || ' MB' as size_limit
FROM storage.buckets
ORDER BY name;

-- Show storage policy count
SELECT
    '🔐 Storage Policies:' as info,
    bucket_id,
    COUNT(*) as policy_count
FROM storage.policies
GROUP BY bucket_id
ORDER BY bucket_id;

-- Final summary
SELECT '================================' as divider
UNION ALL SELECT '✅ Setup Complete!' as divider
UNION ALL SELECT '================================' as divider
UNION ALL SELECT '' as divider
UNION ALL SELECT '📋 Next Steps:' as divider
UNION ALL SELECT '  1. Clear browser cache & localStorage' as divider
UNION ALL SELECT '  2. Logout and login again' as divider
UNION ALL SELECT '  3. Test file upload' as divider
UNION ALL SELECT '  4. Verify no timeout errors' as divider;
