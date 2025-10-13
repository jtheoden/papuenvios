# ⚠️ MIGRACIÓN URGENTE REQUERIDA

## Error Actual
```
Could not find the 'shipped_at' column of 'orders' in the schema cache
```

Este error ocurre porque las nuevas columnas necesarias para el flujo de órdenes **NO EXISTEN** en la base de datos.

---

## 🚨 ACCIÓN REQUERIDA - EJECUTAR INMEDIATAMENTE

### Paso 1: Abrir Supabase SQL Editor

1. Ve a tu proyecto en Supabase: https://supabase.com/dashboard
2. En el menú lateral, haz clic en **"SQL Editor"**
3. Haz clic en **"New Query"**

### Paso 2: Copiar y Ejecutar el Script

**Copia TODO el contenido** del archivo: `database_migration_order_timestamps.sql`

O copia este script completo:

```sql
-- Migration: Add order state transition timestamps
-- Date: 2025-10-12
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

### Paso 3: Ejecutar

1. Pega el script en el SQL Editor
2. Haz clic en el botón **"Run"** o presiona `Ctrl + Enter`
3. Deberías ver el mensaje: `Migration completed: order_timestamps_and_delivery_proof`

---

## ✅ Verificación

Después de ejecutar el script, verifica que funcionó:

```sql
-- Verifica que las columnas existen
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'orders'
AND column_name IN ('processing_started_at', 'shipped_at', 'delivered_at', 'completed_at', 'delivery_proof_url');
```

Deberías ver 5 filas con las columnas:
- processing_started_at (timestamp with time zone)
- shipped_at (timestamp with time zone)
- delivered_at (timestamp with time zone)
- completed_at (timestamp with time zone)
- delivery_proof_url (text)

---

## 🎯 Qué Hace Esta Migración

### Columnas Agregadas:

1. **`processing_started_at`** - Guarda cuándo la orden empezó a procesarse
2. **`shipped_at`** - Guarda cuándo la orden fue enviada
3. **`delivered_at`** - Guarda cuándo la orden fue entregada
4. **`completed_at`** - Guarda cuándo la orden fue completada
5. **`delivery_proof_url`** - URL pública de la foto de evidencia de entrega

### Índices Creados:

- **`idx_orders_processing_started_at`** - Optimiza las consultas de días en procesamiento
- **`idx_orders_status`** - Optimiza el filtrado por estado

### Políticas RLS Verificadas:

- Usuarios pueden ver sus propias órdenes
- Admins pueden ver todas las órdenes
- Solo admins pueden actualizar órdenes

---

## 🔧 Funcionalidades que Ahora Funcionarán

Después de ejecutar esta migración, funcionarán correctamente:

1. ✅ Botón "Iniciar" - Mover orden a procesamiento
2. ✅ Botón "Enviar" - Marcar orden como enviada (con tracking opcional)
3. ✅ Botón "Evidencia" - Subir foto de prueba de entrega
4. ✅ Botón "Completar" - Finalizar orden
5. ✅ Contador de días en procesamiento (con alertas por colores)
6. ✅ Historial completo de timestamps por orden

---

## ⚠️ Importante

- **Este script es seguro de ejecutar múltiples veces** (usa `IF NOT EXISTS`)
- **NO elimina ni modifica datos existentes**
- **Solo AGREGA nuevas columnas e índices**
- **Las órdenes existentes tendrán NULL en estas columnas** (normal)
- **Las nuevas órdenes llenarán estos campos automáticamente**

---

## 🆘 Si Hay Errores

Si ves algún error al ejecutar:

1. **"permission denied"**: Tu usuario no tiene permisos. Usa el usuario `postgres` o un superadmin.
2. **"relation 'orders' does not exist"**: La tabla orders no existe. Verifica el nombre de la tabla.
3. **"column already exists"**: Ignora este error, significa que ya fue ejecutado antes.

---

## 📞 Después de Ejecutar

1. Recarga la aplicación web
2. Prueba hacer clic en "Enviar" en una orden
3. **NO deberías** ver más el error de `shipped_at`
4. Los botones de acción deberían funcionar correctamente

---

**Status**: ⚠️ **PENDIENTE DE EJECUCIÓN**
**Prioridad**: 🔴 **CRÍTICA** (La aplicación NO funcionará correctamente sin esto)
**Tiempo estimado**: ⏱️ **2 minutos**
