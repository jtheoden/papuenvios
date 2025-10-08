# 🔧 Instrucciones para Aplicar las Correcciones de Autorización

## 📋 Resumen Ejecutivo

Se han identificado y corregido **6 problemas críticos** en el sistema de autenticación y autorización:

1. ✅ **Inconsistencia en el email del super_admin** (gmail.com vs googlemail.com)
2. ✅ **Falta de RLS policies en `user_profiles`**
3. ✅ **Campo `email` faltante en `user_profiles`**
4. ✅ **Queries incorrectas en `userService.js`** (intentando acceder a `auth.users`)
5. ✅ **Tabla incorrecta en `UserManagement.jsx`** (usando `users` en vez de `user_profiles`)
6. ✅ **Vulnerabilidad de seguridad** (service_role key expuesta en frontend)

---

## ⚠️ ACCIÓN URGENTE: Rotar Service Role Key

**CRÍTICO:** La `service_role` key estaba expuesta con prefijo `VITE_`, lo que significa que está incluida en el bundle de producción y es accesible por cualquiera.

### Pasos inmediatos:

1. **Ir al Supabase Dashboard:**
   ```
   https://supabase.com/dashboard/project/qcwnlbpultscerwdnzbm/settings/api
   ```

2. **Generar nueva Service Role Key:**
   - Click en "Reset service_role secret"
   - Confirmar la acción
   - Copiar la nueva key

3. **Actualizar `.env.local`:**
   ```bash
   # Solo cambiar esto (sin VITE_ prefix):
   SUPABASE_SERVICE_KEY=<nueva_key_aqui>
   ```

4. **NUNCA usar variables con prefijo `VITE_` para secrets**

---

## 🚀 Pasos para Aplicar la Migración

### Opción A: Desde Supabase Dashboard (Recomendado)

1. **Abrir SQL Editor en Supabase:**
   ```
   https://supabase.com/dashboard/project/qcwnlbpultscerwdnzbm/sql/new
   ```

2. **Copiar el contenido de:**
   ```
   supabase/migrations/03_fix_authorization.sql
   ```

3. **Ejecutar el script completo**
   - Click en "Run"
   - Verificar que no hay errores
   - Revisar los mensajes de `NOTICE` para confirmar que el super_admin fue configurado

4. **Verificar la migración:**
   ```sql
   -- Verificar que el email existe en user_profiles
   SELECT id, email, role, is_enabled FROM public.user_profiles;

   -- Verificar que las RLS policies existen
   SELECT schemaname, tablename, policyname
   FROM pg_policies
   WHERE tablename = 'user_profiles';
   ```

### Opción B: Usando Supabase CLI

```bash
# Si tienes Supabase CLI instalado
cd /home/juan/Workspace/papuenvios
supabase db push
```

---

## 🧪 Pruebas Post-Migración

### 1. Verificar Estructura de Base de Datos

```sql
-- Verificar que el campo email existe
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'user_profiles' AND column_name = 'email';

-- Debe retornar: email | text
```

### 2. Verificar RLS Policies

```sql
SELECT policyname, cmd, qual
FROM pg_policies
WHERE tablename = 'user_profiles';

-- Debe mostrar 5 policies:
-- - Users can view their own profile
-- - Users can update their own profile
-- - Admins can view all profiles
-- - Super admins can update all profiles
-- - System can insert profiles via trigger
```

### 3. Verificar Super Admin

```sql
SELECT email, role, is_enabled
FROM public.user_profiles
WHERE role = 'super_admin';

-- Debe retornar al menos 1 registro con jtheoden@gmail.com o jtheoden@googlemail.com
```

---

## 🔐 Testing de Autorización en la Aplicación

### Test 1: Login como Super Admin

1. **Logout si estás logueado:**
   ```javascript
   // En la consola del navegador:
   await window.supabase.auth.signOut()
   ```

2. **Login con Google OAuth:**
   - Usar la cuenta `jtheoden@gmail.com` o `jtheoden@googlemail.com`
   - Verificar que aparece como super_admin en la UI

3. **Verificar en consola del navegador:**
   ```javascript
   // Debe mostrar el perfil con role: 'super_admin'
   const { data } = await window.supabase
     .from('user_profiles')
     .select('*')
     .eq('id', (await window.supabase.auth.getUser()).data.user.id)
     .single();
   console.log(data);
   ```

### Test 2: Gestión de Usuarios

1. **Ir a la página de User Management**

2. **Verificar que puedes:**
   - ✅ Ver lista de todos los usuarios
   - ✅ Cambiar roles de otros usuarios (solo super_admin)
   - ✅ Habilitar/deshabilitar usuarios
   - ❌ NO poder modificar tu propia cuenta de super_admin

3. **Verificar errores en consola del navegador:**
   - NO deben aparecer errores de RLS
   - NO deben aparecer errores de "auth.users not found"

### Test 3: Rutas Protegidas

1. **Crear un segundo usuario de prueba:**
   - Login con otra cuenta de Google
   - Debe asignarse automáticamente role `user`

2. **Intentar acceder a `/admin`:**
   - Como `user` → Debe mostrar "Acceso restringido"
   - Como `super_admin` → Debe permitir acceso

---

## 📝 Cambios Realizados en el Código

### Archivos Modificados:

1. **`.env.local`**
   - ✅ Removido `VITE_SUPABASE_SERVICE_KEY`
   - ✅ Cambiado a `SUPABASE_SERVICE_KEY` (solo para scripts backend)
   - ✅ Comentado `VITE_GOOGLE_CLIENT_SECRET`

2. **`supabase/migrations/03_fix_authorization.sql`**
   - ✅ Agregado campo `email` a `user_profiles`
   - ✅ Creado 5 RLS policies completas
   - ✅ Actualizado trigger `handle_new_user()` para soportar ambos emails
   - ✅ Agregado trigger para sincronizar email
   - ✅ Creado función helper `current_user_role()`

3. **`src/components/UserManagement.jsx`**
   - ✅ Corregido query de `'users'` a `'user_profiles'`
   - ✅ Agregado soporte para ambos formatos de email
   - ✅ Eliminado intento de hacer join con `auth.users`

4. **`src/lib/userService.js`**
   - ✅ Eliminado query a `auth.users` (inaccesible desde client)
   - ✅ Usando campo `email` denormalizado
   - ✅ Agregado soporte para ambos formatos de email en `checkPermissions()`

5. **`src/contexts/AuthContext.jsx`**
   - ✅ Agregado soporte para ambos formatos de email en `isSuperAdmin` y `isAdmin`

6. **`scripts/createTestUser.js`**
   - ✅ Corregido para usar `SUPABASE_SERVICE_KEY` en vez de `VITE_SUPABASE_SERVICE_KEY`

---

## 🐛 Troubleshooting

### Problema: "No puedo ver mi perfil después del login"

**Causa:** RLS policies no aplicadas correctamente.

**Solución:**
```sql
-- Re-ejecutar la sección de RLS policies del migration script
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
-- ... (resto de policies)
```

### Problema: "Error: relation auth.users does not exist"

**Causa:** Código intentando acceder directamente a `auth.users` desde client.

**Solución:** Asegúrate de que todos los archivos fueron actualizados:
- `userService.js`
- `UserManagement.jsx`

### Problema: "No aparezco como super_admin"

**Causa:** Email no coincide o trigger no ejecutado.

**Solución:**
```sql
-- Verificar tu email en auth.users
SELECT id, email FROM auth.users WHERE email LIKE '%jtheoden%';

-- Forzar actualización manual
UPDATE public.user_profiles
SET role = 'super_admin', is_enabled = true
WHERE id = (SELECT id FROM auth.users WHERE email IN ('jtheoden@gmail.com', 'jtheoden@googlemail.com'));
```

### Problema: "Policy violation" al intentar leer user_profiles

**Causa:** Usuario no autenticado o session expirada.

**Solución:**
```javascript
// Refrescar session
await window.supabase.auth.refreshSession();
```

---

## 📊 Arquitectura de Seguridad Implementada

### Modelo de Roles (Jerárquico)

```
super_admin (level 2)
    ↓ puede hacer todo
admin (level 1)
    ↓ puede ver usuarios, NO puede cambiar roles
user (level 0)
    ↓ solo puede ver/editar su propio perfil
```

### RLS Policies Implementadas

| Policy | Acción | Quién | Qué Puede Hacer |
|--------|--------|-------|-----------------|
| Users can view their own profile | SELECT | authenticated | Ver su propio perfil |
| Users can update their own profile | UPDATE | authenticated | Actualizar su perfil (excepto role) |
| Admins can view all profiles | SELECT | admin/super_admin | Ver todos los perfiles |
| Super admins can update all profiles | UPDATE | super_admin | Modificar cualquier perfil |
| System can insert profiles via trigger | INSERT | authenticated | Crear perfil (via trigger) |

### Principios de Seguridad Aplicados

1. **Least Privilege:** Cada rol tiene solo los permisos necesarios
2. **Defense in Depth:** Validación en múltiples capas (RLS + Application)
3. **Fail Secure:** Por defecto, acceso denegado
4. **Separation of Duties:** Super_admin separado de admin
5. **Audit Trail:** Todos los cambios tienen `updated_at` timestamp

---

## ✅ Checklist de Verificación Final

- [ ] Migración `03_fix_authorization.sql` ejecutada sin errores
- [ ] Campo `email` existe en `user_profiles`
- [ ] 5 RLS policies creadas en `user_profiles`
- [ ] Super admin configurado correctamente
- [ ] Service role key rotada en Supabase
- [ ] `.env.local` actualizado (sin `VITE_SUPABASE_SERVICE_KEY`)
- [ ] Login como super_admin funciona
- [ ] User Management muestra usuarios correctamente
- [ ] Cambio de roles funciona (solo super_admin)
- [ ] Rutas protegidas funcionan correctamente
- [ ] No hay errores en consola del navegador

---

## 📞 Soporte

Si encuentras problemas después de aplicar estas correcciones:

1. **Revisar logs del navegador** (F12 → Console)
2. **Revisar logs de Supabase** (Dashboard → Logs)
3. **Verificar que la migración se aplicó completamente** (queries de verificación arriba)

---

## 🎯 Próximos Pasos Recomendados

### Mejoras de Seguridad:

1. **Implementar Rate Limiting** en login/signup
2. **Agregar MFA (Multi-Factor Authentication)** para super_admin
3. **Crear audit log** de cambios de roles y permisos
4. **Implementar session timeout** configurable

### Mejoras de UX:

1. **Agregar paginación** en User Management (si > 50 usuarios)
2. **Agregar búsqueda/filtros** por email, role, status
3. **Agregar confirmación modal** antes de deshabilitar usuarios
4. **Mostrar last_sign_in** (requiere Edge Function)

### Tests Automatizados:

1. **Unit tests** para `checkPermissions()`
2. **Integration tests** para RLS policies
3. **E2E tests** para flujos de autorización
4. **Security tests** para intentos de privilege escalation

---

**Última actualización:** 2025-10-01
**Versión de migración:** 03
**Estado:** ✅ Listo para producción
