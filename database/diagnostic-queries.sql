-- ============================================================================
-- CONSULTAS DE DIAGNÓSTICO - PapuEnvíos
-- ============================================================================
-- IMPORTANTE: Ejecutar estas consultas UNA POR UNA en tu dashboard de Supabase
-- Copiar y pegar el resultado de cada una para que pueda analizar el estado real
-- ============================================================================

-- ============================================================================
-- 1. VERIFICAR PERMISOS EN inventory_movements
-- ============================================================================
-- Esta consulta verifica si la tabla tiene permisos GRANT para authenticated
SELECT
    grantee,
    privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
AND table_name = 'inventory_movements'
ORDER BY grantee, privilege_type;

-- ============================================================================
-- 2. VERIFICAR RLS HABILITADO EN inventory_movements
-- ============================================================================
SELECT
    schemaname,
    tablename,
    rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
AND tablename = 'inventory_movements';

-- ============================================================================
-- 3. VERIFICAR POLÍTICAS RLS EN inventory_movements
-- ============================================================================
SELECT
    schemaname,
    tablename,
    policyname,
    permissive,
    roles,
    cmd,
    qual,
    with_check
FROM pg_policies
WHERE schemaname = 'public'
AND tablename = 'inventory_movements';

-- ============================================================================
-- 4. VERIFICAR PERMISOS EN remittances
-- ============================================================================
SELECT
    grantee,
    privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
AND table_name = 'remittances'
ORDER BY grantee, privilege_type;

-- ============================================================================
-- 5. VERIFICAR POLÍTICAS RLS EN remittances
-- ============================================================================
SELECT
    schemaname,
    tablename,
    policyname,
    permissive,
    roles,
    cmd,
    qual,
    with_check
FROM pg_policies
WHERE schemaname = 'public'
AND tablename = 'remittances';

-- ============================================================================
-- 6. VERIFICAR PERMISOS EN remittance_status_history
-- ============================================================================
SELECT
    grantee,
    privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
AND table_name = 'remittance_status_history'
ORDER BY grantee, privilege_type;

-- ============================================================================
-- 7. VERIFICAR POLÍTICAS RLS EN remittance_status_history
-- ============================================================================
SELECT
    schemaname,
    tablename,
    policyname,
    permissive,
    roles,
    cmd,
    qual,
    with_check
FROM pg_policies
WHERE schemaname = 'public'
AND tablename = 'remittance_status_history';

-- ============================================================================
-- 8. VERIFICAR BUCKETS DE STORAGE EXISTENTES
-- ============================================================================
SELECT
    id,
    name,
    public
FROM storage.buckets
ORDER BY name;

-- ============================================================================
-- 9. VERIFICAR POLÍTICAS DE STORAGE EN remittance-proofs
-- ============================================================================
SELECT
    name,
    definition
FROM storage.policies
WHERE bucket_id = (SELECT id FROM storage.buckets WHERE name = 'remittance-proofs');

-- ============================================================================
-- 10. VERIFICAR POLÍTICAS DE STORAGE EN remittance-delivery-proofs
-- ============================================================================
SELECT
    name,
    definition
FROM storage.policies
WHERE bucket_id = (SELECT id FROM storage.buckets WHERE name = 'remittance-delivery-proofs');

-- ============================================================================
-- 11. VERIFICAR POLÍTICAS DE STORAGE EN order-documents
-- ============================================================================
SELECT
    name,
    definition
FROM storage.policies
WHERE bucket_id = (SELECT id FROM storage.buckets WHERE name = 'order-documents');

-- ============================================================================
-- 12. VERIFICAR ESTRUCTURA DE activity_logs (para logging correcto)
-- ============================================================================
SELECT
    column_name,
    data_type,
    is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
AND table_name = 'activity_logs'
ORDER BY ordinal_position;

-- ============================================================================
-- 13. VERIFICAR ÚLTIMOS 10 ACTIVITY LOGS (para ver formato actual)
-- ============================================================================
SELECT
    action,
    entity_type,
    entity_id,
    performed_by,
    description,
    created_at
FROM activity_logs
ORDER BY created_at DESC
LIMIT 10;

-- ============================================================================
-- 14. VERIFICAR ENUM order_status (para confirmar estados disponibles)
-- ============================================================================
SELECT
    enumlabel as status_value
FROM pg_enum
WHERE enumtypid = 'order_status'::regtype
ORDER BY enumsortorder;

-- ============================================================================
-- 15. VERIFICAR SI EXISTEN ÓRDENES CANCELADAS
-- ============================================================================
SELECT
    COUNT(*) as total_cancelled_orders,
    COUNT(DISTINCT user_id) as unique_users
FROM orders
WHERE status = 'cancelled';

-- ============================================================================
-- INSTRUCCIONES PARA ENVIAR RESULTADOS:
-- ============================================================================
-- Por favor ejecuta estas consultas en el siguiente orden:
-- 1. Consultas 1-3 (inventory_movements) - CRÍTICO
-- 2. Consultas 4-7 (remittances) - CRÍTICO
-- 3. Consultas 8-11 (storage buckets) - IMPORTANTE
-- 4. Consultas 12-13 (activity_logs) - PARA LOGGING
-- 5. Consultas 14-15 (orders) - PARA REAPERTURA
--
-- Copia y pega los resultados de cada una para que pueda generar
-- las correcciones precisas basadas en el estado real de tu BD.
-- ============================================================================
