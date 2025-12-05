-- ============================================================================
-- CREATE OFFER_USAGE TABLE
-- Tracks usage of promotional offers/coupons
-- ============================================================================

-- Create the table
CREATE TABLE IF NOT EXISTS public.offer_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_id uuid NOT NULL REFERENCES public.offers(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  used_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_offer_usage_offer_id
  ON public.offer_usage(offer_id);

CREATE INDEX IF NOT EXISTS idx_offer_usage_user_id
  ON public.offer_usage(user_id);

CREATE INDEX IF NOT EXISTS idx_offer_usage_order_id
  ON public.offer_usage(order_id);

-- Enable Row Level Security
ALTER TABLE public.offer_usage ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view their own usage
CREATE POLICY "users can view own usage"
  ON public.offer_usage FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid() OR
    EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE id = auth.uid()
      AND role IN ('admin', 'super_admin', 'manager')
    )
  );

-- Policy: Admins can manage all usage records
CREATE POLICY "admins can manage all usage"
  ON public.offer_usage FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE id = auth.uid()
      AND role IN ('admin', 'super_admin', 'manager')
    )
  );

-- Policy: System can insert usage records (for order creation)
CREATE POLICY "authenticated users can insert usage"
  ON public.offer_usage FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Verify table was created
SELECT
  table_name,
  (SELECT COUNT(*) FROM information_schema.columns
   WHERE table_name = 'offer_usage' AND table_schema = 'public') as column_count
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name = 'offer_usage';
