-- =============================================================================
-- FIX ORDER_ITEMS RLS - Allow users to create their own order items
-- =============================================================================
-- Issue: Users get 403 Forbidden when creating orders because they can't
-- insert order_items (only admins can). Users need to insert order_items
-- when they create their own orders.
-- =============================================================================

-- Add policy for users to insert their own order items
DROP POLICY IF EXISTS "Users can insert own order items" ON public.order_items;

CREATE POLICY "Users can insert own order items"
ON public.order_items FOR INSERT
TO authenticated
WITH CHECK (EXISTS (
    SELECT 1 FROM public.orders
    WHERE orders.id = order_items.order_id
    AND orders.user_id = auth.uid()
));

-- Verify policies
SELECT policyname, cmd, roles, qual, with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'order_items'
ORDER BY policyname;
