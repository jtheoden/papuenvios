-- ============================================================================
-- MIGRACIÓN: Sistema Completo de Remesas
-- Fecha: 2025-10-13
-- Descripción: Crea todas las tablas necesarias para el sistema de remesas
-- ============================================================================

-- ============================================================================
-- 1. TABLA: remittance_types
-- Configuración de tipos de remesas (Administrable por admin)
-- ============================================================================

CREATE TABLE IF NOT EXISTS remittance_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Configuración básica
  name VARCHAR(200) NOT NULL,
  currency_code VARCHAR(10) NOT NULL,          -- USD, EUR, CAD, etc.
  delivery_currency VARCHAR(10) NOT NULL,       -- CUP, USD, MLC

  -- Tasas y comisiones
  exchange_rate DECIMAL(12, 4) NOT NULL,        -- Tasa de cambio actual
  commission_percentage DECIMAL(5, 2) DEFAULT 0, -- % de comisión (0-100)
  commission_fixed DECIMAL(10, 2) DEFAULT 0,    -- Comisión fija
  min_amount DECIMAL(10, 2) NOT NULL,           -- Monto mínimo
  max_amount DECIMAL(10, 2),                    -- Monto máximo (NULL = sin límite)

  -- Configuración de entrega
  delivery_method VARCHAR(50) NOT NULL,         -- cash, transfer, card, pickup
  max_delivery_days INTEGER DEFAULT 3,          -- Días máximos para entrega
  warning_days INTEGER DEFAULT 2,               -- Días para mostrar warning (amarillo)

  -- Estado y visibilidad
  is_active BOOLEAN DEFAULT true,
  display_order INTEGER DEFAULT 0,

  -- Metadata
  description TEXT,
  icon VARCHAR(50),                             -- Nombre del ícono
  notes TEXT,                                   -- Notas internas

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id)
);

-- Índices para remittance_types
CREATE INDEX IF NOT EXISTS idx_remittance_types_active
  ON remittance_types(is_active) WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_remittance_types_currency
  ON remittance_types(currency_code);

CREATE INDEX IF NOT EXISTS idx_remittance_types_display
  ON remittance_types(display_order, is_active);

-- Comentarios
COMMENT ON TABLE remittance_types IS 'Configuración de tipos de remesas disponibles';
COMMENT ON COLUMN remittance_types.exchange_rate IS 'Tasa de cambio: 1 unidad de currency_code = X unidades de delivery_currency';
COMMENT ON COLUMN remittance_types.commission_percentage IS 'Porcentaje de comisión sobre el monto (0-100)';
COMMENT ON COLUMN remittance_types.commission_fixed IS 'Comisión fija adicional en currency_code';
COMMENT ON COLUMN remittance_types.max_delivery_days IS 'Días máximos desde validación hasta entrega';
COMMENT ON COLUMN remittance_types.warning_days IS 'Días para mostrar alerta amarilla antes del máximo';

-- ============================================================================
-- 2. FUNCIÓN: Generar número de remesa único
-- ============================================================================

CREATE OR REPLACE FUNCTION generate_remittance_number()
RETURNS VARCHAR(50) AS $$
DECLARE
  new_number VARCHAR(50);
  year_part VARCHAR(4);
  counter INTEGER;
  max_attempts INTEGER := 10;
  attempt INTEGER := 0;
BEGIN
  year_part := TO_CHAR(NOW(), 'YYYY');

  LOOP
    -- Obtener el siguiente contador para el año actual
    SELECT COALESCE(MAX(
      CAST(SUBSTRING(remittance_number FROM '\d+$') AS INTEGER)
    ), 0) + 1
    INTO counter
    FROM remittances
    WHERE remittance_number LIKE 'REM-' || year_part || '-%';

    -- Generar el número con padding de 4 dígitos
    new_number := 'REM-' || year_part || '-' || LPAD(counter::TEXT, 4, '0');

    -- Verificar que no exista (por si acaso)
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM remittances WHERE remittance_number = new_number
    );

    attempt := attempt + 1;
    EXIT WHEN attempt >= max_attempts;
  END LOOP;

  RETURN new_number;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION generate_remittance_number() IS 'Genera número único de remesa en formato REM-YYYY-0001';

-- ============================================================================
-- 3. TABLA: remittances
-- Órdenes de remesas
-- ============================================================================

CREATE TABLE IF NOT EXISTS remittances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  remittance_number VARCHAR(50) UNIQUE NOT NULL DEFAULT generate_remittance_number(),

  -- Referencias
  user_id UUID NOT NULL REFERENCES auth.users(id),
  remittance_type_id UUID NOT NULL REFERENCES remittance_types(id),

  -- Montos y cálculos (snapshot al momento de crear)
  amount_sent DECIMAL(12, 2) NOT NULL,          -- Monto enviado por el usuario
  exchange_rate DECIMAL(12, 4) NOT NULL,        -- Tasa al momento de crear
  commission_percentage DECIMAL(5, 2) NOT NULL, -- % de comisión aplicada
  commission_fixed DECIMAL(10, 2) NOT NULL,     -- Comisión fija aplicada
  commission_total DECIMAL(10, 2) NOT NULL,     -- Total de comisión cobrada
  amount_to_deliver DECIMAL(12, 2) NOT NULL,    -- Monto a entregar al destinatario
  currency_sent VARCHAR(10) NOT NULL,           -- USD, EUR, etc.
  currency_delivered VARCHAR(10) NOT NULL,      -- CUP, USD, MLC

  -- Datos del destinatario
  recipient_name VARCHAR(200) NOT NULL,
  recipient_phone VARCHAR(20) NOT NULL,
  recipient_id_number VARCHAR(50),              -- CI del destinatario
  recipient_address TEXT,
  recipient_province VARCHAR(100),
  recipient_municipality VARCHAR(100),
  delivery_notes TEXT,                          -- Notas del usuario

  -- Comprobante de pago (Usuario)
  payment_proof_url TEXT,                       -- URL en Supabase Storage
  payment_reference VARCHAR(200),               -- Número de referencia/transacción
  payment_proof_uploaded_at TIMESTAMPTZ,
  payment_proof_notes TEXT,                     -- Notas adicionales del usuario

  -- Validación de pago (Admin)
  payment_validated BOOLEAN DEFAULT false,
  payment_validated_at TIMESTAMPTZ,
  payment_validated_by UUID REFERENCES auth.users(id),
  payment_rejection_reason TEXT,

  -- Evidencia de entrega (Admin)
  delivery_proof_url TEXT,                      -- Foto de evidencia de entrega
  delivery_notes_admin TEXT,                    -- Notas del admin sobre la entrega
  delivered_to_name VARCHAR(200),               -- Nombre de quien recibió
  delivered_to_id VARCHAR(50),                  -- CI de quien recibió
  delivered_at TIMESTAMPTZ,
  delivered_by UUID REFERENCES auth.users(id),  -- Admin que confirmó

  -- Estados y timestamps
  status VARCHAR(50) NOT NULL DEFAULT 'payment_pending',
  -- Valores posibles:
  --   payment_pending: Esperando que usuario suba comprobante
  --   payment_proof_uploaded: Comprobante subido, esperando validación admin
  --   payment_validated: Pago validado por admin, listo para procesar
  --   payment_rejected: Pago rechazado por admin
  --   processing: Admin ha iniciado el procesamiento
  --   delivered: Remesa entregada, esperando completar
  --   completed: Remesa completada
  --   cancelled: Remesa cancelada

  processing_started_at TIMESTAMPTZ,            -- Cuando admin inicia procesamiento
  completed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  cancellation_reason TEXT,
  cancelled_by UUID REFERENCES auth.users(id),

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índices para remittances
CREATE INDEX IF NOT EXISTS idx_remittances_user
  ON remittances(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_remittances_status
  ON remittances(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_remittances_number
  ON remittances(remittance_number);

CREATE INDEX IF NOT EXISTS idx_remittances_type
  ON remittances(remittance_type_id);

CREATE INDEX IF NOT EXISTS idx_remittances_payment_validated
  ON remittances(payment_validated, payment_validated_at DESC);

CREATE INDEX IF NOT EXISTS idx_remittances_processing
  ON remittances(processing_started_at DESC)
  WHERE status = 'processing';

-- Comentarios
COMMENT ON TABLE remittances IS 'Órdenes de remesas de usuarios';
COMMENT ON COLUMN remittances.remittance_number IS 'Número único de remesa (REM-YYYY-0001)';
COMMENT ON COLUMN remittances.commission_total IS 'Total de comisión: (amount_sent * commission_percentage / 100) + commission_fixed';
COMMENT ON COLUMN remittances.amount_to_deliver IS 'Monto final que recibe el destinatario: (amount_sent - commission_total) * exchange_rate';
COMMENT ON COLUMN remittances.status IS 'Estado actual de la remesa';

-- ============================================================================
-- 4. TABLA: remittance_status_history
-- Historial de cambios de estado
-- ============================================================================

CREATE TABLE IF NOT EXISTS remittance_status_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  remittance_id UUID NOT NULL REFERENCES remittances(id) ON DELETE CASCADE,

  old_status VARCHAR(50),
  new_status VARCHAR(50) NOT NULL,

  changed_by UUID REFERENCES auth.users(id),
  change_reason TEXT,
  notes TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índice para remittance_status_history
CREATE INDEX IF NOT EXISTS idx_remittance_history
  ON remittance_status_history(remittance_id, created_at DESC);

COMMENT ON TABLE remittance_status_history IS 'Historial de cambios de estado de remesas';

-- ============================================================================
-- 5. TRIGGER: Actualizar updated_at automáticamente
-- ============================================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger para remittance_types
DROP TRIGGER IF EXISTS update_remittance_types_updated_at ON remittance_types;
CREATE TRIGGER update_remittance_types_updated_at
  BEFORE UPDATE ON remittance_types
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Trigger para remittances
DROP TRIGGER IF EXISTS update_remittances_updated_at ON remittances;
CREATE TRIGGER update_remittances_updated_at
  BEFORE UPDATE ON remittances
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- 6. TRIGGER: Registrar cambios de estado en historial
-- ============================================================================

CREATE OR REPLACE FUNCTION log_remittance_status_change()
RETURNS TRIGGER AS $$
BEGIN
  -- Solo registrar si el status cambió
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO remittance_status_history (
      remittance_id,
      old_status,
      new_status,
      changed_by,
      notes
    ) VALUES (
      NEW.id,
      OLD.status,
      NEW.status,
      NEW.updated_at, -- Timestamp del cambio
      CASE NEW.status
        WHEN 'payment_rejected' THEN NEW.payment_rejection_reason
        WHEN 'cancelled' THEN NEW.cancellation_reason
        ELSE NULL
      END
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS log_remittance_status ON remittances;
CREATE TRIGGER log_remittance_status
  AFTER UPDATE ON remittances
  FOR EACH ROW
  EXECUTE FUNCTION log_remittance_status_change();

-- ============================================================================
-- 7. RLS POLICIES - remittance_types
-- ============================================================================

ALTER TABLE remittance_types ENABLE ROW LEVEL SECURITY;

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

-- ============================================================================
-- 8. RLS POLICIES - remittances
-- ============================================================================

ALTER TABLE remittances ENABLE ROW LEVEL SECURITY;

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

-- ============================================================================
-- 9. RLS POLICIES - remittance_status_history
-- ============================================================================

ALTER TABLE remittance_status_history ENABLE ROW LEVEL SECURITY;

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

-- Solo el sistema (triggers) puede insertar en historial
-- No hay policy de INSERT porque se maneja por triggers

-- ============================================================================
-- 10. DATOS INICIALES - Tipos de remesas por defecto
-- ============================================================================

-- Insertar tipos de remesas iniciales (solo si no existen)
INSERT INTO remittance_types (
  name, currency_code, delivery_currency, exchange_rate,
  commission_percentage, commission_fixed,
  min_amount, max_amount,
  delivery_method, max_delivery_days, warning_days,
  description, icon, display_order, is_active
) VALUES
  (
    'Dólares a CUP (Efectivo)',
    'USD', 'CUP', 320.00,
    2.5, 0,
    10.00, 1000.00,
    'cash', 3, 2,
    'Envía dólares USD y el destinatario recibe pesos cubanos (CUP) en efectivo',
    'dollar-sign', 1, true
  ),
  (
    'Euros a CUP (Efectivo)',
    'EUR', 'CUP', 350.00,
    3.0, 0,
    10.00, 500.00,
    'cash', 3, 2,
    'Envía euros EUR y el destinatario recibe pesos cubanos (CUP) en efectivo',
    'euro', 2, true
  ),
  (
    'Dólares a USD (Transferencia)',
    'USD', 'USD', 1.00,
    5.0, 2.00,
    20.00, 2000.00,
    'transfer', 2, 1,
    'Envía dólares USD y el destinatario recibe dólares por transferencia bancaria',
    'credit-card', 3, true
  ),
  (
    'Dólares a MLC (Tarjeta)',
    'USD', 'MLC', 1.00,
    5.0, 2.00,
    20.00, 2000.00,
    'card', 2, 1,
    'Envía dólares USD y el destinatario recibe MLC en su tarjeta',
    'credit-card', 4, false
  )
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- MIGRACIÓN COMPLETADA
-- ============================================================================

-- Log de éxito
DO $$
BEGIN
  RAISE NOTICE 'Migración de sistema de remesas completada exitosamente';
  RAISE NOTICE 'Tablas creadas: remittance_types, remittances, remittance_status_history';
  RAISE NOTICE 'Funciones creadas: generate_remittance_number, update_updated_at_column, log_remittance_status_change';
  RAISE NOTICE 'RLS habilitado en todas las tablas';
  RAISE NOTICE '% tipos de remesas iniciales insertados', (SELECT COUNT(*) FROM remittance_types);
END $$;
