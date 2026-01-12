-- =====================================================
-- MIGRACIÓN: Fix notification_settings RLS y datos
-- Ejecutada: 2026-01-12
-- =====================================================

-- 1. Habilitar RLS en la tabla
ALTER TABLE public.notification_settings ENABLE ROW LEVEL SECURITY;

-- 2. Crear políticas para admins
CREATE POLICY "Admins can view notification settings"
ON public.notification_settings FOR SELECT
TO authenticated
USING (public.current_user_role() IN ('admin', 'super_admin'));

CREATE POLICY "Admins can insert notification settings"
ON public.notification_settings FOR INSERT
TO authenticated
WITH CHECK (public.current_user_role() IN ('admin', 'super_admin'));

CREATE POLICY "Admins can update notification settings"
ON public.notification_settings FOR UPDATE
TO authenticated
USING (public.current_user_role() IN ('admin', 'super_admin'))
WITH CHECK (public.current_user_role() IN ('admin', 'super_admin'));

CREATE POLICY "Admins can delete notification settings"
ON public.notification_settings FOR DELETE
TO authenticated
USING (public.current_user_role() IN ('admin', 'super_admin'));

CREATE POLICY "Service role full access notification settings"
ON public.notification_settings FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- 3. Corregir nombre de setting_type para que coincida con el código
UPDATE public.notification_settings
SET setting_type = 'whatsapp_admin_phone',
    updated_at = now()
WHERE setting_type = 'admin_whatsapp';

-- 4. Insertar settings faltantes (si no existen)
INSERT INTO public.notification_settings (setting_type, value, is_active, description)
SELECT 'whatsapp_group', '', true, 'URL del grupo de WhatsApp para notificaciones'
WHERE NOT EXISTS (
    SELECT 1 FROM public.notification_settings WHERE setting_type = 'whatsapp_group'
);

INSERT INTO public.notification_settings (setting_type, value, is_active, description)
SELECT 'whatsapp_target', 'whatsapp', true, 'Destino de notificaciones: whatsapp o whatsappGroup'
WHERE NOT EXISTS (
    SELECT 1 FROM public.notification_settings WHERE setting_type = 'whatsapp_target'
);
