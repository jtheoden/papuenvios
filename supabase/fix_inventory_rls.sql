-- Fix Inventory Table RLS Policies
-- Issue: Permission denied (403) when trying to insert/update inventory
-- Date: 2025-10-03

-- First, enable RLS on inventory table
ALTER TABLE public.inventory ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (to avoid conflicts)
DROP POLICY IF EXISTS "inventory_viewable_by_everyone" ON public.inventory;
DROP POLICY IF EXISTS "inventory_manageable_by_admins" ON public.inventory;
DROP POLICY IF EXISTS "inventory_insertable_by_admins" ON public.inventory;
DROP POLICY IF EXISTS "inventory_updatable_by_admins" ON public.inventory;
DROP POLICY IF EXISTS "inventory_deletable_by_admins" ON public.inventory;

-- Policy 1: Public can view active inventory (for product availability)
CREATE POLICY "inventory_viewable_by_everyone"
ON public.inventory
FOR SELECT
TO anon, authenticated
USING (is_active = true);

-- Policy 2: Admins can insert inventory
CREATE POLICY "inventory_insertable_by_admins"
ON public.inventory
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE user_id = auth.uid()
    AND role IN ('admin', 'super_admin')
    AND is_enabled = true
  )
);

-- Policy 3: Admins can update inventory
CREATE POLICY "inventory_updatable_by_admins"
ON public.inventory
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE user_id = auth.uid()
    AND role IN ('admin', 'super_admin')
    AND is_enabled = true
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE user_id = auth.uid()
    AND role IN ('admin', 'super_admin')
    AND is_enabled = true
  )
);

-- Policy 4: Admins can delete (soft delete) inventory
CREATE POLICY "inventory_deletable_by_admins"
ON public.inventory
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE user_id = auth.uid()
    AND role IN ('admin', 'super_admin')
    AND is_enabled = true
  )
);

-- Grant necessary permissions
GRANT SELECT ON public.inventory TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.inventory TO authenticated;

-- Verify policies
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual
FROM pg_policies
WHERE tablename = 'inventory';
