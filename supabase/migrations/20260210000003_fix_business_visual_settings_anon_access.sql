-- Fix: business_visual_settings must be readable by anonymous visitors
-- The visual settings (colors, logo, branding) load on every page before auth,
-- so anon role needs SELECT access.

BEGIN;

-- 1. Grant SELECT to anon (was missing — caused 42501 permission denied)
GRANT SELECT ON public.business_visual_settings TO anon;

-- 2. Replace SELECT policy to cover both anon and authenticated
-- (previously only applied to {authenticated})
DROP POLICY IF EXISTS "business_visual_settings_select_all" ON public.business_visual_settings;
CREATE POLICY "business_visual_settings_select_all" ON public.business_visual_settings
  FOR SELECT USING (true);

COMMIT;
