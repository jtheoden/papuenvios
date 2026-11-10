-- ============================================================================
-- Atomic stock reservation (orders + combos)
-- ============================================================================
-- Problem (evidence: src/lib/orderService.js before this change)
--   Stock was read-modify-write from the browser. createOrder never reserved
--   (cart items carry no inventory_id: 124/124 product order_items on remote
--   have inventory_id NULL), there was no availability check, cancel could
--   release twice, combos only reduced stock at validation, reopen did not
--   re-reserve, and a combo added from the detail page was stored as
--   item_type 'product' (remote order item "COMBO 10" is a combo_products id
--   with item_type = 'product').
--
-- Decision (owner, 2026-10-14)
--   From a cutover on, EVERY order reserves stock at creation and consumes it
--   when the payment is validated. Unpaid reservations expire. Orders created
--   before the cutover are NOT touched (their sales were adjusted by hand):
--   they keep stock_managed = false and every RPC below is a no-op for them.
--
-- What this migration adds
--   orders.stock_managed    cutover marker. Existing rows backfill to false;
--                           the column default is then switched to true, so
--                           every new order is managed. (Deliberate deviation
--                           from a bare stock_reserved flag: a managed order
--                           that is unreserved because the reserve call was
--                           lost must NOT be mistaken for a legacy order.)
--   orders.stock_reserved   true while the order holds (or consumed) stock.
--   orders.stock_reserved_at start of the reservation clock used by expiry.
--   order_stock_allocations per (order, inventory batch) quantity + state
--                           reserved | consumed | released | restocked. RLS: SELECT for the
--                           owner / admins; no direct writes (RPC only).
--   inventory CHECK reserved_quantity <= quantity.
--   inventory_movements.reserved_change: the movements table becomes a real ledger.
--                           For every inventory row, SUM(quantity_change) equals the change
--                           in inventory.quantity and SUM(reserved_change) the change in
--                           inventory.reserved_quantity (the table had 0 rows on remote,
--                           no backfill). reserve: 0/+q, release: 0/-q, sold: -q/-q,
--                           restocked: +q/0.
--   guard_orders_stock_columns  BEFORE INSERT: an end user cannot opt out of
--                           stock management by sending stock_managed = false.
--                           (UPDATEs are already blocked for owners by the
--                           whitelist of guard_orders_owner_update.)
--   release_stock_on_order_cancel  AFTER UPDATE OF status trigger on orders: ANY transition to
--                           'cancelled' (owner UPDATE from the browser, admin, service role, RPC)
--                           releases the order's 'reserved' allocations in the same transaction, so a
--                           lost follow-up release call can no longer strand stock. Consumed
--                           allocations are never touched (restock stays an explicit admin action).
--   RPCs (SECURITY DEFINER, search_path = public, pg_temp, EXECUTE only for
--   authenticated + service_role; the caller must be the order owner or an
--   admin, see each function):
--     reserve_order_inventory(order)  -> jsonb {ok, reason, product_id, available}
--     release_order_inventory(order)  -> jsonb {ok, reason, released}
--     consume_order_inventory(order)  -> jsonb {ok, reason, consumed}   (admin)
--     restock_order_inventory(order, reason) -> jsonb {ok, reason, restocked}  (admin)
--     expire_stale_order_reservations(hours default 48, proof_hours default 168) -> integer
--                                                                       (admin / service)
--     get_stock_policy() / set_stock_policy(unpaid, proof, max_open) / reset_stock_policy()
--                             configurable policy stored in system_config (keys stock_*).
--                             set / reset are super_admin only. Approved defaults: 48 h unpaid
--                             window (bounds 6..720), 168 h proof window (24..2160, >= unpaid),
--                             5 open reservations per customer (1..50).
--
-- Known limits of this migration (OPEN RISKS, reported to the owner, not solved here)
--   * The ledger (inventory_movements) is complete ONLY for the paths in this file. Direct
--     edits of inventory.quantity / reserved_quantity (productService create/update/delete
--     batch paths, VendorInventoryTab) are NOT ledgered, so the SUM invariants can drift
--     after a manual edit. A manual edit of reserved_quantity also desyncs the allocations;
--     releases are clamped (never negative) and log the real delta, but the drift stays.
--   * order_stock_allocations.inventory_id is ON DELETE CASCADE: deleting a batch (or a
--     product) silently erases the allocation rows of live orders, and the reservation
--     disappears with them. Product deletion checks only order_items.inventory_id, which is
--     NULL on every row, so it is blind to reservations.
--   * The per-customer cap counts orders that hold a 'reserved' allocation (any status), not
--     "stock_reserved AND pending": stock_reserved stays true after consume, so counting it
--     would block customers with completed orders forever.
--
-- Concurrency model
--   Lock order is ALWAYS: orders row(s) (FOR UPDATE) -> inventory rows
--   (ORDER BY id FOR UPDATE). The expiry job locks all its candidate orders first
--   and then ALL their inventory rows in a single ordered statement, so it follows
--   the same global order. The state checks run while the order row is locked,
--   so transitions are exclusive:
--     reserve : only status = 'pending'            (idempotent if reserved)
--     release : only status = 'cancelled'          (only 'reserved' allocations; also fired by
--               the cancel trigger, clamped so reserved_quantity never goes below 0)
--     consume : admin, payment_status = 'validated' (only 'reserved' allocations)
--     restock : admin, status = 'cancelled' (only 'consumed' allocations, needs a reason).
--               Goods may have left, so restocking is NEVER automatic: the admin decides.
--               A consumed order that is cancelled and NOT restocked keeps its allocations:
--               reopening it answers 'already_reserved' and validating it again
--               'already_consumed' (stock stays decremented, nothing is taken twice).
--   Allocation is FEFO: expiry_date ASC NULLS LAST, created_at, id.
--
-- Owner guards: the RPCs update public.orders as the function owner (postgres),
-- which guard_orders_owner_update / guard_orders_owner_insert bypass
-- (current_user IN ('postgres', ...)). Verified by the concurrency suite.
--
-- Scheduling: NOTHING is scheduled here. Snippet for the owner at the bottom.
--   *** RELEASE GATE: without the pg_cron schedule (or an equivalent job) reservations
--   never expire and abandoned orders hold stock forever. Do not release without it. ***
--
-- ROLLBACK (exact inverse, in this order). Safe only while no managed order holds a
-- reservation; otherwise FIRST release them: for every cancelled order run
-- SELECT public.release_order_inventory(id), and cancel/release the live ones.
-- 1. Front first (deploy the previous build), then unschedule the job if it exists:
--    SELECT cron.unschedule('expire-stale-order-reservations');
-- 2. SQL (the trigger goes before the functions it calls):
-- DROP TRIGGER IF EXISTS release_stock_on_order_cancel ON public.orders;
-- DROP FUNCTION IF EXISTS public.release_stock_on_order_cancel();
-- DROP FUNCTION IF EXISTS public.expire_stale_order_reservations(integer, integer);
-- DROP FUNCTION IF EXISTS public.reset_stock_policy();
-- DROP FUNCTION IF EXISTS public.set_stock_policy(integer, integer, integer);
-- DROP FUNCTION IF EXISTS public.get_stock_policy();
-- DROP FUNCTION IF EXISTS public._apply_stock_policy(integer, integer, integer, text);
-- DROP FUNCTION IF EXISTS public._stock_policy_int(text);
-- DELETE FROM public.system_config WHERE key IN ('stock_unpaid_expiry_hours', 'stock_proof_expiry_hours', 'stock_max_open_reservations');
-- DROP FUNCTION IF EXISTS public.restock_order_inventory(uuid, text);
-- DROP FUNCTION IF EXISTS public.consume_order_inventory(uuid);
-- DROP FUNCTION IF EXISTS public.release_order_inventory(uuid);
-- DROP FUNCTION IF EXISTS public.reserve_order_inventory(uuid);
-- DROP FUNCTION IF EXISTS public._consume_order_locked(uuid);
-- DROP FUNCTION IF EXISTS public._release_order_locked(uuid);
-- DROP FUNCTION IF EXISTS public._reserve_order_locked(uuid);
-- DROP FUNCTION IF EXISTS public._order_stock_needs(uuid);
-- DROP TRIGGER IF EXISTS guard_order_items_insert ON public.order_items;
-- DROP FUNCTION IF EXISTS public.guard_order_items_insert();
-- DROP TRIGGER IF EXISTS guard_orders_stock_columns ON public.orders;
-- DROP FUNCTION IF EXISTS public.guard_orders_stock_columns();
-- DROP TABLE IF EXISTS public.order_stock_allocations;
-- ALTER TABLE public.inventory_movements DROP COLUMN IF EXISTS reserved_change;
-- ALTER TABLE public.inventory DROP CONSTRAINT IF EXISTS inventory_reserved_lte_quantity;
-- ALTER TABLE public.orders DROP COLUMN IF EXISTS stock_reserved_at,
--   DROP COLUMN IF EXISTS stock_reserved, DROP COLUMN IF EXISTS stock_managed;
-- 3. If 20261014210000 was applied, roll it back first (it carries the policy definition).
-- What a rollback does NOT undo: inventory quantities already consumed are not restored,
-- inventory_movements rows written by the RPCs stay, and activity_logs audit rows stay.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Columns
-- ----------------------------------------------------------------------------
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS stock_managed boolean NOT NULL DEFAULT false;
-- Existing rows keep false (legacy); every order created from now on is managed.
ALTER TABLE public.orders
  ALTER COLUMN stock_managed SET DEFAULT true;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS stock_reserved boolean NOT NULL DEFAULT false;
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS stock_reserved_at timestamptz;

-- ----------------------------------------------------------------------------
-- 2. inventory invariant: a batch can never hold more reservations than units
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'inventory_reserved_lte_quantity'
       AND conrelid = 'public.inventory'::regclass
  ) THEN
    ALTER TABLE public.inventory
      ADD CONSTRAINT inventory_reserved_lte_quantity
      CHECK (COALESCE(reserved_quantity, 0) <= quantity);
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 2b. Ledger: reserved_change next to quantity_change
-- ----------------------------------------------------------------------------
ALTER TABLE public.inventory_movements
  ADD COLUMN IF NOT EXISTS reserved_change integer NOT NULL DEFAULT 0;

-- The local base migration declares movement_type / reference_type as enums, the remote
-- project already has text (verified by SELECT). The RPCs write text values such as
-- 'reserved', 'released', 'restocked' and 'adjustment', so convert ONLY if they are enums.
-- (Columns with an enum DEFAULT are not expected; the conversion would fail loudly.)
DO $$
DECLARE
  v_col record;
BEGIN
  FOR v_col IN
    SELECT c.column_name
      FROM information_schema.columns c
     WHERE c.table_schema = 'public'
       AND c.table_name = 'inventory_movements'
       AND c.column_name IN ('movement_type', 'reference_type')
       AND c.data_type = 'USER-DEFINED'
  LOOP
    EXECUTE format(
      'ALTER TABLE public.inventory_movements ALTER COLUMN %I TYPE text USING %I::text',
      v_col.column_name, v_col.column_name);
  END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- 3. Allocations
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.order_stock_allocations (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id     uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  inventory_id uuid NOT NULL REFERENCES public.inventory(id) ON DELETE CASCADE,
  quantity     integer NOT NULL CHECK (quantity > 0),
  state        text NOT NULL DEFAULT 'reserved'
                 CHECK (state IN ('reserved', 'consumed', 'released', 'restocked')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  consumed_at  timestamptz,
  released_at  timestamptz,
  restocked_at timestamptz,
  CONSTRAINT order_stock_allocations_order_inventory_key UNIQUE (order_id, inventory_id)
);

-- Idempotent upgrades for databases that already ran an earlier revision of this file.
ALTER TABLE public.order_stock_allocations ADD COLUMN IF NOT EXISTS restocked_at timestamptz;
ALTER TABLE public.order_stock_allocations DROP CONSTRAINT IF EXISTS order_stock_allocations_state_check;
ALTER TABLE public.order_stock_allocations
  ADD CONSTRAINT order_stock_allocations_state_check
  CHECK (state IN ('reserved', 'consumed', 'released', 'restocked'));

CREATE INDEX IF NOT EXISTS idx_order_stock_allocations_inventory
  ON public.order_stock_allocations (inventory_id);

ALTER TABLE public.order_stock_allocations ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.order_stock_allocations FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.order_stock_allocations TO authenticated;
GRANT ALL ON public.order_stock_allocations TO service_role;

DROP POLICY IF EXISTS order_stock_allocations_select ON public.order_stock_allocations;
CREATE POLICY order_stock_allocations_select ON public.order_stock_allocations
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.orders o
       WHERE o.id = order_stock_allocations.order_id
         AND o.user_id = (SELECT auth.uid())
    )
    OR (SELECT public.is_admin_user())
  );

-- ----------------------------------------------------------------------------
-- 4. End users cannot opt out of stock management on INSERT
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_orders_stock_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF current_user IN ('postgres', 'service_role', 'supabase_admin')
     OR auth.uid() IS NULL
     OR public.is_admin_user()
     OR public.is_super_admin() THEN
    RETURN NEW;
  END IF;

  NEW.stock_managed := true;
  NEW.stock_reserved := false;
  NEW.stock_reserved_at := NULL;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.guard_orders_stock_columns() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS guard_orders_stock_columns ON public.orders;
CREATE TRIGGER guard_orders_stock_columns
  BEFORE INSERT ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.guard_orders_stock_columns();

-- ----------------------------------------------------------------------------
-- 4b. Stock policy (configurable by super_admin) in public.system_config
--     Approved defaults: unpaid window 48 h, proof_uploaded window 168 h (7 days),
--     max open reservations per customer 5. The existing system_config write
--     policies are NOT widened: the keys are written only by set_stock_policy
--     (SECURITY DEFINER, super_admin) and read by admins through get_stock_policy.
-- ----------------------------------------------------------------------------
INSERT INTO public.system_config (key, value_numeric, description)
SELECT v.key, v.value_numeric, v.description
  FROM (VALUES
    ('stock_unpaid_expiry_hours', 48::numeric,
     'Hours after which an order without payment proof (payment pending or rejected) is cancelled automatically and its reserved stock returns to the inventory. Allowed 6-720, default 48.'),
    ('stock_proof_expiry_hours', 168::numeric,
     'Hours after which an order with an uploaded proof that nobody validated or rejected is cancelled automatically and its reserved stock returns to the inventory. Allowed 24-2160, default 168 (7 days); must not be lower than the unpaid window.'),
    ('stock_max_open_reservations', 5::numeric,
     'Maximum number of unpaid orders holding reserved stock that one customer may have open at the same time. Allowed 1-50, default 5.')
  ) AS v(key, value_numeric, description)
 WHERE NOT EXISTS (SELECT 1 FROM public.system_config c WHERE c.key = v.key);

-- Effective integer value of a policy key. Falls back to the approved default when the
-- row is missing, fractional or outside the key's own bounds (the same ones set_stock_policy
-- enforces); the comparison happens BEFORE the cast, so 3e9 cannot overflow. Callers never
-- fail because of config.
CREATE OR REPLACE FUNCTION public._stock_policy_int(p_key text)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT CASE
           WHEN c.value_numeric IS NOT NULL
                AND c.value_numeric = trunc(c.value_numeric)
                AND c.value_numeric BETWEEN b.lo AND b.hi THEN c.value_numeric::integer
           ELSE b.def
         END
    FROM (SELECT CASE p_key WHEN 'stock_unpaid_expiry_hours' THEN 6
                            WHEN 'stock_proof_expiry_hours' THEN 24
                            WHEN 'stock_max_open_reservations' THEN 1 END AS lo,
                 CASE p_key WHEN 'stock_unpaid_expiry_hours' THEN 720
                            WHEN 'stock_proof_expiry_hours' THEN 2160
                            WHEN 'stock_max_open_reservations' THEN 50 END AS hi,
                 CASE p_key WHEN 'stock_unpaid_expiry_hours' THEN 48
                            WHEN 'stock_proof_expiry_hours' THEN 168
                            WHEN 'stock_max_open_reservations' THEN 5 END AS def) AS b
    LEFT JOIN public.system_config c ON c.key = p_key;
$function$;

REVOKE ALL ON FUNCTION public._stock_policy_int(text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_stock_policy()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;

  RETURN jsonb_build_object(
    'unpaid_hours', public._stock_policy_int('stock_unpaid_expiry_hours'),
    'proof_hours', public._stock_policy_int('stock_proof_expiry_hours'),
    'max_open_reservations', public._stock_policy_int('stock_max_open_reservations'),
    'defaults', jsonb_build_object('unpaid_hours', 48, 'proof_hours', 168, 'max_open_reservations', 5),
    'bounds', jsonb_build_object(
      'unpaid_hours', jsonb_build_object('min', 6, 'max', 720),
      'proof_hours', jsonb_build_object('min', 24, 'max', 2160),
      'max_open_reservations', jsonb_build_object('min', 1, 'max', 50)
    )
  );
END;
$function$;

-- Single writer for the three policy rows. Validation happens in the callers; this one
-- locks, writes and records the audit (before/after + actor) INSIDE the same transaction,
-- so a change made through the app cannot exist without its audit trail. Two copies:
-- activity_logs (readable by the admin UI, but subject to the 90-day TTL purge and writable
-- by other service paths, so NOT tamper-evident) and admin_destructive_ops_log (super_admin
-- read only, no purge job, written only by SECURITY DEFINER code: the durable copy).
-- Someone with owner/SQL access can still edit either table. No EXECUTE for API roles.
CREATE OR REPLACE FUNCTION public._apply_stock_policy(
  p_unpaid_hours integer, p_proof_hours integer, p_max_open integer, p_action text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_before jsonb;
  v_after jsonb;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('stock_policy'));

  v_before := jsonb_build_object(
    'unpaid_hours', public._stock_policy_int('stock_unpaid_expiry_hours'),
    'proof_hours', public._stock_policy_int('stock_proof_expiry_hours'),
    'max_open_reservations', public._stock_policy_int('stock_max_open_reservations'));

  INSERT INTO public.system_config (key, value_numeric, description)
  VALUES
    ('stock_unpaid_expiry_hours', p_unpaid_hours, 'Hours after which an order without payment proof is cancelled automatically (6-720, default 48).'),
    ('stock_proof_expiry_hours', p_proof_hours, 'Hours after which an unreviewed order with an uploaded proof is cancelled automatically (24-2160, default 168).'),
    ('stock_max_open_reservations', p_max_open, 'Maximum unpaid orders holding reserved stock per customer (1-50, default 5).')
  ON CONFLICT (key) DO UPDATE SET value_numeric = EXCLUDED.value_numeric;

  v_after := jsonb_build_object(
    'unpaid_hours', p_unpaid_hours, 'proof_hours', p_proof_hours, 'max_open_reservations', p_max_open);

  INSERT INTO public.activity_logs (action, entity_type, entity_id, performed_by, description, metadata)
  VALUES (
    p_action,
    'system_config',
    NULL,
    COALESCE(auth.uid()::text, 'service_role'),
    CASE p_action
      WHEN 'stock_policy_reset' THEN 'Stock reservation policy reset to the defaults'
      ELSE 'Stock reservation policy updated'
    END,
    jsonb_build_object('before', v_before, 'after', v_after));

  INSERT INTO public.admin_destructive_ops_log (op_type, performed_by, details)
  VALUES (
    'stock_policy_changed',
    COALESCE(auth.uid()::text, 'service_role'),
    jsonb_build_object('action', p_action, 'before', v_before, 'after', v_after));

  RETURN public.get_stock_policy();
END;
$function$;

REVOKE ALL ON FUNCTION public._apply_stock_policy(integer, integer, integer, text) FROM PUBLIC, anon, authenticated;

-- Write the three values atomically. super_admin only (or the service role).
-- Bounds: unpaid 6..720, proof 24..2160 and proof >= unpaid, max_open 1..50 (SQLSTATE 22023).
CREATE OR REPLACE FUNCTION public.set_stock_policy(p_unpaid_hours integer, p_proof_hours integer, p_max_open integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;

  IF p_unpaid_hours IS NULL OR p_unpaid_hours NOT BETWEEN 6 AND 720 THEN
    RAISE EXCEPTION 'invalid_unpaid_hours: must be between 6 and 720' USING ERRCODE = '22023';
  END IF;
  IF p_proof_hours IS NULL OR p_proof_hours NOT BETWEEN 24 AND 2160 THEN
    RAISE EXCEPTION 'invalid_proof_hours: must be between 24 and 2160' USING ERRCODE = '22023';
  END IF;
  IF p_proof_hours < p_unpaid_hours THEN
    RAISE EXCEPTION 'invalid_proof_hours: must not be lower than the unpaid window' USING ERRCODE = '22023';
  END IF;
  IF p_max_open IS NULL OR p_max_open NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION 'invalid_max_open: must be between 1 and 50' USING ERRCODE = '22023';
  END IF;

  RETURN public._apply_stock_policy(p_unpaid_hours, p_proof_hours, p_max_open, 'stock_policy_updated');
END;
$function$;

CREATE OR REPLACE FUNCTION public.reset_stock_policy()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  RETURN public._apply_stock_policy(48, 168, 5, 'stock_policy_reset');
END;
$function$;

REVOKE ALL ON FUNCTION public.get_stock_policy() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_stock_policy(integer, integer, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reset_stock_policy() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_stock_policy() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_stock_policy(integer, integer, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reset_stock_policy() TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 5. Internal helpers (no EXECUTE for API roles; callers hold the order lock)
-- ----------------------------------------------------------------------------

-- Stock needed per product. Products are taken as-is; combos are expanded with
-- combo_items.quantity * item quantity. A 'product' item whose id is not a
-- product but IS a combo (items added from the detail page were mislabeled) is
-- treated as a combo. Anything else is reported as invalid_item_id.
CREATE OR REPLACE FUNCTION public._order_stock_needs(p_order_id uuid)
RETURNS TABLE (product_id uuid, qty bigint, invalid_item_id uuid)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $function$
  WITH classified AS (
    SELECT oi.item_id,
           oi.quantity,
           CASE
             WHEN oi.item_type = 'combo'
                  AND EXISTS (SELECT 1 FROM public.combo_products c WHERE c.id = oi.item_id) THEN 'combo'
             WHEN oi.item_type = 'product'
                  AND EXISTS (SELECT 1 FROM public.products p WHERE p.id = oi.item_id) THEN 'product'
             WHEN oi.item_type = 'product'
                  AND EXISTS (SELECT 1 FROM public.combo_products c WHERE c.id = oi.item_id) THEN 'combo'
             ELSE 'invalid'
           END AS kind
      FROM public.order_items oi
     WHERE oi.order_id = p_order_id
       AND oi.item_type IN ('product', 'combo')
  ),
  lines AS (
    SELECT c.item_id AS product_id, c.quantity::bigint AS qty, NULL::uuid AS invalid_item_id
      FROM classified c WHERE c.kind = 'product'
    UNION ALL
    SELECT ci.product_id, (c.quantity::bigint * ci.quantity), NULL::uuid
      FROM classified c
      JOIN public.combo_items ci ON ci.combo_id = c.item_id
     WHERE c.kind = 'combo'
    UNION ALL
    SELECT NULL::uuid, c.quantity::bigint, c.item_id
      FROM classified c WHERE c.kind = 'invalid'
  )
  SELECT l.product_id, SUM(l.qty)::bigint, l.invalid_item_id
    FROM lines l
   GROUP BY l.product_id, l.invalid_item_id;
$function$;

REVOKE ALL ON FUNCTION public._order_stock_needs(uuid) FROM PUBLIC, anon, authenticated;

-- Reserve stock for an order. CALLER MUST HOLD THE ORDER ROW LOCK. Never cancels
-- the order and never raises for business failures: it returns
-- {ok:false, reason, product_id, available}. All-or-nothing: nothing is
-- written unless every product has enough stock.
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

-- Release every 'reserved' allocation of an order. CALLER MUST HOLD THE ORDER
-- ROW LOCK. Returns the number of allocations released (0 = nothing to do).
CREATE OR REPLACE FUNCTION public._release_order_locked(p_order_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_alloc record;
  v_count integer := 0;
  v_number text;
  v_actor uuid := auth.uid();
  v_current integer;
  v_delta integer;
  v_prev_rpc text;
BEGIN
  PERFORM 1
     FROM public.inventory i
    WHERE i.id IN (
            SELECT a.inventory_id FROM public.order_stock_allocations a
             WHERE a.order_id = p_order_id AND a.state = 'reserved')
    ORDER BY i.id
      FOR UPDATE;

  SELECT o.order_number INTO v_number FROM public.orders o WHERE o.id = p_order_id;

  -- Tell the inventory ledger trigger (20261014200000) that this write is already ledgered here.
  v_prev_rpc := current_setting('app.stock_rpc', true);
  PERFORM set_config('app.stock_rpc', 'on', true);

  FOR v_alloc IN
    SELECT a.id, a.inventory_id, a.quantity
      FROM public.order_stock_allocations a
     WHERE a.order_id = p_order_id AND a.state = 'reserved'
     ORDER BY a.inventory_id
  LOOP
    -- Clamp: if the counter drifted (manual inventory edit) never go below 0, and ledger
    -- the delta that was REALLY applied so the SUM invariant keeps matching the row.
    SELECT COALESCE(i.reserved_quantity, 0) INTO v_current
      FROM public.inventory i WHERE i.id = v_alloc.inventory_id;
    v_delta := LEAST(v_alloc.quantity, GREATEST(COALESCE(v_current, 0), 0));

    UPDATE public.inventory
       SET reserved_quantity = COALESCE(reserved_quantity, 0) - v_delta
     WHERE id = v_alloc.inventory_id;

    UPDATE public.order_stock_allocations
       SET state = 'released', released_at = now(), updated_at = now()
     WHERE id = v_alloc.id;

    INSERT INTO public.inventory_movements
      (inventory_id, movement_type, quantity_change, reserved_change, reference_id, reference_type, notes, created_by)
    VALUES
      (v_alloc.inventory_id, 'released', 0, -v_delta, p_order_id, 'order',
       'Released from order ' || COALESCE(v_number, p_order_id::text), v_actor);

    v_count := v_count + 1;
  END LOOP;

  PERFORM set_config('app.stock_rpc', COALESCE(v_prev_rpc, 'off'), true);

  IF v_count > 0 THEN
    UPDATE public.orders
       SET stock_reserved = false,
           stock_reserved_at = NULL
     WHERE id = p_order_id;
  END IF;

  RETURN v_count;
END;
$function$;

REVOKE ALL ON FUNCTION public._release_order_locked(uuid) FROM PUBLIC, anon, authenticated;

-- Consume every 'reserved' allocation: quantity -= q AND reserved -= q (no
-- availability re-check against the order's own reservation). CALLER MUST HOLD
-- THE ORDER ROW LOCK. Returns the number of allocations consumed.
CREATE OR REPLACE FUNCTION public._consume_order_locked(p_order_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_alloc record;
  v_count integer := 0;
  v_number text;
  v_actor uuid := auth.uid();
  v_current integer;
  v_delta integer;
  v_prev_rpc text;
BEGIN
  PERFORM 1
     FROM public.inventory i
    WHERE i.id IN (
            SELECT a.inventory_id FROM public.order_stock_allocations a
             WHERE a.order_id = p_order_id AND a.state = 'reserved')
    ORDER BY i.id
      FOR UPDATE;

  SELECT o.order_number INTO v_number FROM public.orders o WHERE o.id = p_order_id;

  -- Tell the inventory ledger trigger (20261014200000) that this write is already ledgered here.
  v_prev_rpc := current_setting('app.stock_rpc', true);
  PERFORM set_config('app.stock_rpc', 'on', true);

  FOR v_alloc IN
    SELECT a.id, a.inventory_id, a.quantity
      FROM public.order_stock_allocations a
     WHERE a.order_id = p_order_id AND a.state = 'reserved'
     ORDER BY a.inventory_id
  LOOP
    -- The units WERE sold (payment validated), so a drifted counter must not block the sale:
    -- quantity always drops by the allocation, reserved only by what is really there (never
    -- below 0, same clamp as release) and the ledger records that real delta. Refusing with
    -- an error or an 'inconsistent_reservation' result would leave a paid order unconsumed.
    SELECT COALESCE(i.reserved_quantity, 0) INTO v_current
      FROM public.inventory i WHERE i.id = v_alloc.inventory_id;
    v_delta := LEAST(v_alloc.quantity, GREATEST(COALESCE(v_current, 0), 0));

    UPDATE public.inventory
       SET quantity = quantity - v_alloc.quantity,
           reserved_quantity = COALESCE(reserved_quantity, 0) - v_delta
     WHERE id = v_alloc.inventory_id;

    UPDATE public.order_stock_allocations
       SET state = 'consumed', consumed_at = now(), updated_at = now()
     WHERE id = v_alloc.id;

    INSERT INTO public.inventory_movements
      (inventory_id, movement_type, quantity_change, reserved_change, reference_id, reference_type, notes, created_by)
    VALUES
      (v_alloc.inventory_id, 'sold', -v_alloc.quantity, -v_delta, p_order_id, 'order',
       'Sold - payment validated for order ' || COALESCE(v_number, p_order_id::text), v_actor);

    v_count := v_count + 1;
  END LOOP;

  PERFORM set_config('app.stock_rpc', COALESCE(v_prev_rpc, 'off'), true);

  RETURN v_count;
END;
$function$;

REVOKE ALL ON FUNCTION public._consume_order_locked(uuid) FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 6. Public RPCs
-- ----------------------------------------------------------------------------

-- Reserve stock for a pending order. On insufficient stock the order is
-- cancelled IN THE SAME TRANSACTION (no RAISE, so the change commits) with
-- rejection_reason = 'insufficient_stock' | 'invalid_item'.
CREATE OR REPLACE FUNCTION public.reserve_order_inventory(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_owner uuid;
  v_order public.orders%ROWTYPE;
  v_result jsonb;
  -- Max orders holding a 'reserved' allocation (any status) one customer may have at once.
  -- Configurable by super_admin (stock_max_open_reservations, default 5, bounds 1..50);
  -- a missing or invalid row falls back to the default and never fails the reserve.
  v_max_open_reservations integer := public._stock_policy_int('stock_max_open_reservations');
  v_open integer;
BEGIN
  -- Authorize on an unlocked read so strangers cannot queue on someone's row lock.
  -- An unknown id and someone else's order are indistinguishable to end users (no existence leak).
  SELECT o.user_id INTO v_owner FROM public.orders o WHERE o.id = p_order_id;
  IF NOT FOUND THEN
    IF v_uid IS NOT NULL AND NOT public.is_admin_user() THEN
      RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
    END IF;
    RETURN jsonb_build_object('ok', false, 'reason', 'order_not_found');
  END IF;
  IF v_uid IS NOT NULL AND v_owner IS DISTINCT FROM v_uid AND NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;

  IF NOT v_order.stock_managed THEN
    RETURN jsonb_build_object('ok', true, 'reason', 'legacy_order');
  END IF;
  IF v_order.stock_reserved THEN
    RETURN jsonb_build_object('ok', true, 'reason', 'already_reserved');
  END IF;
  IF v_order.status IS DISTINCT FROM 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_order_state');
  END IF;

  -- Serialize the per-customer cap (order lock first, then this lock, then inventory).
  PERFORM pg_advisory_xact_lock(hashtext('reserve_cap:' || v_order.user_id::text));
  SELECT count(*) INTO v_open
    FROM public.orders o
   WHERE o.user_id = v_order.user_id
     AND o.id <> p_order_id
     AND o.stock_managed
     AND EXISTS (SELECT 1 FROM public.order_stock_allocations a
                  WHERE a.order_id = o.id AND a.state = 'reserved');

  IF v_open >= v_max_open_reservations THEN
    v_result := jsonb_build_object('ok', false, 'reason', 'too_many_open_reservations');
  ELSE
    v_result := public._reserve_order_locked(p_order_id);
  END IF;

  IF NOT (v_result ->> 'ok')::boolean THEN
    UPDATE public.orders
       SET status = 'cancelled',
           payment_status = 'rejected',
           rejection_reason = v_result ->> 'reason',
           updated_at = now()
     WHERE id = p_order_id;
  END IF;

  RETURN v_result;
END;
$function$;

-- Release the reservation of a CANCELLED order. Refuses on live orders so an
-- owner cannot free stock and keep the order alive.
CREATE OR REPLACE FUNCTION public.release_order_inventory(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_owner uuid;
  v_order public.orders%ROWTYPE;
  v_count integer;
BEGIN
  SELECT o.user_id INTO v_owner FROM public.orders o WHERE o.id = p_order_id;
  IF NOT FOUND THEN
    IF v_uid IS NOT NULL AND NOT public.is_admin_user() THEN
      RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
    END IF;
    RETURN jsonb_build_object('ok', false, 'reason', 'order_not_found', 'released', false);
  END IF;
  IF v_uid IS NOT NULL AND v_owner IS DISTINCT FROM v_uid AND NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;

  IF v_order.status IS DISTINCT FROM 'cancelled' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'order_not_cancelled', 'released', false);
  END IF;

  v_count := public._release_order_locked(p_order_id);

  RETURN jsonb_build_object(
    'ok', true,
    'reason', CASE WHEN v_count = 0 THEN 'nothing_to_release' ELSE NULL END,
    'released', v_count > 0
  );
END;
$function$;

-- Consume the reservation when the payment is validated (admin / service only).
-- Legacy orders (stock_managed = false) are a no-op. A managed order that was
-- never reserved (the reserve call was lost) is reserved and consumed in this
-- same transaction, with an availability check.
CREATE OR REPLACE FUNCTION public.consume_order_inventory(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_order public.orders%ROWTYPE;
  v_result jsonb;
  v_count integer;
BEGIN
  IF v_uid IS NOT NULL AND NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'order_not_found', 'consumed', false);
  END IF;

  IF NOT v_order.stock_managed THEN
    RETURN jsonb_build_object('ok', true, 'reason', 'legacy_order', 'consumed', false);
  END IF;
  IF v_order.payment_status IS DISTINCT FROM 'validated' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'payment_not_validated', 'consumed', false);
  END IF;

  IF v_order.status NOT IN ('pending', 'processing') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'order_not_active', 'consumed', false);
  END IF;

  IF NOT v_order.stock_reserved THEN
    v_result := public._reserve_order_locked(p_order_id);
    IF NOT (v_result ->> 'ok')::boolean THEN
      RETURN v_result || jsonb_build_object('consumed', false);
    END IF;
  END IF;

  v_count := public._consume_order_locked(p_order_id);

  IF v_count = 0 THEN
    -- Nothing was 'reserved'. Idempotent success only if the order really consumed before;
    -- otherwise the order is flagged reserved with no allocations (inconsistent): say so.
    IF EXISTS (SELECT 1 FROM public.order_stock_allocations a
                WHERE a.order_id = p_order_id AND a.state = 'consumed') THEN
      RETURN jsonb_build_object('ok', true, 'reason', 'already_consumed', 'consumed', false);
    END IF;
    RETURN jsonb_build_object('ok', false, 'reason', 'no_allocations', 'consumed', false);
  END IF;

  RETURN jsonb_build_object('ok', true, 'reason', NULL, 'consumed', true);
END;
$function$;

-- Return the units consumed by a CANCELLED order to the inventory. Explicit admin
-- decision (goods may already have left): never called automatically. Moves each
-- 'consumed' allocation to 'restocked' (quantity += q), logs a 'restocked' movement
-- with the reason, and clears stock_reserved so a later reopen re-reserves with an
-- availability check. Idempotent: a second call finds nothing to restock.
CREATE OR REPLACE FUNCTION public.restock_order_inventory(p_order_id uuid, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_order public.orders%ROWTYPE;
  v_alloc record;
  v_count integer := 0;
  v_prev_rpc text;
BEGIN
  IF v_uid IS NOT NULL AND NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'reason_required', 'restocked', false);
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'order_not_found', 'restocked', false);
  END IF;
  IF v_order.status IS DISTINCT FROM 'cancelled' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'order_not_cancelled', 'restocked', false);
  END IF;

  PERFORM 1
     FROM public.inventory i
    WHERE i.id IN (
            SELECT a.inventory_id FROM public.order_stock_allocations a
             WHERE a.order_id = p_order_id AND a.state = 'consumed')
    ORDER BY i.id
      FOR UPDATE;

  -- Tell the inventory ledger trigger (20261014200000) that this write is already ledgered here.
  v_prev_rpc := current_setting('app.stock_rpc', true);
  PERFORM set_config('app.stock_rpc', 'on', true);

  FOR v_alloc IN
    SELECT a.id, a.inventory_id, a.quantity
      FROM public.order_stock_allocations a
     WHERE a.order_id = p_order_id AND a.state = 'consumed'
     ORDER BY a.inventory_id
  LOOP
    UPDATE public.inventory
       SET quantity = quantity + v_alloc.quantity
     WHERE id = v_alloc.inventory_id;

    UPDATE public.order_stock_allocations
       SET state = 'restocked', restocked_at = now(), updated_at = now()
     WHERE id = v_alloc.id;

    INSERT INTO public.inventory_movements
      (inventory_id, movement_type, quantity_change, reserved_change, reference_id, reference_type, notes, created_by)
    VALUES
      (v_alloc.inventory_id, 'restocked', v_alloc.quantity, 0, p_order_id, 'order',
       'Restocked from cancelled order ' || COALESCE(v_order.order_number, p_order_id::text)
         || ': ' || btrim(p_reason), v_uid);

    v_count := v_count + 1;
  END LOOP;

  PERFORM set_config('app.stock_rpc', COALESCE(v_prev_rpc, 'off'), true);

  IF v_count > 0 THEN
    UPDATE public.orders
       SET stock_reserved = false,
           stock_reserved_at = NULL
     WHERE id = p_order_id;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'reason', CASE WHEN v_count = 0 THEN 'nothing_to_restock' ELSE NULL END,
    'restocked', v_count > 0
  );
END;
$function$;

-- Cancel + release stale reservations, and sweep orphans (cancelled orders that
-- still hold a 'reserved' allocation because a release call was lost).
--   p_hours       Window for UNPAID orders (payment pending | rejected). NULL = the
--                 configured stock_unpaid_expiry_hours (default 48). Explicit values
--                 below the 6 h floor are refused. For a rejected payment the
--                 rejection time (validated_at) counts too, so a customer gets the
--                 whole window to retry after a rejection.
--   p_proof_hours Window for orders with proof_uploaded that nobody validated or
--                 rejected, counted from the reservation. NULL = the configured
--                 stock_proof_expiry_hours (default 168 = 7 days). Explicit values
--                 below the 24 h floor are refused. These are the only statuses that expire:
--                 anything validated / processing / later NEVER expires.
DROP FUNCTION IF EXISTS public.expire_stale_order_reservations(integer);
DROP FUNCTION IF EXISTS public.expire_stale_order_reservations(integer, integer);
CREATE OR REPLACE FUNCTION public.expire_stale_order_reservations(
  p_hours integer DEFAULT NULL,
  p_proof_hours integer DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_ids uuid[];
  v_row record;
  v_released integer;
  v_count integer := 0;
  v_skipped integer := 0;
BEGIN
  IF v_uid IS NOT NULL AND NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  -- Explicit arguments are validated against the floors; NULL means "configured value"
  -- (floored too, so a bad direct edit of system_config cannot make the job over-eager).
  IF (p_hours IS NOT NULL AND p_hours < 6) OR (p_proof_hours IS NOT NULL AND p_proof_hours < 24) THEN
    RAISE EXCEPTION 'invalid_hours' USING ERRCODE = '22023';
  END IF;
  p_hours := COALESCE(p_hours, GREATEST(public._stock_policy_int('stock_unpaid_expiry_hours'), 6));
  p_proof_hours := COALESCE(p_proof_hours, GREATEST(public._stock_policy_int('stock_proof_expiry_hours'), 24));

  -- 1. Lock every candidate order first (skipping rows other transactions hold).
  SELECT array_agg(c.id ORDER BY c.id) INTO v_ids
    FROM (
      SELECT o.id
        FROM public.orders o
       WHERE o.stock_managed
         AND o.stock_reserved
         -- A pending branch only applies while the order still holds a 'reserved' allocation: a
         -- reopened order whose stock was already CONSUMED (cancelled without restock, then
         -- reopened) keeps stock_reserved = true but has nothing to release, and must not be
         -- cancelled as 'reservation_expired'.
         AND (
           -- orphan: cancelled but still holding a 'reserved' allocation
           (o.status = 'cancelled'
            AND EXISTS (SELECT 1 FROM public.order_stock_allocations a
                         WHERE a.order_id = o.id AND a.state = 'reserved'))
           OR (
             o.status = 'pending'
             AND EXISTS (SELECT 1 FROM public.order_stock_allocations a
                          WHERE a.order_id = o.id AND a.state = 'reserved')
             AND o.payment_status IN ('pending', 'rejected')
             AND GREATEST(
                   COALESCE(o.stock_reserved_at, o.created_at),
                   CASE WHEN o.payment_status = 'rejected'
                        THEN COALESCE(o.validated_at, '-infinity'::timestamptz)
                        ELSE '-infinity'::timestamptz END
                 ) < now() - make_interval(hours => p_hours)
           )
           OR (
             o.status = 'pending'
             AND EXISTS (SELECT 1 FROM public.order_stock_allocations a
                          WHERE a.order_id = o.id AND a.state = 'reserved')
             AND o.payment_status = 'proof_uploaded'
             AND COALESCE(o.stock_reserved_at, o.created_at)
                   < now() - make_interval(hours => p_proof_hours)
           )
         )
       ORDER BY o.id
         FOR UPDATE OF o SKIP LOCKED
    ) c;

  IF v_ids IS NULL THEN
    RETURN 0;
  END IF;

  -- 2. Then lock ALL their inventory rows in one globally ordered statement, so this
  --    batch job cannot deadlock against a concurrent multi-product reserve.
  PERFORM 1
     FROM public.inventory i
    WHERE i.id IN (
            SELECT a.inventory_id FROM public.order_stock_allocations a
             WHERE a.order_id = ANY (v_ids) AND a.state = 'reserved')
    ORDER BY i.id
      FOR UPDATE;

  -- 3. Cancel (when still unpaid) and release. Count only orders that actually changed.
  --    Each order runs in its own subtransaction: an order that cannot be expired (trigger
  --    failure, bad data) is skipped with a WARNING and rolled back alone, instead of
  --    aborting the whole sweep and starving every other order.
  FOR v_row IN
    SELECT o.id, o.status FROM public.orders o WHERE o.id = ANY (v_ids) ORDER BY o.id
  LOOP
    BEGIN
      IF v_row.status = 'pending' THEN
        UPDATE public.orders
           SET status = 'cancelled',
               payment_status = 'rejected',
               rejection_reason = 'reservation_expired',
               updated_at = now()
         WHERE id = v_row.id;
        PERFORM public._release_order_locked(v_row.id);
        v_count := v_count + 1;
      ELSE
        v_released := public._release_order_locked(v_row.id);
        IF v_released > 0 THEN
          v_count := v_count + 1;
        END IF;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_skipped := v_skipped + 1;
      RAISE WARNING 'expire_stale_order_reservations: order % skipped (%: %)', v_row.id, SQLSTATE, SQLERRM;
      -- The handler runs after the failed subtransaction was rolled back, so this row survives.
      INSERT INTO public.admin_destructive_ops_log (op_type, performed_by, details)
      VALUES ('stock_expiry_skipped', COALESCE(v_uid::text, 'system'),
              jsonb_build_object('order_id', v_row.id, 'sqlstate', SQLSTATE, 'sqlerrm', SQLERRM));
    END;
  END LOOP;

  -- One summary row per run that skipped something (clean runs write nothing). The integer
  -- return value stays "orders released/cancelled" for compatibility with the cron call.
  IF v_skipped > 0 THEN
    INSERT INTO public.admin_destructive_ops_log (op_type, performed_by, details)
    VALUES ('stock_expiry_run', COALESCE(v_uid::text, 'system'),
            jsonb_build_object('released', v_count, 'skipped', v_skipped));
  END IF;

  RETURN v_count;
END;
$function$;

REVOKE ALL ON FUNCTION public.reserve_order_inventory(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.release_order_inventory(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.consume_order_inventory(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.restock_order_inventory(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.expire_stale_order_reservations(integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reserve_order_inventory(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.release_order_inventory(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.consume_order_inventory(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.restock_order_inventory(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.expire_stale_order_reservations(integer, integer) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 6a. Cancel trigger: ANY path to status = 'cancelled' releases the reservation.
--     The owner can cancel with a plain UPDATE from the browser (the owner guard allows
--     it), so relying on a second client call left stranded stock whenever that call was
--     lost. The order row is already locked by the UPDATE, so the lock order
--     orders -> inventory is preserved. Consumed allocations are untouched.
--     (The expiry sweep still handles orphans created while triggers are disabled.)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.release_stock_on_order_cancel()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF NEW.stock_managed THEN
    -- Own subtransaction: a failing release must never make the owner's cancel fail. The
    -- failure is logged and the order stays cancelled with its reservation; the hourly
    -- expire_stale_order_reservations sweep heals that orphan.
    BEGIN
      PERFORM public._release_order_locked(NEW.id);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'release_stock_on_order_cancel: order % not released (%: %)', NEW.id, SQLSTATE, SQLERRM;
      INSERT INTO public.admin_destructive_ops_log (op_type, performed_by, details)
      VALUES ('stock_release_failed', COALESCE(auth.uid()::text, 'system'),
              jsonb_build_object('order_id', NEW.id, 'sqlstate', SQLSTATE, 'sqlerrm', SQLERRM));
    END;
  END IF;
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.release_stock_on_order_cancel() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS release_stock_on_order_cancel ON public.orders;
CREATE TRIGGER release_stock_on_order_cancel
  AFTER UPDATE OF status ON public.orders
  FOR EACH ROW
  WHEN (NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled')
  EXECUTE FUNCTION public.release_stock_on_order_cancel();

-- ----------------------------------------------------------------------------
-- 6b. order_items: end users can only add lines while the order is still a fresh
--     pending, unreserved order (createOrder inserts the items BEFORE reserving).
--     Prevents growing an order after its stock was reserved or its payment validated.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_order_items_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF current_user IN ('postgres', 'service_role', 'supabase_admin')
     OR auth.uid() IS NULL
     OR public.is_admin_user()
     OR public.is_super_admin() THEN
    RETURN NEW;
  END IF;

  -- FOR SHARE: the check and the insert are one atomic step against reserve/cancel, which
  -- take the order row FOR UPDATE (the FK key-share lock already conflicted with it;
  -- this makes the dependency explicit instead of incidental).
  PERFORM 1
     FROM public.orders o
    WHERE o.id = NEW.order_id
      AND o.status = 'pending'
      AND NOT o.stock_reserved
      FOR SHARE OF o;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_items_insert_forbidden: order is not an open unreserved order'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.guard_order_items_insert() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS guard_order_items_insert ON public.order_items;
CREATE TRIGGER guard_order_items_insert
  BEFORE INSERT ON public.order_items
  FOR EACH ROW EXECUTE FUNCTION public.guard_order_items_insert();

-- ----------------------------------------------------------------------------
-- 6c. (moved) The legacy owner INSERT policy inventory_movements_insert_own_order is NOT
--     dropped here any more: the previous front end still inserts movements through it, so
--     dropping it with this migration would break open tabs (version skew). It goes in
--     20261014210000_drop_movements_insert_policy.sql, applied after the front is deployed.
-- ----------------------------------------------------------------------------

-- ----------------------------------------------------------------------------
-- 7. Scheduling (NOT applied; owner approval required). pg_cron 1.6.4 is
--    installed on the project. Hourly sweep using the configured windows (48 h / 168 h by default):
--
-- SELECT cron.schedule(
--   'expire-stale-order-reservations',
--   '17 * * * *',
--   $$SELECT public.expire_stale_order_reservations()$$  -- no arguments: uses the configured windows
-- );
-- -- To remove:  SELECT cron.unschedule('expire-stale-order-reservations');
-- ----------------------------------------------------------------------------
