-- Preview de cascada para borrado masivo: RPCs de solo lectura que replican
-- las mismas verificaciones de bulk_delete_products/bulk_delete_categories
-- (20260808000001) pero sin escribir nada, para que la UI pueda mostrar
-- ANTES de confirmar que elementos relacionados se van a ver afectados
-- (ordenes bloqueantes, combos a desactivar, filas de inventario/movimientos,
-- productos asociados a una categoria).

BEGIN;

CREATE OR REPLACE FUNCTION public.preview_bulk_delete_products(p_ids uuid[])
 RETURNS TABLE(
   id uuid,
   name text,
   can_delete boolean,
   block_reason text,
   blocking_orders_count int,
   combos_to_deactivate int,
   inventory_rows int,
   inventory_movements int
 )
 LANGUAGE plpgsql
 SECURITY DEFINER
 STABLE
 SET search_path = public
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

COMMENT ON FUNCTION public.preview_bulk_delete_products(uuid[]) IS
  'Preview de solo lectura de bulk_delete_products: mismos chequeos, sin escribir. '
  'Reporta por producto si es eliminable y el impacto en cascada (combos, inventario).';

GRANT EXECUTE ON FUNCTION public.preview_bulk_delete_products(uuid[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.preview_bulk_delete_categories(p_ids uuid[])
 RETURNS TABLE(
   id uuid,
   name text,
   can_delete boolean,
   block_reason text,
   products_count int
 )
 LANGUAGE plpgsql
 SECURITY DEFINER
 STABLE
 SET search_path = public
AS $function$
DECLARE
  v_id uuid;
  v_category_name text;
  v_product_count int;
BEGIN
  IF NOT (SELECT is_super_admin()) THEN
    RAISE EXCEPTION 'Solo super_admin puede previsualizar el borrado masivo' USING ERRCODE = '42501';
  END IF;

  IF p_ids IS NULL OR array_length(p_ids, 1) IS NULL THEN
    RETURN;
  END IF;

  FOREACH v_id IN ARRAY p_ids LOOP
    SELECT COALESCE(name_es, name_en, v_id::text) INTO v_category_name
    FROM product_categories WHERE id = v_id;

    IF v_category_name IS NULL THEN
      id := v_id; name := NULL; can_delete := false; block_reason := 'not_found'; products_count := 0;
      RETURN NEXT;
      CONTINUE;
    END IF;

    SELECT count(*) INTO v_product_count FROM products WHERE category_id = v_id;

    id := v_id;
    name := v_category_name;
    products_count := v_product_count;

    IF v_product_count > 0 THEN
      can_delete := false;
      block_reason := 'has_products';
    ELSE
      can_delete := true;
      block_reason := NULL;
    END IF;

    RETURN NEXT;
  END LOOP;
END;
$function$;

COMMENT ON FUNCTION public.preview_bulk_delete_categories(uuid[]) IS
  'Preview de solo lectura de bulk_delete_categories: mismos chequeos, sin escribir.';

GRANT EXECUTE ON FUNCTION public.preview_bulk_delete_categories(uuid[]) TO authenticated;

COMMIT;
