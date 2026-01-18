-- =====================================================
-- MIGRACIÓN: Fix notification_settings RLS para todos los usuarios
-- Ejecutada: 2026-01-18
--
-- PROBLEMA:
-- 1. Solo admins podían leer notification_settings debido a RLS
-- 2. La función current_user_role() puede no existir
-- 3. Los admins no podían guardar settings (permission denied)
--
-- SOLUCIÓN:
-- 1. Crear/actualizar función current_user_role() si no existe
-- 2. Permitir a TODOS los usuarios LEER (settings son info pública del negocio)
-- 3. Permitir a admins escribir usando función que funcione
-- =====================================================

-- 1. Crear función current_user_role() si no existe
CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS text AS $$
DECLARE
    user_role text;
BEGIN
    SELECT role INTO user_role
    FROM public.user_profiles
    WHERE id = auth.uid()
    LIMIT 1;

    RETURN COALESCE(user_role, 'user');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- Dar permisos de ejecución
GRANT EXECUTE ON FUNCTION public.current_user_role() TO authenticated, anon;

-- 2. Eliminar TODAS las políticas existentes de notification_settings
DROP POLICY IF EXISTS "Admins can view notification settings" ON public.notification_settings;
DROP POLICY IF EXISTS "Admins can insert notification settings" ON public.notification_settings;
DROP POLICY IF EXISTS "Admins can update notification settings" ON public.notification_settings;
DROP POLICY IF EXISTS "Admins can delete notification settings" ON public.notification_settings;
DROP POLICY IF EXISTS "Service role full access notification settings" ON public.notification_settings;
DROP POLICY IF EXISTS "All authenticated users can view notification settings" ON public.notification_settings;

-- 3. Habilitar RLS (por si acaso no está habilitado)
ALTER TABLE public.notification_settings ENABLE ROW LEVEL SECURITY;

-- 4. Crear nuevas políticas

-- 4a. TODOS los usuarios autenticados pueden LEER (settings son info pública)
CREATE POLICY "All users can read notification settings"
ON public.notification_settings FOR SELECT
TO authenticated
USING (true);

-- 4b. Admins pueden INSERT
CREATE POLICY "Admins can insert notification settings"
ON public.notification_settings FOR INSERT
TO authenticated
WITH CHECK (public.current_user_role() IN ('admin', 'super_admin'));

-- 4c. Admins pueden UPDATE
CREATE POLICY "Admins can update notification settings"
ON public.notification_settings FOR UPDATE
TO authenticated
USING (public.current_user_role() IN ('admin', 'super_admin'))
WITH CHECK (public.current_user_role() IN ('admin', 'super_admin'));

-- 4d. Admins pueden DELETE
CREATE POLICY "Admins can delete notification settings"
ON public.notification_settings FOR DELETE
TO authenticated
USING (public.current_user_role() IN ('admin', 'super_admin'));

-- 4e. Service role tiene acceso total (para edge functions)
CREATE POLICY "Service role full access"
ON public.notification_settings FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- 5. Verificar que existan las entradas necesarias
INSERT INTO public.notification_settings (setting_type, value, is_active, description)
SELECT 'whatsapp_admin_phone', '', true, 'Número de WhatsApp para notificaciones'
WHERE NOT EXISTS (SELECT 1 FROM public.notification_settings WHERE setting_type = 'whatsapp_admin_phone');

INSERT INTO public.notification_settings (setting_type, value, is_active, description)
SELECT 'whatsapp_group', '', true, 'URL del grupo de WhatsApp para notificaciones'
WHERE NOT EXISTS (SELECT 1 FROM public.notification_settings WHERE setting_type = 'whatsapp_group');

INSERT INTO public.notification_settings (setting_type, value, is_active, description)
SELECT 'whatsapp_target', 'whatsapp', true, 'Destino de notificaciones: whatsapp o whatsappGroup'
WHERE NOT EXISTS (SELECT 1 FROM public.notification_settings WHERE setting_type = 'whatsapp_target');

INSERT INTO public.notification_settings (setting_type, value, is_active, description)
SELECT 'admin_email', '', true, 'Email de administración'
WHERE NOT EXISTS (SELECT 1 FROM public.notification_settings WHERE setting_type = 'admin_email');
