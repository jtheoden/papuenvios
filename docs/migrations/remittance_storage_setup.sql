-- ============================================================================
-- SUPABASE STORAGE SETUP FOR REMITTANCES
-- ============================================================================
-- Create storage bucket and policies for remittance payment proofs
-- Execute this in Supabase Dashboard > Storage
-- ============================================================================

-- ============================================================================
-- CREATE BUCKET
-- ============================================================================
-- NOTE: This needs to be done via Supabase Dashboard or API
-- Dashboard > Storage > Create Bucket
--
-- Bucket Name: remittance-proofs
-- Public: false (private bucket)
-- File Size Limit: 10 MB
-- Allowed MIME types: image/*, application/pdf
-- ============================================================================

-- ============================================================================
-- STORAGE POLICIES
-- ============================================================================
-- Execute these policies after creating the bucket

-- Policy: Users can upload to their own folder
CREATE POLICY "Users can upload payment proofs"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'remittance-proofs' AND
  (storage.foldername(name))[1] = auth.uid()::text
);

-- Policy: Users can view their own files
CREATE POLICY "Users can view own payment proofs"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'remittance-proofs' AND
  (
    -- User can see their own files
    (storage.foldername(name))[1] = auth.uid()::text
    OR
    -- Admins can see all files
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.user_id = auth.uid()
      AND user_profiles.role IN ('admin', 'super_admin')
    )
  )
);

-- Policy: Users can update their own files (re-upload)
CREATE POLICY "Users can update own payment proofs"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'remittance-proofs' AND
  (storage.foldername(name))[1] = auth.uid()::text
)
WITH CHECK (
  bucket_id = 'remittance-proofs' AND
  (storage.foldername(name))[1] = auth.uid()::text
);

-- Policy: Admins can upload delivery proofs
CREATE POLICY "Admins can upload delivery proofs"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'remittance-proofs' AND
  (storage.foldername(name))[1] = 'delivery' AND
  EXISTS (
    SELECT 1 FROM user_profiles
    WHERE user_profiles.user_id = auth.uid()
    AND user_profiles.role IN ('admin', 'super_admin')
  )
);

-- Policy: Users can view delivery proofs for their remittances
CREATE POLICY "Users can view delivery proofs"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'remittance-proofs' AND
  (storage.foldername(name))[1] = 'delivery' AND
  (
    -- Admins can see all
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.user_id = auth.uid()
      AND user_profiles.role IN ('admin', 'super_admin')
    )
    OR
    -- Users can see delivery proofs for their own remittances
    EXISTS (
      SELECT 1 FROM remittances
      WHERE remittances.user_id = auth.uid()
      AND remittances.delivery_proof_url LIKE '%' || name || '%'
    )
  )
);

-- Policy: Super admins can delete files if needed
CREATE POLICY "Super admins can delete files"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'remittance-proofs' AND
  EXISTS (
    SELECT 1 FROM user_profiles
    WHERE user_profiles.user_id = auth.uid()
    AND user_profiles.role = 'super_admin'
  )
);

-- ============================================================================
-- FOLDER STRUCTURE
-- ============================================================================
-- The system will automatically organize files as:
--
-- remittance-proofs/
-- ├── {user_id}/
-- │   ├── REM-2025-0001.jpg       (payment proof from user)
-- │   ├── REM-2025-0002.pdf       (payment proof from user)
-- │   └── ...
-- └── delivery/
--     ├── REM-2025-0001_delivery.jpg   (delivery proof by admin)
--     ├── REM-2025-0002_delivery.jpg   (delivery proof by admin)
--     └── ...
-- ============================================================================

-- ============================================================================
-- MANUAL BUCKET CREATION INSTRUCTIONS
-- ============================================================================
-- Since bucket creation cannot be done via SQL, follow these steps:
--
-- 1. Go to Supabase Dashboard
-- 2. Navigate to Storage section
-- 3. Click "Create Bucket"
-- 4. Enter the following details:
--    - Name: remittance-proofs
--    - Public: NO (keep private)
--    - File size limit: 10 MB (or as needed)
--    - Allowed MIME types: image/jpeg, image/png, image/jpg, application/pdf
-- 5. Click "Create Bucket"
-- 6. Then run the policies above in SQL Editor
--
-- Verification:
-- After creating bucket and running policies, verify with:
--
-- SELECT * FROM storage.buckets WHERE name = 'remittance-proofs';
-- SELECT * FROM storage.policies WHERE bucket_id = 'remittance-proofs';
-- ============================================================================

-- ============================================================================
-- TESTING QUERIES
-- ============================================================================

-- Check if bucket exists
SELECT id, name, public, file_size_limit, allowed_mime_types
FROM storage.buckets
WHERE name = 'remittance-proofs';

-- Check policies
SELECT
  name,
  definition,
  CASE command
    WHEN 'r' THEN 'SELECT'
    WHEN 'a' THEN 'INSERT'
    WHEN 'w' THEN 'UPDATE'
    WHEN 'd' THEN 'DELETE'
    ELSE command::text
  END as operation
FROM pg_policies
WHERE schemaname = 'storage'
AND tablename = 'objects'
AND name LIKE '%remittance%'
ORDER BY name;

-- Check files in bucket (as admin)
SELECT
  name,
  bucket_id,
  owner,
  created_at,
  updated_at,
  last_accessed_at,
  metadata->>'size' as size_bytes,
  metadata->>'mimetype' as mime_type
FROM storage.objects
WHERE bucket_id = 'remittance-proofs'
ORDER BY created_at DESC
LIMIT 20;
