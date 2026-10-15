# Real-Postgres tests (concurrency + characterization)

Real concurrency tests for `reserve_order_inventory`, `release_order_inventory`,
`consume_order_inventory` and `expire_stale_order_reservations`
(`supabase/migrations/20261014190000_atomic_stock_reservation.sql`), plus
`zelleCharacterization.test.js`, which pins the CURRENT behavior of the live Zelle /
payment-method SQL (toggle + guards, `list_zelle_accounts_public`, computed usage and capacity,
orders owner guards, grants, trigger firing order) so later payment-method work cannot change it silently.

They run against a **local** scratch database only (the harness refuses any non-local host).
When the database is unreachable, is not a `papuenvios_test*` database, or lacks the objects a suite uses, that suite is
skipped and the reason is printed on stderr. **Set `DB_TESTS_REQUIRED=1` (CI) to make a skip a hard failure.**

## Prerequisites

- Docker with the local e2e Supabase Postgres container **running** (`supabase_db_e2e-supabase`, host port 55322).
  The bootstrap checks that the container really publishes that port.
- `psql` and `pg_dump` on the PATH (or Docker, used as a fallback for `pg_dump`).
- `npm install` (the harness uses `pg`; the connection-string guard uses `pg-connection-string`, a dependency of `pg`).

## Run

```bash
# 1. build the scratch DB `papuenvios_test` on the local Supabase Postgres container
#    (supabase_db_e2e-supabase, host port 55322). Idempotent, ~3 s. Never touches the hosted project.
npm run test:db:bootstrap              # add `-- --recreate` to drop and rebuild it

# 2. tests
npm run test:concurrency
```

`STOCK_TEST_DB_URL` overrides the connection string (must still point at localhost). The default
target is the local scratch database `papuenvios_test` on `127.0.0.1:55322` (credentials from
`TEST_DB_USER` / `TEST_DB_PASSWORD`, defaulting to the e2e container's); the shared `postgres`
database of the e2e container is no longer written to by these tests.

### What the bootstrap does (`scripts/test-db-bootstrap.sh`)

1. Creates the dedicated database (`papuenvios_test*` only; drops it only with `--recreate`).
2. Clones the schema (`public`, `auth`, `extensions`, `storage`, WITH privileges) from a schema source:
   `pg_dump --schema-only` of the `postgres` database of the local container (default), or a committed
   plain-SQL dump via `--schema-dump FILE`.
3. Replays `supabase/migrations/*.sql` in filename order **from `20261014180000` on** (`--replay-from`
   to change), stopping on the first error and naming the file. Replayed files are recorded in
   `test_bootstrap.replayed_migrations`.
4. Loads `scripts/test-db-seed.sql` (two e2e users, currencies, one category/product, `payment_methods` rows).

Safety: refuses any host other than 127.0.0.1 / localhost / ::1, a port other than 55322 unless
`--allow-nondefault-port`, and a `--source-db` that is not a bare identifier (libpq would treat `host=...` or a URI as a
full connection string and override the local host). A failed clone drops the partial database; a database without the
`test_bootstrap.clone_done` marker is refused (use `--recreate`). Replayed migrations are stored with a sha256 and a
changed file is refused (use `--recreate`). `--probe` replays EVERY migration into a throwaway `papuenvios_test_probe`
database, lists all failures and drops it.

The test side is guarded too: `localGuard.js` parses `STOCK_TEST_DB_URL` with the same parser as the driver and rejects
`?host=` / `?hostaddr=` overrides, any query string or fragment and non-local hosts (unit-tested without a database in
`src/tests/unit/dbHarnessLocalGuard.test.js`), and every connection must report a `papuenvios_test*` `current_database()`
because the tests delete rows.

### Replay window: what the clone has and what is replayed

Evidence gathered by replaying all 72 migrations on a fresh clone (`--probe`) and by catalog checks:

- Everything up to and including `20261014170000` is **already in the e2e clone** (verified: payment
  methods, computed Zelle usage, owner guards, atomic stock reservation functions, ledger safety net).
  Early migrations are NOT replayable (non-idempotent policies, `pg_cron` extension, `storage` seeds, etc.),
  and replaying older ones over a newer clone can DOWNGRADE a function (e.g. `20261014130000` over `20261014150000`).
- **Missing from the clone and replayed cleanly:** `20261014180000` (user_profiles role guard),
  `20261014210000` (drop movements insert policy), `20261015100000` (image migration backup).
  `20261014190000` and `20261014200000` are already present; replaying them is a harmless idempotent no-op.
- **Replayed below the window on purpose:** `20261014140000` (drops `zelle_accounts_select_active`; applied in
  production on 2026-10-15). It is listed in `ALWAYS_REPLAY` in `scripts/test-db-bootstrap.sh`.
- Gaps, stated honestly: (0) the `supabase_admin` bypass of the creation guard cannot be exercised (the `postgres` login
  cannot `SET ROLE supabase_admin`), and `service_role` has no table privileges on `orders`/`remittances` at all, so its
  bypass is unreachable by direct DML; both are noted in the tests; (a) data that old migrations INSERT is not in the structure-only clone, so the seed
  restates what the tests need (`payment_methods`); (b) the clone's `zelle_accounts` policies match production, because
  `20261014140000` is replayed (only `zelle_accounts_manage` remains); (c) the clone is Postgres 17.x, not 15.

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

Both migrations (`20261014190000`, `20261014200000`) are provided by the bootstrap; no manual apply step.
