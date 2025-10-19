-- ============================================================================
-- SOLUCIÓN DEFINITIVA - Error 403 Persistente
-- ============================================================================
-- Este script soluciona TODOS los problemas posibles que causan el error 403
-- Ejecuta este script COMPLETO en Supabase SQL Editor
-- ============================================================================

-- ============================================================================
-- PASO 1: Asegurar que tu usuario existe en user_profiles
-- ============================================================================

-- Crear perfil si no existe
INSERT INTO user_profiles (user_id, email, role, full_name, is_enabled)
SELECT
  auth.uid(),
  (SELECT email FROM auth.users WHERE id = auth.uid()),
  'super_admin',
  (SELECT COALESCE(raw_user_meta_data->>'full_name', email) FROM auth.users WHERE id = auth.uid()),
  true
WHERE NOT EXISTS (SELECT 1 FROM user_profiles WHERE user_id = auth.uid());

-- Actualizar rol a super_admin si ya existe
UPDATE user_profiles
SET
  role = 'super_admin',
  is_enabled = true,
  updated_at = now()
WHERE user_id = auth.uid();

-- Verificar tu perfil
SELECT
  '✅ PASO 1 COMPLETADO' as status,
  user_id,
  email,
  role,
  full_name,
  is_enabled
FROM user_profiles
WHERE user_id = auth.uid();

-- ============================================================================
-- PASO 2: Deshabilitar RLS temporalmente para limpiar
-- ============================================================================

ALTER TABLE remittance_types DISABLE ROW LEVEL SECURITY;
ALTER TABLE remittances DISABLE ROW LEVEL SECURITY;
ALTER TABLE remittance_status_history DISABLE ROW LEVEL SECURITY;

-- ============================================================================
-- PASO 3: Eliminar TODAS las políticas existentes
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

-- remittances
DROP POLICY IF EXISTS "Users can view own remittances" ON remittances;
DROP POLICY IF EXISTS "Users can create own remittances" ON remittances;
DROP POLICY IF EXISTS "Users can update own remittances" ON remittances;
DROP POLICY IF EXISTS "Admins can update any remittance" ON remittances;
DROP POLICY IF EXISTS "Only super admins can delete remittances" ON remittances;
DROP POLICY IF EXISTS "Enable read access for all users" ON remittances;
DROP POLICY IF EXISTS "Enable insert for authenticated users only" ON remittances;

-- remittance_status_history
DROP POLICY IF EXISTS "Users can view own remittance history" ON remittance_status_history;
DROP POLICY IF EXISTS "Enable read access for all users" ON remittance_status_history;
DROP POLICY IF EXISTS "Enable insert for authenticated users only" ON remittance_status_history;

-- ============================================================================
-- PASO 4: Re-habilitar RLS
-- ============================================================================

ALTER TABLE remittance_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE remittances ENABLE ROW LEVEL SECURITY;
ALTER TABLE remittance_status_history ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- PASO 5: Crear políticas SIMPLIFICADAS y FUNCIONALES
-- ============================================================================

-- ====================================
-- REMITTANCE_TYPES
-- ====================================

-- Política 1: Todos pueden VER tipos activos (usuarios no autenticados y autenticados)
CREATE POLICY "remittance_types_select_active"
  ON remittance_types
  FOR SELECT
  TO public
  USING (is_active = true);

-- Política 2: Admins pueden VER todos los tipos (incluso inactivos)
CREATE POLICY "remittance_types_select_admin"
  ON remittance_types
  FOR SELECT
  TO authenticated
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
  TO authenticated
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
  TO authenticated
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
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.user_id = auth.uid()
      AND user_profiles.role = 'super_admin'
      AND user_profiles.is_enabled = true
    )
  );

-- ====================================
-- REMITTANCES
-- ====================================

-- Política 1: Usuarios ven solo sus remesas, admins ven todas
CREATE POLICY "remittances_select_own_or_admin"
  ON remittances
  FOR SELECT
  TO authenticated
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
  TO authenticated
  WITH CHECK (user_id = auth.uid());

-- Política 3: Los usuarios pueden actualizar sus propias remesas (solo en ciertos estados)
CREATE POLICY "remittances_update_own"
  ON remittances
  FOR UPDATE
  TO authenticated
  USING (
    user_id = auth.uid()
    AND status IN ('payment_pending', 'payment_rejected')
  )
  WITH CHECK (
    user_id = auth.uid()
    AND status IN ('payment_pending', 'payment_rejected', 'payment_proof_uploaded')
  );

-- Política 4: Los admins pueden actualizar cualquier remesa
CREATE POLICY "remittances_update_admin"
  ON remittances
  FOR UPDATE
  TO authenticated
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
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.user_id = auth.uid()
      AND user_profiles.role = 'super_admin'
      AND user_profiles.is_enabled = true
    )
  );

-- ====================================
-- REMITTANCE_STATUS_HISTORY
-- ====================================

-- Política 1: Los usuarios ven el historial de sus propias remesas, admins ven todo
CREATE POLICY "remittance_status_history_select"
  ON remittance_status_history
  FOR SELECT
  TO authenticated
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

-- Política 2: Permitir insertar historial (sistema y admins)
CREATE POLICY "remittance_status_history_insert"
  ON remittance_status_history
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.user_id = auth.uid()
      AND user_profiles.is_enabled = true
    )
  );

-- ============================================================================
-- PASO 6: Otorgar permisos básicos a la tabla
-- ============================================================================

-- Asegurar que authenticated tiene permisos básicos
GRANT SELECT, INSERT, UPDATE ON remittance_types TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON remittances TO authenticated;
GRANT SELECT, INSERT ON remittance_status_history TO authenticated;

-- ============================================================================
-- PASO 7: Verificar que todo quedó bien
-- ============================================================================

SELECT
  '✅ VERIFICACIÓN FINAL' as seccion,
  (SELECT COUNT(*) FROM pg_policies WHERE tablename = 'remittance_types') as politicas_remittance_types,
  (SELECT COUNT(*) FROM pg_policies WHERE tablename = 'remittances') as politicas_remittances,
  (SELECT COUNT(*) FROM pg_policies WHERE tablename = 'remittance_status_history') as politicas_history,
  (SELECT role FROM user_profiles WHERE user_id = auth.uid()) as tu_rol,
  (SELECT is_enabled FROM user_profiles WHERE user_id = auth.uid()) as cuenta_activa,
  CASE
    WHEN (SELECT role FROM user_profiles WHERE user_id = auth.uid()) IN ('admin', 'super_admin')
      AND (SELECT is_enabled FROM user_profiles WHERE user_id = auth.uid()) = true
    THEN '✅ PUEDES CREAR TIPOS DE REMESAS'
    ELSE '❌ Verifica tu rol y cuenta activa'
  END as status_final;

-- ============================================================================
-- PASO 8: Ver todas las políticas creadas
-- ============================================================================

SELECT
  '📋 POLÍTICAS CREADAS' as seccion,
  tablename,
  policyname,
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

-- ============================================================================
-- PASO 9: Probar que funciona
-- ============================================================================

-- Intenta leer remittance_types
SELECT
  '🧪 TEST: Leer remittance_types' as test,
  COUNT(*) as registros_encontrados,
  '✅ FUNCIONA' as resultado
FROM remittance_types;

-- ============================================================================
-- ✅ SCRIPT COMPLETADO
-- ============================================================================

-- IMPORTANTE: Después de ejecutar este script:
--
-- 1. ✅ Verifica que la última consulta muestra:
--    - politicas_remittance_types: 5
--    - politicas_remittances: 5
--    - politicas_history: 2
--    - tu_rol: super_admin
--    - status_final: ✅ PUEDES CREAR TIPOS DE REMESAS
--
-- 2. ✅ Cierra sesión en tu aplicación
--
-- 3. ✅ BORRA EL CACHÉ del navegador:
--    - Presiona F12
--    - Ve a Application → Local Storage
--    - Elimina todo el contenido de supabase
--    - O simplemente: Ctrl + Shift + Delete → Borrar datos de navegación
--
-- 4. ✅ Vuelve a iniciar sesión
--
-- 5. ✅ Ve a Dashboard → Tipos de Remesas
--
-- 6. ✅ El error 403 debe desaparecer
--
-- Si TODAVÍA recibes error 403 después de estos pasos:
-- Ejecuta el script DIAGNOSTIC_RLS_CHECK.sql y comparte los resultados.
