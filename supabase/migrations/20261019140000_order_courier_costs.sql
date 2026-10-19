-- Courier (mensajeria) cost per order: an admin-only snapshot taken when the order is created.
--
-- WHY: the owner wants to see what each delivery costs the business and what is left after paying the courier.
--   shipping_zones.transport_cost (USD, per municipality, confirmed by the owner) holds the courier tariff, but
--   nothing recorded it per order, so it could not be accounted for. Changing a tariff later would also rewrite
--   history if the Dashboard joined the live zone. The cost is therefore copied ONCE per order, at creation.
--
-- WHAT:
--   1. public.order_courier_costs(order_id PK -> orders ON DELETE CASCADE, shipping_zone_id, amount_usd, created_at).
--      amount_usd NULL = "the zone had no courier tariff configured" (unknown), which is NOT the same as 0.
--   2. AFTER INSERT trigger on public.orders -> snapshot_order_courier_cost() (SECURITY DEFINER) inserts the row
--      for orders that carry a shipping_zone_id. NULL amount when the zone is missing or transport_cost is NULL/<=0.
--      The function swallows its own errors (WARNING only): this is accounting, it must never break checkout.
--   3. Visibility: admin and customer share the `authenticated` DB role, so a column grant cannot separate them.
--      RLS ON, one SELECT policy on (SELECT is_admin_user()); no INSERT/UPDATE/DELETE privilege for any API role
--      (only the definer trigger writes). Customers (even for their own order) and anon read nothing.
--
-- DESIGN NOTES
--   * No backfill: the 31 existing orders stay "not recorded" (the current tariff is not the historical one;
--     inventing history would be wrong). The Dashboard counts them as "without courier tariff recorded".
--   * Not reusing operational_costs (0 rows in prod): that table models fixed periodic costs, a different concept
--     (no order link). Not reusing the order_analytics view: it is a read model, not a store.
--   * No FK from shipping_zone_id to shipping_zones: orders.shipping_zone_id already has one (NO ACTION, verified in
--     prod), so a zone in use cannot be deleted and a dangling zone id cannot reach the trigger; the copy stays plain data.
--   * Not added to supabase_realtime (the Dashboard refetches on the orders realtime event it already has).
--   * No extra index: the Dashboard reads the table whole (one row per order) and the PK covers the join.
--   * LIMIT (accounting only, closed by F4a): shipping_zone_id is sent by the client in the order INSERT, so the
--     recorded cost follows the zone the client picked. The zone swap after creation is intentionally ignored.
--   * Cancelled orders keep their row; the Dashboard only sums active orders, like every other figure.
--   * platform reset: execute_platform_reset() does DELETE FROM orders; the cost rows go with them through the
--     ON DELETE CASCADE, so the reset function needs no change. guard_reset_lock_orders (BEFORE INSERT) runs
--     before this AFTER INSERT trigger and is unaffected.
--
-- Prod verification (read only SELECTs, 2026-10-19, project qcwnlbpultscerwdnzbm):
--   shipping_zones 26 rows, 6 with transport_cost > 0; orders 31, all with shipping_zone_id; no table matching
--   '%courier%'; operational_costs 0 rows; orders triggers (12): audit_order_status, guard_bizum_quote_immutable,
--   guard_order_offer_id, guard_orders_owner_insert, guard_orders_owner_update, guard_orders_stock_columns,
--   guard_payment_method_enabled, guard_reset_lock_orders, release_stock_on_order_cancel, seal_bizum_payment,
--   trigger_set_order_number, trigger_update_orders_updated_at (none named order_courier_cost_snapshot);
--   supabase_realtime holds only orders and remittances; base currency is USD.
--
-- Apply BEFORE merging the Dashboard change (the Dashboard reads this table). Idempotent.
--
-- ROLLBACK (exact; the table holds only derived accounting data):
--   DROP TRIGGER IF EXISTS order_courier_cost_snapshot ON public.orders;
--   DROP FUNCTION IF EXISTS public.snapshot_order_courier_cost();
--   DROP TABLE IF EXISTS public.order_courier_costs;

SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.order_courier_costs (
  order_id         uuid PRIMARY KEY REFERENCES public.orders(id) ON DELETE CASCADE,
  shipping_zone_id uuid,
  amount_usd       numeric(12,2) CHECK (amount_usd IS NULL OR amount_usd >= 0),
  created_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.order_courier_costs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.order_courier_costs FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.order_courier_costs TO authenticated;

DROP POLICY IF EXISTS order_courier_costs_select_admin ON public.order_courier_costs;
CREATE POLICY order_courier_costs_select_admin ON public.order_courier_costs
  FOR SELECT TO authenticated
  USING ((SELECT public.is_admin_user()));

CREATE OR REPLACE FUNCTION public.snapshot_order_courier_cost()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF NEW.shipping_zone_id IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.order_courier_costs (order_id, shipping_zone_id, amount_usd)
  SELECT NEW.id,
         NEW.shipping_zone_id,
         (SELECT CASE WHEN z.transport_cost > 0 THEN round(z.transport_cost, 2) END
            FROM public.shipping_zones z WHERE z.id = NEW.shipping_zone_id)
  ON CONFLICT (order_id) DO NOTHING;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Accounting data must never break checkout.
  RAISE WARNING 'snapshot_order_courier_cost failed for order %: % (%)', NEW.id, SQLERRM, SQLSTATE;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.snapshot_order_courier_cost() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS order_courier_cost_snapshot ON public.orders;
CREATE TRIGGER order_courier_cost_snapshot
  AFTER INSERT ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.snapshot_order_courier_cost();
