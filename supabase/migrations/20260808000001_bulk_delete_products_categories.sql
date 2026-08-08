-- Frente 1 del plan admin-bulk-ops-reset-audit: seleccion multiple + borrado
-- masivo de productos y categorias, exclusivo de super_admin.
--
-- Fase 0 fix incluido aqui: categories_all_admin (FOR ALL) permitia DELETE a
-- cualquier admin, no solo super_admin. Se separa por comando: SELECT/INSERT/
-- UPDATE siguen siendo de admin (sin cambio de comportamiento), DELETE pasa a
-- requerir super_admin — el mismo nivel que exige el RPC de borrado masivo.
--
-- bulk_delete_products / bulk_delete_categories reusan la misma cascada de
-- borrado fisico que ya usan deleteProduct/deleteCategory en productService.js
-- (no existe convencion de soft-delete "activa" en este proyecto — is_active
-- solo oculta del catalogo publico). Reportan {deleted, blocked, block_reason}
-- por item en vez de todo-o-nada, para que un item bloqueado no aborte el
-- resto del batch. pg_advisory_xact_lock serializa bulk-deletes concurrentes
-- del mismo tipo de entidad.

BEGIN;

-- ── Fase 0: RLS de categories — DELETE exclusivo de super_admin ────────────

DROP POLICY IF EXISTS "categories_all_admin" ON public.product_categories;

CREATE POLICY "categories_admin_insert" ON public.product_categories
  FOR INSERT WITH CHECK ((select is_admin_user()));

CREATE POLICY "categories_admin_update" ON public.product_categories
  FOR UPDATE USING ((select is_admin_user()));

CREATE POLICY "categories_super_admin_delete" ON public.product_categories
  FOR DELETE USING ((select is_super_admin()));

-- categories_select_public ya cubre SELECT para admin (OR is_admin_user()) — no se duplica.

-- ── bulk_delete_products ────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.bulk_delete_products(p_ids uuid[])
 RETURNS TABLE(deleted_id uuid, blocked_id uuid, block_reason text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
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

COMMENT ON FUNCTION public.bulk_delete_products(uuid[]) IS
  'Borrado masivo de productos, exclusivo super_admin. Reusa la cascada de '
  'deleteProduct() (productService.js) dentro de una sola transaccion, '
  'con reporte parcial por item (deleted/blocked) y advisory lock por tipo de entidad.';

GRANT EXECUTE ON FUNCTION public.bulk_delete_products(uuid[]) TO authenticated;

-- ── bulk_delete_categories ──────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.bulk_delete_categories(p_ids uuid[])
 RETURNS TABLE(deleted_id uuid, blocked_id uuid, block_reason text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $function$
DECLARE
  v_id uuid;
  v_category_name text;
  v_product_count int;
BEGIN
  IF NOT (SELECT is_super_admin()) THEN
    RAISE EXCEPTION 'Solo super_admin puede ejecutar borrado masivo' USING ERRCODE = '42501';
  END IF;

  IF p_ids IS NULL OR array_length(p_ids, 1) IS NULL THEN
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('bulk_delete:categories'));

  FOREACH v_id IN ARRAY p_ids LOOP
    SELECT COALESCE(name_es, name_en, v_id::text) INTO v_category_name
    FROM product_categories WHERE id = v_id;

    IF v_category_name IS NULL THEN
      deleted_id := NULL; blocked_id := v_id; block_reason := 'not_found';
      RETURN NEXT;
      CONTINUE;
    END IF;

    SELECT count(*) INTO v_product_count FROM products WHERE category_id = v_id;

    IF v_product_count > 0 THEN
      deleted_id := NULL; blocked_id := v_id; block_reason := 'has_products';
      RETURN NEXT;
      CONTINUE;
    END IF;

    DELETE FROM product_categories WHERE id = v_id;

    INSERT INTO activity_logs (action, entity_type, entity_id, performed_by, description, metadata)
    VALUES (
      'category_deleted', 'category', v_id, COALESCE(auth.uid()::text, 'system'),
      'Categoría eliminada (bulk) - ' || v_category_name,
      jsonb_build_object('categoryId', v_id, 'categoryName', v_category_name, 'bulk', true)
    );

    deleted_id := v_id; blocked_id := NULL; block_reason := NULL;
    RETURN NEXT;
  END LOOP;
END;
$function$;

COMMENT ON FUNCTION public.bulk_delete_categories(uuid[]) IS
  'Borrado masivo de categorias, exclusivo super_admin. Bloquea categorias con '
  'productos asociados (mismo criterio que deleteCategory() en productService.js).';

GRANT EXECUTE ON FUNCTION public.bulk_delete_categories(uuid[]) TO authenticated;

COMMIT;
