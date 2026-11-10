# Plan: atomic stock reservation (orders + combos)

## Problem (evidence: orderService.js before this change)
Stock was read-modify-write in the client. No availability check at createOrder, double release on cancel,
combos not reserved until validatePayment, reopenOrder did not re-reserve.
Remote state at 2026-10-14: inventory 69 rows (1 per product, all products have one), reserved_quantity total 0,
no open orders holding stock, no negative availability, no multi-batch products => no data migration needed.
Extra finding: 124/124 product order_items have inventory_id NULL (cart items never carry it), and order item
"COMBO 10" (2026-10-12) is a combo_products id stored with item_type = 'product' (ProductDetailPage added combos
without `type`).

## Decision (owner, 2026-10-14)
Reserve at order creation, consume at validated payment, unpaid reservations expire. Orders created before the
cutover are NOT decremented at validation (their sales were adjusted by hand).

## Design (as implemented)
1. inventory CHECK (reserved_quantity <= quantity) (0 violating rows on remote).
2. orders.stock_managed (cutover marker; backfill false, default true), stock_reserved, stock_reserved_at.
   DEVIATION from the first draft (single flag): a managed order whose reserve call was lost must not look legacy.
3. order_stock_allocations (order, inventory batch, qty, state reserved|consumed|released), RLS select owner/admin.
4. RPCs SECURITY DEFINER, search_path=public, EXECUTE authenticated + service_role only:
   reserve (pending only; cancels the order itself with rejection_reason insufficient_stock | invalid_item, no RAISE),
   release (cancelled orders only), consume (admin; payment validated; reserve+consume if never reserved),
   expire_stale_order_reservations (admin/service; unpaid pending + rejected older than N h; sweeps cancelled orphans).
   Lock order everywhere: orders row -> inventory rows ORDER BY id. FEFO: expiry ASC NULLS LAST, created_at, id.
   DEVIATION from the first draft ("single RPC, RAISE"): createOrder inserts order+items, then calls reserve.
5. Front: createOrder -> reserve (typed INSUFFICIENT_STOCK error, CartPage toast); cancel/cancelByUser -> release
   (best effort, sweep heals); rejectPayment does NOT release (order stays pending for retry); validatePayment ->
   consume (reverts the status update if consume fails); reopen/reopenByAdmin -> re-reserve or refuse.
6. Combo mislabeled as product: fixed at source (ProductDetailPage sets type), in CartPage (resolveCartItemType)
   and tolerated server-side (a 'product' item whose id is a combo is expanded as a combo).

## Open decisions for the owner
- cancelOrder on a PROCESSING (already consumed) order does not restock. Needs an explicit restock action.
- Expiry window (48 h default) and scheduling (pg_cron snippet is commented in the migration).
- Expired/closed batches are still allocatable (FEFO only, no expiry_date filter).

## TDD / verification
- npm run test:concurrency (local Supabase, README in src/tests/concurrency).
- Vitest: orderService.stockReservation, CartPage.stockReservation, stockReservationMigration.
- Before applying on remote: SELECT-only probes (see report), then a separate explicit "dale".
