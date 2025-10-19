-- ============================================================================
-- APLICAR POLÍTICAS RLS - SISTEMA DE REMESAS
-- ============================================================================
-- Ejecuta este script COMPLETO en Supabase SQL Editor
-- ============================================================================

-- ============================================================================
-- PASO 1: Verificar tu rol de usuario
-- ============================================================================
SELECT
  up.user_id,
  up.email,
  up.role,
  up.full_name,
  up.is_enabled,
  CASE
    WHEN up.role IN ('admin', 'super_admin') THEN '✅ Tienes permisos de admin'
    ELSE '❌ NO tienes permisos de admin - Necesitas actualizar tu rol'
  END as status
FROM user_profiles up
WHERE up.user_id = auth.uid();

-- Si NO eres admin, ejecuta esto (descomenta las líneas):
/*
UPDATE user_profiles
SET role = 'super_admin'
WHERE user_id = auth.uid();

-- Verifica el cambio:
SELECT user_id, email, role, full_name FROM user_profiles WHERE user_id = auth.uid();
*/

-- ============================================================================
-- PASO 2: Habilitar RLS en las 3 tablas de remesas
-- ============================================================================

ALTER TABLE remittance_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE remittances ENABLE ROW LEVEL SECURITY;
ALTER TABLE remittance_status_history ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- PASO 3: Limpiar políticas antiguas (si existen)
-- ============================================================================

-- Políticas de remittance_types
DROP POLICY IF EXISTS "Anyone can view active remittance types" ON remittance_types;
DROP POLICY IF EXISTS "Admins can view all remittance types" ON remittance_types;
DROP POLICY IF EXISTS "Only admins can insert remittance types" ON remittance_types;
DROP POLICY IF EXISTS "Only admins can update remittance types" ON remittance_types;
DROP POLICY IF EXISTS "Only super admins can delete remittance types" ON remittance_types;

-- Políticas de remittances
DROP POLICY IF EXISTS "Users can view own remittances" ON remittances;
DROP POLICY IF EXISTS "Users can create own remittances" ON remittances;
DROP POLICY IF EXISTS "Users can update own remittances" ON remittances;
DROP POLICY IF EXISTS "Admins can update any remittance" ON remittances;
DROP POLICY IF EXISTS "Only super admins can delete remittances" ON remittances;

-- Políticas de remittance_status_history
DROP POLICY IF EXISTS "Users can view own remittance history" ON remittance_status_history;

-- ============================================================================
-- PASO 4: Crear políticas para REMITTANCE_TYPES
-- ============================================================================

-- 1. SELECT: Todos pueden ver tipos activos
CREATE POLICY "Anyone can view active remittance types"
  ON remittance_types
  FOR SELECT
  USING (is_active = true);

-- 2. SELECT: Admins pueden ver todos los tipos (incluso inactivos)
CREATE POLICY "Admins can view all remittance types"
  ON remittance_types
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.user_id = auth.uid()
      AND user_profiles.role IN ('admin', 'super_admin')
    )
  );

-- 3. INSERT: Solo admins pueden crear tipos
CREATE POLICY "Only admins can insert remittance types"
  ON remittance_types
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.user_id = auth.uid()
      AND user_profiles.role IN ('admin', 'super_admin')
    )
  );

-- 4. UPDATE: Solo admins pueden actualizar tipos
CREATE POLICY "Only admins can update remittance types"
  ON remittance_types
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.user_id = auth.uid()
      AND user_profiles.role IN ('admin', 'super_admin')
    )
  );

-- 5. DELETE: Solo super_admins pueden eliminar tipos
CREATE POLICY "Only super admins can delete remittance types"
  ON remittance_types
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.user_id = auth.uid()
      AND user_profiles.role = 'super_admin'
    )
  );

-- ============================================================================
-- PASO 5: Crear políticas para REMITTANCES
-- ============================================================================

-- 1. SELECT: Los usuarios ven solo sus propias remesas, admins ven todas
CREATE POLICY "Users can view own remittances"
  ON remittances
  FOR SELECT
  USING (
    auth.uid() = user_id OR
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.user_id = auth.uid()
      AND user_profiles.role IN ('admin', 'super_admin')
    )
  );

-- 2. INSERT: Los usuarios pueden crear sus propias remesas
CREATE POLICY "Users can create own remittances"
  ON remittances
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- 3. UPDATE: Los usuarios pueden actualizar sus propias remesas (solo en ciertos estados)
CREATE POLICY "Users can update own remittances"
  ON remittances
  FOR UPDATE
  USING (
    auth.uid() = user_id AND
    status IN ('payment_pending', 'payment_rejected')
  );

-- 4. UPDATE: Los admins pueden actualizar cualquier remesa
CREATE POLICY "Admins can update any remittance"
  ON remittances
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.user_id = auth.uid()
      AND user_profiles.role IN ('admin', 'super_admin')
    )
  );

-- 5. DELETE: Solo super_admins pueden eliminar remesas
CREATE POLICY "Only super admins can delete remittances"
  ON remittances
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.user_id = auth.uid()
      AND user_profiles.role = 'super_admin'
    )
  );

-- ============================================================================
-- PASO 6: Crear políticas para REMITTANCE_STATUS_HISTORY
-- ============================================================================

-- 1. SELECT: Los usuarios ven el historial de sus propias remesas
CREATE POLICY "Users can view own remittance history"
  ON remittance_status_history
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM remittances
      WHERE remittances.id = remittance_status_history.remittance_id
      AND (
        remittances.user_id = auth.uid() OR
        EXISTS (
          SELECT 1 FROM user_profiles
          WHERE user_profiles.user_id = auth.uid()
          AND user_profiles.role IN ('admin', 'super_admin')
        )
      )
    )
  );

-- ============================================================================
-- PASO 7: Verificar que las políticas se crearon correctamente
-- ============================================================================

SELECT
  schemaname,
  tablename,
  policyname,
  cmd as operacion,
  CASE
    WHEN cmd = 'SELECT' THEN '📖 Ver/Leer'
    WHEN cmd = 'INSERT' THEN '➕ Crear'
    WHEN cmd = 'UPDATE' THEN '✏️ Actualizar'
    WHEN cmd = 'DELETE' THEN '🗑️ Eliminar'
  END as tipo_operacion,
  CASE
    WHEN policyname LIKE '%super%' THEN '🔴 Solo Super Admins'
    WHEN policyname LIKE '%admin%' THEN '🟡 Solo Admins'
    WHEN policyname LIKE '%own%' THEN '🟢 Propios Usuarios'
    ELSE '🔵 Todos (públicos)'
  END as quien_puede
FROM pg_policies
WHERE tablename IN ('remittance_types', 'remittances', 'remittance_status_history')
ORDER BY tablename, cmd;

-- Deberías ver 13 políticas en total:
-- - 5 para remittance_types
-- - 5 para remittances
-- - 1 para remittance_status_history
-- - 2 adicionales para remittances (users can view/update own)

-- ============================================================================
-- PASO 8: Verificar que RLS está habilitado
-- ============================================================================

SELECT
  schemaname,
  tablename,
  rowsecurity as rls_enabled,
  CASE
    WHEN rowsecurity THEN '✅ RLS Habilitado'
    ELSE '❌ RLS Deshabilitado'
  END as status
FROM pg_tables
WHERE tablename IN ('remittance_types', 'remittances', 'remittance_status_history')
ORDER BY tablename;

-- ============================================================================
-- PASO 9: Probar que funciona (SOLO SI ERES ADMIN)
-- ============================================================================

-- Test 1: Ver tipos de remesas (debería funcionar)
-- SELECT * FROM remittance_types;

-- Test 2: Crear un tipo de remesa de prueba (debería funcionar si eres admin)
/*
INSERT INTO remittance_types (
  name,
  currency_code,
  delivery_currency,
  exchange_rate,
  commission_percentage,
  commission_fixed,
  min_amount,
  max_amount,
  delivery_method,
  max_delivery_days,
  warning_days,
  description,
  icon,
  display_order,
  is_active
) VALUES (
  '🧪 TEST - Dólares a CUP',
  'USD',
  'CUP',
  320.00,
  2.5,
  0,
  10.00,
  1000.00,
  'cash',
  3,
  2,
  'Test de tipo de remesa - ELIMINAR DESPUÉS',
  'dollar-sign',
  999,
  false
) RETURNING *;
*/

-- Test 3: Eliminar el test (si lo creaste)
-- DELETE FROM remittance_types WHERE name LIKE '%TEST%';

-- ============================================================================
-- ✅ VERIFICACIÓN FINAL
-- ============================================================================

-- Ejecuta esta consulta para ver un resumen completo:
SELECT
  '✅ CONFIGURACIÓN COMPLETADA' as status,
  (SELECT COUNT(*) FROM pg_policies WHERE tablename = 'remittance_types') as policies_remittance_types,
  (SELECT COUNT(*) FROM pg_policies WHERE tablename = 'remittances') as policies_remittances,
  (SELECT COUNT(*) FROM pg_policies WHERE tablename = 'remittance_status_history') as policies_history,
  (SELECT role FROM user_profiles WHERE user_id = auth.uid()) as tu_rol,
  CASE
    WHEN (SELECT role FROM user_profiles WHERE user_id = auth.uid()) IN ('admin', 'super_admin')
    THEN '✅ Puedes crear tipos de remesas'
    ELSE '❌ Necesitas ser admin'
  END as permiso_crear;

-- ============================================================================
-- 🎯 PRÓXIMOS PASOS
-- ============================================================================

-- 1. Cierra sesión en tu aplicación
-- 2. Vuelve a iniciar sesión
-- 3. Ve a Dashboard → Tipos de Remesas
-- 4. Intenta crear un nuevo tipo
-- 5. Debería funcionar sin error 403

-- Si aún da error, ejecuta:
-- SELECT user_id, email, role FROM user_profiles WHERE user_id = auth.uid();
-- Y verifica que role sea 'admin' o 'super_admin'

-- ============================================================================
-- 📚 DOCUMENTACIÓN
-- ============================================================================

-- Ver políticas creadas:
-- SELECT * FROM pg_policies WHERE tablename LIKE 'remittance%';

-- Ver permisos de tabla:
-- SELECT grantee, privilege_type FROM information_schema.role_table_grants
-- WHERE table_name = 'remittance_types';

-- Deshabilitar RLS temporalmente (NO RECOMENDADO):
-- ALTER TABLE remittance_types DISABLE ROW LEVEL SECURITY;

-- Re-habilitar RLS:
-- ALTER TABLE remittance_types ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- ✅ SCRIPT COMPLETADO
-- ============================================================================
