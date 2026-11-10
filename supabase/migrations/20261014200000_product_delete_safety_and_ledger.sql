-- ============================================================================
-- Product delete safety net + inventory ledger safety net
-- ============================================================================
-- Applies AFTER 20261014190000_atomic_stock_reservation.sql (needs order_stock_allocations,
-- inventory_movements.reserved_change and the app.stock_rpc flag set by the stock RPCs).
-- Idempotent: every statement is CREATE OR REPLACE / DROP ... IF EXISTS.
--
-- Problem 1 (evidence, REMOTE, read-only SELECTs, 2026-10-14: 25 orders, 126 order_items)
--   order_items.inventory_id is non-NULL in 0 of 126 rows (126 are NULL). Both
--   bulk_delete_products and preview_bulk_delete_products only block on
--   oi.inventory_id IN (inventory of the product), so they blocked NOTHING: 15 products sat in
--   open (pending/processing) orders directly and 0 through combo_items (re-checked on
--   2026-10-14; an earlier "11 via combo" figure was wrong). The front helper
--   findBlockingOrdersForProduct had the same blind spot. The LIVE preview is also broken today
--   (SQLSTATE 42702, ambiguous "id"); the replacement here qualifies every column. The live bodies
--   are saved in supabase/rollbacks/20261014_bulk_delete_live_bodies.sql.
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
--   get_combo_blockers(combo)      same fail-closed style for combos: an order that references the
--       combo (any item_type) blocks when it is open / NULL / unknown, or when it still holds a
--       'reserved' allocation of a component. deleteCombo uses it and fails closed on RPC errors;
--       it no longer rewrites order_items.item_id (NOT NULL, no FK), so combos that appear in
--       closed orders can be deleted.
--   delete_product(product)        single-product delete as ONE transaction (same 7 steps and
--       the same blocker predicate as bulk_delete_products; admin). Before the movements go, a
--       'product_ledger_snapshot' row with SUM(quantity_change) / SUM(reserved_change) per batch is
--       written to admin_destructive_ops_log. The front no longer deletes anything table by table.
--   delete_combo(combo)            combo delete as ONE fail-closed transaction (admin): advisory lock,
--       lock of the component batches (ORDER BY id FOR UPDATE) and the combo row, then
--       get_combo_blockers, then combo_items + combo_products, and a 'combo_deleted' row (with the
--       items) in admin_destructive_ops_log. deleteCombo in the front is a single call to it.
--   guard_inventory_movements_delete  BEFORE DELETE on inventory_movements: 42501 unless
--       app.stock_rpc = 'on' or current_user is postgres / service_role / supabase_admin. The
--       SECURITY DEFINER delete functions and execute_platform_reset run as postgres, so they pass;
--       app roles can no longer erase the ledger with the legacy RLS delete policy
--       (admin_delete_inventory_movements_direct, left in place). NOTE: a build of the front end
--       from before this branch deletes movements table by table, so its product delete fails with
--       42501 after this migration (fail-closed; use the new build).
--   Locking (TOCTOU): delete_product and bulk_delete_products lock the product's inventory rows
--       (ORDER BY id FOR UPDATE) and the products row BEFORE running the blocker check, so a
--       concurrent reserve (which needs those inventory locks) either finishes first (its
--       allocation is then seen) or waits until the product is gone. preview_bulk_delete_products
--       is STABLE (no row locks allowed) and advisory only; the real run re-checks under lock.
--   guard_inventory_reserved_edit also covers INSERT (a batch cannot be created with reserved > 0
--       by an app role).
--   orders_with_consumed_stock(order_ids) admin RPC: the cancelled orders (among the given ids)
--       that own 'consumed' allocations; it replaces a long .in(...) URL query from the browser.
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
-- DROP FUNCTION IF EXISTS public.orders_with_consumed_stock(uuid[]);
-- DROP FUNCTION IF EXISTS public.delete_combo(uuid);
-- DROP FUNCTION IF EXISTS public.delete_product(uuid);
-- DROP FUNCTION IF EXISTS public._log_product_ledger_snapshot(uuid);
-- DROP FUNCTION IF EXISTS public.get_combo_blockers(uuid);
-- DROP TRIGGER IF EXISTS guard_inventory_movements_delete ON public.inventory_movements;
-- DROP FUNCTION IF EXISTS public.guard_inventory_movements_delete();
-- DROP TRIGGER IF EXISTS guard_inventory_reserved_insert ON public.inventory;
-- DROP TRIGGER IF EXISTS trg_inventory_delete_snapshot ON public.inventory;
-- DROP FUNCTION IF EXISTS public.trg_inventory_delete_snapshot();
-- DROP TRIGGER IF EXISTS guard_inventory_reserved_edit ON public.inventory;
-- DROP FUNCTION IF EXISTS public.guard_inventory_reserved_edit();
-- DROP TRIGGER IF EXISTS trg_inventory_ledger_ins ON public.inventory;
-- DROP TRIGGER IF EXISTS trg_inventory_ledger_upd ON public.inventory;
-- DROP FUNCTION IF EXISTS public.trg_inventory_ledger();
-- Restore the previous bodies of bulk_delete_products / preview_bulk_delete_products by running
-- supabase/rollbacks/20261014_bulk_delete_live_bodies.sql (the LIVE remote bodies, captured with a
-- read-only SELECT on 2026-10-14), then:
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
  v_prev_rpc text;
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

    -- STEP 0 (TOCTOU): lock the batches and the product row BEFORE checking, so a concurrent
    -- reserve either committed already (and is seen below) or waits until the product is gone.
    PERFORM 1 FROM public.inventory i WHERE i.product_id = v_id ORDER BY i.id FOR UPDATE;
    PERFORM 1 FROM public.products p WHERE p.id = v_id FOR UPDATE;

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

    -- STEP 5-6: snapshot the ledger sums, delete inventory_movements, then inventory (the
    -- BEFORE DELETE trigger snapshots every batch, including consumed allocations).
    PERFORM public._log_product_ledger_snapshot(v_id);

    v_prev_rpc := current_setting('app.stock_rpc', true);
    PERFORM set_config('app.stock_rpc', 'on', true);
    DELETE FROM inventory_movements
    WHERE inventory_id IN (SELECT id FROM inventory WHERE product_id = v_id);
    PERFORM set_config('app.stock_rpc', COALESCE(v_prev_rpc, 'off'), true);

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

-- Combos: same fail-closed predicate (any item_type, open / NULL / unknown status, or a
-- reserved allocation of a component on an order that references the combo).
CREATE OR REPLACE FUNCTION public.get_combo_blockers(p_combo_id uuid)
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
  SELECT DISTINCT ON (o.id)
         o.id, o.order_number::text, o.status::text, o.payment_status::text,
         CASE WHEN o.status IS NULL OR o.status NOT IN ('dispatched', 'delivered', 'completed', 'cancelled')
              THEN 'direct' ELSE 'allocation' END
    FROM public.order_items oi
    JOIN public.orders o ON o.id = oi.order_id
   WHERE oi.item_id = p_combo_id
     AND (
       o.status IS NULL
       OR o.status NOT IN ('dispatched', 'delivered', 'completed', 'cancelled')
       OR EXISTS (
         SELECT 1
           FROM public.order_stock_allocations a
          WHERE a.order_id = o.id
            AND a.state = 'reserved'
            AND a.inventory_id IN (
                  SELECT inv.id
                    FROM public.combo_items ci
                    JOIN public.inventory inv ON inv.product_id = ci.product_id
                   WHERE ci.combo_id = p_combo_id))
     )
   ORDER BY o.id;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_combo_blockers(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_combo_blockers(uuid) TO authenticated, service_role;

-- Combo delete as one fail-closed transaction (same pattern as delete_product).
CREATE OR REPLACE FUNCTION public.delete_combo(p_combo_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_name text;
  v_blockers jsonb;
  v_items jsonb;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('delete:combo'));

  SELECT COALESCE(c.name_es, c.name_en, p_combo_id::text) INTO v_name
    FROM public.combo_products c WHERE c.id = p_combo_id;
  IF v_name IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;

  -- TOCTOU: component batches (a reserve of an order containing the combo needs them) and the
  -- combo row are locked BEFORE the blocker check.
  PERFORM 1 FROM public.inventory i
   WHERE i.product_id IN (SELECT ci.product_id FROM public.combo_items ci WHERE ci.combo_id = p_combo_id)
   ORDER BY i.id FOR UPDATE;
  PERFORM 1 FROM public.combo_products c WHERE c.id = p_combo_id FOR UPDATE;

  SELECT jsonb_agg(to_jsonb(b)) INTO v_blockers FROM public.get_combo_blockers(p_combo_id) b;
  IF v_blockers IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'blocking_orders', 'combo_name', v_name, 'blockers', v_blockers);
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('product_id', ci.product_id, 'quantity', ci.quantity)
                            ORDER BY ci.product_id), '[]'::jsonb)
    INTO v_items
    FROM public.combo_items ci WHERE ci.combo_id = p_combo_id;

  DELETE FROM public.combo_items ci WHERE ci.combo_id = p_combo_id;
  DELETE FROM public.combo_products c WHERE c.id = p_combo_id;

  INSERT INTO public.admin_destructive_ops_log (op_type, performed_by, details)
  VALUES ('combo_deleted', COALESCE(auth.uid()::text, 'system'),
          jsonb_build_object('combo_id', p_combo_id, 'name', v_name, 'items', v_items));

  RETURN jsonb_build_object('ok', true, 'combo_name', v_name);
END;
$function$;

REVOKE ALL ON FUNCTION public.delete_combo(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_combo(uuid) TO authenticated, service_role;

-- Admin RPC: which of the given orders are cancelled AND own consumed allocations (restock
-- candidates). Ids travel in the request body, not in a URL.
CREATE OR REPLACE FUNCTION public.orders_with_consumed_stock(p_order_ids uuid[])
RETURNS TABLE (order_id uuid)
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
  SELECT o.id
    FROM public.orders o
   WHERE o.id = ANY (p_order_ids)
     AND o.status = 'cancelled'
     AND EXISTS (SELECT 1 FROM public.order_stock_allocations a
                  WHERE a.order_id = o.id AND a.state = 'consumed');
END;
$function$;

REVOKE ALL ON FUNCTION public.orders_with_consumed_stock(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.orders_with_consumed_stock(uuid[]) TO authenticated, service_role;

-- Per-batch ledger sums of a product, written BEFORE its movements are deleted (the
-- BEFORE DELETE snapshot of each batch runs after the movements are gone).
CREATE OR REPLACE FUNCTION public._log_product_ledger_snapshot(p_product_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.inventory i WHERE i.product_id = p_product_id) THEN
    RETURN;
  END IF;

  INSERT INTO public.admin_destructive_ops_log (op_type, performed_by, details)
  SELECT 'product_ledger_snapshot',
         COALESCE(auth.uid()::text, 'system'),
         jsonb_build_object(
           'product_id', p_product_id,
           'batches', COALESCE(jsonb_agg(jsonb_build_object(
                'batch_id', i.id,
                'sum_quantity_change', COALESCE(s.q, 0),
                'sum_reserved_change', COALESCE(s.r, 0),
                'movements', COALESCE(s.n, 0)) ORDER BY i.id), '[]'::jsonb))
    FROM public.inventory i
    LEFT JOIN (SELECT m.inventory_id, sum(m.quantity_change) AS q, sum(m.reserved_change) AS r, count(*) AS n
                 FROM public.inventory_movements m GROUP BY m.inventory_id) s ON s.inventory_id = i.id
   WHERE i.product_id = p_product_id;
END;
$function$;

REVOKE ALL ON FUNCTION public._log_product_ledger_snapshot(uuid) FROM PUBLIC, anon, authenticated;

-- Single-product delete as one transaction (the old front deleted table by table, so a
-- failure half way left a product without ledger or batches). Same steps as the bulk delete.
CREATE OR REPLACE FUNCTION public.delete_product(p_product_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_name text;
  v_blockers jsonb;
  v_combos jsonb;
  v_combo record;
  v_prev_rpc text;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;

  -- Same domain lock as the bulk delete: the two never interleave.
  PERFORM pg_advisory_xact_lock(hashtext('bulk_delete:products'));

  SELECT COALESCE(p.name_es, p.name_en, p_product_id::text) INTO v_name
    FROM public.products p WHERE p.id = p_product_id;
  IF v_name IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;

  -- TOCTOU: lock batches and product BEFORE the blocker check.
  PERFORM 1 FROM public.inventory i WHERE i.product_id = p_product_id ORDER BY i.id FOR UPDATE;
  PERFORM 1 FROM public.products p WHERE p.id = p_product_id FOR UPDATE;

  SELECT jsonb_agg(to_jsonb(b)) INTO v_blockers FROM public.get_product_blockers(p_product_id) b;
  IF v_blockers IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'blocking_orders', 'product_name', v_name, 'blockers', v_blockers);
  END IF;

  UPDATE public.order_items oi SET inventory_id = NULL
   WHERE oi.inventory_id IN (SELECT i.id FROM public.inventory i WHERE i.product_id = p_product_id);

  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', c.id, 'name', COALESCE(c.name_es, c.name_en, c.id::text))), '[]'::jsonb)
    INTO v_combos
    FROM public.combo_products c
   WHERE c.is_active
     AND c.id IN (SELECT ci.combo_id FROM public.combo_items ci WHERE ci.product_id = p_product_id);

  UPDATE public.combo_products c
     SET is_active = false, updated_at = now()
   WHERE c.is_active
     AND c.id IN (SELECT ci.combo_id FROM public.combo_items ci WHERE ci.product_id = p_product_id);

  FOR v_combo IN SELECT (e ->> 'id')::uuid AS id, e ->> 'name' AS name FROM jsonb_array_elements(v_combos) e LOOP
    INSERT INTO public.activity_logs (action, entity_type, entity_id, performed_by, description, metadata)
    VALUES ('combo_deactivated', 'combo', v_combo.id, COALESCE(auth.uid()::text, 'system'),
            'Combo desactivado - ' || v_combo.name || ' (producto eliminado: ' || v_name || ')',
            jsonb_build_object('comboId', v_combo.id, 'comboName', v_combo.name, 'reason', 'product_deleted',
                               'deletedProductId', p_product_id, 'deletedProductName', v_name));
  END LOOP;

  DELETE FROM public.combo_items ci WHERE ci.product_id = p_product_id;

  PERFORM public._log_product_ledger_snapshot(p_product_id);

  v_prev_rpc := current_setting('app.stock_rpc', true);
  PERFORM set_config('app.stock_rpc', 'on', true);
  DELETE FROM public.inventory_movements m
   WHERE m.inventory_id IN (SELECT i.id FROM public.inventory i WHERE i.product_id = p_product_id);
  PERFORM set_config('app.stock_rpc', COALESCE(v_prev_rpc, 'off'), true);

  DELETE FROM public.inventory i WHERE i.product_id = p_product_id;
  DELETE FROM public.products p WHERE p.id = p_product_id;

  INSERT INTO public.activity_logs (action, entity_type, entity_id, performed_by, description, metadata)
  VALUES ('product_deleted', 'product', p_product_id, COALESCE(auth.uid()::text, 'system'),
          'Producto eliminado - ' || v_name,
          jsonb_build_object('productId', p_product_id, 'productName', v_name, 'bulk', false));

  RETURN jsonb_build_object('ok', true, 'product_name', v_name, 'deactivated_combos', v_combos);
END;
$function$;

REVOKE ALL ON FUNCTION public.delete_product(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_product(uuid) TO authenticated, service_role;

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

-- An admin editing reserved_quantity by hand would desync the allocations; creating a batch
-- with reserved > 0 would do the same (no allocation backs it).
CREATE OR REPLACE FUNCTION public.guard_inventory_reserved_edit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF current_setting('app.stock_rpc', true) IS NOT DISTINCT FROM 'on'
     OR current_user IN ('postgres', 'service_role', 'supabase_admin') THEN
    RETURN NEW;
  END IF;

  IF (TG_OP = 'INSERT' AND COALESCE(NEW.reserved_quantity, 0) <> 0)
     OR (TG_OP = 'UPDATE' AND NEW.reserved_quantity IS DISTINCT FROM OLD.reserved_quantity) THEN
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

DROP TRIGGER IF EXISTS guard_inventory_reserved_insert ON public.inventory;
CREATE TRIGGER guard_inventory_reserved_insert
  BEFORE INSERT ON public.inventory
  FOR EACH ROW EXECUTE FUNCTION public.guard_inventory_reserved_edit();

-- The ledger cannot be erased by app roles. The SECURITY DEFINER delete functions and
-- execute_platform_reset run as the function owner (postgres) and pass; so does the flag.
CREATE OR REPLACE FUNCTION public.guard_inventory_movements_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF current_setting('app.stock_rpc', true) IS NOT DISTINCT FROM 'on'
     OR current_user IN ('postgres', 'service_role', 'supabase_admin') THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'inventory_movements is a ledger: rows are deleted only by the delete functions'
    USING ERRCODE = '42501';
END;
$function$;

REVOKE ALL ON FUNCTION public.guard_inventory_movements_delete() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS guard_inventory_movements_delete ON public.inventory_movements;
CREATE TRIGGER guard_inventory_movements_delete
  BEFORE DELETE ON public.inventory_movements
  FOR EACH ROW EXECUTE FUNCTION public.guard_inventory_movements_delete();

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
