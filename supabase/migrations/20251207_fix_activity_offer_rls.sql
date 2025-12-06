-- Ensure activity_logs and offer_usage tables are readable/writable by authenticated users with proper RLS

-- Activity logs: keep table consistent and enforce admin visibility
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

ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;

-- Clear conflicting policies to avoid duplicates
DROP POLICY IF EXISTS "activity_logs_insert_authenticated" ON public.activity_logs;
DROP POLICY IF EXISTS "activity_logs_select_authenticated" ON public.activity_logs;
DROP POLICY IF EXISTS "activity_logs_admin_manage" ON public.activity_logs;

-- Allow admins/super_admins to insert/select activity logs
CREATE POLICY "activity_logs_admin_manage"
  ON public.activity_logs
  FOR ALL
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.user_profiles up
    WHERE up.id = auth.uid() AND up.role IN ('admin', 'super_admin')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.user_profiles up
    WHERE up.id = auth.uid() AND up.role IN ('admin', 'super_admin')
  ));

-- Offer usage tracking
CREATE TABLE IF NOT EXISTS public.offer_usage (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  offer_id uuid NOT NULL REFERENCES public.offers(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id),
  order_id uuid,
  used_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_offer_usage_offer_id ON public.offer_usage(offer_id);
CREATE INDEX IF NOT EXISTS idx_offer_usage_user_id ON public.offer_usage(user_id);

ALTER TABLE public.offer_usage ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "offer_usage_select_authenticated" ON public.offer_usage;
DROP POLICY IF EXISTS "offer_usage_insert_authenticated" ON public.offer_usage;

-- Any authenticated session can read usage metrics (needed for validation)
CREATE POLICY "offer_usage_select_authenticated"
  ON public.offer_usage
  FOR SELECT
  TO authenticated
  USING (true);

-- Authenticated users can record their own usage; admins can record for anyone
CREATE POLICY "offer_usage_insert_authenticated"
  ON public.offer_usage
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id IS NULL
    OR user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.user_profiles up
      WHERE up.id = auth.uid() AND up.role IN ('admin', 'super_admin')
    )
  );

-- Optional: prevent stray deletes/updates unless admin
DROP POLICY IF EXISTS "offer_usage_admin_all" ON public.offer_usage;
CREATE POLICY "offer_usage_admin_all"
  ON public.offer_usage
  FOR ALL
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.user_profiles up
    WHERE up.id = auth.uid() AND up.role IN ('admin', 'super_admin')
  ));
