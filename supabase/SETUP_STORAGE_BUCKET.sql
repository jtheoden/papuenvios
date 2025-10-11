-- ========================================
-- Setup Storage Bucket for Order Documents
-- ========================================
-- This script creates the storage bucket for payment proof images
-- and sets up appropriate RLS policies

-- Create bucket if it doesn't exist
INSERT INTO storage.buckets (id, name, public)
VALUES ('order-documents', 'order-documents', true)
ON CONFLICT (id) DO UPDATE
SET public = true;

-- Drop existing policies if any
DROP POLICY IF EXISTS "Users can upload payment proofs" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can view payment proofs" ON storage.objects;
DROP POLICY IF EXISTS "Admins can delete payment proofs" ON storage.objects;

-- Allow authenticated users to upload to payment-proofs folder
CREATE POLICY "Users can upload payment proofs"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'order-documents'
  AND (storage.foldername(name))[1] = 'payment-proofs'
);

-- Allow anyone to view payment proof images (public bucket)
CREATE POLICY "Anyone can view payment proofs"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'order-documents');

-- Allow admins to delete payment proofs
CREATE POLICY "Admins can delete payment proofs"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'order-documents'
  AND public.current_user_role() IN ('admin', 'super_admin')
);

-- Grant usage on storage schema
GRANT USAGE ON SCHEMA storage TO authenticated, anon;
GRANT ALL ON storage.objects TO authenticated;
GRANT ALL ON storage.buckets TO authenticated;
