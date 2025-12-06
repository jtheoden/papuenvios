-- Strengthen system_config RLS for notification settings
-- Allow only the service role (used by the notification-settings Edge Function)
-- to read/update protected notification keys while keeping existing visibility
-- for other keys.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'system_config'
      AND policyname = 'Public config viewable by all'
  ) THEN
    DROP POLICY "Public config viewable by all" ON public.system_config;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'system_config'
      AND policyname = 'All config viewable by admins'
  ) THEN
    DROP POLICY "All config viewable by admins" ON public.system_config;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'system_config'
      AND policyname = 'Config manageable by super admins'
  ) THEN
    DROP POLICY "Config manageable by super admins" ON public.system_config;
  END IF;
END $$;

-- Public configs stay visible but exclude protected notification keys
CREATE POLICY "Public config viewable by all"
ON public.system_config FOR SELECT
USING (
  is_public = true
  AND key NOT IN ('whatsapp_admin_phone', 'whatsapp_group', 'admin_email')
);

-- Admins retain read access for non-protected keys
CREATE POLICY "Admins can view non-notification config"
ON public.system_config FOR SELECT
TO authenticated
USING (
  public.current_user_role() IN ('admin', 'super_admin')
  AND key NOT IN ('whatsapp_admin_phone', 'whatsapp_group', 'admin_email')
);

-- Super admins can manage non-protected keys
CREATE POLICY "Super admins manage non-notification config"
ON public.system_config FOR ALL
TO authenticated
USING (
  public.current_user_role() = 'super_admin'
  AND key NOT IN ('whatsapp_admin_phone', 'whatsapp_group', 'admin_email')
)
WITH CHECK (
  public.current_user_role() = 'super_admin'
  AND key NOT IN ('whatsapp_admin_phone', 'whatsapp_group', 'admin_email')
);

-- Service role is allowed to read/update the protected notification keys
CREATE POLICY "Service role reads notification config"
ON public.system_config FOR SELECT
TO service_role
USING (key IN ('whatsapp_admin_phone', 'whatsapp_group', 'admin_email'));

CREATE POLICY "Service role updates notification config"
ON public.system_config FOR UPDATE
TO service_role
USING (key IN ('whatsapp_admin_phone', 'whatsapp_group', 'admin_email'))
WITH CHECK (key IN ('whatsapp_admin_phone', 'whatsapp_group', 'admin_email'));

-- Explicitly prevent anonymous inserts
REVOKE INSERT ON public.system_config FROM anon;
