-- ============================================================================
-- ROLLBACK FILE: LIVE bodies of bulk_delete_products / preview_bulk_delete_products
-- ============================================================================
-- Captured from the REMOTE project (qcwnlbpultscerwdnzbm) on 2026-10-14 with
--   SELECT pg_get_functiondef(p.oid) FROM pg_proc p
--    WHERE p.pronamespace = 'public'::regnamespace
--      AND p.proname IN ('bulk_delete_products', 'preview_bulk_delete_products');
-- (read-only SELECT; nothing was written to remote).
--
-- Use: run this file to restore the pre-20261014200000 behaviour of both functions
-- (see the rollback steps of 20261014200000_product_delete_safety_and_ledger.sql and of
-- .claude/docs/runbook_stock_reservation_deploy.md). Compare it against
-- `SELECT pg_get_functiondef(...)` on remote right before applying, in case they changed.
--
-- Known defect of the LIVE preview (still present here, fixed by 20261014200000):
-- preview_bulk_delete_products fails at run time with SQLSTATE 42702
-- ("column reference \"id\" is ambiguous"): its RETURNS TABLE has an OUT column named id and
-- the body uses unqualified `WHERE id = v_id`. The replacement qualifies every column.
-- Both live bodies also block ONLY on order_items.inventory_id, which is NULL in 126 of 126
-- remote rows, i.e. they block nothing.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.bulk_delete_products(p_ids uuid[])
 RETURNS TABLE(deleted_id uuid, blocked_id uuid, block_reason text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
  v_product_name text;
  v_blocking_count int;
BEGIN
  IF NOT (SELECT is_super_admin()) THEN
    RAISE EXCEPTION 'Solo super_admin puede ejecutar borrado masivo' USING ERRCODE = '42501';
  END IF;

  IF p_ids IS NULL OR array_length(p_ids, 1) IS NULL THEN
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('bulk_delete:products'));

  FOREACH v_id IN ARRAY p_ids LOOP
    SELECT COALESCE(name_es, name_en, v_id::text) INTO v_product_name
    FROM products WHERE id = v_id;

    IF v_product_name IS NULL THEN
      deleted_id := NULL; blocked_id := v_id; block_reason := 'not_found';
      RETURN NEXT;
      CONTINUE;
    END IF;

    -- STEP 1: blocking orders — fail-closed: cualquier estado que no sea
    -- explicitamente "seguro" bloquea (incluye pending/processing y
    -- cualquier estado futuro no contemplado).
    SELECT count(*) INTO v_blocking_count
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    WHERE oi.inventory_id IN (SELECT id FROM inventory WHERE product_id = v_id)
      AND o.status NOT IN ('dispatched', 'delivered', 'completed', 'cancelled');

    IF v_blocking_count > 0 THEN
      deleted_id := NULL; blocked_id := v_id; block_reason := 'blocking_orders';
      RETURN NEXT;
      CONTINUE;
    END IF;

    -- STEP 2: limpiar inventory_id de ordenes seguras (ya despachadas/canceladas)
    UPDATE order_items oi SET inventory_id = NULL
    WHERE oi.inventory_id IN (SELECT id FROM inventory WHERE product_id = v_id)
      AND EXISTS (
        SELECT 1 FROM orders o WHERE o.id = oi.order_id
        AND o.status IN ('dispatched', 'delivered', 'completed', 'cancelled')
      );

    -- STEP 3: desactivar combos que contienen este producto
    UPDATE combo_products
    SET is_active = false, updated_at = now()
    WHERE is_active = true
      AND id IN (SELECT combo_id FROM combo_items WHERE product_id = v_id);

    -- STEP 4: borrar referencias en combo_items
    DELETE FROM combo_items WHERE product_id = v_id;

    -- STEP 5-6: borrar inventory_movements y luego inventory
    DELETE FROM inventory_movements
    WHERE inventory_id IN (SELECT id FROM inventory WHERE product_id = v_id);

    DELETE FROM inventory WHERE product_id = v_id;

    -- STEP 7: borrar el producto
    DELETE FROM products WHERE id = v_id;

    INSERT INTO activity_logs (action, entity_type, entity_id, performed_by, description, metadata)
    VALUES (
      'product_deleted', 'product', v_id, COALESCE(auth.uid()::text, 'system'),
      'Producto eliminado (bulk) - ' || v_product_name,
      jsonb_build_object('productId', v_id, 'productName', v_product_name, 'bulk', true)
    );

    deleted_id := v_id; blocked_id := NULL; block_reason := NULL;
    RETURN NEXT;
  END LOOP;
END;
$function$;

CREATE OR REPLACE FUNCTION public.preview_bulk_delete_products(p_ids uuid[])
 RETURNS TABLE(id uuid, name text, can_delete boolean, block_reason text, blocking_orders_count integer, combos_to_deactivate integer, inventory_rows integer, inventory_movements integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
  v_product_name text;
  v_blocking_count int;
BEGIN
  IF NOT (SELECT is_super_admin()) THEN
    RAISE EXCEPTION 'Solo super_admin puede previsualizar el borrado masivo' USING ERRCODE = '42501';
  END IF;

  IF p_ids IS NULL OR array_length(p_ids, 1) IS NULL THEN
    RETURN;
  END IF;

  FOREACH v_id IN ARRAY p_ids LOOP
    SELECT COALESCE(name_es, name_en, v_id::text) INTO v_product_name
    FROM products WHERE id = v_id;

    IF v_product_name IS NULL THEN
      id := v_id; name := NULL; can_delete := false; block_reason := 'not_found';
      blocking_orders_count := 0; combos_to_deactivate := 0; inventory_rows := 0; inventory_movements := 0;
      RETURN NEXT;
      CONTINUE;
    END IF;

    SELECT count(*) INTO v_blocking_count
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    WHERE oi.inventory_id IN (SELECT inv.id FROM inventory inv WHERE inv.product_id = v_id)
      AND o.status NOT IN ('dispatched', 'delivered', 'completed', 'cancelled');

    id := v_id;
    name := v_product_name;
    blocking_orders_count := v_blocking_count;

    SELECT count(*) INTO combos_to_deactivate
    FROM combo_products
    WHERE is_active = true
      AND id IN (SELECT combo_id FROM combo_items WHERE product_id = v_id);

    SELECT count(*) INTO inventory_rows FROM inventory WHERE product_id = v_id;

    SELECT count(*) INTO inventory_movements
    FROM inventory_movements
    WHERE inventory_id IN (SELECT inv.id FROM inventory inv WHERE inv.product_id = v_id);

    IF v_blocking_count > 0 THEN
      can_delete := false;
      block_reason := 'blocking_orders';
    ELSE
      can_delete := true;
      block_reason := NULL;
    END IF;

    RETURN NEXT;
  END LOOP;
END;
$function$;
