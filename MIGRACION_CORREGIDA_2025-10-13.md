# ✅ Migración SQL Corregida - 2025-10-13

## 🔴 Error Encontrado

Al ejecutar la migración original, se recibió este error:
```
ERROR: 42P01: relation "profiles" does not exist
```

## 🔍 Causa del Problema

La migración usaba la tabla `profiles` pero en tu esquema de base de datos la tabla se llama `user_profiles`.

### Diferencias en el Esquema:

**❌ Incorrecto (versión original)**:
```sql
SELECT 1 FROM profiles
WHERE profiles.id = auth.uid()
AND profiles.role IN ('admin', 'super_admin')
```

**✅ Correcto (versión actualizada)**:
```sql
SELECT 1 FROM user_profiles
WHERE user_profiles.user_id = auth.uid()
AND user_profiles.role IN ('admin', 'super_admin')
```

### Cambios Específicos:

1. **Nombre de tabla**: `profiles` → `user_profiles`
2. **Campo de unión**: `profiles.id` → `user_profiles.user_id`

---

## ✅ Solución Implementada

He actualizado los siguientes archivos:

### 1. `database_migration_order_timestamps.sql`
- ✅ Líneas 47-49: Cambiado `profiles` a `user_profiles`
- ✅ Líneas 67-69: Cambiado `profiles.id` a `user_profiles.user_id`

### 2. `INSTRUCCIONES_MIGRACION_URGENTE.md`
- ✅ Actualizado el script SQL embebido con la corrección

---

## 🚀 Script SQL Correcto y Completo

**Copia y ejecuta este script completo en Supabase SQL Editor:**

```sql
-- Migration: Add order state transition timestamps
-- Date: 2025-10-12
-- Updated: 2025-10-13 - Fixed user_profiles table name
-- Description: Adds timestamp fields to track order state transitions and delivery proof

-- Add new columns to orders table
ALTER TABLE orders
ADD COLUMN IF NOT EXISTS processing_started_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS shipped_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS delivery_proof_url TEXT;

-- Add comments to document the columns
COMMENT ON COLUMN orders.processing_started_at IS 'Timestamp when order status changed to processing (after payment validation)';
COMMENT ON COLUMN orders.shipped_at IS 'Timestamp when order was marked as shipped';
COMMENT ON COLUMN orders.delivered_at IS 'Timestamp when order was marked as delivered (with proof)';
COMMENT ON COLUMN orders.completed_at IS 'Timestamp when order was completed';
COMMENT ON COLUMN orders.delivery_proof_url IS 'Public URL of delivery proof image uploaded to Supabase Storage';

-- Create index for processing_started_at to optimize getDaysInProcessing queries
CREATE INDEX IF NOT EXISTS idx_orders_processing_started_at
ON orders (processing_started_at)
WHERE status = 'processing';

-- Create index for status to optimize filtering
CREATE INDEX IF NOT EXISTS idx_orders_status
ON orders (status);

-- Update RLS policies if needed (orders table should already have proper RLS)
-- Users can view their own orders
-- Admins can view all orders
-- These policies should already exist, but verify:

-- Verify existing RLS policy for SELECT
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'orders'
        AND policyname = 'Users can view own orders or admins can view all'
    ) THEN
        CREATE POLICY "Users can view own orders or admins can view all"
        ON orders FOR SELECT
        USING (
            auth.uid() = user_id OR
            EXISTS (
                SELECT 1 FROM user_profiles
                WHERE user_profiles.user_id = auth.uid()
                AND user_profiles.role IN ('admin', 'super_admin')
            )
        );
    END IF;
END $$;

-- Verify existing RLS policy for UPDATE
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'orders'
        AND policyname = 'Only admins can update orders'
    ) THEN
        CREATE POLICY "Only admins can update orders"
        ON orders FOR UPDATE
        USING (
            EXISTS (
                SELECT 1 FROM user_profiles
                WHERE user_profiles.user_id = auth.uid()
                AND user_profiles.role IN ('admin', 'super_admin')
            )
        );
    END IF;
END $$;

-- Migration completed successfully
SELECT 'Migration completed: order_timestamps_and_delivery_proof' AS status;
```

---

## 📋 Pasos para Ejecutar

### 1. Abrir Supabase SQL Editor
- Ve a: https://supabase.com/dashboard
- Selecciona tu proyecto
- Click en "SQL Editor" en el menú lateral
- Click en "New Query"

### 2. Copiar el Script
- Copia TODO el script de arriba (desde `-- Migration:` hasta el final)
- O copia el contenido del archivo: `database_migration_order_timestamps.sql`

### 3. Ejecutar
- Pega en el editor SQL
- Click en "Run" o presiona `Ctrl + Enter`

### 4. Verificar Resultado
Deberías ver:
```
Migration completed: order_timestamps_and_delivery_proof
```

---

## ✅ Verificación Post-Migración

Ejecuta esta query para verificar que las columnas se crearon:

```sql
SELECT
    column_name,
    data_type,
    is_nullable
FROM information_schema.columns
WHERE table_name = 'orders'
AND column_name IN (
    'processing_started_at',
    'shipped_at',
    'delivered_at',
    'completed_at',
    'delivery_proof_url'
)
ORDER BY column_name;
```

**Resultado esperado (5 filas)**:
```
column_name              | data_type                    | is_nullable
-------------------------+------------------------------+-------------
completed_at             | timestamp with time zone     | YES
delivered_at             | timestamp with time zone     | YES
delivery_proof_url       | text                         | YES
processing_started_at    | timestamp with time zone     | YES
shipped_at               | timestamp with time zone     | YES
```

---

## 🎯 Qué Hace Esta Migración

### Columnas Agregadas a la Tabla `orders`:

| Columna | Tipo | Propósito |
|---------|------|-----------|
| `processing_started_at` | TIMESTAMPTZ | Momento en que la orden comenzó a procesarse |
| `shipped_at` | TIMESTAMPTZ | Momento en que la orden fue enviada |
| `delivered_at` | TIMESTAMPTZ | Momento en que la orden fue entregada |
| `completed_at` | TIMESTAMPTZ | Momento en que la orden fue completada |
| `delivery_proof_url` | TEXT | URL de la foto de evidencia de entrega |

### Índices Creados:

1. **`idx_orders_processing_started_at`**
   - Optimiza el cálculo de días en procesamiento
   - Solo indexa órdenes con status = 'processing'

2. **`idx_orders_status`**
   - Optimiza filtrado por estado de orden
   - Mejora rendimiento en consultas del dashboard

### Políticas RLS Verificadas:

Si no existen, se crean automáticamente:

1. **"Users can view own orders or admins can view all"**
   - Permite a usuarios ver sus propias órdenes
   - Permite a admins y super_admins ver todas las órdenes

2. **"Only admins can update orders"**
   - Solo admins y super_admins pueden actualizar órdenes
   - Usuarios regulares no pueden modificar órdenes

---

## 🔧 Funcionalidades Que Se Activarán

Una vez ejecutada la migración, funcionarán:

1. ✅ **Botón "Iniciar"** - Mover orden de validada a procesamiento
2. ✅ **Botón "Enviar"** - Marcar orden como enviada (con tracking opcional)
3. ✅ **Botón "Evidencia"** - Subir foto de prueba de entrega
4. ✅ **Botón "Completar"** - Finalizar orden
5. ✅ **Contador de Días** - Mostrar días en procesamiento con alertas
6. ✅ **Historial de Timestamps** - Trazabilidad completa de cada orden

---

## ⚠️ Notas Importantes

### Seguridad:
- ✅ Script usa `IF NOT EXISTS` - seguro ejecutar múltiples veces
- ✅ No elimina ni modifica datos existentes
- ✅ Solo agrega columnas, índices y políticas

### Datos Existentes:
- Las órdenes existentes tendrán `NULL` en estas nuevas columnas
- Esto es **normal y esperado**
- Las nuevas órdenes llenarán automáticamente estos campos

### Rendimiento:
- Los índices optimizan las consultas
- No hay impacto negativo en performance
- La base de datos puede tardar unos segundos en crear los índices

---

## 🆘 Troubleshooting

### Si ves: "column already exists"
- ✅ **Ignorar** - Significa que ya fue ejecutado antes
- El script continuará con el resto de operaciones

### Si ves: "policy already exists"
- ✅ **Ignorar** - Las políticas RLS ya existen
- Esto es lo esperado

### Si ves: "permission denied"
- ❌ Tu usuario no tiene permisos suficientes
- Solución: Usa el usuario `postgres` o un superadmin

### Si ves: "relation 'orders' does not exist"
- ❌ La tabla orders no existe en tu esquema
- Solución: Verifica que estás en la base de datos correcta

---

## 📊 Antes vs Después

### Antes de la Migración:
```
ERROR: Could not find the 'shipped_at' column
```
❌ Botones de acción no funcionan
❌ No se pueden registrar timestamps
❌ No hay contador de días

### Después de la Migración:
```
✅ Migration completed successfully
```
✅ Todos los botones funcionan
✅ Timestamps se registran automáticamente
✅ Contador de días operativo
✅ Filtros avanzados funcionan
✅ Historial completo disponible

---

## 📞 Próximos Pasos

1. **Inmediatamente**: Ejecutar esta migración
2. **Después**: Recargar la aplicación web
3. **Probar**: Hacer clic en botones de acción
4. **Verificar**: Que no hay más errores de `shipped_at`

---

**Status**: ✅ **SCRIPT CORREGIDO Y LISTO**
**Prioridad**: 🔴 **CRÍTICA**
**Tiempo**: ⏱️ **2 minutos**
**Última Actualización**: 2025-10-13
