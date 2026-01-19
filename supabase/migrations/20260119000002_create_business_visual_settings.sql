-- ============================================================================
-- Create business_visual_settings table for persistent visual customization
-- This stores all visual settings as a JSON object for simplicity and flexibility
-- ============================================================================

-- Step 1: Create the table
CREATE TABLE IF NOT EXISTS public.business_visual_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    settings JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Step 2: Add comment for documentation
COMMENT ON TABLE public.business_visual_settings IS 'Stores business-wide visual customization settings as JSON';
COMMENT ON COLUMN public.business_visual_settings.settings IS 'JSON object containing all visual settings (colors, logo, gradients, etc.)';

-- Step 3: Create updated_at trigger
CREATE OR REPLACE FUNCTION public.update_business_visual_settings_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_business_visual_settings_timestamp ON public.business_visual_settings;
CREATE TRIGGER trigger_update_business_visual_settings_timestamp
    BEFORE UPDATE ON public.business_visual_settings
    FOR EACH ROW
    EXECUTE FUNCTION public.update_business_visual_settings_timestamp();

-- Step 4: Enable RLS
ALTER TABLE public.business_visual_settings ENABLE ROW LEVEL SECURITY;

-- Step 5: Create RLS policies
-- Everyone can read visual settings (needed for consistent UI)
CREATE POLICY "business_visual_settings_select_all"
ON public.business_visual_settings
FOR SELECT
TO authenticated
USING (true);

-- Only admins can modify visual settings
CREATE POLICY "business_visual_settings_insert_admin"
ON public.business_visual_settings
FOR INSERT
TO authenticated
WITH CHECK (public.get_my_role() IN ('admin', 'super_admin'));

CREATE POLICY "business_visual_settings_update_admin"
ON public.business_visual_settings
FOR UPDATE
TO authenticated
USING (public.get_my_role() IN ('admin', 'super_admin'))
WITH CHECK (public.get_my_role() IN ('admin', 'super_admin'));

CREATE POLICY "business_visual_settings_delete_admin"
ON public.business_visual_settings
FOR DELETE
TO authenticated
USING (public.get_my_role() IN ('admin', 'super_admin'));

-- Step 6: Grant table permissions
GRANT SELECT ON public.business_visual_settings TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.business_visual_settings TO authenticated;

-- Step 7: Insert default settings row
INSERT INTO public.business_visual_settings (settings)
VALUES ('{
    "logo": "",
    "favicon": "",
    "companyName": "PapuEnvios",
    "siteTitle": "PapuEnvios - Remesas y E-Commerce",
    "primaryColor": "#2563eb",
    "secondaryColor": "#9333ea",
    "useGradient": true,
    "headerBgColor": "#ffffff",
    "headerTextColor": "#1f2937",
    "headerMenuBgColor": "#ffffff",
    "headerMenuTextColor": "#1f2937",
    "headerMenuHoverBgColor": "#f3f4f6",
    "headerMenuActiveColor": "#2563eb",
    "headingColor": "#1f2937",
    "useHeadingGradient": true,
    "tabActiveColor": "#2563eb",
    "tabActiveBgColor": "#eff6ff",
    "tabInactiveColor": "#6b7280",
    "tabInactiveBgColor": "#f9fafb",
    "buttonBgColor": "#2563eb",
    "buttonTextColor": "#ffffff",
    "buttonHoverBgColor": "#1d4ed8",
    "destructiveBgColor": "#dc2626",
    "destructiveTextColor": "#ffffff",
    "destructiveHoverBgColor": "#b91c1c",
    "accentColor": "#9333ea",
    "pageBgColor": "#f9fafb",
    "cardBgColor": "#ffffff"
}'::jsonb)
ON CONFLICT DO NOTHING;

-- Verification
DO $$
BEGIN
    RAISE NOTICE 'business_visual_settings table created with RLS policies';
END $$;
