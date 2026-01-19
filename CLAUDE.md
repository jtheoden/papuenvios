# PapuEnvios - Notas de Desarrollo

## Supabase Project Info

- **Project Name**: papuenvios
- **Reference ID**: qcwnlbpultscerwdnzbm
- **Region**: South America (Sao Paulo)
- **URL**: https://qcwnlbpultscerwdnzbm.supabase.co
- **DB Host**: db.qcwnlbpultscerwdnzbm.supabase.co

## Acceso a Base de Datos Remota (Diagnostico)

Para ejecutar SQL directamente en la BD remota de Supabase:

```bash
# Obtener credenciales temporales (expiran rapidamente)
supabase db dump --linked --schema public --dry-run 2>&1 | grep -E "PGPASSWORD|PGHOST|PGUSER"

# Ejecutar SQL con las credenciales obtenidas
PGHOST="db.qcwnlbpultscerwdnzbm.supabase.co" \
PGPORT="5432" \
PGUSER="cli_login_postgres" \
PGPASSWORD="[password_temporal]" \
PGDATABASE="postgres" \
psql -c "SET ROLE postgres; SELECT * FROM your_table;"
```

**IMPORTANTE**: El password temporal expira en ~1 minuto. Regenerar con `supabase db dump --dry-run` antes de cada sesion.

## Consultas Diagnosticas Utiles

### Verificar RLS Policies
```sql
SET ROLE postgres;
SELECT policyname, permissive, roles, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
AND tablename = 'nombre_tabla';
```

### Verificar si RLS esta habilitado
```sql
SET ROLE postgres;
SELECT relname, relrowsecurity, relforcerowsecurity
FROM pg_class
WHERE relname = 'nombre_tabla';
```

### Verificar GRANTs de una tabla
```sql
SET ROLE postgres;
SELECT grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
AND table_name = 'nombre_tabla';
```

### Verificar funciones SECURITY DEFINER
```sql
SELECT routine_name, routine_type, security_type
FROM information_schema.routines
WHERE routine_schema = 'public'
AND routine_name = 'nombre_funcion';
```

### Verificar definicion de funcion
```sql
SELECT prosrc FROM pg_proc WHERE proname = 'nombre_funcion';
```

## Errores Comunes y Soluciones

### Error: "permission denied for table X" (42501)

**Causa**: RLS policies existen pero faltan GRANTs a nivel de tabla.

**Solucion**:
```sql
GRANT SELECT, INSERT, UPDATE, DELETE ON public.nombre_tabla TO authenticated;
```

**Explicacion**: En Supabase, las RLS policies controlan *quien* puede hacer *que*, pero los GRANTs a nivel de tabla son necesarios para que el rol pueda intentar la operacion en primer lugar. Ambos son requeridos:
1. GRANT - Permite al rol intentar la operacion
2. RLS Policy - Filtra que filas puede afectar

### Error: Recursion infinita en RLS policies

**Causa**: Una policy en tabla A consulta tabla B, y tabla B tiene policies que consultan tabla A.

**Solucion**: Usar funciones `SECURITY DEFINER` que bypassean RLS:
```sql
CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT COALESCE(
    (SELECT role FROM user_profiles WHERE id = auth.uid() LIMIT 1),
    'user'
  )
$$;
```

### Error: Vite 504 "Outdated Optimize Dep"

**Solucion**:
```bash
rm -rf node_modules/.vite
npm run dev
```

## Tablas Importantes

### user_profiles
- Contiene roles de usuarios (user, admin, super_admin)
- Tiene RLS habilitado con policies que usan `is_admin_user()` e `is_super_admin()`

### notification_settings
- Configuraciones de notificaciones (WhatsApp, email, etc.)
- RLS policies usan `get_my_role()` function
- Requiere GRANTs para INSERT/UPDATE/DELETE

### user_alerts
- Alertas persistentes para usuarios (ej: cuenta Zelle desactivada)
- RLS policies permiten usuarios ver/actualizar sus propias alertas
- Admins pueden gestionar todas las alertas

## Edge Functions

### notification-settings
- GET: Todos los usuarios autenticados pueden leer
- PUT: Solo admins pueden modificar
- Usa service role key para bypassear RLS internamente

### notify-zelle-deactivation
- Envia emails cuando una cuenta Zelle es desactivada
- Usa Resend API para envio de emails

## Comandos Utiles

```bash
# Sincronizar migraciones
supabase db push

# Reparar estado de migracion
supabase migration repair --status applied [timestamp_nombre_migracion]

# Listar migraciones aplicadas
supabase migration list

# Desplegar Edge Functions
supabase functions deploy nombre-funcion
```
