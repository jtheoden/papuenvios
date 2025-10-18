# Instrucciones para Configurar RLS en Supabase

## Problema Actual

Error `403 Forbidden - permission denied for table remittance_types` al intentar crear tipos de remesas.

## Causa

Las políticas de Row Level Security (RLS) no están aplicadas en Supabase o la tabla `user_profiles` no tiene el rol correcto para el usuario admin.

## Solución en 3 Pasos

### Paso 1: Verificar que existe la tabla user_profiles

Ejecuta en el SQL Editor de Supabase:

```sql
SELECT * FROM user_profiles WHERE user_id = auth.uid();
```

Deberías ver tu perfil con `role = 'admin'` o `role = 'super_admin'`.

**Si no aparece o el rol es incorrecto**, actualízalo:

```sql
UPDATE user_profiles
SET role = 'super_admin'
WHERE user_id = auth.uid();
```

### Paso 2: Verificar que existen las políticas RLS

Ejecuta en el SQL Editor de Supabase:

```sql
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
WHERE tablename = 'remittance_types';
```

Deberías ver **4 políticas**:
1. `Anyone can view active remittance types` (SELECT)
2. `Admins can view all remittance types` (SELECT)
3. `Only admins can insert remittance types` (INSERT)
4. `Only admins can update remittance types` (UPDATE)
5. `Only super admins can delete remittance types` (DELETE)

**Si NO aparecen las políticas**, ejecútalas manualmente:

```sql
-- Habilitar RLS
ALTER TABLE remittance_types ENABLE ROW LEVEL SECURITY;

-- Eliminar políticas antiguas si existen
DROP POLICY IF EXISTS "Anyone can view active remittance types" ON remittance_types;
DROP POLICY IF EXISTS "Admins can view all remittance types" ON remittance_types;
DROP POLICY IF EXISTS "Only admins can insert remittance types" ON remittance_types;
DROP POLICY IF EXISTS "Only admins can update remittance types" ON remittance_types;
DROP POLICY IF EXISTS "Only super admins can delete remittance types" ON remittance_types;

-- Todos pueden ver tipos activos
CREATE POLICY "Anyone can view active remittance types"
  ON remittance_types FOR SELECT
  USING (is_active = true);

-- Solo admins pueden ver todos los tipos (incluso inactivos)
CREATE POLICY "Admins can view all remittance types"
  ON remittance_types FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.user_id = auth.uid()
      AND user_profiles.role IN ('admin', 'super_admin')
    )
  );

-- Solo admins pueden insertar tipos
CREATE POLICY "Only admins can insert remittance types"
  ON remittance_types FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.user_id = auth.uid()
      AND user_profiles.role IN ('admin', 'super_admin')
    )
  );

-- Solo admins pueden actualizar tipos
CREATE POLICY "Only admins can update remittance types"
  ON remittance_types FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.user_id = auth.uid()
      AND user_profiles.role IN ('admin', 'super_admin')
    )
  );

-- Solo super_admins pueden eliminar tipos
CREATE POLICY "Only super admins can delete remittance types"
  ON remittance_types FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.user_id = auth.uid()
      AND user_profiles.role = 'super_admin'
    )
  );
```

### Paso 3: Verificar que funciona

Ejecuta en el SQL Editor (esto debería funcionar si eres admin):

```sql
SELECT * FROM remittance_types;
```

Y prueba crear un tipo (debería funcionar):

```sql
INSERT INTO remittance_types (
  name, currency_code, delivery_currency, exchange_rate,
  commission_percentage, commission_fixed,
  min_amount, max_amount,
  delivery_method, max_delivery_days, warning_days,
  description, icon, display_order, is_active
) VALUES (
  'TEST - Dólares a CUP',
  'USD', 'CUP', 320.00,
  2.5, 0,
  10.00, 1000.00,
  'cash', 3, 2,
  'Test de tipo de remesa',
  'dollar-sign', 99, false
) RETURNING *;
```

Si esto funciona, elimina el test:

```sql
DELETE FROM remittance_types WHERE name = 'TEST - Dólares a CUP';
```

## Paso 4: Configurar políticas para la tabla remittances

```sql
-- Habilitar RLS
ALTER TABLE remittances ENABLE ROW LEVEL SECURITY;

-- Eliminar políticas antiguas si existen
DROP POLICY IF EXISTS "Users can view own remittances" ON remittances;
DROP POLICY IF EXISTS "Users can create own remittances" ON remittances;
DROP POLICY IF EXISTS "Users can update own remittances" ON remittances;
DROP POLICY IF EXISTS "Admins can update any remittance" ON remittances;
DROP POLICY IF EXISTS "Only super admins can delete remittances" ON remittances;

-- Los usuarios ven solo sus propias remesas
CREATE POLICY "Users can view own remittances"
  ON remittances FOR SELECT
  USING (
    auth.uid() = user_id OR
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.user_id = auth.uid()
      AND user_profiles.role IN ('admin', 'super_admin')
    )
  );

-- Los usuarios pueden crear sus propias remesas
CREATE POLICY "Users can create own remittances"
  ON remittances FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Los usuarios pueden actualizar sus propias remesas (solo en ciertos estados)
CREATE POLICY "Users can update own remittances"
  ON remittances FOR UPDATE
  USING (
    auth.uid() = user_id AND
    status IN ('payment_pending', 'payment_rejected')
  );

-- Los admins pueden actualizar cualquier remesa
CREATE POLICY "Admins can update any remittance"
  ON remittances FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.user_id = auth.uid()
      AND user_profiles.role IN ('admin', 'super_admin')
    )
  );

-- Solo super_admins pueden eliminar remesas
CREATE POLICY "Only super admins can delete remittances"
  ON remittances FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.user_id = auth.uid()
      AND user_profiles.role = 'super_admin'
    )
  );
```

## Paso 5: Configurar políticas para remittance_status_history

```sql
-- Habilitar RLS
ALTER TABLE remittance_status_history ENABLE ROW LEVEL SECURITY;

-- Eliminar política antigua si existe
DROP POLICY IF EXISTS "Users can view own remittance history" ON remittance_status_history;

-- Los usuarios ven el historial de sus propias remesas
CREATE POLICY "Users can view own remittance history"
  ON remittance_status_history FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM remittances
      WHERE remittances.id = remittance_status_history.remittance_id
      AND (
        remittances.user_id = auth.uid() OR
        EXISTS (
          SELECT 1 FROM user_profiles
          WHERE user_profiles.user_id = auth.uid()
          AND user_profiles.role IN ('admin', 'super_admin')
        )
      )
    )
  );
```

## Verificación Final

Después de aplicar todos los pasos, intenta crear un tipo de remesa desde la interfaz web. Debería funcionar sin errores 403.

Si persiste el error, verifica en la consola del navegador qué usuario está autenticado:

```javascript
// En la consola del navegador
const { data: { user } } = await window.supabase.auth.getUser()
console.log('User ID:', user.id)
console.log('User Email:', user.email)

// Luego verifica el perfil
const { data: profile } = await window.supabase
  .from('user_profiles')
  .select('*')
  .eq('user_id', user.id)
  .single()
console.log('Profile:', profile)
```

El campo `role` debe ser `'admin'` o `'super_admin'`.
