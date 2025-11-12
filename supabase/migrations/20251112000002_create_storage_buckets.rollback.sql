-- ============================================================================
-- ROLLBACK: STORAGE BUCKETS RLS POLICIES
-- Created: 2025-11-12
-- Purpose: Remove RLS policies from storage buckets
-- ============================================================================

-- Drop all policies related to storage buckets

DROP POLICY IF EXISTS "users can upload order delivery proofs" ON storage.objects;
DROP POLICY IF EXISTS "users can view order delivery proofs" ON storage.objects;
DROP POLICY IF EXISTS "users can delete order delivery proofs" ON storage.objects;
DROP POLICY IF EXISTS "admins can view all order delivery proofs" ON storage.objects;

DROP POLICY IF EXISTS "users can upload remittance delivery proofs" ON storage.objects;
DROP POLICY IF EXISTS "users can view remittance delivery proofs" ON storage.objects;
DROP POLICY IF EXISTS "users can delete remittance delivery proofs" ON storage.objects;
DROP POLICY IF EXISTS "admins can view all remittance delivery proofs" ON storage.objects;

-- ============================================================================
