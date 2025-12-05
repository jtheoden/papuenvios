-- ============================================================================
-- FIX: is_admin_user() - Evitar recursión RLS infinita
-- ============================================================================
-- El problema: is_admin_user() intenta leer user_profiles, pero user_profiles
-- tiene RLS que llama a is_admin_user(), causando loop infinito
--
-- La solución: Agregar SET row_security TO OFF para que is_admin_user()
-- pueda leer user_profiles sin disparar las RLS policies
-- ============================================================================

CREATE OR REPLACE FUNCTION public.is_admin_user()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
SET row_security TO OFF  -- ← CLAVE: Esto previene recursión RLS
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM user_profiles
    WHERE user_id = auth.uid()
    AND role IN ('admin', 'super_admin', 'manager')
    AND is_enabled = true
    LIMIT 1
  );
$function$;

-- Verificar que la función se recreó correctamente
SELECT
    'Function is_admin_user() recreated with SET row_security TO OFF' as status,
    proname,
    prosecdef as security_definer
FROM pg_proc
WHERE proname = 'is_admin_user'
AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public');

-- Registrar la migración
INSERT INTO _migrations_applied (migration) VALUES
('20251116_fix_is_admin_user_recursion')
ON CONFLICT (migration) DO NOTHING;

SELECT '✅ SUCCESS: is_admin_user() recursion fixed!' as final_status;
