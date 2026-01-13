-- Activity log support for frontend auditing tools
CREATE TABLE IF NOT EXISTS public.activity_logs (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  performed_by text,
  description text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_activity_logs_created_at ON public.activity_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_logs_action ON public.activity_logs(action);
CREATE INDEX IF NOT EXISTS idx_activity_logs_entity ON public.activity_logs(entity_type);

ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users (admins) to write and read activity logs
CREATE POLICY IF NOT EXISTS "activity_logs_insert_authenticated"
  ON public.activity_logs FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY IF NOT EXISTS "activity_logs_select_authenticated"
  ON public.activity_logs FOR SELECT
  TO authenticated
  USING (true);

-- Coupon/offer columns required by admin UI
ALTER TABLE public.offers
  ADD COLUMN IF NOT EXISTS code text,
  ADD COLUMN IF NOT EXISTS max_usage_global integer,
  ADD COLUMN IF NOT EXISTS max_usage_per_user integer;

CREATE UNIQUE INDEX IF NOT EXISTS offers_code_unique ON public.offers(code) WHERE code IS NOT NULL;
