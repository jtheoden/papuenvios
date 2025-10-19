-- ============================================================================
-- DIAGNÓSTICO COMPLETO - Error 403 Persistente
-- ============================================================================
-- Este script te dirá EXACTAMENTE qué está mal
-- ============================================================================

-- ============================================================================
-- 1. VERIFICAR TU USUARIO Y ROL
-- ============================================================================
SELECT
  '🔍 TU INFORMACIÓN' as seccion,
  auth.uid() as tu_user_id,
  (SELECT email FROM user_profiles WHERE user_id = auth.uid()) as tu_email,
  (SELECT role FROM user_profiles WHERE user_id = auth.uid()) as tu_rol,
  (SELECT full_name FROM user_profiles WHERE user_id = auth.uid()) as tu_nombre,
  (SELECT is_enabled FROM user_profiles WHERE user_id = auth.uid()) as cuenta_activa;

-- ============================================================================
-- 2. VERIFICAR QUE LAS TABLAS EXISTEN
-- ============================================================================
SELECT
  '🗄️ TABLAS' as seccion,
  table_name,
  CASE
    WHEN table_name IN ('remittance_types', 'remittances', 'remittance_status_history')
    THEN '✅ Existe'
    ELSE '❌ No existe'
  END as estado
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('remittance_types', 'remittances', 'remittance_status_history')
ORDER BY table_name;

-- ============================================================================
-- 3. VERIFICAR SI RLS ESTÁ HABILITADO
-- ============================================================================
SELECT
  '🔒 RLS STATUS' as seccion,
  tablename,
  rowsecurity as rls_habilitado,
  CASE
    WHEN rowsecurity = true THEN '✅ RLS Habilitado'
    ELSE '❌ RLS Deshabilitado'
  END as estado
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('remittance_types', 'remittances', 'remittance_status_history')
ORDER BY tablename;

-- ============================================================================
-- 4. CONTAR POLÍTICAS EXISTENTES
-- ============================================================================
SELECT
  '📋 POLÍTICAS CREADAS' as seccion,
  tablename,
  COUNT(*) as cantidad_politicas,
  CASE
    WHEN COUNT(*) = 0 THEN '❌ Sin políticas - ESTE ES EL PROBLEMA'
    WHEN COUNT(*) < 3 THEN '⚠️ Políticas incompletas'
    ELSE '✅ Políticas creadas'
  END as estado
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('remittance_types', 'remittances', 'remittance_status_history')
GROUP BY tablename
ORDER BY tablename;

-- ============================================================================
-- 5. LISTAR TODAS LAS POLÍTICAS
-- ============================================================================
SELECT
  '📜 DETALLE DE POLÍTICAS' as seccion,
  tablename,
  policyname,
  cmd as operacion,
  CASE
    WHEN cmd = 'SELECT' THEN '📖 Ver'
    WHEN cmd = 'INSERT' THEN '➕ Crear'
    WHEN cmd = 'UPDATE' THEN '✏️ Editar'
    WHEN cmd = 'DELETE' THEN '🗑️ Eliminar'
    ELSE cmd
  END as tipo
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('remittance_types', 'remittances', 'remittance_status_history')
ORDER BY tablename, cmd;

-- ============================================================================
-- 6. PROBAR ACCESO DIRECTO A LA TABLA
-- ============================================================================
-- Intenta leer la tabla directamente
DO $$
DECLARE
  record_count INTEGER;
BEGIN
  BEGIN
    SELECT COUNT(*) INTO record_count FROM remittance_types;
    RAISE NOTICE '✅ Puedes leer remittance_types. Registros: %', record_count;
  EXCEPTION
    WHEN OTHERS THEN
      RAISE NOTICE '❌ NO puedes leer remittance_types. Error: %', SQLERRM;
  END;
END $$;

-- ============================================================================
-- 7. VERIFICAR PERMISOS DE TABLA
-- ============================================================================
SELECT
  '🔐 PERMISOS DE TABLA' as seccion,
  table_name,
  grantee,
  privilege_type,
  CASE
    WHEN grantee = 'authenticated' THEN '✅ Usuarios autenticados'
    WHEN grantee = 'anon' THEN '🔵 Usuarios anónimos'
    WHEN grantee = 'postgres' THEN '🔴 Super usuario'
    ELSE grantee
  END as quien
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name IN ('remittance_types', 'remittances', 'remittance_status_history')
ORDER BY table_name, grantee, privilege_type;

-- ============================================================================
-- 8. VERIFICAR SI HAY DATOS EN LA TABLA
-- ============================================================================
-- Esto lo ejecuta el sistema sin RLS
SELECT
  '📊 DATOS EN TABLA' as seccion,
  (SELECT COUNT(*) FROM remittance_types) as total_tipos_remesa,
  (SELECT COUNT(*) FROM remittances) as total_remesas,
  CASE
    WHEN (SELECT COUNT(*) FROM remittance_types) = 0
    THEN '⚠️ Tabla vacía - Necesitas crear tipos de remesa'
    ELSE '✅ Hay datos'
  END as estado_datos;

-- ============================================================================
-- 9. VERIFICAR SI USER_PROFILES TIENE TU REGISTRO
-- ============================================================================
SELECT
  '👤 TU PERFIL' as seccion,
  EXISTS (SELECT 1 FROM user_profiles WHERE user_id = auth.uid()) as perfil_existe,
  CASE
    WHEN EXISTS (SELECT 1 FROM user_profiles WHERE user_id = auth.uid())
    THEN '✅ Tu perfil existe'
    ELSE '❌ NO EXISTE tu perfil en user_profiles - PROBLEMA CRÍTICO'
  END as estado;

-- ============================================================================
-- 10. DIAGNÓSTICO FINAL
-- ============================================================================
SELECT
  '🎯 DIAGNÓSTICO FINAL' as seccion,
  CASE
    -- Caso 1: No existe el perfil del usuario
    WHEN NOT EXISTS (SELECT 1 FROM user_profiles WHERE user_id = auth.uid())
    THEN '❌ PROBLEMA: Tu usuario no existe en user_profiles. Ejecuta la sección SOLUCIÓN A.'

    -- Caso 2: El rol no es admin
    WHEN (SELECT role FROM user_profiles WHERE user_id = auth.uid()) NOT IN ('admin', 'super_admin')
    THEN '❌ PROBLEMA: Tu rol no es admin. Ejecuta la sección SOLUCIÓN B.'

    -- Caso 3: RLS no está habilitado
    WHEN NOT EXISTS (
      SELECT 1 FROM pg_tables
      WHERE schemaname = 'public'
        AND tablename = 'remittance_types'
        AND rowsecurity = true
    )
    THEN '❌ PROBLEMA: RLS no está habilitado. Ejecuta la sección SOLUCIÓN C.'

    -- Caso 4: No hay políticas
    WHEN (SELECT COUNT(*) FROM pg_policies WHERE tablename = 'remittance_types') = 0
    THEN '❌ PROBLEMA: No hay políticas RLS. Ejecuta la sección SOLUCIÓN D.'

    -- Caso 5: Todo está bien pero sigue fallando
    ELSE '⚠️ Todo parece estar bien. El problema puede ser de sesión. Ejecuta SOLUCIÓN E.'
  END as diagnostico,

  -- Información adicional
  (SELECT COUNT(*) FROM pg_policies WHERE tablename = 'remittance_types') as politicas_remittance_types,
  (SELECT role FROM user_profiles WHERE user_id = auth.uid()) as tu_rol_actual,
  (SELECT rowsecurity FROM pg_tables WHERE tablename = 'remittance_types' AND schemaname = 'public') as rls_enabled;

-- ============================================================================
-- SOLUCIONES
-- ============================================================================

-- SOLUCIÓN A: Crear tu perfil de usuario
-- Ejecuta esto si el diagnóstico dice "Tu usuario no existe en user_profiles"
/*
INSERT INTO user_profiles (user_id, email, role, full_name, is_enabled)
SELECT
  auth.uid(),
  (SELECT email FROM auth.users WHERE id = auth.uid()),
  'super_admin',
  'Administrador',
  true
WHERE NOT EXISTS (SELECT 1 FROM user_profiles WHERE user_id = auth.uid());
*/

-- SOLUCIÓN B: Actualizar tu rol a admin
-- Ejecuta esto si el diagnóstico dice "Tu rol no es admin"
/*
UPDATE user_profiles
SET role = 'super_admin'
WHERE user_id = auth.uid();

-- Verificar el cambio
SELECT user_id, email, role FROM user_profiles WHERE user_id = auth.uid();
*/

-- SOLUCIÓN C: Habilitar RLS
-- Ejecuta esto si el diagnóstico dice "RLS no está habilitado"
/*
ALTER TABLE remittance_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE remittances ENABLE ROW LEVEL SECURITY;
ALTER TABLE remittance_status_history ENABLE ROW LEVEL SECURITY;
*/

-- SOLUCIÓN D: Crear las políticas
-- Ejecuta esto si el diagnóstico dice "No hay políticas RLS"
-- Usa el script APPLY_RLS_POLICIES_NOW.sql completo

-- SOLUCIÓN E: Limpiar sesión y reautenticar
-- Si todo está bien pero sigue fallando:
-- 1. Cierra sesión en la aplicación
-- 2. Borra el localStorage del navegador (F12 → Application → Local Storage → Clear)
-- 3. Vuelve a iniciar sesión
-- 4. El token JWT se actualizará con tus permisos correctos

-- ============================================================================
-- ✅ VERIFICACIÓN POST-SOLUCIÓN
-- ============================================================================
-- Después de aplicar la solución, ejecuta esto para verificar:
/*
SELECT
  '✅ VERIFICACIÓN' as seccion,
  (SELECT role FROM user_profiles WHERE user_id = auth.uid()) as tu_rol,
  (SELECT COUNT(*) FROM pg_policies WHERE tablename = 'remittance_types') as politicas,
  (SELECT rowsecurity FROM pg_tables WHERE tablename = 'remittance_types' AND schemaname = 'public') as rls_enabled,
  CASE
    WHEN (SELECT role FROM user_profiles WHERE user_id = auth.uid()) IN ('admin', 'super_admin')
      AND (SELECT COUNT(*) FROM pg_policies WHERE tablename = 'remittance_types') >= 3
      AND (SELECT rowsecurity FROM pg_tables WHERE tablename = 'remittance_types' AND schemaname = 'public') = true
    THEN '✅ TODO CORRECTO - Cierra sesión y vuelve a iniciar'
    ELSE '❌ Aún hay problemas - Revisa el diagnóstico'
  END as estado_final;
*/
