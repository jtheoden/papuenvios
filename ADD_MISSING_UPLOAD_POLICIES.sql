-- ============================================================================
-- ADD: MISSING UPLOAD POLICIES FOR USERS
-- ============================================================================
-- DIAGNOSIS: Users cannot upload delivery proofs - only managers/admins can
-- SOLUTION: Add two policies allowing regular users to upload their own proofs
-- Path format: {user_id}/{order_id or remittance_id}/filename
-- ============================================================================

-- STEP 1: Add policy for users to upload their own order delivery proofs
CREATE POLICY "users can upload order delivery proofs"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'order-delivery-proofs' AND
  -- Path format: {user_id}/{order_id}/filename
  (storage.foldername(name))[1] = (auth.uid())::text
);

SELECT '✅ Added policy: users can upload order delivery proofs' as status;

-- STEP 2: Add policy for users to upload their own remittance delivery proofs
CREATE POLICY "users can upload remittance delivery proofs"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'remittance-delivery-proofs' AND
  -- Path format: {user_id}/{remittance_id}/filename
  (storage.foldername(name))[1] = (auth.uid())::text
);

SELECT '✅ Added policy: users can upload remittance delivery proofs' as status;

-- STEP 3: Verify the new upload policies were created
SELECT
    '🔐 NEW UPLOAD POLICIES CREATED:' as status,
    policyname,
    CASE
      WHEN with_check IS NOT NULL THEN 'INSERT ✅'
      ELSE 'Other'
    END as operation
FROM pg_policies
WHERE tablename = 'objects'
AND schemaname = 'storage'
AND (policyname = 'users can upload order delivery proofs'
  OR policyname = 'users can upload remittance delivery proofs')
ORDER BY policyname;

-- STEP 5: Record this fix
INSERT INTO _migrations_applied (migration) VALUES
('20251116_add_missing_upload_policies')
ON CONFLICT (migration) DO NOTHING;

SELECT '✅ SUCCESS: Missing upload policies added!' as final_status;
