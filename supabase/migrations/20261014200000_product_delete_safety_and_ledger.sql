-- ============================================================================
-- Product delete safety net + inventory ledger safety net
-- ============================================================================
-- Applies AFTER 20261014190000_atomic_stock_reservation.sql (needs order_stock_allocations,
-- inventory_movements.reserved_change and the app.stock_rpc flag set by the stock RPCs).
-- Idempotent: every statement is CREATE OR REPLACE / DROP ... IF EXISTS.
--
-- Problem 1 (evidence, REMOTE, read-only SELECTs, 2026-10-14)
--   order_items.inventory_id is non-NULL in 0 of 126 rows (126 are NULL). Both
--   bulk_delete_products and preview_bulk_delete_products only block on
--   oi.inventory_id IN (inventory of the product), so they blocked NOTHING: 15 products sat in
--   open (pending/processing) orders directly and 11 more through combo_items. The front
--   helper findBlockingOrdersForProduct had the same blind spot.
--
-- Problem 2
--   Direct edits of inventory.quantity / reserved_quantity bypass the ledger, an admin editing
--   reserved_quantity desyncs the allocations, and deleting a batch silently erases the
--   allocation rows (ON DELETE CASCADE) of the orders that held it.
--
-- What this migration adds
--   get_product_blockers(product)  admin-only, SECURITY DEFINER. ONE predicate shared by
--       preview, bulk delete and the front end. An order blocks when it references the product
--       (order_items.item_id = product, OR item_id = a combo that contains the product, OR
--       inventory_id in the product's batches; NO item_type filter, because combos are stored
--       mislabelled as 'product') AND its status is not one of dispatched / delivered /
--       completed / cancelled (fail-closed: unknown or NULL statuses block). Independently, any
--       order that still holds a 'reserved' allocation on a batch of the product blocks, even if
--       cancelled. 'consumed' allocations NEVER block (history must stay deletable).
--       Deliberate deviation from the brief: the bare orders.stock_reserved flag is NOT used,
--       because it stays true after consume and would make every completed order block forever;
--       the 'reserved' allocation is the precise equivalent.
--   bulk_delete_products / preview_bulk_delete_products rewritten to use it (signatures,
--       return shapes, advisory lock and super_admin checks unchanged).
--   trg_inventory_ledger           AFTER INSERT / UPDATE OF quantity, reserved_quantity on
--       inventory: any change made OUTSIDE the stock RPCs (app.stock_rpc <> 'on') is ledgered
--       as an 'adjustment' movement ('initial batch' / 'manual edit'); the RPC paths already
--       ledger themselves and are skipped (no double log).
--   guard_inventory_reserved_edit  BEFORE UPDATE OF reserved_quantity: outside the RPCs a role
--       other than postgres / service_role / supabase_admin gets 42501. An admin may still
--       edit quantity (ledgered); the CHECK reserved <= quantity stays.
--   trg_inventory_delete_snapshot  BEFORE DELETE on inventory: writes a snapshot (batch,
--       product, quantity, reserved, allocation states) to admin_destructive_ops_log. Nothing is
--       written to inventory_movements on delete (FK).
--
-- Honest limits
--   * The ledger is complete only from the moment this migration is applied. Batches that
--     already existed have no opening movement (inventory_movements was empty on remote and is
--     not backfilled), so SUM(movements) reproduces CHANGES since the migration, not the whole
--     quantity, for those rows.
--   * Deleting a product still deletes its inventory_movements first (existing behaviour of the
--     delete paths); the snapshot in admin_destructive_ops_log is what survives.
--   * app.stock_rpc is a transaction-local setting any SQL session can set; the guard is a
--     safety net against accidental edits from the app roles, not a barrier against someone who
--     can run arbitrary SQL as an owner.
--
-- ROLLBACK (exact inverse, in this order; the 20261014190000 rollback comes after it):
-- DROP TRIGGER IF EXISTS trg_inventory_delete_snapshot ON public.inventory;
-- DROP FUNCTION IF EXISTS public.trg_inventory_delete_snapshot();
-- DROP TRIGGER IF EXISTS guard_inventory_reserved_edit ON public.inventory;
-- DROP FUNCTION IF EXISTS public.guard_inventory_reserved_edit();
-- DROP TRIGGER IF EXISTS trg_inventory_ledger_ins ON public.inventory;
-- DROP TRIGGER IF EXISTS trg_inventory_ledger_upd ON public.inventory;
-- DROP FUNCTION IF EXISTS public.trg_inventory_ledger();
-- Restore the previous bodies of bulk_delete_products / preview_bulk_delete_products from
-- supabase/migrations/20260808000001_bulk_delete_products_categories.sql and
-- 20260909110000_preview_bulk_delete.sql (CREATE OR REPLACE them), then:
-- DROP FUNCTION IF EXISTS public.get_product_blockers(uuid);
-- (inventory_movements 'adjustment' rows and admin_destructive_ops_log snapshots stay.)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Shared blocker predicate
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_product_blockers(p_product_id uuid)
RETURNS TABLE (order_id uuid, order_number text, status text, payment_status text, via text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH inv AS (
    SELECT i.id FROM public.inventory i WHERE i.product_id = p_product_id
  ),
  hits AS (
    SELECT oi.order_id AS oid, 'direct'::text AS via, 1 AS prio
      FROM public.order_items oi
     WHERE oi.item_id = p_product_id
    UNION ALL
    SELECT oi.order_id, 'combo', 2
      FROM public.order_items oi
     WHERE oi.item_id IN (SELECT ci.combo_id FROM public.combo_items ci WHERE ci.product_id = p_product_id)
    UNION ALL
    SELECT oi.order_id, 'inventory', 3
      FROM public.order_items oi
     WHERE oi.inventory_id IN (SELECT inv.id FROM inv)
    UNION ALL
    SELECT a.order_id, 'allocation', 4
      FROM public.order_stock_allocations a
     WHERE a.state = 'reserved'
       AND a.inventory_id IN (SELECT inv.id FROM inv)
  )
  SELECT DISTINCT ON (o.id) o.id, o.order_number::text, o.status::text, o.payment_status::text, h.via
    FROM hits h
    JOIN public.orders o ON o.id = h.oid
   WHERE h.via = 'allocation'
      OR o.status IS NULL
      OR o.status NOT IN ('dispatched', 'delivered', 'completed', 'cancelled')
   ORDER BY o.id, h.prio;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_product_blockers(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_product_blockers(uuid) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 2. bulk delete / preview use the shared predicate
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bulk_delete_products(p_ids uuid[])
RETURNS TABLE(deleted_id uuid, blocked_id uuid, block_reason text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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

    -- STEP 1: blocking orders (shared predicate: direct, via combo, via inventory, or a
    -- still-reserved allocation; fail-closed on unknown statuses).
    SELECT count(*) INTO v_blocking_count FROM public.get_product_blockers(v_id);

    IF v_blocking_count > 0 THEN
      deleted_id := NULL; blocked_id := v_id; block_reason := 'blocking_orders';
      RETURN NEXT;
      CONTINUE;
    END IF;

    -- STEP 2: clear inventory_id on the remaining (safe) orders
    UPDATE order_items oi SET inventory_id = NULL
    WHERE oi.inventory_id IN (SELECT id FROM inventory WHERE product_id = v_id)
      AND EXISTS (
        SELECT 1 FROM orders o WHERE o.id = oi.order_id
        AND o.status IN ('dispatched', 'delivered', 'completed', 'cancelled')
      );

    -- STEP 3: deactivate combos that contain this product
    UPDATE combo_products
    SET is_active = false, updated_at = now()
    WHERE is_active = true
      AND id IN (SELECT combo_id FROM combo_items WHERE product_id = v_id);

    -- STEP 4: delete combo_items references
    DELETE FROM combo_items WHERE product_id = v_id;

    -- STEP 5-6: delete inventory_movements, then inventory (the BEFORE DELETE trigger
    -- snapshots every batch, including consumed allocations, into admin_destructive_ops_log)
    DELETE FROM inventory_movements
    WHERE inventory_id IN (SELECT id FROM inventory WHERE product_id = v_id);

    DELETE FROM inventory WHERE product_id = v_id;

    -- STEP 7: delete the product
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
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
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
    FROM products WHERE products.id = v_id;

    IF v_product_name IS NULL THEN
      id := v_id; name := NULL; can_delete := false; block_reason := 'not_found';
      blocking_orders_count := 0; combos_to_deactivate := 0; inventory_rows := 0; inventory_movements := 0;
      RETURN NEXT;
      CONTINUE;
    END IF;

    SELECT count(*) INTO v_blocking_count FROM public.get_product_blockers(v_id);

    id := v_id;
    name := v_product_name;
    blocking_orders_count := v_blocking_count;

    SELECT count(*) INTO combos_to_deactivate
    FROM combo_products
    WHERE is_active = true
      AND combo_products.id IN (SELECT combo_id FROM combo_items WHERE product_id = v_id);

    SELECT count(*) INTO inventory_rows FROM inventory WHERE product_id = v_id;

    SELECT count(*) INTO inventory_movements
    FROM public.inventory_movements im
    WHERE im.inventory_id IN (SELECT inv.id FROM inventory inv WHERE inv.product_id = v_id);

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

-- ----------------------------------------------------------------------------
-- 3. Ledger safety net
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_inventory_ledger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_dq integer;
  v_dr integer;
BEGIN
  -- The stock RPCs ledger their own writes (and set this flag for the duration of the write).
  IF current_setting('app.stock_rpc', true) = 'on' THEN
    RETURN NULL;
  END IF;

  IF TG_OP = 'INSERT' THEN
    v_dq := COALESCE(NEW.quantity, 0);
    v_dr := COALESCE(NEW.reserved_quantity, 0);
  ELSE
    v_dq := COALESCE(NEW.quantity, 0) - COALESCE(OLD.quantity, 0);
    v_dr := COALESCE(NEW.reserved_quantity, 0) - COALESCE(OLD.reserved_quantity, 0);
  END IF;

  IF v_dq = 0 AND v_dr = 0 THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.inventory_movements
    (inventory_id, movement_type, quantity_change, reserved_change, notes, created_by)
  VALUES
    (NEW.id, 'adjustment', v_dq, v_dr,
     CASE WHEN TG_OP = 'INSERT' THEN 'initial batch' ELSE 'manual edit' END,
     auth.uid());

  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.trg_inventory_ledger() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_inventory_ledger_ins ON public.inventory;
CREATE TRIGGER trg_inventory_ledger_ins
  AFTER INSERT ON public.inventory
  FOR EACH ROW EXECUTE FUNCTION public.trg_inventory_ledger();

DROP TRIGGER IF EXISTS trg_inventory_ledger_upd ON public.inventory;
CREATE TRIGGER trg_inventory_ledger_upd
  AFTER UPDATE OF quantity, reserved_quantity ON public.inventory
  FOR EACH ROW EXECUTE FUNCTION public.trg_inventory_ledger();

-- An admin editing reserved_quantity by hand would desync the allocations.
CREATE OR REPLACE FUNCTION public.guard_inventory_reserved_edit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF NEW.reserved_quantity IS DISTINCT FROM OLD.reserved_quantity
     AND current_setting('app.stock_rpc', true) IS DISTINCT FROM 'on'
     AND current_user NOT IN ('postgres', 'service_role', 'supabase_admin') THEN
    RAISE EXCEPTION 'reserved_quantity is managed by the stock reservation functions'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.guard_inventory_reserved_edit() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS guard_inventory_reserved_edit ON public.inventory;
CREATE TRIGGER guard_inventory_reserved_edit
  BEFORE UPDATE OF reserved_quantity ON public.inventory
  FOR EACH ROW EXECUTE FUNCTION public.guard_inventory_reserved_edit();

-- Snapshot of every deleted batch (BEFORE DELETE: the ON DELETE CASCADE that erases its
-- allocations runs afterwards, so their states are still readable here).
CREATE OR REPLACE FUNCTION public.trg_inventory_delete_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  INSERT INTO public.admin_destructive_ops_log (op_type, performed_by, details)
  VALUES (
    'inventory_batch_deleted',
    COALESCE(auth.uid()::text, 'system'),
    jsonb_build_object(
      'batch_id', OLD.id,
      'product_id', OLD.product_id,
      'quantity', OLD.quantity,
      'reserved_quantity', COALESCE(OLD.reserved_quantity, 0),
      'expiry_date', OLD.expiry_date,
      'allocations', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'order_id', a.order_id, 'state', a.state, 'quantity', a.quantity))
          FROM public.order_stock_allocations a
         WHERE a.inventory_id = OLD.id), '[]'::jsonb)
    ));
  RETURN OLD;
END;
$function$;

REVOKE ALL ON FUNCTION public.trg_inventory_delete_snapshot() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_inventory_delete_snapshot ON public.inventory;
CREATE TRIGGER trg_inventory_delete_snapshot
  BEFORE DELETE ON public.inventory
  FOR EACH ROW EXECUTE FUNCTION public.trg_inventory_delete_snapshot();
