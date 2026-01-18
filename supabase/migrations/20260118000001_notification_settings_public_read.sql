-- =====================================================
-- MIGRACIÓN: Allow all authenticated users to read notification_settings
-- Ejecutada: 2026-01-18
--
-- PROBLEMA: Solo admins podían leer notification_settings debido a RLS,
-- causando que usuarios normales no pudieran ver el número de WhatsApp
-- para contacto durante el checkout.
--
-- SOLUCIÓN: Los settings de notificación (teléfono WhatsApp, email de contacto)
-- NO son datos sensibles - son información pública del negocio que todos
-- los usuarios necesitan ver para poder contactar soporte.
-- =====================================================

-- 1. Eliminar la política restrictiva existente (solo admins)
DROP POLICY IF EXISTS "Admins can view notification settings" ON public.notification_settings;

-- 2. Crear nueva política que permite a TODOS los usuarios autenticados LEER
-- Los settings de notificación son información pública del negocio
CREATE POLICY "All authenticated users can view notification settings"
ON public.notification_settings FOR SELECT
TO authenticated
USING (true);

-- Las políticas de INSERT, UPDATE, DELETE permanecen restringidas a admins
-- (ya existen en la migración anterior)

-- 3. Verificación: mostrar políticas activas (para debugging)
-- SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual
-- FROM pg_policies WHERE tablename = 'notification_settings';
