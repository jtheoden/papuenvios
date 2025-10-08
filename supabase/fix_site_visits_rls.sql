-- Fix RLS policies for site_visits table
-- This script adds the necessary policies to allow reading visit statistics

-- Drop existing policies if any
DROP POLICY IF EXISTS "Allow public read access to site_visits" ON public.site_visits;
DROP POLICY IF EXISTS "Allow admin read access to site_visits" ON public.site_visits;
DROP POLICY IF EXISTS "Allow insert for tracking visits" ON public.site_visits;

-- Enable RLS on site_visits table
ALTER TABLE public.site_visits ENABLE ROW LEVEL SECURITY;

-- Policy 1: Allow authenticated admins to read all visit data
CREATE POLICY "Allow admin read access to site_visits"
ON public.site_visits
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE user_profiles.user_id = auth.uid()
    AND user_profiles.role IN ('admin', 'super_admin')
  )
);

-- Policy 2: Allow public insert for tracking visits (anonymous users can log visits)
CREATE POLICY "Allow insert for tracking visits"
ON public.site_visits
FOR INSERT
TO public
WITH CHECK (true);

-- Grant necessary permissions
GRANT SELECT ON public.site_visits TO authenticated;
GRANT INSERT ON public.site_visits TO anon;
GRANT INSERT ON public.site_visits TO authenticated;

-- Verify policies are created
SELECT schemaname, tablename, policyname, permissive, roles, cmd
FROM pg_policies
WHERE tablename = 'site_visits';
