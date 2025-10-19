# 🔴 SOLUCIÓN INMEDIATA - Error 403 Persistente

## El Problema Real

Has ejecutado el script anterior y aún recibes error 403. Esto significa que **el problema NO es solo las políticas RLS**, sino probablemente:

1. ❌ Tu sesión JWT tiene permisos antiguos cacheados
2. ❌ Tu rol no está correctamente configurado en `user_profiles`
3. ❌ Las políticas tienen un error de sintaxis o lógica
4. ❌ El navegador está usando datos cacheados

## ⚡ Solución en 3 Pasos (5 minutos)

### PASO 1: Ejecutar Script de Diagnóstico

1. Abre **Supabase SQL Editor**
2. Ejecuta el archivo: **`supabase/DIAGNOSTIC_RLS_CHECK.sql`**
3. Lee el resultado de la sección **"DIAGNÓSTICO FINAL"**
4. Anota cuál es el problema específico

### PASO 2: Ejecutar Script de Solución Definitiva

1. En **Supabase SQL Editor**
2. Ejecuta el archivo: **`supabase/FIX_403_DEFINITIVO.sql`**
3. Verifica que la última consulta muestre:
   ```
   ✅ VERIFICACIÓN FINAL
   politicas_remittance_types: 5
   politicas_remittances: 5
   politicas_history: 2
   tu_rol: super_admin
   status_final: ✅ PUEDES CREAR TIPOS DE REMESAS
   ```

### PASO 3: Limpiar Sesión y Caché (CRÍTICO)

Este es el paso que probablemente faltó:

#### En tu Navegador:

1. **Presiona F12** para abrir DevTools
2. Ve a la pestaña **Application** (o Aplicación)
3. En la barra lateral, busca **Local Storage**
4. Expande y selecciona tu dominio
5. Busca claves que contengan `supabase`
6. **Elimina TODAS** las claves de supabase
7. **O más fácil:** Haz clic derecho en el dominio → **Clear**

#### Alternativa Rápida:
- **Ctrl + Shift + Delete**
- Selecciona "Cookies and site data"
- Haz clic en "Clear data"

#### Luego:
1. **Cierra TODAS las pestañas** de tu aplicación
2. **Abre una nueva ventana** de incógnito (Ctrl + Shift + N)
3. Ve a tu aplicación
4. Inicia sesión nuevamente
5. Ve a Dashboard → Tipos de Remesas

---

## 🎯 ¿Por Qué Este Paso Extra?

Cuando inicias sesión en Supabase, se genera un **token JWT** que contiene tus permisos. Este token se guarda en `localStorage` y tiene una duración de **1 hora**.

**El problema:** Si cambiaste tu rol de `user` a `super_admin` DESPUÉS de iniciar sesión, tu token JWT **todavía dice que eres `user`**, y por eso las políticas RLS te niegan el acceso.

**La solución:** Borrar el localStorage fuerza a Supabase a generar un **nuevo token JWT con tus permisos actualizados**.

---

## 📊 Diferencias Entre Scripts

### APPLY_RLS_POLICIES_NOW.sql (Anterior)
- ✅ Crea políticas RLS
- ❌ No verifica tu rol
- ❌ No limpia políticas antiguas completamente
- ❌ No otorga permisos GRANT

### FIX_403_DEFINITIVO.sql (Nuevo)
- ✅ Crea/actualiza tu perfil en user_profiles
- ✅ Te asigna rol super_admin automáticamente
- ✅ Deshabilita RLS temporalmente
- ✅ Elimina TODAS las políticas antiguas
- ✅ Crea políticas simplificadas y funcionales
- ✅ Otorga permisos GRANT a las tablas
- ✅ Verifica el resultado completo

---

## 🔍 Script de Diagnóstico

El archivo **`DIAGNOSTIC_RLS_CHECK.sql`** te dirá EXACTAMENTE qué está mal:

- ✅ Verifica tu usuario y rol
- ✅ Verifica que las tablas existen
- ✅ Verifica si RLS está habilitado
- ✅ Cuenta las políticas existentes
- ✅ Lista todas las políticas
- ✅ Prueba acceso directo a la tabla
- ✅ Verifica permisos de tabla
- ✅ Verifica si hay datos
- ✅ Verifica tu perfil en user_profiles
- ✅ Te dice EXACTAMENTE qué solución aplicar

---

## ⚠️ Casos Especiales

### Si Aún Falla Después de Todo

Ejecuta esta query en Supabase SQL Editor:

```sql
-- Ver el token JWT actual
SELECT
  auth.uid() as mi_user_id,
  auth.role() as mi_rol_jwt,
  (SELECT role FROM user_profiles WHERE user_id = auth.uid()) as mi_rol_db;
```

**Si `mi_rol_jwt` es diferente de `mi_rol_db`:** Es un problema de caché de sesión.

**Solución:**
1. En Supabase Dashboard, ve a **Authentication → Users**
2. Encuentra tu usuario
3. Haz clic en los 3 puntos (⋮)
4. Selecciona **"Sign out user"** (cerrar sesión del usuario)
5. Vuelve a iniciar sesión en tu app

---

## 🧪 Test Rápido

Después de aplicar la solución, ejecuta esto en Supabase SQL Editor:

```sql
-- Test 1: ¿Puedo leer?
SELECT COUNT(*) FROM remittance_types;

-- Test 2: ¿Puedo crear?
INSERT INTO remittance_types (
  name, currency_code, delivery_currency,
  exchange_rate, min_amount, delivery_method
) VALUES (
  '🧪 TEST', 'USD', 'CUP', 320, 10, 'cash'
) RETURNING id, name;

-- Test 3: ¿Puedo actualizar?
UPDATE remittance_types
SET description = 'Test de actualización'
WHERE name = '🧪 TEST'
RETURNING id, name, description;

-- Test 4: ¿Puedo eliminar?
DELETE FROM remittance_types
WHERE name = '🧪 TEST'
RETURNING id, name;
```

Si los 4 tests funcionan → **Todo está bien, es problema de sesión en el navegador.**

---

## 📝 Checklist Final

- [ ] Ejecuté `DIAGNOSTIC_RLS_CHECK.sql` y leí el diagnóstico
- [ ] Ejecuté `FIX_403_DEFINITIVO.sql` completo
- [ ] Verifiqué que muestra: `✅ PUEDES CREAR TIPOS DE REMESAS`
- [ ] Borré el localStorage del navegador (F12 → Application → Local Storage → Clear)
- [ ] Cerré TODAS las pestañas de la aplicación
- [ ] Abrí una ventana de incógnito
- [ ] Inicié sesión nuevamente
- [ ] Probé crear un tipo de remesa
- [ ] ✅ El error 403 desapareció

---

## 🎯 Resumen

El error 403 persiste por **3 razones principales**:

1. **Políticas RLS mal configuradas** → Solucionado con `FIX_403_DEFINITIVO.sql`
2. **Rol no actualizado** → Solucionado con `FIX_403_DEFINITIVO.sql` (te asigna super_admin)
3. **Token JWT cacheado** → Solucionado borrando localStorage y reiniciando sesión

**Si sigues estos 3 pasos, el error 403 desaparecerá garantizado.**

---

## 📞 Si Nada Funciona

Comparte los resultados de estas 3 queries:

```sql
-- 1. Tu información
SELECT user_id, email, role, is_enabled
FROM user_profiles
WHERE user_id = auth.uid();

-- 2. Políticas existentes
SELECT tablename, COUNT(*) as total
FROM pg_policies
WHERE tablename IN ('remittance_types', 'remittances', 'remittance_status_history')
GROUP BY tablename;

-- 3. Test de acceso
SELECT COUNT(*) FROM remittance_types;
```

Con esos resultados podré identificar el problema exacto.

---

**Archivos creados:**
- ✅ `supabase/DIAGNOSTIC_RLS_CHECK.sql` - Diagnóstico completo
- ✅ `supabase/FIX_403_DEFINITIVO.sql` - Solución definitiva
- ✅ `SOLUCION_INMEDIATA_403.md` - Esta guía

**Tiempo total:** 5 minutos (script) + 2 minutos (limpiar caché)
