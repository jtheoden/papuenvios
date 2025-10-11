-- =============================================================================
-- UPDATE TESTIMONIALS RLS POLICIES
-- =============================================================================
-- The table already exists with correct schema
-- Just need to ensure RLS policies are correct
-- =============================================================================

-- Enable RLS
ALTER TABLE public.testimonials ENABLE ROW LEVEL SECURITY;

-- Drop all existing policies
DROP POLICY IF EXISTS "Users can view approved testimonials" ON public.testimonials;
DROP POLICY IF EXISTS "Users can view visible testimonials" ON public.testimonials;
DROP POLICY IF EXISTS "Users can create own testimonial" ON public.testimonials;
DROP POLICY IF EXISTS "Users can update own testimonial" ON public.testimonials;
DROP POLICY IF EXISTS "Users can read own testimonial" ON public.testimonials;
DROP POLICY IF EXISTS "Admins can view all testimonials" ON public.testimonials;
DROP POLICY IF EXISTS "Admins can update testimonials" ON public.testimonials;
DROP POLICY IF EXISTS "Admins can delete testimonials" ON public.testimonials;
DROP POLICY IF EXISTS "Admins can manage testimonials" ON public.testimonials;

-- Public can view visible (published) testimonials
CREATE POLICY "Users can view visible testimonials"
ON public.testimonials FOR SELECT
TO anon, authenticated
USING (is_visible = true);

-- Users can read their own testimonial (even if not visible yet)
CREATE POLICY "Users can read own testimonial"
ON public.testimonials FOR SELECT
TO authenticated
USING (user_id = auth.uid());

-- Users can create their own testimonial
CREATE POLICY "Users can create own testimonial"
ON public.testimonials FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

-- Users can update their own testimonial (rating and comment only)
CREATE POLICY "Users can update own testimonial"
ON public.testimonials FOR UPDATE
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

-- Admins can view all testimonials
CREATE POLICY "Admins can view all testimonials"
ON public.testimonials FOR SELECT
TO authenticated
USING (public.current_user_role() IN ('admin', 'super_admin'));

-- Admins can update any testimonial (approve via is_visible, feature, etc.)
CREATE POLICY "Admins can update testimonials"
ON public.testimonials FOR UPDATE
TO authenticated
USING (public.current_user_role() IN ('admin', 'super_admin'))
WITH CHECK (public.current_user_role() IN ('admin', 'super_admin'));

-- Admins can delete testimonials
CREATE POLICY "Admins can delete testimonials"
ON public.testimonials FOR DELETE
TO authenticated
USING (public.current_user_role() IN ('admin', 'super_admin'));

-- Grant permissions
GRANT SELECT ON public.testimonials TO anon, authenticated;
GRANT INSERT, UPDATE ON public.testimonials TO authenticated;
GRANT DELETE ON public.testimonials TO authenticated;

-- Verify policies
SELECT
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'testimonials'
ORDER BY policyname;

SELECT 'Testimonials RLS policies updated successfully!' as result;
