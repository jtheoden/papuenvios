-- WARN-3.7: inventory_movements_insert (with_check=true) permitía insertar
-- cualquier fila arbitraria. El fix original del plan (admin-only) fue
-- descartado: orderService.js inserta aquí directo desde el checkout de un
-- `user` regular al reservar/vender/liberar stock (movement_type IN
-- ('reserved','released','sold'), reference_type='order') — admin-only
-- rompía ese flujo real. Fix aplicado: acotar a los movement_type/
-- reference_type realmente usados por el código (grep confirmado, sin
-- 'adjustment' manual desde el cliente) + validar que reference_id apunte a
-- una orden que el caller sea dueño o sea admin (mismo criterio que
-- order_status_history).

DROP POLICY IF EXISTS "inventory_movements_insert" ON public.inventory_movements;

CREATE POLICY "inventory_movements_insert_own_order" ON public.inventory_movements
  FOR INSERT TO authenticated
  WITH CHECK (
    movement_type IN ('reserved', 'released', 'sold')
    AND reference_type = 'order'
    AND EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.id = inventory_movements.reference_id
        AND (o.user_id = auth.uid() OR is_admin_user())
    )
  );
