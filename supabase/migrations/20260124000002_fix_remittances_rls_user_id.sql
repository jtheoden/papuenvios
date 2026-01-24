-- Fix remittances RLS policies - use user_id instead of sender_id
-- The RLS policies were incorrectly using sender_id, but the actual column is user_id

BEGIN;

-- Drop existing remittances policies
DROP POLICY IF EXISTS "users can view own remittances" ON public.remittances;
DROP POLICY IF EXISTS "users can insert remittances" ON public.remittances;
DROP POLICY IF EXISTS "users can update own remittances" ON public.remittances;
DROP POLICY IF EXISTS "admins can view all remittances" ON public.remittances;
DROP POLICY IF EXISTS "admins can update all remittances" ON public.remittances;

-- Recreate policies with correct column name (user_id)

-- Users can view their own remittances
CREATE POLICY "users can view own remittances"
ON public.remittances
FOR SELECT
TO authenticated
USING (user_id = current_user_id());

-- Users can create remittances
CREATE POLICY "users can insert remittances"
ON public.remittances
FOR INSERT
TO authenticated
WITH CHECK (user_id = current_user_id());

-- Users can update their own remittances (limited updates)
CREATE POLICY "users can update own remittances"
ON public.remittances
FOR UPDATE
TO authenticated
USING (user_id = current_user_id())
WITH CHECK (user_id = current_user_id());

-- Admins can view all remittances
CREATE POLICY "admins can view all remittances"
ON public.remittances
FOR SELECT
TO authenticated
USING (is_admin() OR is_super_admin());

-- Admins can update all remittances
CREATE POLICY "admins can update all remittances"
ON public.remittances
FOR UPDATE
TO authenticated
USING (is_admin() OR is_super_admin())
WITH CHECK (is_admin() OR is_super_admin());

COMMIT;
