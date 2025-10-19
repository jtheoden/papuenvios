# 🔴 SOLUCIÓN: Error 403 Forbidden en Remittance Types

## El Problema

```
POST remittance_types 403 (Forbidden)
Error: permission denied for table remittance_types
```

**Causa:** Las políticas de seguridad (RLS) no están aplicadas en Supabase.

---

## ✅ Solución Rápida (5 minutos)

### Paso 1: Abre Supabase SQL Editor

1. Ve a tu proyecto en Supabase: https://supabase.com/dashboard
2. Selecciona tu proyecto: `papuenvios`
3. Click en el menú lateral: **SQL Editor**
4. Click en **New query**

### Paso 2: Ejecuta el Script de Solución

Copia y pega **TODO** el contenido del archivo:
📄 `supabase/FIX_RLS_REMITTANCES.sql`

Luego click en **Run** (o presiona Cmd/Ctrl + Enter)

### Paso 3: Verifica el Resultado

Deberías ver una tabla con **5 políticas** creadas:

| policyname | operacion | quien_puede |
|------------|-----------|-------------|
| Anyone can view active... | Ver/Leer | Todos (públicos) |
| Admins can view all... | Ver/Leer | Solo Admins |
| Only admins can insert... | Crear | Solo Admins |
| Only admins can update... | Actualizar | Solo Admins |
| Only super admins can delete... | Eliminar | Solo Super Admins |

### Paso 4: Prueba en la Aplicación

1. Refresca tu aplicación (F5)
2. Ve a Dashboard → Tipos de Remesas
3. Click en "Nuevo Tipo"
4. Rellena el formulario
5. Click en "Guardar"

**✅ Si funciona:** ¡Listo! El problema está resuelto.
**❌ Si sigue el error:** Ve a la sección de Troubleshooting abajo.

---

## 🔍 Troubleshooting

### Error Persiste Después del Script

**Problema:** Aún recibes error 403

**Solución:** Tu usuario no tiene rol de admin. Ejecuta esto en SQL Editor:

```sql
-- Ver tu rol actual
SELECT user_id, email, role, full_name
FROM user_profiles
WHERE user_id = auth.uid();

-- Si role NO es 'admin' o 'super_admin', ejecuta:
UPDATE user_profiles
SET role = 'super_admin'
WHERE user_id = auth.uid();

-- Verifica el cambio:
SELECT user_id, email, role, full_name
FROM user_profiles
WHERE user_id = auth.uid();
```

Después de cambiar el rol:
1. Cierra sesión en la app
2. Vuelve a iniciar sesión
3. Prueba crear el tipo de remesa

---

### No Existe la Tabla user_profiles

**Problema:** `relation "user_profiles" does not exist`

**Solución:** La tabla tiene otro nombre. Ejecuta esto:

```sql
-- Buscar tablas de usuarios
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
AND table_name LIKE '%user%'
ORDER BY table_name;
```

Identifica el nombre correcto (puede ser `users`, `profiles`, etc.) y reemplázalo en el script FIX_RLS_REMITTANCES.sql donde dice `user_profiles`.

---

### Las Políticas No Se Crean

**Problema:** El script se ejecuta pero las políticas no aparecen

**Solución:** Verifica permisos de la tabla:

```sql
-- Ver permisos de la tabla
SELECT grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_name = 'remittance_types'
AND grantee = current_user;
```

Deberías tener privilegios de **OWNER** o al menos **ALL PRIVILEGES**.

Si no los tienes, ejecuta:

```sql
-- Otorgar todos los permisos
GRANT ALL PRIVILEGES ON TABLE remittance_types TO authenticated;
GRANT ALL PRIVILEGES ON TABLE remittance_types TO service_role;
```

---

## 📞 Si Nada Funciona

Si después de todo esto el error persiste:

1. **Verifica en Supabase Dashboard:**
   - Ve a **Database** → **Tables** → `remittance_types`
   - Click en **Policies**
   - Deberías ver las 5 políticas listadas

2. **Verifica RLS está habilitado:**
   ```sql
   SELECT tablename, rowsecurity
   FROM pg_tables
   WHERE tablename = 'remittance_types';
   ```
   `rowsecurity` debe ser `true`

3. **Última opción - Deshabilitar RLS temporalmente (NO RECOMENDADO EN PRODUCCIÓN):**
   ```sql
   ALTER TABLE remittance_types DISABLE ROW LEVEL SECURITY;
   ```

   ⚠️ **ADVERTENCIA:** Esto hace que TODOS puedan modificar la tabla. Solo usa esto para testing, luego re-habilita RLS.

---

## ✅ Verificación Final

Una vez que todo funcione, deberías poder:

- ✅ Ver la lista de tipos de remesas
- ✅ Crear nuevos tipos
- ✅ Editar tipos existentes
- ✅ Activar/desactivar tipos
- ✅ Eliminar tipos (solo super_admin)

---

## 📚 Documentación Relacionada

- 📄 Guía completa: `docs/RLS_SETUP_INSTRUCTIONS.md`
- 📄 Script SQL: `supabase/FIX_RLS_REMITTANCES.sql`
- 📄 Migración original: `docs/migrations/remittance_system_migration.sql`

---

*Última actualización: 18 de Octubre, 2025*
*Si el problema persiste, comparte el mensaje de error específico que recibes.*
