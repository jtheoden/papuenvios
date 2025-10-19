-- ============================================================================
-- FIX RLS PARA REMITTANCE_TYPES - Solución Inmediata
-- ============================================================================
-- IMPORTANTE: Ejecuta este script completo en Supabase SQL Editor
-- ============================================================================

-- PASO 1: Verificar tu rol actual
-- (Esto es solo para ver, no hace cambios)
SELECT
  user_id,
  email,
  role,
  full_name
FROM user_profiles
WHERE user_id = auth.uid();

-- Si el rol no es 'admin' o 'super_admin', ejecuta esto:
-- UPDATE user_profiles SET role = 'super_admin' WHERE user_id = auth.uid();

-- ============================================================================
-- PASO 2: Limpiar políticas antiguas
-- ============================================================================

-- Eliminar políticas existentes si hay alguna
DROP POLICY IF EXISTS "Anyone can view active remittance types" ON remittance_types;
DROP POLICY IF EXISTS "Admins can view all remittance types" ON remittance_types;
DROP POLICY IF EXISTS "Only admins can insert remittance types" ON remittance_types;
DROP POLICY IF EXISTS "Only admins can update remittance types" ON remittance_types;
DROP POLICY IF EXISTS "Only super admins can delete remittance types" ON remittance_types;

-- ============================================================================
-- PASO 3: Asegurar que RLS está habilitado
-- ============================================================================

ALTER TABLE remittance_types ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- PASO 4: Crear políticas correctas
-- ============================================================================

-- 1. Todos pueden VER tipos activos
CREATE POLICY "Anyone can view active remittance types"
  ON remittance_types
  FOR SELECT
  USING (is_active = true);

-- 2. Admins pueden VER todos los tipos (incluso inactivos)
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

-- 3. Admins pueden CREAR nuevos tipos
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

-- 4. Admins pueden ACTUALIZAR tipos
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

-- 5. Solo super_admins pueden ELIMINAR tipos
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
-- PASO 5: Verificar que las políticas se crearon correctamente
-- ============================================================================

SELECT
  policyname,
  cmd,
  CASE
    WHEN cmd = 'SELECT' THEN 'Ver/Leer'
    WHEN cmd = 'INSERT' THEN 'Crear'
    WHEN cmd = 'UPDATE' THEN 'Actualizar'
    WHEN cmd = 'DELETE' THEN 'Eliminar'
  END as operacion,
  CASE
    WHEN policyname LIKE '%admin%' THEN 'Solo Admins'
    WHEN policyname LIKE '%super%' THEN 'Solo Super Admins'
    ELSE 'Todos (públicos)'
  END as quien_puede
FROM pg_policies
WHERE tablename = 'remittance_types'
ORDER BY cmd;

-- ============================================================================
-- PASO 6: Probar que funciona (SOLO SI ERES ADMIN)
-- ============================================================================

-- Esta query debería funcionar si eres admin:
-- SELECT * FROM remittance_types;

-- Esta query debería funcionar si eres admin:
/*
INSERT INTO remittance_types (
  name, currency_code, delivery_currency, exchange_rate,
  commission_percentage, commission_fixed,
  min_amount, max_amount,
  delivery_method, max_delivery_days, warning_days,
  description, icon, display_order, is_active
) VALUES (
  'TEST - Dólares a CUP',
  'USD', 'CUP', 320.00,
  2.5, 0,
  10.00, 1000.00,
  'cash', 3, 2,
  'Test de tipo de remesa',
  'dollar-sign', 99, false
) RETURNING *;
*/

-- Si funciona, elimina el test:
-- DELETE FROM remittance_types WHERE name = 'TEST - Dólares a CUP';

-- ============================================================================
-- SOLUCIÓN DE PROBLEMAS COMUNES
-- ============================================================================

-- PROBLEMA 1: Aún da error 403
-- SOLUCIÓN: Verifica que tu usuario tenga rol admin
/*
SELECT user_id, role FROM user_profiles WHERE user_id = auth.uid();
-- Si no es admin:
UPDATE user_profiles SET role = 'super_admin' WHERE user_id = auth.uid();
*/

-- PROBLEMA 2: No existe la tabla user_profiles
-- SOLUCIÓN: Verifica el nombre exacto de la tabla
/*
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
AND table_name LIKE '%user%';
*/

-- PROBLEMA 3: Las políticas no aparecen
-- SOLUCIÓN: Verifica que tienes permisos de owner en la tabla
/*
SELECT
  grantee,
  privilege_type
FROM information_schema.role_table_grants
WHERE table_name='remittance_types';
*/

-- ============================================================================
-- ✅ ÉXITO
-- ============================================================================
-- Si al ejecutar este script ves las 5 políticas en el PASO 5,
-- entonces el problema está resuelto.
--
-- Ahora ve a tu aplicación y prueba crear un tipo de remesa.
-- Debería funcionar sin error 403.
-- ============================================================================
