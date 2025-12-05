-- ============================================================================
-- Fix category_discounts RLS Policy
-- Created: 2025-12-05
-- Purpose: Allow authenticated users to read category discounts
-- Issue: Users need to see applicable discounts during checkout
-- ============================================================================

-- Drop existing restrictive policy
DROP POLICY IF EXISTS "admins can view discounts" ON public.category_discounts;

-- Create new policy: authenticated users can view all discounts
-- This is safe because discounts are business rules, not sensitive data
DROP POLICY IF EXISTS "authenticated users can view discounts" ON public.category_discounts;
CREATE POLICY "authenticated users can view discounts"
ON public.category_discounts
FOR SELECT
TO authenticated
USING (true);

-- Keep admin management policy
-- (already exists as "super admins can manage discounts")

COMMENT ON POLICY "authenticated users can view discounts" ON public.category_discounts IS
'Allow all authenticated users to view category discounts for checkout calculations';
