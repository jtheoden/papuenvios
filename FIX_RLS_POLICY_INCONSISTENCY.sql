-- ============================================================================
-- FIX: RLS POLICY INCONSISTENCY
-- ============================================================================
-- Some policies use user_profiles.id, others use user_profiles.user_id
-- Although currently id = user_id, this is inconsistent and dangerous
-- Standardize ALL policies to use user_profiles.user_id
-- ============================================================================

-- STEP 1: Drop inconsistent policies
DROP POLICY IF EXISTS "admins can view all order delivery proofs" ON storage.objects;
DROP POLICY IF EXISTS "managers can upload order delivery proofs" ON storage.objects;
DROP POLICY IF EXISTS "managers can upload remittance delivery proofs" ON storage.objects;
DROP POLICY IF EXISTS "admins can view all remittance delivery proofs" ON storage.objects;

SELECT '✅ Dropped inconsistent policies' as status;

-- STEP 2: Recreate with CONSISTENT user_profiles.user_id
CREATE POLICY "admins can view all order delivery proofs"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'order-delivery-proofs' AND
  EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE user_profiles.user_id = auth.uid()
    AND user_profiles.role IN ('admin', 'super_admin')
    LIMIT 1
  )
);

CREATE POLICY "managers can upload order delivery proofs"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'order-delivery-proofs' AND
  EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE user_profiles.user_id = auth.uid()
    AND user_profiles.role IN ('admin', 'super_admin', 'manager')
    LIMIT 1
  )
);

CREATE POLICY "managers can upload remittance delivery proofs"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'remittance-delivery-proofs' AND
  EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE user_profiles.user_id = auth.uid()
    AND user_profiles.role IN ('admin', 'super_admin', 'manager')
    LIMIT 1
  )
);

CREATE POLICY "admins can view all remittance delivery proofs"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'remittance-delivery-proofs' AND
  EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE user_profiles.user_id = auth.uid()
    AND user_profiles.role IN ('admin', 'super_admin', 'manager')
    LIMIT 1
  )
);

SELECT '✅ Recreated policies with consistent user_profiles.user_id' as status;

-- STEP 3: Record this fix
INSERT INTO _migrations_applied (migration) VALUES
('20251116_fix_rls_policy_inconsistency')
ON CONFLICT (migration) DO NOTHING;

SELECT '✅ SUCCESS: RLS policies are now consistent!' as final_status;
