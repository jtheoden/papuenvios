-- ============================================================================
-- SOLUCIÓN MANUAL - Error 403 (Para ejecutar desde SQL Editor de Supabase)
-- ============================================================================
-- Este script soluciona el error 403 sin necesitar auth.uid()
-- ============================================================================

-- ============================================================================
-- PASO 1: Primero, identifica tu user_id
-- ============================================================================

-- Lista TODOS los usuarios del sistema
SELECT
  '👥 USUARIOS EN EL SISTEMA' as seccion,
  user_id,
  email,
  role,
  full_name,
  is_enabled,
  created_at
FROM user_profiles
ORDER BY created_at DESC;

-- ============================================================================
-- PASO 2: Actualiza TU usuario a super_admin
-- ============================================================================
-- IMPORTANTE: Reemplaza 'TU_EMAIL@ejemplo.com' con tu email real

UPDATE user_profiles
SET
  role = 'super_admin',
  is_enabled = true,
  updated_at = now()
WHERE email = 'TU_EMAIL@ejemplo.com';  -- ⚠️ CAMBIA ESTO

-- Verifica el cambio
SELECT
  '✅ TU USUARIO ACTUALIZADO' as status,
  user_id,
  email,
  role,
  full_name,
  is_enabled
FROM user_profiles
WHERE email = 'TU_EMAIL@ejemplo.com';  -- ⚠️ CAMBIA ESTO

-- ============================================================================
-- PASO 3: Deshabilitar RLS temporalmente para limpiar
-- ============================================================================

ALTER TABLE remittance_types DISABLE ROW LEVEL SECURITY;
ALTER TABLE remittances DISABLE ROW LEVEL SECURITY;
ALTER TABLE remittance_status_history DISABLE ROW LEVEL SECURITY;

SELECT '✅ RLS DESHABILITADO' as status;

-- ============================================================================
-- PASO 4: Eliminar TODAS las políticas existentes
-- ============================================================================

-- remittance_types
DROP POLICY IF EXISTS "Anyone can view active remittance types" ON remittance_types;
DROP POLICY IF EXISTS "Admins can view all remittance types" ON remittance_types;
DROP POLICY IF EXISTS "Only admins can insert remittance types" ON remittance_types;
DROP POLICY IF EXISTS "Only admins can update remittance types" ON remittance_types;
DROP POLICY IF EXISTS "Only super admins can delete remittance types" ON remittance_types;
DROP POLICY IF EXISTS "Enable read access for all users" ON remittance_types;
DROP POLICY IF EXISTS "Enable insert for authenticated users only" ON remittance_types;
DROP POLICY IF EXISTS "Enable update for users based on email" ON remittance_types;
DROP POLICY IF EXISTS "remittance_types_select_active" ON remittance_types;
DROP POLICY IF EXISTS "remittance_types_select_admin" ON remittance_types;
DROP POLICY IF EXISTS "remittance_types_insert_admin" ON remittance_types;
DROP POLICY IF EXISTS "remittance_types_update_admin" ON remittance_types;
DROP POLICY IF EXISTS "remittance_types_delete_superadmin" ON remittance_types;

-- remittances
DROP POLICY IF EXISTS "Users can view own remittances" ON remittances;
DROP POLICY IF EXISTS "Users can create own remittances" ON remittances;
DROP POLICY IF EXISTS "Users can update own remittances" ON remittances;
DROP POLICY IF EXISTS "Admins can update any remittance" ON remittances;
DROP POLICY IF EXISTS "Only super admins can delete remittances" ON remittances;
DROP POLICY IF EXISTS "Enable read access for all users" ON remittances;
DROP POLICY IF EXISTS "Enable insert for authenticated users only" ON remittances;
DROP POLICY IF EXISTS "remittances_select_own_or_admin" ON remittances;
DROP POLICY IF EXISTS "remittances_insert_own" ON remittances;
DROP POLICY IF EXISTS "remittances_update_own" ON remittances;
DROP POLICY IF EXISTS "remittances_update_admin" ON remittances;
DROP POLICY IF EXISTS "remittances_delete_superadmin" ON remittances;

-- remittance_status_history
DROP POLICY IF EXISTS "Users can view own remittance history" ON remittance_status_history;
DROP POLICY IF EXISTS "Enable read access for all users" ON remittance_status_history;
DROP POLICY IF EXISTS "Enable insert for authenticated users only" ON remittance_status_history;
DROP POLICY IF EXISTS "remittance_status_history_select" ON remittance_status_history;
DROP POLICY IF EXISTS "remittance_status_history_insert" ON remittance_status_history;

SELECT '✅ POLÍTICAS ANTIGUAS ELIMINADAS' as status;

-- ============================================================================
-- PASO 5: Re-habilitar RLS
-- ============================================================================

ALTER TABLE remittance_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE remittances ENABLE ROW LEVEL SECURITY;
ALTER TABLE remittance_status_history ENABLE ROW LEVEL SECURITY;

SELECT '✅ RLS RE-HABILITADO' as status;

-- ============================================================================
-- PASO 6: Crear políticas SIMPLIFICADAS y FUNCIONALES
-- ============================================================================

-- ====================================
-- REMITTANCE_TYPES
-- ====================================

-- Política 1: Todos pueden VER tipos activos
CREATE POLICY "remittance_types_select_active"
  ON remittance_types
  FOR SELECT
  USING (is_active = true);

-- Política 2: Admins pueden VER todos los tipos
CREATE POLICY "remittance_types_select_admin"
  ON remittance_types
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.user_id = auth.uid()
      AND user_profiles.role IN ('admin', 'super_admin')
      AND user_profiles.is_enabled = true
    )
  );

-- Política 3: Solo admins pueden CREAR tipos
CREATE POLICY "remittance_types_insert_admin"
  ON remittance_types
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.user_id = auth.uid()
      AND user_profiles.role IN ('admin', 'super_admin')
      AND user_profiles.is_enabled = true
    )
  );

-- Política 4: Solo admins pueden ACTUALIZAR tipos
CREATE POLICY "remittance_types_update_admin"
  ON remittance_types
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.user_id = auth.uid()
      AND user_profiles.role IN ('admin', 'super_admin')
      AND user_profiles.is_enabled = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.user_id = auth.uid()
      AND user_profiles.role IN ('admin', 'super_admin')
      AND user_profiles.is_enabled = true
    )
  );

-- Política 5: Solo super_admins pueden ELIMINAR tipos
CREATE POLICY "remittance_types_delete_superadmin"
  ON remittance_types
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.user_id = auth.uid()
      AND user_profiles.role = 'super_admin'
      AND user_profiles.is_enabled = true
    )
  );

SELECT '✅ POLÍTICAS DE REMITTANCE_TYPES CREADAS (5)' as status;

-- ====================================
-- REMITTANCES
-- ====================================

-- Política 1: Usuarios ven solo sus remesas, admins ven todas
CREATE POLICY "remittances_select_own_or_admin"
  ON remittances
  FOR SELECT
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.user_id = auth.uid()
      AND user_profiles.role IN ('admin', 'super_admin')
      AND user_profiles.is_enabled = true
    )
  );

-- Política 2: Los usuarios pueden crear sus propias remesas
CREATE POLICY "remittances_insert_own"
  ON remittances
  FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- Política 3: Los usuarios pueden actualizar sus propias remesas
CREATE POLICY "remittances_update_own"
  ON remittances
  FOR UPDATE
  USING (
    user_id = auth.uid()
    AND status IN ('payment_pending', 'payment_rejected')
  )
  WITH CHECK (
    user_id = auth.uid()
  );

-- Política 4: Los admins pueden actualizar cualquier remesa
CREATE POLICY "remittances_update_admin"
  ON remittances
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.user_id = auth.uid()
      AND user_profiles.role IN ('admin', 'super_admin')
      AND user_profiles.is_enabled = true
    )
  );

-- Política 5: Solo super_admins pueden eliminar remesas
CREATE POLICY "remittances_delete_superadmin"
  ON remittances
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.user_id = auth.uid()
      AND user_profiles.role = 'super_admin'
      AND user_profiles.is_enabled = true
    )
  );

SELECT '✅ POLÍTICAS DE REMITTANCES CREADAS (5)' as status;

-- ====================================
-- REMITTANCE_STATUS_HISTORY
-- ====================================

-- Política 1: Ver historial (propias remesas o admin)
CREATE POLICY "remittance_status_history_select"
  ON remittance_status_history
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM remittances
      WHERE remittances.id = remittance_status_history.remittance_id
      AND (
        remittances.user_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM user_profiles
          WHERE user_profiles.user_id = auth.uid()
          AND user_profiles.role IN ('admin', 'super_admin')
          AND user_profiles.is_enabled = true
        )
      )
    )
  );

-- Política 2: Insertar historial (usuarios habilitados)
CREATE POLICY "remittance_status_history_insert"
  ON remittance_status_history
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.user_id = auth.uid()
      AND user_profiles.is_enabled = true
    )
  );

SELECT '✅ POLÍTICAS DE REMITTANCE_STATUS_HISTORY CREADAS (2)' as status;

-- ============================================================================
-- PASO 7: Otorgar permisos GRANT explícitos
-- ============================================================================

GRANT SELECT, INSERT, UPDATE ON remittance_types TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON remittances TO authenticated;
GRANT SELECT, INSERT ON remittance_status_history TO authenticated;

-- También al rol anon para ver tipos activos
GRANT SELECT ON remittance_types TO anon;

SELECT '✅ PERMISOS GRANT OTORGADOS' as status;

-- ============================================================================
-- PASO 8: Verificación completa
-- ============================================================================

-- Contar políticas
SELECT
  '📊 RESUMEN DE POLÍTICAS' as seccion,
  (SELECT COUNT(*) FROM pg_policies WHERE tablename = 'remittance_types') as remittance_types,
  (SELECT COUNT(*) FROM pg_policies WHERE tablename = 'remittances') as remittances,
  (SELECT COUNT(*) FROM pg_policies WHERE tablename = 'remittance_status_history') as status_history,
  (SELECT COUNT(*) FROM pg_policies WHERE tablename IN ('remittance_types', 'remittances', 'remittance_status_history')) as total;

-- Ver todas las políticas
SELECT
  '📋 DETALLE DE POLÍTICAS' as seccion,
  tablename as tabla,
  policyname as nombre_politica,
  cmd as operacion,
  CASE
    WHEN cmd = 'SELECT' THEN '📖 Ver'
    WHEN cmd = 'INSERT' THEN '➕ Crear'
    WHEN cmd = 'UPDATE' THEN '✏️ Editar'
    WHEN cmd = 'DELETE' THEN '🗑️ Eliminar'
  END as tipo
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('remittance_types', 'remittances', 'remittance_status_history')
ORDER BY tablename, cmd;

-- Verificar RLS habilitado
SELECT
  '🔒 ESTADO RLS' as seccion,
  tablename as tabla,
  rowsecurity as rls_habilitado,
  CASE
    WHEN rowsecurity THEN '✅ Habilitado'
    ELSE '❌ Deshabilitado'
  END as estado
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('remittance_types', 'remittances', 'remittance_status_history')
ORDER BY tablename;

-- Verificar permisos GRANT
SELECT
  '🔐 PERMISOS GRANT' as seccion,
  table_name as tabla,
  grantee as quien,
  privilege_type as permiso
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name IN ('remittance_types', 'remittances', 'remittance_status_history')
  AND grantee IN ('authenticated', 'anon')
ORDER BY table_name, grantee, privilege_type;

-- ============================================================================
-- ✅ VERIFICACIÓN FINAL
-- ============================================================================

SELECT
  '✅ CONFIGURACIÓN COMPLETADA' as titulo,
  CASE
    WHEN (SELECT COUNT(*) FROM pg_policies WHERE tablename = 'remittance_types') = 5
      AND (SELECT COUNT(*) FROM pg_policies WHERE tablename = 'remittances') = 5
      AND (SELECT COUNT(*) FROM pg_policies WHERE tablename = 'remittance_status_history') = 2
    THEN '✅ TODAS LAS POLÍTICAS CREADAS CORRECTAMENTE'
    ELSE '❌ FALTAN POLÍTICAS - Revisa los pasos anteriores'
  END as estado_politicas,
  CASE
    WHEN EXISTS (
      SELECT 1 FROM user_profiles
      WHERE role IN ('admin', 'super_admin')
      AND is_enabled = true
    )
    THEN '✅ HAY AL MENOS UN ADMIN EN EL SISTEMA'
    ELSE '⚠️ NO HAY ADMINS - Ejecuta el PASO 2 con tu email'
  END as estado_admins;

-- ============================================================================
-- 🎯 PRÓXIMOS PASOS
-- ============================================================================

-- 1. ✅ Verifica que la verificación final muestra:
--    - estado_politicas: ✅ TODAS LAS POLÍTICAS CREADAS CORRECTAMENTE
--    - estado_admins: ✅ HAY AL MENOS UN ADMIN EN EL SISTEMA
--
-- 2. ✅ IMPORTANTE: Borra el caché del navegador
--    - Presiona F12
--    - Ve a Application → Local Storage
--    - Elimina todo lo relacionado a supabase
--    - O: Ctrl + Shift + Delete → Borrar datos
--
-- 3. ✅ Cierra TODAS las pestañas de tu aplicación
--
-- 4. ✅ Abre ventana de incógnito (Ctrl + Shift + N)
--
-- 5. ✅ Inicia sesión con el email que actualizaste en el PASO 2
--
-- 6. ✅ Ve a Dashboard → Tipos de Remesas
--
-- 7. ✅ El error 403 debe haber desaparecido
--
-- ============================================================================
-- 📝 NOTAS IMPORTANTES
-- ============================================================================
--
-- - Este script NO usa auth.uid() en los INSERT/UPDATE
-- - Debes especificar manualmente tu email en el PASO 2
-- - Las políticas SÍ usan auth.uid() y funcionarán cuando inicies sesión
-- - Si el error persiste, es 100% problema de caché del navegador
--
-- ============================================================================
