-- ============================================================================
-- MIGRACIÓN COMPLETA: Sistema de Destinatarios y Gestión Zelle Mejorada
-- ============================================================================

-- ============================================================================
-- TABLA: recipients (Destinatarios compartidos para remesas y combos)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.recipients (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  full_name character varying NOT NULL,
  phone character varying NOT NULL,
  id_number character varying,  -- Carnet de identidad
  email character varying,
  notes text,
  is_favorite boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT recipients_pkey PRIMARY KEY (id),
  CONSTRAINT recipients_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_recipients_user_id ON public.recipients(user_id);
CREATE INDEX IF NOT EXISTS idx_recipients_phone ON public.recipients(phone);

-- ============================================================================
-- TABLA: recipient_addresses (Direcciones de envío por destinatario)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.recipient_addresses (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  recipient_id uuid NOT NULL,
  address_type character varying DEFAULT 'home',  -- home, work, other
  province character varying NOT NULL,
  municipality character varying,
  address_line_1 text NOT NULL,
  address_line_2 text,
  postal_code character varying,
  reference_point text,  -- Punto de referencia
  is_default boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT recipient_addresses_pkey PRIMARY KEY (id),
  CONSTRAINT recipient_addresses_recipient_id_fkey FOREIGN KEY (recipient_id) REFERENCES public.recipients(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_recipient_addresses_recipient_id ON public.recipient_addresses(recipient_id);
CREATE INDEX IF NOT EXISTS idx_recipient_addresses_province ON public.recipient_addresses(province);

-- ============================================================================
-- TABLA: cuban_municipalities (Localidades de Cuba para remesas)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.cuban_municipalities (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  province character varying NOT NULL,
  municipality character varying NOT NULL,
  delivery_available boolean DEFAULT true,
  delivery_days integer DEFAULT 3,
  notes text,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT cuban_municipalities_pkey PRIMARY KEY (id),
  CONSTRAINT cuban_municipalities_unique UNIQUE (province, municipality)
);

CREATE INDEX IF NOT EXISTS idx_cuban_municipalities_province ON public.cuban_municipalities(province);

-- ============================================================================
-- MEJORAR TABLA: zelle_accounts (Ya existe, agregar columnas)
-- ============================================================================

-- Agregar columnas faltantes si no existen
ALTER TABLE public.zelle_accounts
  ADD COLUMN IF NOT EXISTS security_limit numeric DEFAULT 1000.00,
  ADD COLUMN IF NOT EXISTS priority_order integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS last_used_at timestamp with time zone;

-- ============================================================================
-- TABLA: zelle_transaction_history (Historial de transacciones)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.zelle_transaction_history (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  zelle_account_id uuid NOT NULL,
  transaction_type character varying NOT NULL,  -- remittance, product, combo
  reference_id uuid,  -- ID de remesa, order, etc.
  amount numeric NOT NULL,
  transaction_date timestamp with time zone DEFAULT now(),
  status character varying DEFAULT 'pending',  -- pending, validated, rejected
  validated_by uuid,
  validated_at timestamp with time zone,
  notes text,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT zelle_transaction_history_pkey PRIMARY KEY (id),
  CONSTRAINT zelle_transaction_history_account_fkey FOREIGN KEY (zelle_account_id) REFERENCES public.zelle_accounts(id) ON DELETE CASCADE,
  CONSTRAINT zelle_transaction_history_validated_by_fkey FOREIGN KEY (validated_by) REFERENCES auth.users(id)
);

CREATE INDEX IF NOT EXISTS idx_zelle_transactions_account ON public.zelle_transaction_history(zelle_account_id);
CREATE INDEX IF NOT EXISTS idx_zelle_transactions_date ON public.zelle_transaction_history(transaction_date);
CREATE INDEX IF NOT EXISTS idx_zelle_transactions_type ON public.zelle_transaction_history(transaction_type);

-- ============================================================================
-- ACTUALIZAR TABLA: remittances (Agregar campos de destinatario y Zelle)
-- ============================================================================

ALTER TABLE public.remittances
  ADD COLUMN IF NOT EXISTS recipient_id uuid,
  ADD COLUMN IF NOT EXISTS recipient_address_id uuid,
  ADD COLUMN IF NOT EXISTS zelle_account_id uuid,
  ADD COLUMN IF NOT EXISTS zelle_transaction_id uuid;

-- Agregar foreign keys
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'remittances_recipient_id_fkey'
  ) THEN
    ALTER TABLE public.remittances
      ADD CONSTRAINT remittances_recipient_id_fkey
      FOREIGN KEY (recipient_id) REFERENCES public.recipients(id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'remittances_recipient_address_id_fkey'
  ) THEN
    ALTER TABLE public.remittances
      ADD CONSTRAINT remittances_recipient_address_id_fkey
      FOREIGN KEY (recipient_address_id) REFERENCES public.recipient_addresses(id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'remittances_zelle_account_id_fkey'
  ) THEN
    ALTER TABLE public.remittances
      ADD CONSTRAINT remittances_zelle_account_id_fkey
      FOREIGN KEY (zelle_account_id) REFERENCES public.zelle_accounts(id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'remittances_zelle_transaction_id_fkey'
  ) THEN
    ALTER TABLE public.remittances
      ADD CONSTRAINT remittances_zelle_transaction_id_fkey
      FOREIGN KEY (zelle_transaction_id) REFERENCES public.zelle_transaction_history(id);
  END IF;
END $$;

-- ============================================================================
-- FUNCIÓN: Seleccionar cuenta Zelle automáticamente
-- ============================================================================
CREATE OR REPLACE FUNCTION select_available_zelle_account(
  p_transaction_type character varying,
  p_amount numeric
)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_account_id uuid;
BEGIN
  SELECT id INTO v_account_id
  FROM zelle_accounts
  WHERE is_active = true
    AND (
      (p_transaction_type = 'remittance' AND for_remittances = true) OR
      (p_transaction_type IN ('product', 'combo') AND for_products = true)
    )
    AND (current_daily_amount + p_amount) <= COALESCE(daily_limit, 999999)
    AND (current_monthly_amount + p_amount) <= COALESCE(monthly_limit, 999999)
    AND (current_daily_amount + p_amount) <= COALESCE(security_limit, 999999)
  ORDER BY priority_order ASC, last_used_at ASC NULLS FIRST
  LIMIT 1;

  RETURN v_account_id;
END;
$$;

-- ============================================================================
-- FUNCIÓN: Actualizar contadores de cuenta Zelle
-- ============================================================================
CREATE OR REPLACE FUNCTION update_zelle_account_usage(
  p_account_id uuid,
  p_amount numeric
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE zelle_accounts
  SET
    current_daily_amount = current_daily_amount + p_amount,
    current_monthly_amount = current_monthly_amount + p_amount,
    last_used_at = now(),
    updated_at = now()
  WHERE id = p_account_id;
END;
$$;

-- ============================================================================
-- FUNCIÓN: Reset diario de contadores Zelle (ejecutar con cron job)
-- ============================================================================
CREATE OR REPLACE FUNCTION reset_daily_zelle_counters()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE zelle_accounts
  SET
    current_daily_amount = 0,
    last_reset_date = CURRENT_DATE
  WHERE last_reset_date < CURRENT_DATE;
END;
$$;

-- ============================================================================
-- FUNCIÓN: Reset mensual de contadores Zelle (ejecutar con cron job)
-- ============================================================================
CREATE OR REPLACE FUNCTION reset_monthly_zelle_counters()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE zelle_accounts
  SET current_monthly_amount = 0
  WHERE EXTRACT(DAY FROM now()) = 1;  -- Primer día del mes
END;
$$;

-- ============================================================================
-- POLÍTICAS RLS: recipients
-- ============================================================================

ALTER TABLE public.recipients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own recipients"
  ON public.recipients FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users can create own recipients"
  ON public.recipients FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own recipients"
  ON public.recipients FOR UPDATE
  USING (user_id = auth.uid());

CREATE POLICY "Users can delete own recipients"
  ON public.recipients FOR DELETE
  USING (user_id = auth.uid());

-- ============================================================================
-- POLÍTICAS RLS: recipient_addresses
-- ============================================================================

ALTER TABLE public.recipient_addresses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own recipient addresses"
  ON public.recipient_addresses FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM recipients
      WHERE recipients.id = recipient_addresses.recipient_id
      AND recipients.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can create own recipient addresses"
  ON public.recipient_addresses FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM recipients
      WHERE recipients.id = recipient_addresses.recipient_id
      AND recipients.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update own recipient addresses"
  ON public.recipient_addresses FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM recipients
      WHERE recipients.id = recipient_addresses.recipient_id
      AND recipients.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete own recipient addresses"
  ON public.recipient_addresses FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM recipients
      WHERE recipients.id = recipient_addresses.recipient_id
      AND recipients.user_id = auth.uid()
    )
  );

-- ============================================================================
-- POLÍTICAS RLS: cuban_municipalities
-- ============================================================================

ALTER TABLE public.cuban_municipalities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view municipalities"
  ON public.cuban_municipalities FOR SELECT
  USING (true);

CREATE POLICY "Only admins can manage municipalities"
  ON public.cuban_municipalities FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.user_id = auth.uid()
      AND user_profiles.role IN ('admin', 'super_admin')
    )
  );

-- ============================================================================
-- POLÍTICAS RLS: zelle_transaction_history
-- ============================================================================

ALTER TABLE public.zelle_transaction_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own zelle transactions"
  ON public.zelle_transaction_history FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM remittances
      WHERE remittances.id = reference_id
      AND remittances.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.user_id = auth.uid()
      AND user_profiles.role IN ('admin', 'super_admin')
    )
  );

CREATE POLICY "System can insert zelle transactions"
  ON public.zelle_transaction_history FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Admins can update zelle transactions"
  ON public.zelle_transaction_history FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.user_id = auth.uid()
      AND user_profiles.role IN ('admin', 'super_admin')
    )
  );

-- ============================================================================
-- SEED DATA: Municipios de Cuba
-- ============================================================================

INSERT INTO public.cuban_municipalities (province, municipality, delivery_available) VALUES
  ('La Habana', 'Plaza de la Revolución', true),
  ('La Habana', 'Centro Habana', true),
  ('La Habana', 'Habana Vieja', true),
  ('La Habana', 'Habana del Este', true),
  ('La Habana', 'Guanabacoa', true),
  ('La Habana', 'San Miguel del Padrón', true),
  ('La Habana', 'Diez de Octubre', true),
  ('La Habana', 'Cerro', true),
  ('La Habana', 'Marianao', true),
  ('La Habana', 'La Lisa', true),
  ('La Habana', 'Boyeros', true),
  ('La Habana', 'Arroyo Naranjo', true),
  ('La Habana', 'Cotorro', true),
  ('La Habana', 'Regla', true),
  ('La Habana', 'Playa', true),
  ('Artemisa', 'Artemisa', true),
  ('Artemisa', 'Bauta', true),
  ('Artemisa', 'San Antonio de los Baños', true),
  ('Mayabeque', 'San José de las Lajas', true),
  ('Mayabeque', 'Güines', true),
  ('Matanzas', 'Matanzas', true),
  ('Matanzas', 'Cárdenas', true),
  ('Villa Clara', 'Santa Clara', true),
  ('Cienfuegos', 'Cienfuegos', true),
  ('Sancti Spíritus', 'Sancti Spíritus', true),
  ('Sancti Spíritus', 'Trinidad', true),
  ('Ciego de Ávila', 'Ciego de Ávila', true),
  ('Camagüey', 'Camagüey', true),
  ('Las Tunas', 'Las Tunas', true),
  ('Holguín', 'Holguín', true),
  ('Granma', 'Bayamo', true),
  ('Santiago de Cuba', 'Santiago de Cuba', true),
  ('Guantánamo', 'Guantánamo', true),
  ('Pinar del Río', 'Pinar del Río', true)
ON CONFLICT (province, municipality) DO NOTHING;

-- ============================================================================
-- VERIFICACIÓN FINAL
-- ============================================================================

SELECT '✅ MIGRACIÓN COMPLETADA' as status;

SELECT
  'recipients' as tabla,
  COUNT(*) as registros
FROM public.recipients
UNION ALL
SELECT
  'recipient_addresses',
  COUNT(*)
FROM public.recipient_addresses
UNION ALL
SELECT
  'cuban_municipalities',
  COUNT(*)
FROM public.cuban_municipalities
UNION ALL
SELECT
  'zelle_transaction_history',
  COUNT(*)
FROM public.zelle_transaction_history;
