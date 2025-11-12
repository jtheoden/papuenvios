-- ============================================================================
-- STORAGE BUCKETS CREATION & RLS POLICIES - CORRECTED
-- Created: 2025-11-12
-- Purpose: Create and configure storage buckets for order and remittance delivery proofs
-- CORRECTED: Removed ALTER TABLE (Supabase controls this), fixed user_id references
-- ============================================================================

-- NOTE: Storage buckets must be created via Supabase dashboard or API
-- This migration sets up RLS policies only
-- For bucket creation, see /docs/migrations/STORAGE_BUCKETS_SETUP.md

-- ============================================================================
-- STEP 1: RLS is already enabled by Supabase on storage.objects
-- We only need to create policies below (no ALTER TABLE needed)
-- ============================================================================

-- ============================================================================
-- STEP 2: Order Delivery Proofs Bucket Policies
-- ============================================================================

-- Users can upload delivery proofs for their own orders
CREATE POLICY IF NOT EXISTS "users can upload order delivery proofs"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'order-delivery-proofs' AND
  (auth.uid())::text = (storage.foldername(name))[1]
);

-- Users can view delivery proofs for their own orders
CREATE POLICY IF NOT EXISTS "users can view order delivery proofs"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'order-delivery-proofs' AND
  (
    (auth.uid())::text = (storage.foldername(name))[1] OR
    EXISTS (
      SELECT 1 FROM public.orders
      WHERE id = (storage.foldername(name))[2]::uuid
      AND (
        orders.user_id = auth.uid() OR
        EXISTS (
          SELECT 1 FROM public.user_profiles
          WHERE id = auth.uid()
          AND role IN ('admin', 'super_admin', 'manager')
        )
      )
    )
  )
);

-- Users can delete their own delivery proofs
CREATE POLICY IF NOT EXISTS "users can delete order delivery proofs"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'order-delivery-proofs' AND
  (auth.uid())::text = (storage.foldername(name))[1]
);

-- Admins can view all delivery proofs
CREATE POLICY IF NOT EXISTS "admins can view all order delivery proofs"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'order-delivery-proofs' AND
  EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = auth.uid()
    AND role IN ('admin', 'super_admin')
  )
);

-- ============================================================================
-- STEP 3: Remittance Delivery Proofs Bucket Policies
-- ============================================================================

-- Users can upload delivery proofs for their own remittances
CREATE POLICY IF NOT EXISTS "users can upload remittance delivery proofs"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'remittance-delivery-proofs' AND
  (auth.uid())::text = (storage.foldername(name))[1]
);

-- Users can view delivery proofs for their own remittances
CREATE POLICY IF NOT EXISTS "users can view remittance delivery proofs"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'remittance-delivery-proofs' AND
  (
    (auth.uid())::text = (storage.foldername(name))[1] OR
    EXISTS (
      SELECT 1 FROM public.remittances
      WHERE id = (storage.foldername(name))[2]::uuid
      AND (
        remittances.user_id = auth.uid() OR
        EXISTS (
          SELECT 1 FROM public.user_profiles
          WHERE id = auth.uid()
          AND role IN ('admin', 'super_admin', 'manager')
        )
      )
    )
  )
);

-- Users can delete their own delivery proofs
CREATE POLICY IF NOT EXISTS "users can delete remittance delivery proofs"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'remittance-delivery-proofs' AND
  (auth.uid())::text = (storage.foldername(name))[1]
);

-- Admins and managers can view all remittance proofs
CREATE POLICY IF NOT EXISTS "admins can view all remittance delivery proofs"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'remittance-delivery-proofs' AND
  EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = auth.uid()
    AND role IN ('admin', 'super_admin', 'manager')
  )
);

-- ============================================================================
-- VERIFICATION QUERIES
-- ============================================================================
/*
-- Check RLS policies on storage
SELECT schemaname, tablename, policyname, permissive, roles, qual, with_check
FROM pg_policies
WHERE schemaname = 'storage'
AND tablename = 'objects'
ORDER BY policyname;

-- Test bucket access
SELECT name, bucket_id FROM storage.objects
WHERE bucket_id IN ('order-delivery-proofs', 'remittance-delivery-proofs')
LIMIT 10;
*/

-- ============================================================================
