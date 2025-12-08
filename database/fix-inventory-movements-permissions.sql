-- ============================================================================
-- FIX CRITICAL: inventory_movements permissions
-- ============================================================================
-- PROBLEMA: authenticated solo tiene SELECT, necesita INSERT y UPDATE
-- IMPACTO: Bloquea validatePayment() con error 403 Forbidden
-- ============================================================================

-- Otorgar permisos faltantes a inventory_movements
GRANT INSERT, UPDATE ON public.inventory_movements TO authenticated;

-- Verificar que los permisos se aplicaron correctamente
SELECT
    grantee,
    privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
AND table_name = 'inventory_movements'
AND grantee = 'authenticated'
ORDER BY privilege_type;

-- Resultado esperado:
-- authenticated | INSERT
-- authenticated | SELECT
-- authenticated | UPDATE

-- ============================================================================
-- NOTAS:
-- ============================================================================
-- 1. La tabla inventory_movements NO tiene RLS habilitado (rowsecurity = false)
-- 2. Por lo tanto, solo necesitamos GRANTs, no políticas RLS
-- 3. Esto permitirá que validatePayment() registre movimientos de inventario
-- 4. Los permisos SELECT ya existían, solo faltaban INSERT y UPDATE
-- ============================================================================
