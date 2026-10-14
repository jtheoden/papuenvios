# Stock reservation concurrency tests

Real concurrency tests for `reserve_order_inventory`, `release_order_inventory`,
`consume_order_inventory` and `expire_stale_order_reservations`
(`supabase/migrations/20261014190000_atomic_stock_reservation.sql`).

They run against the **local** Supabase Postgres only (the harness refuses any non-local host).
When the database is unreachable the whole suite is skipped with a warning.

## Run

```bash
# 1. local stack (docker container supabase_db_e2e-supabase, host port 55322)
src/tests/e2e/stack/e2e-stack.sh start      # schema snapshot + e2e users/currency/product seed

# 2. apply the migration to the LOCAL db (idempotent; never the hosted project)
PGPASSWORD=postgres psql -h 127.0.0.1 -p 55322 -U postgres -d postgres -v ON_ERROR_STOP=1 \
  -f supabase/migrations/20261014190000_atomic_stock_reservation.sql

# 3. tests
npm run test:concurrency
```

`STOCK_TEST_DB_URL` overrides the connection string (must still point at localhost).

## How it works

- Every worker is its own `pg` connection with `SET ROLE authenticated` and a
  `request.jwt.claims` setting (`sub` = the seeded customer / admin), so the
  owner/admin checks and the `orders` owner guards behave like a PostgREST call.
- `fireTogether` releases all workers at the same instant: the controller holds an
  exclusive advisory lock, each worker blocks on a shared lock in the same statement
  as the RPC, and the controller unlocks once all workers are parked.
- Fixtures are seeded as `postgres` with random UUIDs and removed after each test.
- `__test_admin_cancel(uuid)` is a helper function created in `beforeAll` and dropped
  in `afterAll` (status update + release in one transaction, as an admin cancel).

## Prerequisites on the local schema

Requires the seeded e2e users (`e2e.customer@example.test`, `e2e.admin@example.test`) and one
product (for `category_id` / `base_currency_id`). The local schema snapshot must contain
`orders`, `order_items`, `inventory`, `inventory_movements`, `combo_products`, `combo_items`,
`user_profiles` and the `is_admin_user()` / `is_super_admin()` helpers.

## Release gate: scheduling

The migration does NOT schedule `expire_stale_order_reservations`. Without the pg_cron job (commented snippet at the end of the migration, needs owner approval) reservations never expire and abandoned orders hold stock forever. Scheduling is a RELEASE GATE.

## Configurable policy (approved defaults)

Stored in `system_config` (`stock_unpaid_expiry_hours` 48, `stock_proof_expiry_hours` 168, `stock_max_open_reservations` 5), read by `reserve_order_inventory` and `expire_stale_order_reservations()` (no arguments = configured values), changed only through `set_stock_policy` / `reset_stock_policy` (super_admin) and shown in Settings -> System. `stockPolicy.test.js` covers it. The tests restore the defaults after each case.

## Ledger

`inventory_movements` is a ledger: for every inventory row `SUM(quantity_change)` equals the change in `inventory.quantity` and `SUM(reserved_change)` the change in `inventory.reserved_quantity` (reserve 0/+q, release 0/-q, sold -q/-q, restocked +q/0). The suite asserts it after a mix of reserve/release/consume/restock/expire.

Since `20261014200000_product_delete_safety_and_ledger.sql` there is a safety net: any write to `inventory.quantity` / `reserved_quantity` made outside the stock RPCs (the RPCs raise the transaction-local flag `app.stock_rpc`) is ledgered as an `adjustment` movement (`initial batch` on insert, `manual edit` on update), so direct edits from the app no longer drift the ledger. Limits, stated honestly:

- Batches that existed before the migration have no opening movement (the table was empty on remote and is not backfilled): for them the sums reproduce the changes since the migration, not the whole quantity. Batches created afterwards (including every test fixture) are complete from their `initial batch` row.
- Editing `reserved_quantity` outside the RPCs is refused (42501) for app roles; `postgres` / `service_role` can still do it (it is ledgered).
- Deleting a batch writes a snapshot to `admin_destructive_ops_log` (op_type `inventory_batch_deleted`), not a movement (FK). Deleting a product still deletes its movements first; the snapshot is what survives.
- `order_stock_allocations.inventory_id` is `ON DELETE CASCADE`: deleting a batch erases its allocation rows. `get_product_blockers` (used by preview, bulk delete and the front end) blocks deleting a product while any order that is not dispatched / delivered / completed / cancelled references it (directly, through a combo, or via inventory_id) or while any order still holds a `reserved` allocation on it; `consumed` allocations never block.

Files: `stockReservation.test.js` (core), `stockReservationHardening.test.js` (cancel trigger, sweep isolation, clamped release, audit, bounds), `stockPolicy.test.js`, `productDeleteAndLedger.test.js` (delete predicate, ledger net, platform reset still works inside a rolled-back transaction).

Apply BOTH migrations to the local DB, in order (`20261014190000` then `20261014200000`), before running the suite.
