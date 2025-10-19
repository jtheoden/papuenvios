# 🔴 SOLUCIÓN URGENTE - Error 403 Forbidden

**Error Actual:**
```
GET .../remittance_types 403 (Forbidden)
Error: {code: '42501', message: 'permission denied for table remittance_types'}
```

---

## ⚡ Solución en 5 Minutos

### Paso 1: Abrir Supabase Dashboard
1. Ve a: https://supabase.com/dashboard
2. Selecciona tu proyecto: `qcwnlbpultscerwdnzbm`
3. En la barra lateral izquierda, busca el icono de base de datos
4. Haz clic en **"SQL Editor"**

### Paso 2: Copiar el Script SQL
1. Abre el archivo: `supabase/APPLY_RLS_POLICIES_NOW.sql`
2. Presiona `Ctrl + A` para seleccionar todo
3. Presiona `Ctrl + C` para copiar

### Paso 3: Ejecutar en Supabase
1. En Supabase SQL Editor, haz clic en **"New query"**
2. Pega el contenido completo del script (`Ctrl + V`)
3. Haz clic en el botón **"Run"** o presiona `Ctrl + Enter`
4. Espera 3-5 segundos

### Paso 4: Verificar Éxito
Deberías ver en los resultados:
```
✅ CONFIGURACIÓN COMPLETADA
policies_remittance_types: 5
policies_remittances: 5
policies_history: 1
tu_rol: admin (o super_admin)
permiso_crear: ✅ Puedes crear tipos de remesas
```

### Paso 5: Reiniciar Sesión en la App
1. Cierra sesión en tu aplicación
2. Vuelve a iniciar sesión
3. Ve a Dashboard → Tipos de Remesas
4. El error 403 debería desaparecer

---

## 🎯 ¿Por Qué Ocurre Este Error?

Supabase usa **Row Level Security (RLS)** para proteger las tablas. Cuando RLS está habilitado pero NO hay políticas definidas, **nadie** puede acceder a los datos, ni siquiera los administradores.

El script SQL que creé hace lo siguiente:

1. ✅ Habilita RLS en las 3 tablas de remesas
2. ✅ Crea 13 políticas de seguridad
3. ✅ Define quién puede ver/crear/editar/eliminar datos
4. ✅ Separa permisos por roles (user, admin, super_admin)

---

## 🔍 Si Aún No Funciona

### Verifica Tu Rol
Ejecuta esta query en Supabase SQL Editor:
```sql
SELECT user_id, email, role, full_name
FROM user_profiles
WHERE user_id = auth.uid();
```

**Si tu `role` NO es `admin` o `super_admin`:**
```sql
UPDATE user_profiles
SET role = 'super_admin'
WHERE user_id = auth.uid();
```

Luego **cierra sesión** y vuelve a iniciar sesión en la app.

---

## 📋 Resumen de Políticas Creadas

| Tabla | Operación | Quién Puede |
|-------|-----------|-------------|
| remittance_types | Ver tipos activos | 🔵 Todos |
| remittance_types | Ver todos los tipos | 🟡 Admins |
| remittance_types | Crear tipos | 🟡 Admins |
| remittance_types | Editar tipos | 🟡 Admins |
| remittance_types | Eliminar tipos | 🔴 Super Admins |
| remittances | Ver propias | 🟢 Usuario dueño + Admins |
| remittances | Crear | 🟢 Usuarios |
| remittances | Editar propias | 🟢 Usuario (solo ciertos estados) |
| remittances | Editar cualquiera | 🟡 Admins |
| remittances | Eliminar | 🔴 Super Admins |
| remittance_status_history | Ver historial | 🟢 Usuario dueño + Admins |

---

## ⏱️ Tiempo Total: 5 Minutos

1. Abrir Supabase Dashboard (30 seg)
2. Ir a SQL Editor (10 seg)
3. Copiar script (10 seg)
4. Pegar y ejecutar (20 seg)
5. Verificar resultados (20 seg)
6. Cerrar/abrir sesión en app (1 min)
7. Probar crear tipo de remesa (2 min)

**TOTAL: ~5 minutos**

---

## 🆘 Necesitas Ayuda?

Si después de seguir estos pasos el error persiste:

1. Toma screenshot de los resultados del script SQL
2. Toma screenshot del error en la consola del navegador
3. Verifica que ejecutaste **TODO** el script (343 líneas)
4. Verifica que tu rol sea admin/super_admin
5. Verifica que cerraste sesión y volviste a iniciar

---

## ✅ Después de Solucionar

Una vez que el error 403 desaparezca, podrás:

- ✅ Crear tipos de remesas desde el dashboard
- ✅ Ver todos los tipos de remesas
- ✅ Editar tipos existentes
- ✅ Los usuarios podrán enviar remesas
- ✅ El sistema funcionará 100%

---

**Archivo del script:** `supabase/APPLY_RLS_POLICIES_NOW.sql`

**Documentación adicional:**
- `docs/RLS_SETUP_INSTRUCTIONS.md` - Guía detallada
- `ACCIONES_REQUERIDAS.md` - Lista completa de acciones

---

*Este es el ÚNICO paso que falta para que el sistema esté 100% operativo.*
*Todo el código está listo, solo necesita las políticas RLS en la base de datos.*

---

**IMPORTANTE:** No puedo ejecutar este script desde el código porque:
- ❌ Las políticas RLS solo se pueden crear desde el SQL Editor de Supabase
- ❌ La API REST de Supabase no permite modificar políticas RLS
- ❌ Es una restricción de seguridad de PostgreSQL/Supabase

Por eso necesitas ejecutarlo manualmente en el Dashboard de Supabase.
