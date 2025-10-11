-- ========================================
-- PHASE 2 MIGRATIONS
-- New Features: Delivery dates, transport costs,
-- admin messages, operational costs
-- ========================================

-- 1. Add delivery_days and transport_cost to shipping_zones
ALTER TABLE shipping_zones
ADD COLUMN IF NOT EXISTS delivery_days INTEGER DEFAULT 3,
ADD COLUMN IF NOT EXISTS transport_cost DECIMAL(10,2) DEFAULT 0.00,
ADD COLUMN IF NOT EXISTS delivery_note TEXT;

COMMENT ON COLUMN shipping_zones.delivery_days IS 'Estimated delivery days for this zone';
COMMENT ON COLUMN shipping_zones.transport_cost IS 'Internal transport cost for admin cost tracking';
COMMENT ON COLUMN shipping_zones.delivery_note IS 'Custom delivery note for this zone';

-- 2. Create admin_messages table for user notifications
CREATE TABLE IF NOT EXISTS admin_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  admin_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  subject VARCHAR(255) NOT NULL,
  message TEXT NOT NULL,
  is_read BOOLEAN DEFAULT false,
  related_order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  read_at TIMESTAMPTZ
);

CREATE INDEX idx_admin_messages_user ON admin_messages(user_id, is_read);
CREATE INDEX idx_admin_messages_created ON admin_messages(created_at DESC);

COMMENT ON TABLE admin_messages IS 'Messages from admin to users';

-- RLS for admin_messages
ALTER TABLE admin_messages ENABLE ROW LEVEL SECURITY;

-- Users can read their own messages
CREATE POLICY "Users can read own messages"
ON admin_messages FOR SELECT
TO authenticated
USING (user_id = auth.uid());

-- Users can update read status of their own messages
CREATE POLICY "Users can mark own messages as read"
ON admin_messages FOR UPDATE
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

-- Admins can create messages
CREATE POLICY "Admins can create messages"
ON admin_messages FOR INSERT
TO authenticated
WITH CHECK (public.current_user_role() IN ('admin', 'super_admin'));

-- Admins can read all messages
CREATE POLICY "Admins can read all messages"
ON admin_messages FOR SELECT
TO authenticated
USING (public.current_user_role() IN ('admin', 'super_admin'));

-- 3. Create operational_costs table
CREATE TABLE IF NOT EXISTS operational_costs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cost_name VARCHAR(255) NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  frequency VARCHAR(50) NOT NULL CHECK (frequency IN ('daily', 'weekly', 'biweekly', 'monthly', 'yearly')),
  category VARCHAR(100), -- 'energy', 'salaries', 'rent', 'supplies', etc.
  description TEXT,
  is_active BOOLEAN DEFAULT true,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_operational_costs_active ON operational_costs(is_active);
CREATE INDEX idx_operational_costs_frequency ON operational_costs(frequency);

COMMENT ON TABLE operational_costs IS 'Operational costs configuration for financial tracking';

-- RLS for operational_costs
ALTER TABLE operational_costs ENABLE ROW LEVEL SECURITY;

-- Only admins can manage operational costs
CREATE POLICY "Admins can manage operational costs"
ON operational_costs FOR ALL
TO authenticated
USING (public.current_user_role() IN ('admin', 'super_admin'))
WITH CHECK (public.current_user_role() IN ('admin', 'super_admin'));

-- 4. Add delivered_at and estimated_delivery_date to orders
ALTER TABLE orders
ADD COLUMN IF NOT EXISTS estimated_delivery_date DATE,
ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS delivery_notes TEXT;

COMMENT ON COLUMN orders.estimated_delivery_date IS 'Estimated delivery date shown to customer';
COMMENT ON COLUMN orders.delivered_at IS 'Actual delivery timestamp';

-- 5. Create function to calculate daily cost from frequency
CREATE OR REPLACE FUNCTION get_daily_operational_cost()
RETURNS DECIMAL AS $$
DECLARE
  total_daily_cost DECIMAL := 0;
  cost_record RECORD;
BEGIN
  FOR cost_record IN
    SELECT amount, frequency FROM operational_costs WHERE is_active = true
  LOOP
    CASE cost_record.frequency
      WHEN 'daily' THEN
        total_daily_cost := total_daily_cost + cost_record.amount;
      WHEN 'weekly' THEN
        total_daily_cost := total_daily_cost + (cost_record.amount / 7);
      WHEN 'biweekly' THEN
        total_daily_cost := total_daily_cost + (cost_record.amount / 14);
      WHEN 'monthly' THEN
        total_daily_cost := total_daily_cost + (cost_record.amount / 30);
      WHEN 'yearly' THEN
        total_daily_cost := total_daily_cost + (cost_record.amount / 365);
    END CASE;
  END LOOP;

  RETURN total_daily_cost;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6. Create view for order analytics with costs
CREATE OR REPLACE VIEW order_analytics AS
SELECT
  o.id,
  o.order_number,
  o.created_at,
  o.validated_at,
  o.status,
  o.payment_status,
  o.total_amount,
  o.shipping_cost,
  sz.transport_cost,
  sz.province_name,
  (o.shipping_address->>'municipality')::text as municipality,
  up.full_name as customer_name,
  up.email as customer_email,
  c.code as currency_code
FROM orders o
LEFT JOIN shipping_zones sz ON o.shipping_zone_id = sz.id
LEFT JOIN user_profiles up ON o.user_id = up.user_id
LEFT JOIN currencies c ON o.currency_id = c.id;

COMMENT ON VIEW order_analytics IS 'Order analytics with transport costs for reporting';

-- Grant permissions
GRANT SELECT ON order_analytics TO authenticated;
