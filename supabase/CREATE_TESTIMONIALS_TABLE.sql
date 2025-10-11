-- =============================================================================
-- CREATE TESTIMONIALS TABLE
-- =============================================================================
-- Allows users to leave ratings and testimonials about their experience
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.testimonials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  rating integer NOT NULL CHECK (rating >= 1 AND rating <= 5),
  comment text,
  is_approved boolean DEFAULT false,
  is_featured boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),

  CONSTRAINT unique_user_testimonial UNIQUE (user_id)
);

-- Create index for performance
CREATE INDEX IF NOT EXISTS idx_testimonials_user_id ON public.testimonials(user_id);
CREATE INDEX IF NOT EXISTS idx_testimonials_approved ON public.testimonials(is_approved);
CREATE INDEX IF NOT EXISTS idx_testimonials_featured ON public.testimonials(is_featured);

-- Enable RLS
ALTER TABLE public.testimonials ENABLE ROW LEVEL SECURITY;

-- RLS Policies
DROP POLICY IF EXISTS "Users can view approved testimonials" ON public.testimonials;
DROP POLICY IF EXISTS "Users can create own testimonial" ON public.testimonials;
DROP POLICY IF EXISTS "Users can update own testimonial" ON public.testimonials;
DROP POLICY IF EXISTS "Admins can view all testimonials" ON public.testimonials;
DROP POLICY IF EXISTS "Admins can update testimonials" ON public.testimonials;
DROP POLICY IF EXISTS "Admins can delete testimonials" ON public.testimonials;

-- Anyone can view approved testimonials
CREATE POLICY "Users can view approved testimonials"
ON public.testimonials FOR SELECT
TO anon, authenticated
USING (is_approved = true);

-- Users can create their own testimonial (one per user)
CREATE POLICY "Users can create own testimonial"
ON public.testimonials FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

-- Users can update their own testimonial
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

-- Admins can update any testimonial (approve, feature, etc.)
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

-- Verify
SELECT 'Testimonials table created successfully!' as result;
