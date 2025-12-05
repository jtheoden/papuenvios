-- ============================================================================
-- CREATE ACTIVITY_LOGS TABLE
-- Run this in Supabase SQL Editor to create the missing table
-- ============================================================================

-- Create activity_logs table
CREATE TABLE IF NOT EXISTS public.activity_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  performed_by text,
  description text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_activity_logs_created_at ON public.activity_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_logs_action ON public.activity_logs(action);
CREATE INDEX IF NOT EXISTS idx_activity_logs_entity ON public.activity_logs(entity_type);

-- Enable RLS
ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to insert and read activity logs
DROP POLICY IF EXISTS "activity_logs_insert_authenticated" ON public.activity_logs;
CREATE POLICY "activity_logs_insert_authenticated"
  ON public.activity_logs FOR INSERT
  TO authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "activity_logs_select_authenticated" ON public.activity_logs;
CREATE POLICY "activity_logs_select_authenticated"
  ON public.activity_logs FOR SELECT
  TO authenticated
  USING (true);

-- Verify table was created
SELECT table_name, table_schema
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name = 'activity_logs';

-- Should return 1 row showing the table exists
