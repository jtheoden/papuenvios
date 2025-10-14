-- Migration: Add order state transition timestamps
-- Date: 2025-10-12
-- Description: Adds timestamp fields to track order state transitions and delivery proof

-- Add new columns to orders table
ALTER TABLE orders
ADD COLUMN IF NOT EXISTS processing_started_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS shipped_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS delivery_proof_url TEXT;

-- Add comments to document the columns
COMMENT ON COLUMN orders.processing_started_at IS 'Timestamp when order status changed to processing (after payment validation)';
COMMENT ON COLUMN orders.shipped_at IS 'Timestamp when order was marked as shipped';
COMMENT ON COLUMN orders.delivered_at IS 'Timestamp when order was marked as delivered (with proof)';
COMMENT ON COLUMN orders.completed_at IS 'Timestamp when order was completed';
COMMENT ON COLUMN orders.delivery_proof_url IS 'Public URL of delivery proof image uploaded to Supabase Storage';

-- Create index for processing_started_at to optimize getDaysInProcessing queries
CREATE INDEX IF NOT EXISTS idx_orders_processing_started_at
ON orders (processing_started_at)
WHERE status = 'processing';

-- Create index for status to optimize filtering
CREATE INDEX IF NOT EXISTS idx_orders_status
ON orders (status);

-- Update RLS policies if needed (orders table should already have proper RLS)
-- Users can view their own orders
-- Admins can view all orders
-- These policies should already exist, but verify:

-- Verify existing RLS policy for SELECT
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'orders'
        AND policyname = 'Users can view own orders or admins can view all'
    ) THEN
        CREATE POLICY "Users can view own orders or admins can view all"
        ON orders FOR SELECT
        USING (
            auth.uid() = user_id OR
            EXISTS (
                SELECT 1 FROM user_profiles
                WHERE user_profiles.user_id = auth.uid()
                AND user_profiles.role IN ('admin', 'super_admin')
            )
        );
    END IF;
END $$;

-- Verify existing RLS policy for UPDATE
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'orders'
        AND policyname = 'Only admins can update orders'
    ) THEN
        CREATE POLICY "Only admins can update orders"
        ON orders FOR UPDATE
        USING (
            EXISTS (
                SELECT 1 FROM user_profiles
                WHERE user_profiles.user_id = auth.uid()
                AND user_profiles.role IN ('admin', 'super_admin')
            )
        );
    END IF;
END $$;

-- Migration completed successfully
SELECT 'Migration completed: order_timestamps_and_delivery_proof' AS status;
