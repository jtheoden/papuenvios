-- ============================================================================
-- FIX: CREATE MISSING STORAGE BUCKETS
-- ============================================================================
-- Execute this in Supabase SQL Editor to fix "bucket not found" errors
-- ============================================================================

-- STEP 1: Create order-documents bucket (used by orderService.js)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'order-documents',
    'order-documents',
    false,
    10485760,  -- 10MB
    ARRAY['image/jpeg', 'image/png', 'image/jpg', 'image/webp', 'application/pdf']::text[]
)
ON CONFLICT (id) DO UPDATE SET
    file_size_limit = 10485760,
    allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/jpg', 'image/webp', 'application/pdf']::text[];

SELECT '✅ order-documents bucket created' as status;

-- STEP 2: Create order-delivery-proofs bucket (used by migration 2)
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

SELECT '✅ order-delivery-proofs bucket created' as status;

-- STEP 3: Create remittance-proofs bucket (used by remittanceService.js)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'remittance-proofs',
    'remittance-proofs',
    false,
    10485760,
    ARRAY['image/jpeg', 'image/png', 'image/jpg', 'image/webp', 'application/pdf']::text[]
)
ON CONFLICT (id) DO UPDATE SET
    file_size_limit = 10485760,
    allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/jpg', 'image/webp', 'application/pdf']::text[];

SELECT '✅ remittance-proofs bucket created' as status;

-- STEP 4: Create remittance-delivery-proofs bucket (used by migration 2)
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

SELECT '✅ remittance-delivery-proofs bucket created' as status;

-- STEP 5: Verify all buckets exist
SELECT
    '🗂️ Storage Buckets:' as info,
    id,
    name,
    public,
    ROUND(file_size_limit / 1048576) as size_limit_mb
FROM storage.buckets
WHERE id IN ('order-documents', 'order-delivery-proofs', 'remittance-proofs', 'remittance-delivery-proofs')
ORDER BY name;

SELECT '✅ ALL BUCKETS READY!' as final_status;
