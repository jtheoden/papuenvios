-- Migration: Fix missing foreign key relationship between orders and user_profiles
-- Date: 2025-11-28
-- Purpose: Enable Supabase PostgREST to properly join orders with user_profiles
-- Issue: Previous schema had orders.user_id → auth.users(id) and user_profiles.user_id → auth.users(id)
--        but no explicit FK from orders to user_profiles, causing "Could not find relationship" error

BEGIN;

-- Add explicit foreign key constraint from orders to user_profiles
-- This allows Supabase to infer the relationship for PostgREST queries
ALTER TABLE public.orders
ADD CONSTRAINT fk_orders_user_profiles
FOREIGN KEY (user_id)
REFERENCES public.user_profiles(user_id)
ON DELETE CASCADE
DEFERRABLE INITIALLY DEFERRED;

-- Create index for performance on this relationship
CREATE INDEX IF NOT EXISTS idx_orders_user_profiles_fk ON public.orders(user_id);

-- Verify relationship exists by checking constraint
SELECT constraint_name, table_name, column_name
FROM information_schema.key_column_usage
WHERE table_name = 'orders' AND column_name = 'user_id'
LIMIT 1;

COMMIT;
