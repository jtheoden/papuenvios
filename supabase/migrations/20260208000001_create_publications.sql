-- ============================================================================
-- Create publications table for platform guides/articles
-- Stores help articles with bilingual content, cover images, and video embeds
-- ============================================================================

-- Step 1: Create the table
CREATE TABLE IF NOT EXISTS public.publications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title_es TEXT NOT NULL DEFAULT '',
    title_en TEXT NOT NULL DEFAULT '',
    content_es TEXT NOT NULL DEFAULT '',
    content_en TEXT NOT NULL DEFAULT '',
    cover_image_url TEXT DEFAULT '',
    video_url TEXT DEFAULT '',
    category TEXT NOT NULL DEFAULT 'general',
    is_active BOOLEAN NOT NULL DEFAULT true,
    display_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Step 2: Add comments for documentation
COMMENT ON TABLE public.publications IS 'Platform guide articles with bilingual content, images, and videos';
COMMENT ON COLUMN public.publications.category IS 'Article category: general, orders, remittances, recipients, user-panel';
COMMENT ON COLUMN public.publications.cover_image_url IS 'Supabase Storage URL for cover image';
COMMENT ON COLUMN public.publications.video_url IS 'YouTube or Vimeo URL for embedded video';

-- Step 3: Create updated_at trigger
CREATE OR REPLACE FUNCTION public.update_publications_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_publications_timestamp ON public.publications;
CREATE TRIGGER trigger_update_publications_timestamp
    BEFORE UPDATE ON public.publications
    FOR EACH ROW
    EXECUTE FUNCTION public.update_publications_timestamp();

-- Step 4: Create index on category + is_active for filtered queries
CREATE INDEX IF NOT EXISTS idx_publications_category_active
    ON public.publications (category, is_active);

CREATE INDEX IF NOT EXISTS idx_publications_display_order
    ON public.publications (display_order);

-- Step 5: Enable RLS
ALTER TABLE public.publications ENABLE ROW LEVEL SECURITY;

-- Step 6: Create RLS policies
-- All authenticated users can read active publications
CREATE POLICY "publications_select_authenticated"
ON public.publications
FOR SELECT
TO authenticated
USING (true);

-- Also allow anonymous/public read for active publications (guides page is public)
CREATE POLICY "publications_select_anon"
ON public.publications
FOR SELECT
TO anon
USING (is_active = true);

-- Only admins can insert
CREATE POLICY "publications_insert_admin"
ON public.publications
FOR INSERT
TO authenticated
WITH CHECK (public.get_my_role() IN ('admin', 'super_admin'));

-- Only admins can update
CREATE POLICY "publications_update_admin"
ON public.publications
FOR UPDATE
TO authenticated
USING (public.get_my_role() IN ('admin', 'super_admin'))
WITH CHECK (public.get_my_role() IN ('admin', 'super_admin'));

-- Only admins can delete
CREATE POLICY "publications_delete_admin"
ON public.publications
FOR DELETE
TO authenticated
USING (public.get_my_role() IN ('admin', 'super_admin'));

-- Step 7: Grant table permissions
GRANT SELECT ON public.publications TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.publications TO authenticated;

-- Step 8: Create storage bucket for publication images
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'publications',
    'publications',
    true,
    5242880, -- 5MB
    ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO NOTHING;

-- Step 9: Storage policies for publications bucket
CREATE POLICY "publications_storage_select_all"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'publications');

CREATE POLICY "publications_storage_insert_admin"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
    bucket_id = 'publications'
    AND public.get_my_role() IN ('admin', 'super_admin')
);

CREATE POLICY "publications_storage_update_admin"
ON storage.objects FOR UPDATE
TO authenticated
USING (
    bucket_id = 'publications'
    AND public.get_my_role() IN ('admin', 'super_admin')
);

CREATE POLICY "publications_storage_delete_admin"
ON storage.objects FOR DELETE
TO authenticated
USING (
    bucket_id = 'publications'
    AND public.get_my_role() IN ('admin', 'super_admin')
);

-- Verification
DO $$
BEGIN
    RAISE NOTICE 'publications table created with RLS policies and storage bucket';
END $$;
