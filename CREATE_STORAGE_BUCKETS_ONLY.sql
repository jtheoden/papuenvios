-- ============================================================================
-- CREATE STORAGE BUCKETS & POLICIES ONLY
-- ============================================================================
-- This script ONLY creates storage infrastructure
-- Does NOT touch user_profiles (users already exist)
-- ============================================================================

-- STEP 1: Create storage buckets
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

-- STEP 2: Create storage policies for remittance-proofs
DROP POLICY IF EXISTS "Users can upload their own remittance proofs" ON storage.objects;
DROP POLICY IF EXISTS "Users can read their own remittance proofs" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete their own remittance proofs" ON storage.objects;

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

SELECT '✅ Policies created for remittance-proofs' as status;

-- STEP 3: Create storage policies for order-delivery-proofs
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

SELECT '✅ Policies created for order-delivery-proofs' as status;

-- STEP 4: Create storage policies for remittance-delivery-proofs
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

SELECT '✅ Policies created for remittance-delivery-proofs' as status;

-- STEP 5: Verify
SELECT '================================' as divider
UNION ALL SELECT '✅ STORAGE SETUP COMPLETE!' as divider
UNION ALL SELECT '================================' as divider;

-- Show storage buckets
SELECT
    '🗂️ Buckets Created:' as info,
    name,
    public,
    file_size_limit / 1048576 || ' MB' as size_limit
FROM storage.buckets
WHERE name IN ('remittance-proofs', 'order-delivery-proofs', 'remittance-delivery-proofs')
ORDER BY name;

-- Show storage policy count
SELECT
    '🔐 Policies Per Bucket:' as info,
    bucket_id,
    COUNT(*) as policy_count
FROM storage.policies
WHERE bucket_id IN ('remittance-proofs', 'order-delivery-proofs', 'remittance-delivery-proofs')
GROUP BY bucket_id
ORDER BY bucket_id;

SELECT '================================' as divider
UNION ALL SELECT '✅ File uploads should now work!' as divider
UNION ALL SELECT '================================' as divider;
