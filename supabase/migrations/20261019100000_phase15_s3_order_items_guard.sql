-- ============================================================================
-- Phase 1.5 / S3 (audit_phase1_price_tamper.md, patches P2 + P4): server-side sanity guard for order_items
-- INSERTs and a flag-only items-vs-subtotal reconciliation, with an off / warn / block kill switch.
--                                                                  PREPARED, NOT APPLIED
-- ============================================================================
-- Closes (matrix): T-01 (unit_price 0.01 on a 50 USD product), T-03 (items that do not add up to the order),
-- T-04 (huge quantity), T-17 (fake item_type / item_id).
--
-- What it is NOT: it does not recompute prices. It enforces a 50% FLOOR of the catalog price (a safety net against
-- gross abuse, audit D-03); exact server-side pricing (create_order RPC) stays in F4a.
--
-- ----------------------------------------------------------------------------------------------------
-- P2 RULES (public.order_items BEFORE INSERT, trigger guard_order_items_pricing)
--   blocking class (rejected in 'block', recorded as flag mode 'warn' in 'warn'):
--     item_type_invalid     item_type is not 'product' / 'combo'
--     item_not_in_catalog   item_id is neither a product (item_type 'product') nor a combo. A 'product' line whose id is
--                           a combo is accepted as a combo: the product detail page mislabels combos and
--                           _order_stock_needs() handles them the same way (1 such line exists in production).
--     below_floor           unit_price < 0.5 * catalog final_price (products.final_price / combo_products.final_price).
--                           Prices above the catalog always pass (display currency CUP is a bigger number; EUR is 0.9x).
--     line_total_mismatch   abs(total_price - unit_price * quantity) > 0.005 * quantity + 0.01
--     quantity_above_cap    quantity > 1000 (cap to confirm with the owner; max in production today: 27)
--   flag-only class (NEVER blocks, mode 'flag', recorded in 'warn' and 'block'; not in 'off'):
--     currency_unverified   the product's base_currency_id is not USD (the cart converts to the display currency, so the
--                           raw comparison would be meaningless; floor skipped). 0 such products in production today.
--     catalog_price_missing the catalog row has final_price NULL (floor cannot be evaluated)
--   Every comparison is written "(cond) IS NOT TRUE" so a NULL operand rejects instead of skipping.
--   The table CHECK constraints the audit lists for P2 (line total, quantity cap) are implemented as trigger rules instead,
--   so the kill switch can disarm them; a CHECK cannot be turned off without a migration (audit D-12).
--
-- P4 (reconciliation, FLAG ONLY, never blocks, never cancels, in ANY mode except 'off'):
--   public._flag_order_price_mismatch(order_id) records rule items_subtotal_mismatch (mode 'flag', source_table 'orders')
--   when abs(sum(order_items.total_price) - orders.subtotal) > 0.01 + 0.01 * number_of_lines. Once per order (idempotent).
--   It is called at the top of _reserve_order_locked(), the single chokepoint reached by reserve_order_inventory (customer,
--   right after the items are inserted) AND by consume_order_inventory (admin, when the payment is validated and the
--   reservation was lost): not calling reserve does not escape the check (audit 3.1). Callers of _reserve_order_locked
--   in the repo: reserve_order_inventory, consume_order_inventory only (rg over supabase/ and src/).
--   The helper swallows its own errors (EXCEPTION WHEN OTHERS) so a flag failure can NEVER break a stock reservation.
--   Risk assessment of touching a hot stock function: the migration re-creates _reserve_order_locked byte-for-byte as in
--   20261014190000 (md5 of the body verified equal in production, see below) plus ONE guarded call between the markers
--   P4-BEGIN / P4-END; a static test removes those lines and compares the rest against the original migration.
--   Alternative if the owner prefers not to touch it: call the helper from the two public wrappers only (more copies of
--   larger functions, same effect) or run it as a periodic admin audit query; both documented in plan_phase15_s3_s4.md.
--
-- KILL SWITCH: system_config key order_items_pricing_guard_mode (value_text): 'off' | 'warn' | 'block'. Ships 'warn'.
--   Missing row or any other value behaves as 'warn'. Change without a migration:
--   SELECT public.set_order_items_pricing_guard_mode('block');   (super_admin only, logged to activity_logs)
--   IN WARN MODE THE ATTACKS ARE ONLY RECORDED, NOT STOPPED. Flip to 'block' after price_integrity_flags shows no real
--   customer being flagged. 'off' disables both P2 and P4.
--
-- OBSERVABILITY: REUSES public.price_integrity_flags created by S2 (already applied in production; source_table =
--   'order_items' / 'orders'). No table is created here. In 'block' mode a rejected INSERT rolls back its own flag.
--
-- WHO IS NOT RESTRICTED: service_role, postgres, supabase_admin, requests without a JWT subject, admins and super_admins
--   (same bypass as guard_order_items_insert / S2). The trigger is SECURITY DEFINER (it must read system_config and write the
--   flags table, both without grants), so the bypass does NOT use current_user (inside DEFINER it is the function owner and
--   would let everybody through): it uses auth.uid(), is_admin_user(), is_super_admin() and the session GUC `role`.
--   search_path = public, pg_temp; EXECUTE revoked from PUBLIC, anon, authenticated (except the setter). The error is uniform
--   ('order_item_pricing_rejected', SQLSTATE 23514, no DETAIL/HINT): floors and catalog prices never leak.
--
-- TRIGGER ORDER (BEFORE INSERT, alphabetical): guard_order_items_insert (open, unreserved order), guard_order_items_pricing.
--
-- Production verification (read-only SELECTs via MCP, 2026-10-19, project qcwnlbpultscerwdnzbm):
--   order_items: 146 rows (types: product, combo). Rules run verbatim against all of them: item_type invalid 0,
--     below_floor 0, line_total_mismatch 0 (tolerance as above), quantity > 1000 0 (max 27). 11 lines point to products that no
--     longer exist (physical deletes): historical only, the rule applies to NEW inserts. 1 line is a combo labeled 'product'.
--   Products with a non-USD base currency: 0. order_items triggers in production: 1 (guard_order_items_insert).
--   P4 predicate over the 31 orders (all have items): 0 violations, max |sum(items) - subtotal| = 0.01.
--   price_integrity_flags exists (S2). system_config has no order_items_pricing_guard_mode / offer_id_guard_mode row.
--   md5(prosrc) of _reserve_order_locked in production = cca10f4ee5d7cd8a2876450be73b47ab = the original in 20261014190000.
--
-- Preconditions: S2 applied (price_integrity_flags), 20261014190000 applied; is_admin_user(), is_super_admin(), auth.uid(),
--   activity_logs and system_config exist. Re-check before applying: md5 above must still match, otherwise the stock function
--   changed after this file was written and the P4 hook must be rebased on the new body.
-- Apply order: S1, S2, S3, S4. Needs the owner's "dale" to apply remotely. Idempotent (CREATE OR REPLACE, IF NOT EXISTS).
--
-- ROLLBACK (exact inverse):
-- 1. Re-create _reserve_order_locked with the ORIGINAL body (20261014190000_atomic_stock_reservation.sql, the function that
--    starts at its CREATE OR REPLACE and ends before its REVOKE; i.e. this file minus the 3 lines between P4-BEGIN and P4-END),
--    then re-apply the same REVOKE that migration has right after that function (no EXECUTE for API roles).
-- 2. DROP TRIGGER IF EXISTS guard_order_items_pricing ON public.order_items;
--    DROP FUNCTION IF EXISTS public.guard_order_items_pricing();
--    DROP FUNCTION IF EXISTS public._flag_order_price_mismatch(uuid);
--    DROP FUNCTION IF EXISTS public.set_order_items_pricing_guard_mode(text);
--    DROP FUNCTION IF EXISTS public._order_items_guard_mode();
--    DELETE FROM public.system_config WHERE key = 'order_items_pricing_guard_mode';
--    DELETE FROM public.price_integrity_flags WHERE source_table = 'order_items' OR rule = 'items_subtotal_mismatch';
-- ============================================================================

SET LOCAL lock_timeout = '5s';

-- ----------------------------------------------------------------------------------------------------
-- 1. Kill switch row (ships in warn) and its reader / writer
-- ----------------------------------------------------------------------------------------------------
INSERT INTO public.system_config (key, value_text, description)
SELECT 'order_items_pricing_guard_mode', 'warn',
       'Order items pricing guard mode: off | warn | block. warn records violations in price_integrity_flags without blocking; block rejects them. Missing or invalid values behave as warn.'
 WHERE NOT EXISTS (SELECT 1 FROM public.system_config c WHERE c.key = 'order_items_pricing_guard_mode');

CREATE OR REPLACE FUNCTION public._order_items_guard_mode()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT COALESCE(
    (SELECT value_text FROM public.system_config
      WHERE key = 'order_items_pricing_guard_mode' AND value_text IN ('off', 'warn', 'block')),
    'warn');
$function$;

REVOKE ALL ON FUNCTION public._order_items_guard_mode() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.set_order_items_pricing_guard_mode(p_mode text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_before text;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE = '42501';
  END IF;
  IF p_mode IS NULL OR p_mode NOT IN ('off', 'warn', 'block') THEN
    RAISE EXCEPTION 'invalid_mode: expected off, warn or block' USING ERRCODE = '22023';
  END IF;

  v_before := public._order_items_guard_mode();

  INSERT INTO public.system_config (key, value_text, description)
  VALUES ('order_items_pricing_guard_mode', p_mode,
          'Order items pricing guard mode: off | warn | block. Missing or invalid values behave as warn.')
  ON CONFLICT (key) DO UPDATE SET value_text = EXCLUDED.value_text;

  INSERT INTO public.activity_logs (action, entity_type, entity_id, performed_by, description, metadata)
  VALUES ('order_items_pricing_guard_mode_changed', 'system_config', NULL, COALESCE(auth.uid()::text, 'service_role'),
          'Order items pricing guard mode changed',
          jsonb_build_object('before', v_before, 'after', p_mode));

  RETURN p_mode;
END;
$function$;

REVOKE ALL ON FUNCTION public.set_order_items_pricing_guard_mode(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_order_items_pricing_guard_mode(text) TO authenticated, service_role;

-- ----------------------------------------------------------------------------------------------------
-- 2. P2: the per-line guard
-- ----------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_order_items_pricing()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_mode    text;
  v_cat     numeric;
  v_found   boolean := false;
  v_base    uuid;
  v_usd     uuid;
  v_block   text[] := ARRAY[]::text[];
  v_flag    text[] := ARRAY[]::text[];
  v_rule    text;
  v_details jsonb;
BEGIN
  -- Trusted contexts. NOT current_user: inside SECURITY DEFINER it is the function owner.
  IF auth.uid() IS NULL
     OR COALESCE(current_setting('role', true), '') IN ('service_role', 'postgres', 'supabase_admin')
     OR public.is_admin_user()
     OR public.is_super_admin() THEN
    RETURN NEW;
  END IF;

  v_mode := public._order_items_guard_mode();
  IF v_mode = 'off' THEN
    RETURN NEW;
  END IF;

  IF (NEW.item_type IN ('product', 'combo')) IS NOT TRUE THEN
    v_block := array_append(v_block, 'item_type_invalid'::text);
  ELSE
    IF NEW.item_type = 'product' THEN
      SELECT p.final_price, p.base_currency_id INTO v_cat, v_base FROM public.products p WHERE p.id = NEW.item_id;
      v_found := FOUND;
    END IF;
    IF NOT v_found THEN
      -- combos, and combos mislabeled as 'product' (same classification as _order_stock_needs)
      SELECT c.final_price INTO v_cat FROM public.combo_products c WHERE c.id = NEW.item_id;
      v_found := FOUND;
      v_base := NULL;
    END IF;

    IF NOT v_found THEN
      v_block := array_append(v_block, 'item_not_in_catalog'::text);
    ELSIF v_cat IS NULL THEN
      v_flag := array_append(v_flag, 'catalog_price_missing'::text);
    ELSE
      SELECT id INTO v_usd FROM public.currencies WHERE code = 'USD' LIMIT 1;
      IF v_base IS NOT NULL AND v_base IS DISTINCT FROM v_usd THEN
        v_flag := array_append(v_flag, 'currency_unverified'::text);
      ELSIF (NEW.unit_price >= 0.5 * v_cat) IS NOT TRUE THEN
        v_block := array_append(v_block, 'below_floor'::text);
      END IF;
    END IF;
  END IF;

  IF (abs(NEW.total_price - NEW.unit_price * NEW.quantity) <= 0.005 * NEW.quantity + 0.01) IS NOT TRUE THEN
    v_block := array_append(v_block, 'line_total_mismatch'::text);
  END IF;
  IF (NEW.quantity <= 1000) IS NOT TRUE THEN
    v_block := array_append(v_block, 'quantity_above_cap'::text);
  END IF;

  IF array_length(v_block, 1) IS NOT NULL AND v_mode = 'block' THEN
    RAISE EXCEPTION 'order_item_pricing_rejected' USING ERRCODE = '23514';
  END IF;

  v_details := jsonb_build_object('order_id', NEW.order_id, 'item_type', NEW.item_type, 'item_id', NEW.item_id,
                                  'quantity', NEW.quantity, 'unit_price', NEW.unit_price,
                                  'total_price', NEW.total_price, 'catalog_price', v_cat);

  FOREACH v_rule IN ARRAY v_block LOOP
    INSERT INTO public.price_integrity_flags (source_table, source_id, user_id, rule, mode, details)
    VALUES ('order_items', NEW.id, auth.uid(), v_rule, 'warn', v_details);
  END LOOP;

  FOREACH v_rule IN ARRAY v_flag LOOP
    INSERT INTO public.price_integrity_flags (source_table, source_id, user_id, rule, mode, details)
    VALUES ('order_items', NEW.id, auth.uid(), v_rule, 'flag', v_details);
  END LOOP;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.guard_order_items_pricing() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS guard_order_items_pricing ON public.order_items;
CREATE TRIGGER guard_order_items_pricing
  BEFORE INSERT ON public.order_items
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_order_items_pricing();

-- ----------------------------------------------------------------------------------------------------
-- 3. P4: items vs subtotal reconciliation helper (flag only)
-- ----------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._flag_order_price_mismatch(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_subtotal numeric;
  v_user     uuid;
  v_sum      numeric;
  v_n        integer;
BEGIN
  IF public._order_items_guard_mode() = 'off' THEN
    RETURN;
  END IF;

  SELECT o.subtotal, o.user_id INTO v_subtotal, v_user FROM public.orders o WHERE o.id = p_order_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT COALESCE(sum(i.total_price), 0), count(*)::integer INTO v_sum, v_n
    FROM public.order_items i WHERE i.order_id = p_order_id;
  IF v_n = 0 THEN
    RETURN;
  END IF;

  IF (abs(v_sum - v_subtotal) <= 0.01 + 0.01 * v_n) IS NOT TRUE
     AND NOT EXISTS (SELECT 1 FROM public.price_integrity_flags f
                      WHERE f.source_table = 'orders' AND f.source_id = p_order_id AND f.rule = 'items_subtotal_mismatch') THEN
    INSERT INTO public.price_integrity_flags (source_table, source_id, user_id, rule, mode, details)
    VALUES ('orders', p_order_id, v_user, 'items_subtotal_mismatch', 'flag',
            jsonb_build_object('subtotal', v_subtotal, 'items_sum', v_sum, 'lines', v_n));
  END IF;
EXCEPTION WHEN OTHERS THEN
  -- A flag failure must never break a stock reservation.
  NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public._flag_order_price_mismatch(uuid) FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------------------------------
-- 4. P4 hook: the stock-reservation chokepoint, original body + one guarded call
-- ----------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._reserve_order_locked(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_need record;
  v_inv record;
  v_available bigint;
  v_remaining bigint;
  v_take bigint;
  v_invalid uuid;
  v_number text;
  v_actor uuid := auth.uid();
  v_prev_rpc text;
BEGIN
  -- P4-BEGIN
  PERFORM public._flag_order_price_mismatch(p_order_id);
  -- P4-END
  IF NOT EXISTS (SELECT 1 FROM public._order_stock_needs(p_order_id)) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'empty_order', 'product_id', NULL, 'available', NULL);
  END IF;

  SELECT n.invalid_item_id INTO v_invalid
    FROM public._order_stock_needs(p_order_id) n
   WHERE n.invalid_item_id IS NOT NULL
   LIMIT 1;
  IF v_invalid IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_item', 'product_id', NULL, 'available', NULL);
  END IF;

  -- Lock every candidate batch in a global order before reading availability.
  PERFORM 1
     FROM public.inventory i
    WHERE i.product_id IN (
            SELECT n.product_id FROM public._order_stock_needs(p_order_id) n
             WHERE n.product_id IS NOT NULL)
    ORDER BY i.id
      FOR UPDATE;

  -- Pass 1: availability (a product without an active batch has zero stock).
  FOR v_need IN
    SELECT n.product_id, n.qty
      FROM public._order_stock_needs(p_order_id) n
     WHERE n.product_id IS NOT NULL
     ORDER BY n.product_id
  LOOP
    SELECT COALESCE(SUM(i.quantity - COALESCE(i.reserved_quantity, 0)), 0)
      INTO v_available
      FROM public.inventory i
     WHERE i.product_id = v_need.product_id
       AND COALESCE(i.is_active, true)
       AND (i.expiry_date IS NULL OR i.expiry_date >= current_date);
    IF v_available < v_need.qty THEN
      RETURN jsonb_build_object(
        'ok', false,
        'reason', 'insufficient_stock',
        'product_id', v_need.product_id,
        'available', GREATEST(v_available, 0)
      );
    END IF;
  END LOOP;

  SELECT o.order_number INTO v_number FROM public.orders o WHERE o.id = p_order_id;

  -- Tell the inventory ledger trigger (20261014200000) that this write is already ledgered here.
  v_prev_rpc := current_setting('app.stock_rpc', true);
  PERFORM set_config('app.stock_rpc', 'on', true);

  -- Pass 2: allocate FEFO.
  FOR v_need IN
    SELECT n.product_id, n.qty
      FROM public._order_stock_needs(p_order_id) n
     WHERE n.product_id IS NOT NULL
     ORDER BY n.product_id
  LOOP
    v_remaining := v_need.qty;
    FOR v_inv IN
      SELECT i.id, (i.quantity - COALESCE(i.reserved_quantity, 0)) AS avail
        FROM public.inventory i
       WHERE i.product_id = v_need.product_id
         AND COALESCE(i.is_active, true)
         AND (i.expiry_date IS NULL OR i.expiry_date >= current_date)
         AND i.quantity - COALESCE(i.reserved_quantity, 0) > 0
       ORDER BY i.expiry_date ASC NULLS LAST, i.created_at ASC, i.id ASC
    LOOP
      EXIT WHEN v_remaining <= 0;
      v_take := LEAST(v_inv.avail, v_remaining);

      UPDATE public.inventory
         SET reserved_quantity = COALESCE(reserved_quantity, 0) + v_take
       WHERE id = v_inv.id;

      INSERT INTO public.order_stock_allocations (order_id, inventory_id, quantity, state)
      VALUES (p_order_id, v_inv.id, v_take, 'reserved')
      ON CONFLICT (order_id, inventory_id) DO UPDATE
        SET quantity = EXCLUDED.quantity,
            state = 'reserved',
            updated_at = now(),
            consumed_at = NULL,
            released_at = NULL,
            restocked_at = NULL;

      INSERT INTO public.inventory_movements
        (inventory_id, movement_type, quantity_change, reserved_change, reference_id, reference_type, notes, created_by)
      VALUES
        (v_inv.id, 'reserved', 0, v_take, p_order_id, 'order',
         'Reserved for order ' || COALESCE(v_number, p_order_id::text), v_actor);

      v_remaining := v_remaining - v_take;
    END LOOP;
  END LOOP;

  PERFORM set_config('app.stock_rpc', COALESCE(v_prev_rpc, 'off'), true);

  UPDATE public.orders
     SET stock_reserved = true,
         stock_reserved_at = now()
   WHERE id = p_order_id;

  RETURN jsonb_build_object('ok', true, 'reason', NULL);
END;
$function$;

REVOKE ALL ON FUNCTION public._reserve_order_locked(uuid) FROM PUBLIC, anon, authenticated;
