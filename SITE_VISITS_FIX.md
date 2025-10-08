# Fix para Error 400 en site_visits

## 🔴 Problema

El Dashboard muestra errores 400 en la consola al intentar leer la tabla `site_visits`:

```
GET https://qcwnlbpultscerwdnzbm.supabase.co/rest/v1/site_visits?select=visited_at 400 (Bad Request)
```

## 🔍 Causa

La tabla `site_visits` existe en la base de datos pero **no tiene políticas RLS (Row Level Security)** configuradas. Cuando RLS está habilitado sin políticas, Supabase bloquea todas las consultas por defecto.

**⚠️ IMPORTANTE:** El script ha sido corregido para usar `public.user_profiles` en lugar de `public.users` (que no existe en la BD). Los roles correctos son `'admin'` y `'super_admin'`.

## ✅ Solución Aplicada en el Código

He modificado `DashboardPage.jsx` para manejar este error gracefully:

- El error ya no rompe el dashboard
- Muestra valores en 0 cuando la tabla no es accesible
- Se loguea como advertencia en vez de error
- El dashboard sigue funcionando normalmente

## 🔧 Solución Permanente en la Base de Datos

Para habilitar el tracking de visitas correctamente, ejecuta este SQL en Supabase:

### Opción 1: Desde Supabase Dashboard

1. Ve a tu proyecto en [Supabase Dashboard](https://app.supabase.com)
2. Click en "SQL Editor" en el menú lateral
3. Click en "New query"
4. Copia y pega el contenido de `supabase/fix_site_visits_rls.sql`
5. Click en "Run" o presiona Ctrl+Enter

### Opción 2: Desde CLI (si tienes Supabase CLI instalado)

```bash
supabase db execute --file supabase/fix_site_visits_rls.sql
```

## 📋 Lo que hace el script SQL

El script:

1. **Elimina políticas existentes** (si las hay)
2. **Habilita RLS** en la tabla `site_visits`
3. **Crea política de lectura para admins**: Solo usuarios con rol `admin` o `superadmin` pueden leer las estadísticas
4. **Crea política de inserción pública**: Cualquier usuario (incluso anónimo) puede registrar visitas
5. **Asigna permisos** necesarios
6. **Verifica** que las políticas se crearon correctamente

## 🧪 Verificar que Funciona

Después de ejecutar el script:

1. Recarga la aplicación
2. Ve al Dashboard
3. No deberías ver más errores 400 en la consola
4. Las estadísticas de visitas deberían mostrarse correctamente (o en 0 si no hay datos)

## 🔒 Seguridad

Las políticas implementadas son seguras:

- ✅ Solo admins pueden **leer** las estadísticas
- ✅ Cualquiera puede **registrar** una visita (necesario para tracking)
- ✅ Nadie puede **modificar** o **eliminar** visitas existentes
- ✅ RLS está habilitado para protección adicional

## 📝 Notas

- El código ya está preparado para funcionar con o sin las políticas
- Si no ejecutas el SQL, el dashboard seguirá funcionando pero mostrará 0 visitas
- Las visitas solo se rastrearán después de aplicar el fix en la BD
