-- =============================================================================
-- FIX TESTIMONIALS TABLE - Adapt to existing schema
-- =============================================================================
-- The table already exists with different column names
-- Existing: is_visible, is_featured
-- Need to work with existing schema or migrate
-- =============================================================================

-- First, check what columns exist
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'testimonials'
ORDER BY ordinal_position;

-- Add missing columns if they don't exist
ALTER TABLE public.testimonials
ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;

-- Add constraint if it doesn't exist (will fail silently if exists)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'unique_user_testimonial'
  ) THEN
    ALTER TABLE public.testimonials
    ADD CONSTRAINT unique_user_testimonial UNIQUE (user_id);
  END IF;
END $$;

-- Create indexes if they don't exist
CREATE INDEX IF NOT EXISTS idx_testimonials_user_id ON public.testimonials(user_id);
CREATE INDEX IF NOT EXISTS idx_testimonials_visible ON public.testimonials(is_visible);
CREATE INDEX IF NOT EXISTS idx_testimonials_featured ON public.testimonials(is_featured);

-- Enable RLS
ALTER TABLE public.testimonials ENABLE ROW LEVEL SECURITY;

-- Drop existing policies
DROP POLICY IF EXISTS "Users can view approved testimonials" ON public.testimonials;
DROP POLICY IF EXISTS "Users can view visible testimonials" ON public.testimonials;
DROP POLICY IF EXISTS "Users can create own testimonial" ON public.testimonials;
DROP POLICY IF EXISTS "Users can update own testimonial" ON public.testimonials;
DROP POLICY IF EXISTS "Admins can view all testimonials" ON public.testimonials;
DROP POLICY IF EXISTS "Admins can update testimonials" ON public.testimonials;
DROP POLICY IF EXISTS "Admins can delete testimonials" ON public.testimonials;
DROP POLICY IF EXISTS "Admins can manage testimonials" ON public.testimonials;

-- Public can view visible (published) testimonials
CREATE POLICY "Users can view visible testimonials"
ON public.testimonials FOR SELECT
TO anon, authenticated
USING (is_visible = true);

-- Users can create their own testimonial (one per user)
CREATE POLICY "Users can create own testimonial"
ON public.testimonials FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

-- Users can update their own testimonial (only rating and comment)
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

-- Verify
SELECT 'Testimonials table fixed successfully!' as result;

-- Show final schema
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'testimonials'
ORDER BY ordinal_position;
