-- Migration: Orders & Payment System Enhancement
-- Created: 2025-10-07
-- Purpose: Add tables and columns for complete order processing, shipping, and testimonials

-- ============================================================================
-- PART 1: CREATE NEW TABLES
-- ============================================================================

-- Table: shipping_zones
-- Purpose: Store shipping costs by province/region
CREATE TABLE IF NOT EXISTS public.shipping_zones (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  province_name text NOT NULL UNIQUE,
  shipping_cost numeric NOT NULL DEFAULT 0 CHECK (shipping_cost >= 0),
  is_active boolean DEFAULT true,
  free_shipping boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

COMMENT ON TABLE public.shipping_zones IS 'Provincial/regional shipping cost configuration';
COMMENT ON COLUMN public.shipping_zones.free_shipping IS 'If true, shipping is free regardless of cost';

-- Table: system_messages
-- Purpose: Store admin-configurable system messages (payment instructions, etc.)
CREATE TABLE IF NOT EXISTS public.system_messages (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  message_key text NOT NULL UNIQUE, -- 'zelle_instructions', 'whatsapp_support', etc.
  title_es text,
  title_en text,
  content_es text NOT NULL,
  content_en text NOT NULL,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

COMMENT ON TABLE public.system_messages IS 'Admin-configurable system messages for checkout and support';

-- ============================================================================
-- PART 2: MODIFY EXISTING TABLES
-- ============================================================================

-- Modify: orders table
-- Add columns for payment validation workflow
DO $$
BEGIN
  -- Add payment_proof_url if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'orders' AND column_name = 'payment_proof_url'
  ) THEN
    ALTER TABLE public.orders ADD COLUMN payment_proof_url text;
  END IF;

  -- Add shipping_zone_id if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'orders' AND column_name = 'shipping_zone_id'
  ) THEN
    ALTER TABLE public.orders ADD COLUMN shipping_zone_id uuid REFERENCES public.shipping_zones(id);
  END IF;

  -- Add validated_by if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'orders' AND column_name = 'validated_by'
  ) THEN
    ALTER TABLE public.orders ADD COLUMN validated_by uuid REFERENCES auth.users(id);
  END IF;

  -- Add validated_at if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'orders' AND column_name = 'validated_at'
  ) THEN
    ALTER TABLE public.orders ADD COLUMN validated_at timestamptz;
  END IF;

  -- Add rejection_reason if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'orders' AND column_name = 'rejection_reason'
  ) THEN
    ALTER TABLE public.orders ADD COLUMN rejection_reason text;
  END IF;
END $$;

COMMENT ON COLUMN public.orders.payment_proof_url IS 'URL/path to uploaded payment proof screenshot';
COMMENT ON COLUMN public.orders.shipping_zone_id IS 'Selected shipping zone for cost calculation';
COMMENT ON COLUMN public.orders.validated_by IS 'Admin user who validated/rejected the payment';
COMMENT ON COLUMN public.orders.validated_at IS 'Timestamp when payment was validated';
COMMENT ON COLUMN public.orders.rejection_reason IS 'Reason for payment rejection (if rejected)';

-- ============================================================================
-- PART 3: CREATE INDEXES FOR PERFORMANCE
-- ============================================================================

-- Index on orders for admin queries
CREATE INDEX IF NOT EXISTS idx_orders_status ON public.orders(status) WHERE status IN ('pending', 'validated', 'rejected');
CREATE INDEX IF NOT EXISTS idx_orders_user_id ON public.orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_payment_status ON public.orders(payment_status);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON public.orders(created_at DESC);

-- Index on order_items for lookups
CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON public.order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_item_id ON public.order_items(item_id, item_type);

-- Index on testimonials
CREATE INDEX IF NOT EXISTS idx_testimonials_user_id ON public.testimonials(user_id);
CREATE INDEX IF NOT EXISTS idx_testimonials_visible ON public.testimonials(is_visible) WHERE is_visible = true;
CREATE INDEX IF NOT EXISTS idx_testimonials_featured ON public.testimonials(is_featured) WHERE is_featured = true;

-- ============================================================================
-- PART 4: ROW LEVEL SECURITY (RLS) POLICIES
-- ============================================================================

-- Enable RLS on new tables
ALTER TABLE public.shipping_zones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_messages ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (for clean migration)
DROP POLICY IF EXISTS "Users can view own orders" ON public.orders;
DROP POLICY IF EXISTS "Admins can view all orders" ON public.orders;
DROP POLICY IF EXISTS "Admins can update orders" ON public.orders;
DROP POLICY IF EXISTS "Users can create orders" ON public.orders;

DROP POLICY IF EXISTS "Users can manage own testimonials" ON public.testimonials;
DROP POLICY IF EXISTS "Public can view visible testimonials" ON public.testimonials;
DROP POLICY IF EXISTS "Admins can manage all testimonials" ON public.testimonials;

DROP POLICY IF EXISTS "Public can view active shipping zones" ON public.shipping_zones;
DROP POLICY IF EXISTS "Admins can manage shipping zones" ON public.shipping_zones;

DROP POLICY IF EXISTS "Public can view active messages" ON public.system_messages;
DROP POLICY IF EXISTS "Admins can manage system messages" ON public.system_messages;

-- ===== ORDERS POLICIES =====

-- Users can view their own orders
CREATE POLICY "Users can view own orders"
ON public.orders FOR SELECT
TO authenticated
USING (user_id = auth.uid());

-- Admins can view all orders
CREATE POLICY "Admins can view all orders"
ON public.orders FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE user_profiles.user_id = auth.uid()
    AND user_profiles.role IN ('admin', 'super_admin')
  )
);

-- Users can create their own orders
CREATE POLICY "Users can create orders"
ON public.orders FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

-- Admins can update orders (for validation/rejection)
CREATE POLICY "Admins can update orders"
ON public.orders FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE user_profiles.user_id = auth.uid()
    AND user_profiles.role IN ('admin', 'super_admin')
  )
);

-- ===== TESTIMONIALS POLICIES =====

-- Users can manage their own testimonials
CREATE POLICY "Users can manage own testimonials"
ON public.testimonials FOR ALL
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

-- Public can view visible testimonials
CREATE POLICY "Public can view visible testimonials"
ON public.testimonials FOR SELECT
TO public
USING (is_visible = true);

-- Admins can manage all testimonials (for approval/visibility)
CREATE POLICY "Admins can manage all testimonials"
ON public.testimonials FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE user_profiles.user_id = auth.uid()
    AND user_profiles.role IN ('admin', 'super_admin')
  )
);

-- ===== SHIPPING ZONES POLICIES =====

-- Public can view active shipping zones
CREATE POLICY "Public can view active shipping zones"
ON public.shipping_zones FOR SELECT
TO public
USING (is_active = true);

-- Admins can manage shipping zones
CREATE POLICY "Admins can manage shipping zones"
ON public.shipping_zones FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE user_profiles.user_id = auth.uid()
    AND user_profiles.role IN ('admin', 'super_admin')
  )
);

-- ===== SYSTEM MESSAGES POLICIES =====

-- Public can view active system messages
CREATE POLICY "Public can view active messages"
ON public.system_messages FOR SELECT
TO public
USING (is_active = true);

-- Admins can manage system messages
CREATE POLICY "Admins can manage system messages"
ON public.system_messages FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE user_profiles.user_id = auth.uid()
    AND user_profiles.role IN ('admin', 'super_admin')
  )
);

-- ============================================================================
-- PART 5: GRANT PERMISSIONS
-- ============================================================================

-- Grant select on new tables
GRANT SELECT ON public.shipping_zones TO anon, authenticated;
GRANT SELECT ON public.system_messages TO anon, authenticated;

-- Grant all on tables for authenticated (RLS will control access)
GRANT ALL ON public.shipping_zones TO authenticated;
GRANT ALL ON public.system_messages TO authenticated;
GRANT ALL ON public.orders TO authenticated;
GRANT ALL ON public.order_items TO authenticated;
GRANT ALL ON public.testimonials TO authenticated;

-- ============================================================================
-- PART 6: INSERT DEFAULT DATA
-- ============================================================================

-- Insert default system messages
INSERT INTO public.system_messages (message_key, title_es, title_en, content_es, content_en, is_active)
VALUES
  (
    'zelle_instructions',
    'Instrucciones de Pago Zelle',
    'Zelle Payment Instructions',
    'Por favor complete el pago usando Zelle con la información proporcionada. Asegúrese de incluir el número de orden en la descripción del pago para una validación rápida. Una vez completado el pago, suba la captura de pantalla como comprobante.',
    'Please complete payment using Zelle with the information provided. Make sure to include the order number in the payment description for quick validation. Once payment is complete, upload the screenshot as proof.',
    true
  ),
  (
    'whatsapp_support',
    'Soporte por WhatsApp',
    'WhatsApp Support',
    '¿Tienes dudas sobre tu pedido o pago? Contáctanos por WhatsApp y te ayudaremos inmediatamente.',
    'Have questions about your order or payment? Contact us on WhatsApp and we''ll help you immediately.',
    true
  ),
  (
    'checkout_terms',
    'Términos y Condiciones',
    'Terms and Conditions',
    'Al realizar tu pedido, aceptas nuestros términos de servicio. Los pedidos están sujetos a disponibilidad de inventario. El tiempo de entrega estimado es de 3-7 días hábiles.',
    'By placing your order, you accept our terms of service. Orders are subject to inventory availability. Estimated delivery time is 3-7 business days.',
    true
  )
ON CONFLICT (message_key) DO NOTHING;

-- Insert some default shipping zones (examples - admin can modify)
INSERT INTO public.shipping_zones (province_name, shipping_cost, is_active, free_shipping)
VALUES
  ('La Habana', 0, true, true),
  ('Artemisa', 10.00, true, false),
  ('Mayabeque', 15.00, true, false),
  ('Matanzas', 20.00, true, false),
  ('Villa Clara', 25.00, true, false),
  ('Sancti Spíritus', 30.00, true, false),
  ('Ciego de Ávila', 35.00, true, false),
  ('Camagüey', 40.00, true, false),
  ('Las Tunas', 45.00, true, false),
  ('Holguín', 50.00, true, false),
  ('Granma', 55.00, true, false),
  ('Santiago de Cuba', 60.00, true, false),
  ('Guantánamo', 65.00, true, false),
  ('Pinar del Río', 20.00, true, false),
  ('Cienfuegos', 25.00, true, false),
  ('Isla de la Juventud', 70.00, true, false)
ON CONFLICT (province_name) DO NOTHING;

-- ============================================================================
-- PART 7: CREATE HELPER FUNCTIONS
-- ============================================================================

-- Function to get pending orders count for admin notifications
CREATE OR REPLACE FUNCTION public.get_pending_orders_count()
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT COUNT(*)::integer
  FROM public.orders
  WHERE status = 'pending' OR payment_status = 'pending';
$$;

-- Function to get low stock products count
CREATE OR REPLACE FUNCTION public.get_low_stock_count()
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT COUNT(*)::integer
  FROM public.inventory i
  JOIN public.products p ON p.id = i.product_id
  WHERE i.available_quantity <= p.min_stock_alert
  AND i.available_quantity > 0
  AND i.is_active = true;
$$;

-- Function to calculate order total with shipping
CREATE OR REPLACE FUNCTION public.calculate_order_total(
  p_subtotal numeric,
  p_shipping_zone_id uuid,
  p_discount_amount numeric DEFAULT 0
)
RETURNS numeric
LANGUAGE plpgsql
AS $$
DECLARE
  v_shipping_cost numeric := 0;
  v_free_shipping boolean := false;
BEGIN
  -- Get shipping cost
  SELECT shipping_cost, free_shipping
  INTO v_shipping_cost, v_free_shipping
  FROM public.shipping_zones
  WHERE id = p_shipping_zone_id AND is_active = true;

  -- Apply free shipping if enabled
  IF v_free_shipping THEN
    v_shipping_cost := 0;
  END IF;

  -- Calculate total
  RETURN (p_subtotal - COALESCE(p_discount_amount, 0)) + COALESCE(v_shipping_cost, 0);
END;
$$;

-- ============================================================================
-- PART 8: CREATE UPDATE TRIGGERS
-- ============================================================================

-- Trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply trigger to new tables
DROP TRIGGER IF EXISTS update_shipping_zones_updated_at ON public.shipping_zones;
CREATE TRIGGER update_shipping_zones_updated_at
BEFORE UPDATE ON public.shipping_zones
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_system_messages_updated_at ON public.system_messages;
CREATE TRIGGER update_system_messages_updated_at
BEFORE UPDATE ON public.system_messages
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- VERIFICATION QUERIES (Run these to verify migration)
-- ============================================================================

-- Verify new tables exist
SELECT 'shipping_zones' as table_name, COUNT(*) as record_count FROM public.shipping_zones
UNION ALL
SELECT 'system_messages', COUNT(*) FROM public.system_messages;

-- Verify new columns in orders
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'orders'
AND column_name IN ('payment_proof_url', 'shipping_zone_id', 'validated_by', 'validated_at', 'rejection_reason')
ORDER BY column_name;

-- Verify policies
SELECT schemaname, tablename, policyname, permissive, roles, cmd
FROM pg_policies
WHERE tablename IN ('orders', 'testimonials', 'shipping_zones', 'system_messages')
ORDER BY tablename, policyname;

-- ============================================================================
-- MIGRATION COMPLETE
-- ============================================================================

-- Log migration completion
DO $$
BEGIN
  RAISE NOTICE 'Migration 20251007_orders_payment_system completed successfully';
  RAISE NOTICE 'New tables: shipping_zones, system_messages';
  RAISE NOTICE 'Modified tables: orders (added 5 columns)';
  RAISE NOTICE 'RLS policies: Created/updated for orders, testimonials, shipping_zones, system_messages';
  RAISE NOTICE 'Helper functions: get_pending_orders_count, get_low_stock_count, calculate_order_total';
END $$;
