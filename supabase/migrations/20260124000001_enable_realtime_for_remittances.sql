-- Enable Realtime for remittances table
-- This migration adds the remittances table to the Supabase Realtime publication
-- so that users can receive real-time updates when their remittance status changes

-- Add remittances table to Realtime publication
-- Note: This uses the ALTER PUBLICATION syntax for Supabase Realtime
-- The supabase_realtime publication is created by Supabase automatically

BEGIN;

-- Check if the publication exists and add the table to it
DO $$
BEGIN
  -- Drop if already exists (to handle re-running the migration)
  IF EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
    AND schemaname = 'public'
    AND tablename = 'remittances'
  ) THEN
    -- Already in publication, do nothing
    RAISE NOTICE 'remittances table is already in supabase_realtime publication';
  ELSE
    -- Add to publication
    ALTER PUBLICATION supabase_realtime ADD TABLE public.remittances;
    RAISE NOTICE 'Added remittances table to supabase_realtime publication';
  END IF;
END $$;

-- Also ensure orders table is in realtime publication for consistency
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
    AND schemaname = 'public'
    AND tablename = 'orders'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.orders;
    RAISE NOTICE 'Added orders table to supabase_realtime publication';
  END IF;
END $$;

COMMIT;
