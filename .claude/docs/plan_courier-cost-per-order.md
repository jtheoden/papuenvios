# Plan: courier (mensajería) cost per order

Branch: `feat/courier-cost-per-order`. Status: implemented locally, NOT applied to prod, NOT committed.

## Business request (owner, literal)
Register the courier expense, show how much belongs to the courier and how much profit remains, keep it in the accounting and visible to the admin. If the tariff depends on the municipality, configure it in "Tarifas de mensajería" and apply it once per order. Owner confirmed: `shipping_zones.transport_cost` is in USD and per municipality.

## Decisions
1. No per-product cost. The cost is `shipping_zones.transport_cost` of the order's zone, applied once per order.
2. Snapshot table `order_courier_costs` (order_id PK, ON DELETE CASCADE; shipping_zone_id; amount_usd NULL-able; created_at) filled by an AFTER INSERT trigger on `orders` (SECURITY DEFINER, pinned search_path, EXECUTE revoked). Why a snapshot and not a join to the live zone: a later tariff change would rewrite history.
3. Visibility: admin and customer share the `authenticated` role, so RLS on `(SELECT is_admin_user())`; no INSERT/UPDATE/DELETE privilege for API roles; anon has nothing; not in realtime. Customers do not see even the cost of their own order.
4. `amount_usd` NULL means "no tariff configured for the zone" (unknown), stored for NULL / 0 / missing transport_cost. The Dashboard never turns NULL into 0.
5. Trigger never breaks checkout: `EXCEPTION WHEN OTHERS` -> WARNING in the Postgres log, order is created without cost row. Tested by forcing a failing CHECK on the table.
6. No backfill of the 31 existing orders: today's tariff is not the historical one. They show up as "without recorded tariff".
7. Reuse check: `operational_costs` (0 rows) models fixed periodic costs with no order link; `order_analytics` is a read view. Neither fits a per-order snapshot.
8. No extra index: the Dashboard reads the whole table (one row per order, 31 today) and the PK covers the lookup.
9. No FK on `shipping_zone_id`: `orders.shipping_zone_id` already has an FK (NO ACTION), so a zone in use cannot be deleted and a dangling id cannot reach the trigger.
10. Dashboard: the old card "Costos de transporte" (sum of `orders.shipping_cost`, i.e. what the customer paid) is renamed "Envío cobrado a clientes" with the same numbers. New card "Costo de mensajería" with, for day/month/year (same active-orders filter and rolling windows as `sumActiveSince`): shipping charged, courier cost, charged minus courier, and the number of orders without a recorded tariff. Read error -> `role="alert"` unavailable message, no figures.
11. Currency: the Dashboard shows everything in the base currency without conversion; prod base currency is USD (verified), `transport_cost` is USD, so the figure is shown with the same symbol as the rest. If the base currency ever stops being USD this card (and the rest of the Dashboard) needs a real conversion; out of scope.
12. platform reset: `execute_platform_reset` does `DELETE FROM orders`; cost rows disappear through the cascade. The function is not changed. `guard_reset_lock_orders` is BEFORE INSERT and runs before the new AFTER INSERT trigger. Tested by running `execute_platform_reset` in a rolled-back transaction.

## OPEN DECISION FOR THE OWNER (not decided by the code)
Should the shipping charged to the customer offset the courier cost in the "estimated net profit"? Today `estimateOrderProfit` excludes shipping entirely, and the net profit does NOT subtract the courier. The Dashboard therefore shows three separate figures (charged, courier, difference) and leaves the net profit untouched. Options: (a) keep as is; (b) net profit += charged - courier; (c) net profit -= courier only. 26 of 31 orders charged 0 shipping, so the choice moves the numbers materially. Needs the owner's answer before touching `estimateOrderProfit`.

## Devil's advocate
- "The client picks the zone, so the cost can be gamed." True: `shipping_zone_id` comes from the client INSERT; the recorded cost follows the zone picked. Effect is accounting-only (no money moves) and is closed by F4a (server-side order creation). The later zone change is ignored on purpose (snapshot).
- "Historical orders are missing." By design (decision 6); shown as unrecorded, never as 0. If the owner wants a one-off estimate it is a separate, explicit data-fix decision.
- "NULL vs 0." A zone without tariff stores NULL; a recorded 0 cannot happen (0 is stored as NULL) because "tariff 0" and "tariff not set" are indistinguishable in `shipping_zones`. The Dashboard counts NULL and missing rows as unrecorded.
- "Tariff changes later." The snapshot does not change (tested).
- "Cancelled orders." They keep their row but are excluded from every sum (only processing/dispatched/delivered/completed count), like revenue and shipping charged. If an order is cancelled after being dispatched the courier may still have been paid; not modelled.
- "Remittances." Out of scope: remittances have no courier flow here (remittanceService also sends a `shipping_zone_id`, but the trigger is on `orders` only).
- "Orders created by an admin on behalf of a client, or in other currencies." Same path (INSERT into orders); the amount is always USD from the zone.
- "Realtime." The table is not published; the Dashboard already refetches on the orders realtime event, and the AFTER INSERT row is committed with the order.
- "Customers reading costs through RLS joins." Policy requires `is_admin_user()`; tested for the owner of the order.

## Files
- `supabase/migrations/20261019140000_order_courier_costs.sql`
- `src/lib/courierCostService.js` (new), `src/lib/dashboardMetrics.js` (`computeCourierCostTotals`), `src/components/DashboardPage.jsx`
- `src/translations/{ES,EN}.json` (`dashboard.shippingCollected`, `dashboard.courier.*`; `dashboard.transportCosts` removed, it had a single use)
- Tests: `src/tests/concurrency/orderCourierCosts.test.js`, `src/tests/unit/courierCosts.test.js`, `src/tests/unit/DashboardPage.courierCost.test.jsx`

## Apply order and "dales" needed
1. Owner "dale" to apply the migration to prod (separate action; not done here). Apply BEFORE merging/deploying the front: the Dashboard reads `order_courier_costs` and would show "unavailable" until then.
2. Merge the front PR and deploy.
3. Post-apply check (SELECT only): the table exists, RLS on, one policy; `SELECT count(*) FROM order_courier_costs` = 0 right after apply (no backfill); create/observe a real order and see one row; as a customer the table returns 0 rows.
4. Owner answers the open decision above.

## Rollback
`DROP TRIGGER IF EXISTS order_courier_cost_snapshot ON public.orders; DROP FUNCTION IF EXISTS public.snapshot_order_courier_cost(); DROP TABLE IF EXISTS public.order_courier_costs;` Front without the table shows the unavailable message, nothing else breaks.
