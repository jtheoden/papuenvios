/**
 * REMITTANCES DATA PERSISTENCE VERIFICATION
 * Execute these queries in Supabase SQL Editor to verify actual schema and data persistence
 * Last Updated: 2025-11-29
 */

-- ============================================================================
-- QUERY 1: REMITTANCES TABLE STRUCTURE
-- Shows all columns in the remittances table with their data types
-- ============================================================================
SELECT
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'remittances'
ORDER BY ordinal_position;

-- Expected output should show these key columns for proof persistence:
-- payment_proof_url (text)
-- payment_proof_uploaded_at (timestamp with timezone)
-- payment_proof_notes (text)
-- payment_reference (text)
-- payment_validated (boolean)
-- payment_validated_at (timestamp with timezone)
-- payment_validated_by (uuid)
-- payment_rejected_at (timestamp with timezone)
-- payment_rejection_reason (text)
-- delivery_proof_url (text)
-- delivered_at (timestamp with timezone)
-- delivery_notes_admin (text)
-- processing_started_at (timestamp with timezone)


-- ============================================================================
-- QUERY 2: VERIFY PERSISTENCE FIELDS EXIST
-- Checks if critical timestamp and proof fields exist
-- ============================================================================
SELECT
  CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='remittances' AND column_name='payment_proof_uploaded_at') THEN '✓' ELSE '✗' END as "payment_proof_uploaded_at",
  CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='remittances' AND column_name='payment_validated_at') THEN '✓' ELSE '✗' END as "payment_validated_at",
  CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='remittances' AND column_name='payment_rejected_at') THEN '✓' ELSE '✗' END as "payment_rejected_at",
  CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='remittances' AND column_name='delivered_at') THEN '✓' ELSE '✗' END as "delivered_at",
  CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='remittances' AND column_name='payment_proof_url') THEN '✓' ELSE '✗' END as "payment_proof_url",
  CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='remittances' AND column_name='delivery_proof_url') THEN '✓' ELSE '✗' END as "delivery_proof_url",
  CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='remittances' AND column_name='payment_validated_by') THEN '✓' ELSE '✗' END as "payment_validated_by";


-- ============================================================================
-- QUERY 3: SAMPLE REMITTANCE WITH ALL PROOF FIELDS
-- Shows a recent remittance with all persistence-related fields
-- Adjust the LIMIT and WHERE clause as needed
-- ============================================================================
SELECT
  id,
  remittance_number,
  status,
  -- Payment Proof Fields
  payment_proof_url,
  payment_proof_uploaded_at,
  payment_proof_notes,
  payment_reference,
  -- Payment Validation Fields
  payment_validated,
  payment_validated_at,
  payment_validated_by,
  -- Payment Rejection Fields
  payment_rejected_at,
  payment_rejection_reason,
  -- Delivery Fields
  delivery_proof_url,
  delivered_at,
  delivery_notes_admin,
  processing_started_at,
  -- System Fields
  created_at,
  updated_at
FROM remittances
ORDER BY created_at DESC
LIMIT 5;

-- This query should show:
-- ✓ payment_proof_uploaded_at: ISO timestamp when user uploaded payment proof (e.g., 2025-11-29T21:30:45.123Z)
-- ✓ payment_validated_at: ISO timestamp when admin validated payment (e.g., 2025-11-29T21:35:00.456Z)
-- ✓ delivered_at: ISO timestamp when admin confirmed delivery (e.g., 2025-11-29T22:00:00.789Z)
-- ✓ payment_proof_url: File path to payment proof in storage
-- ✓ delivery_proof_url: File path to delivery proof in storage


-- ============================================================================
-- QUERY 4: VERIFY PERSISTENCE IN EACH STATE
-- Shows one remittance example in each state to verify all fields are persisted
-- ============================================================================

-- 4a: PAYMENT_PROOF_UPLOADED state
-- Should show: payment_proof_url, payment_proof_uploaded_at, payment_proof_notes
SELECT
  remittance_number,
  status,
  payment_proof_url,
  payment_proof_uploaded_at,
  payment_proof_notes,
  payment_reference
FROM remittances
WHERE status = 'payment_proof_uploaded'
LIMIT 1;

-- 4b: PAYMENT_VALIDATED state
-- Should show: payment_validated=true, payment_validated_at, payment_validated_by
SELECT
  remittance_number,
  status,
  payment_validated,
  payment_validated_at,
  payment_validated_by
FROM remittances
WHERE status = 'payment_validated'
LIMIT 1;

-- 4c: PAYMENT_REJECTED state
-- Should show: payment_rejected_at, payment_rejection_reason
SELECT
  remittance_number,
  status,
  payment_rejected_at,
  payment_rejection_reason
FROM remittances
WHERE status = 'payment_rejected'
LIMIT 1;

-- 4d: PROCESSING state
-- Should show: processing_started_at, delivery_proof_url or NULL
SELECT
  remittance_number,
  status,
  processing_started_at,
  delivery_proof_url
FROM remittances
WHERE status = 'processing'
LIMIT 1;

-- 4e: DELIVERED state
-- Should show: delivery_proof_url, delivered_at, delivery_notes_admin
SELECT
  remittance_number,
  status,
  delivery_proof_url,
  delivered_at,
  delivery_notes_admin
FROM remittances
WHERE status = 'delivered'
LIMIT 1;


-- ============================================================================
-- QUERY 5: COMPLETE AUDIT TRAIL FOR ONE REMITTANCE
-- Shows full timeline of timestamps for a specific remittance
-- Replace 'REM-2025-XXXX' with actual remittance number
-- ============================================================================
SELECT
  remittance_number,
  status,
  created_at as "Step 1: Remittance Created",
  payment_proof_uploaded_at as "Step 2: User Uploaded Payment Proof",
  payment_validated_at as "Step 3: Admin Validated Payment",
  COALESCE(payment_rejected_at, NULL) as "Step 3b: Admin Rejected Payment (if applicable)",
  processing_started_at as "Step 4: Admin Started Processing",
  delivered_at as "Step 5: Admin Confirmed Delivery",
  COALESCE(completed_at, NULL) as "Step 6: Remittance Completed (if applicable)",
  updated_at as "Last Update"
FROM remittances
WHERE remittance_number = 'REM-2025-XXXX'  -- Replace with actual remittance number
LIMIT 1;


-- ============================================================================
-- QUERY 6: PERSISTENCE INTEGRITY CHECK
-- Verifies that once data is saved, all timestamps exist for complete workflow
-- ============================================================================
SELECT
  remittance_number,
  status,
  CASE WHEN payment_proof_url IS NOT NULL THEN '✓' ELSE '✗' END as "Has Payment Proof URL",
  CASE WHEN payment_proof_uploaded_at IS NOT NULL THEN '✓' ELSE '✗' END as "Has Upload Timestamp",
  CASE WHEN payment_validated_at IS NOT NULL THEN '✓' ELSE '✗' END as "Has Validation Timestamp",
  CASE WHEN delivered_at IS NOT NULL THEN '✓' ELSE '✗' END as "Has Delivery Timestamp",
  CASE WHEN delivery_proof_url IS NOT NULL THEN '✓' ELSE '✗' END as "Has Delivery Proof URL"
FROM remittances
WHERE status IN ('payment_validated', 'processing', 'delivered', 'completed')
ORDER BY created_at DESC
LIMIT 10;


-- ============================================================================
-- QUERY 7: CHECK WHO VALIDATED PAYMENTS
-- Verifies payment_validated_by field contains admin user IDs
-- ============================================================================
SELECT
  r.remittance_number,
  r.status,
  r.payment_validated_at,
  r.payment_validated_by,
  up.full_name as "Validated By (Admin Name)",
  up.role as "Admin Role"
FROM remittances r
LEFT JOIN user_profiles up ON r.payment_validated_by = up.user_id
WHERE r.payment_validated = true
ORDER BY r.payment_validated_at DESC
LIMIT 10;


-- ============================================================================
-- QUERY 8: DATA PERSISTENCE SUMMARY
-- Overall statistics on proof persistence
-- ============================================================================
SELECT
  COUNT(*) as "Total Remittances",
  COUNT(CASE WHEN payment_proof_url IS NOT NULL THEN 1 END) as "With Payment Proof",
  COUNT(CASE WHEN payment_proof_uploaded_at IS NOT NULL THEN 1 END) as "With Upload Timestamp",
  COUNT(CASE WHEN payment_validated_at IS NOT NULL THEN 1 END) as "With Validation Timestamp",
  COUNT(CASE WHEN delivery_proof_url IS NOT NULL THEN 1 END) as "With Delivery Proof",
  COUNT(CASE WHEN delivered_at IS NOT NULL THEN 1 END) as "With Delivery Timestamp",
  COUNT(CASE WHEN payment_rejection_reason IS NOT NULL THEN 1 END) as "With Rejection Reason"
FROM remittances;
