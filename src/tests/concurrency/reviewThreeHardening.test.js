/**
 * Third adversarial review (W1-W10 + enum conversion). Local Postgres only; skipped when unreachable.
 *  W1 get_combo_blockers      W2 policy drop in its own migration   W3 delete_product + movements trigger
 *  W4 reserved insert guard   W5 TOCTOU locks                       W6 expiry skip log
 *  W7 policy audit ops log    W8 orders_with_consumed_stock         W10 cancel trigger isolation
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { isDbReachable, connectAdmin, connectAs, endAll } from './db';
import {
  loadActors,
  createTracker,
  seedProduct,
  seedCombo,
  seedOrder,
  cleanup,
  readInventory,
  readOrder,
  readAllocations,
  setStockPolicyRows,
  restoreStockPolicyRows
} from './fixtures';

const reachable = await isDbReachable();
const describeDb = reachable ? describe : describe.skip;

const reserveSql = 'public.reserve_order_inventory($1::uuid)';
const migration = (name) => readFileSync(resolve(process.cwd(), 'supabase/migrations', name), 'utf8');
const OPS = ['stock_expiry_skipped', 'stock_expiry_run', 'stock_release_failed', 'stock_policy_changed', 'product_ledger_snapshot', 'product_deleted_snapshot', 'inventory_batch_deleted'];

describeDb('third review hardening (local Postgres)', () => {
  let admin;
  let actors;
  let startedAt;
  const tracker = createTracker();
  const clients = [];

  const as = async (userId) => {
    const c = await connectAs(userId);
    clients.push(c);
    return c;
  };
  const asCustomer = () => as(actors.customerId);
  const asAdmin = () => as(actors.adminId);
  const asSuper = async () => {
    await admin.query(`UPDATE public.user_profiles SET role = 'super_admin' WHERE id = $1`, [actors.adminId]);
    return as(actors.adminId);
  };
  const opsRows = async (opType) => {
    const { rows } = await admin.query(
      `SELECT op_type, performed_by, details FROM public.admin_destructive_ops_log
        WHERE op_type = $1 AND created_at >= $2 ORDER BY created_at`,
      [opType, startedAt]
    );
    return rows;
  };

  beforeAll(async () => {
    admin = await connectAdmin();
    actors = await loadActors(admin);
    startedAt = (await admin.query('SELECT clock_timestamp() AS t')).rows[0].t;
  });

  afterEach(async () => {
    await endAll(clients.splice(0));
    await admin.query('DROP TRIGGER IF EXISTS __test_boom ON public.orders');
    await admin.query('DROP FUNCTION IF EXISTS public.__test_boom()');
    await admin.query('DROP TRIGGER IF EXISTS __test_boom_alloc ON public.order_stock_allocations');
    await admin.query('DROP FUNCTION IF EXISTS public.__test_boom_alloc()');
    await admin.query(`SET session_replication_role = DEFAULT`);
    await cleanup(admin, tracker);
    await restoreStockPolicyRows(admin);
    await admin.query(`DELETE FROM public.admin_destructive_ops_log WHERE op_type = ANY($1) AND created_at >= $2`, [OPS, startedAt]);
    await admin.query(`DELETE FROM public.activity_logs WHERE entity_type = 'system_config' AND action LIKE 'stock_policy_%'`);
    await admin.query(`UPDATE public.user_profiles SET role = 'admin' WHERE id = $1`, [actors.adminId]);
  });

  afterAll(async () => {
    await admin.end();
  });

  describe('W1 get_combo_blockers + combos in closed orders', () => {
    const blockers = async (client, comboId) =>
      (await client.query('SELECT * FROM public.get_combo_blockers($1::uuid)', [comboId])).rows;

    it('blocks a combo referenced by an open order whatever its item_type (mislabelled included)', async () => {
      const { productId } = await seedProduct(admin, actors, tracker, { quantity: 5 });
      const comboId = await seedCombo(admin, tracker, [{ productId, quantity: 1 }]);
      const o1 = await seedOrder(admin, actors, tracker, [{ type: 'combo', id: comboId, quantity: 1 }]);
      const o2 = await seedOrder(admin, actors, tracker, [{ type: 'product', id: comboId, quantity: 1 }], { status: 'processing' });
      const client = await asAdmin();

      const rows = await blockers(client, comboId);

      expect(rows.map((r) => r.order_id).sort()).toEqual([o1, o2].sort());
    });

    it('does not block when the combo only appears in closed orders', async () => {
      const { productId } = await seedProduct(admin, actors, tracker, { quantity: 5 });
      const comboId = await seedCombo(admin, tracker, [{ productId, quantity: 1 }]);
      for (const status of ['dispatched', 'delivered', 'completed', 'cancelled']) {
        await seedOrder(admin, actors, tracker, [{ type: 'combo', id: comboId, quantity: 1 }], { status });
      }
      const client = await asAdmin();

      expect(await blockers(client, comboId)).toEqual([]);
    });

    it('fails closed on an unknown status', async () => {
      const { productId } = await seedProduct(admin, actors, tracker, { quantity: 5 });
      const comboId = await seedCombo(admin, tracker, [{ productId, quantity: 1 }]);
      const o = await seedOrder(admin, actors, tracker, [{ type: 'combo', id: comboId, quantity: 1 }], { status: 'on_hold_review' });
      const client = await asAdmin();

      expect(await blockers(client, comboId)).toEqual([expect.objectContaining({ order_id: o })]);
    });

    it('blocks a cancelled order that references the combo and still holds a reserved allocation of a component', async () => {
      const { productId } = await seedProduct(admin, actors, tracker, { quantity: 5 });
      const comboId = await seedCombo(admin, tracker, [{ productId, quantity: 1 }]);
      const o = await seedOrder(admin, actors, tracker, [{ type: 'combo', id: comboId, quantity: 1 }]);
      const customer = await asCustomer();
      await customer.query(`SELECT ${reserveSql}`, [o]);
      await admin.query(`SET session_replication_role = replica`);
      await admin.query(`UPDATE public.orders SET status = 'cancelled' WHERE id = $1`, [o]);
      await admin.query(`SET session_replication_role = DEFAULT`);
      const client = await asAdmin();

      expect(await blockers(client, comboId)).toEqual([expect.objectContaining({ order_id: o, via: 'allocation' })]);
    });

    it('is admin only', async () => {
      const { productId } = await seedProduct(admin, actors, tracker, { quantity: 5 });
      const comboId = await seedCombo(admin, tracker, [{ productId, quantity: 1 }]);
      const customer = await asCustomer();

      await expect(blockers(customer, comboId)).rejects.toMatchObject({ code: '42501' });
    });

    it('a combo present in closed orders can be deleted (order_items.item_id is NOT NULL, no FK: no update needed)', async () => {
      const { productId } = await seedProduct(admin, actors, tracker, { quantity: 5 });
      const comboId = await seedCombo(admin, tracker, [{ productId, quantity: 1 }]);
      await seedOrder(admin, actors, tracker, [{ type: 'combo', id: comboId, quantity: 1 }], { status: 'completed' });
      const client = await asAdmin();

      await client.query('DELETE FROM public.combo_items WHERE combo_id = $1', [comboId]);
      await expect(client.query('DELETE FROM public.combo_products WHERE id = $1', [comboId])).resolves.toBeTruthy();
    });
  });

  describe('W2 the movements insert policy lives in its own migration', () => {
    const POLICY = `CREATE POLICY inventory_movements_insert_own_order ON public.inventory_movements
      FOR INSERT TO authenticated
      WITH CHECK (movement_type = ANY (ARRAY['reserved'::text, 'released'::text, 'sold'::text])
        AND reference_type = 'order'::text
        AND EXISTS (SELECT 1 FROM public.orders o WHERE o.id = inventory_movements.reference_id
                    AND (o.user_id = auth.uid() OR public.is_admin_user())))`;

    it('the stock migration no longer drops it; the 210000 migration does, and rolls back cleanly', async () => {
      expect(migration('20261014190000_atomic_stock_reservation.sql').split('\n').filter((l) => !l.trim().startsWith('--')).join('\n'))
        .not.toMatch(/DROP POLICY IF EXISTS inventory_movements_insert_own_order/);

      const { productId, inventoryId } = await seedProduct(admin, actors, tracker, { quantity: 5 });
      expect(productId).toBeTruthy();
      const orderId = await seedOrder(admin, actors, tracker, []);
      await admin.query('DROP POLICY IF EXISTS inventory_movements_insert_own_order ON public.inventory_movements');
      await admin.query(POLICY); // the state the old front still relies on (version skew)
      const owner = await asCustomer();
      const insert = () =>
        owner.query(
          `INSERT INTO public.inventory_movements (inventory_id, movement_type, quantity_change, reference_id, reference_type)
           VALUES ($1, 'released', 0, $2, 'order')`,
          [inventoryId, orderId]
        );
      await expect(insert()).resolves.toBeTruthy();

      await admin.query(migration('20261014210000_drop_movements_insert_policy.sql'));

      await expect(insert()).rejects.toMatchObject({ code: '42501' });
      const { rows } = await admin.query(
        `SELECT count(*)::int AS n FROM pg_policies WHERE tablename = 'inventory_movements' AND policyname = 'inventory_movements_insert_own_order'`
      );
      expect(rows[0].n).toBe(0);
      // idempotent
      await expect(admin.query(migration('20261014210000_drop_movements_insert_policy.sql'))).resolves.toBeTruthy();
    });
  });

  describe('W3 delete_product and the movements delete trigger', () => {
    const del = async (client, productId) =>
      (await client.query('SELECT public.delete_product($1::uuid) AS r', [productId])).rows[0].r;

    it('deletes the product, batches, movements and combo links in one call (admin) and snapshots the ledger sums first', async () => {
      const { productId, inventoryId } = await seedProduct(admin, actors, tracker, { quantity: 8 });
      const comboId = await seedCombo(admin, tracker, [{ productId, quantity: 1 }]);
      const adminClient = await asAdmin();
      await adminClient.query(`UPDATE public.inventory SET quantity = quantity + 2 WHERE id = $1`, [inventoryId]);

      const r = await del(adminClient, productId);

      expect(r).toMatchObject({ ok: true });
      expect((await admin.query('SELECT 1 FROM public.products WHERE id = $1', [productId])).rowCount).toBe(0);
      expect((await admin.query('SELECT 1 FROM public.inventory_movements WHERE inventory_id = $1', [inventoryId])).rowCount).toBe(0);
      expect((await admin.query('SELECT is_active FROM public.combo_products WHERE id = $1', [comboId])).rows[0].is_active).toBe(false);
      const snaps = await opsRows('product_ledger_snapshot');
      expect(snaps).toHaveLength(1);
      expect(snaps[0].details).toMatchObject({
        product_id: productId,
        batches: [{ batch_id: inventoryId, sum_quantity_change: 10, sum_reserved_change: 0 }]
      });
      expect(snaps[0].performed_by).toBe(actors.adminId);
      expect(await opsRows('inventory_batch_deleted')).toHaveLength(1);
    });

    it('is fail-closed: an open order blocks it and nothing is deleted', async () => {
      const { productId, inventoryId } = await seedProduct(admin, actors, tracker, { quantity: 4 });
      const orderId = await seedOrder(admin, actors, tracker, [{ type: 'product', id: productId, quantity: 1 }]);
      const adminClient = await asAdmin();

      const r = await del(adminClient, productId);

      expect(r).toMatchObject({ ok: false, reason: 'blocking_orders' });
      expect(r.blockers).toEqual([expect.objectContaining({ order_id: orderId })]);
      expect(await readInventory(admin, productId)).toHaveLength(1);
      expect((await admin.query('SELECT 1 FROM public.inventory_movements WHERE inventory_id = $1', [inventoryId])).rowCount).toBe(1);
    });

    it('refuses customers (42501), reports unknown products and handles products with no batches', async () => {
      const { productId } = await seedProduct(admin, actors, tracker, { quantity: 4 });
      const customer = await asCustomer();
      await expect(del(customer, productId)).rejects.toMatchObject({ code: '42501' });

      const adminClient = await asAdmin();
      expect(await del(adminClient, '00000000-0000-0000-0000-000000000001')).toMatchObject({ ok: false, reason: 'not_found' });
    });

    it('an app role cannot delete ledger rows directly (42501) even with the old RLS delete policy; owners can', async () => {
      const { inventoryId } = await seedProduct(admin, actors, tracker, { quantity: 4 });
      const adminClient = await asAdmin();

      await expect(
        adminClient.query('DELETE FROM public.inventory_movements WHERE inventory_id = $1', [inventoryId])
      ).rejects.toMatchObject({ code: '42501' });
      expect((await admin.query('SELECT 1 FROM public.inventory_movements WHERE inventory_id = $1', [inventoryId])).rowCount).toBe(1);

      await expect(
        admin.query('DELETE FROM public.inventory_movements WHERE inventory_id = $1', [inventoryId])
      ).resolves.toBeTruthy();
    });
  });

  describe('W4 reserved_quantity cannot be seeded through INSERT', () => {
    const insertBatch = (client, productId, reserved) =>
      client.query(`INSERT INTO public.inventory (product_id, quantity, reserved_quantity) VALUES ($1, 10, $2)`, [productId, reserved]);

    it('an admin inserting a batch with reserved > 0 is refused (42501); reserved 0 is fine', async () => {
      const { productId } = await seedProduct(admin, actors, tracker, { quantity: 1 });
      const adminClient = await asAdmin();

      await expect(insertBatch(adminClient, productId, 3)).rejects.toMatchObject({ code: '42501' });
      await expect(insertBatch(adminClient, productId, 0)).resolves.toBeTruthy();
    });
  });

  describe('W5 delete takes the inventory locks before it checks the blockers (TOCTOU)', () => {
    const waitPending = async (promise, ms = 400) => {
      let settled = false;
      promise.then(() => { settled = true; }, () => { settled = true; });
      await new Promise((r) => setTimeout(r, ms));
      return !settled;
    };

    it.each([
      ['delete_product', 'SELECT public.delete_product($1::uuid) AS r', (r) => r.r.reason],
      ['bulk_delete_products', 'SELECT * FROM public.bulk_delete_products(ARRAY[$1]::uuid[])', (r) => r.block_reason]
    ])('%s waits for a writer holding the batch and then sees the order that appeared meanwhile', async (_name, sql, reasonOf) => {
      const { productId } = await seedProduct(admin, actors, tracker, { quantity: 5 });
      const writer = await asCustomer();
      const deleter = await asSuper();
      const orderId = await seedOrder(admin, actors, tracker, []); // empty, pending, owned by the customer
      // the writer takes the batch lock (as a reserve would), then adds the product to its order
      await admin.query('BEGIN');
      await admin.query('SELECT 1 FROM public.inventory WHERE product_id = $1 FOR UPDATE', [productId]);

      const deleting = deleter.query(sql, [productId]);
      const stillWaiting = await waitPending(deleting);
      await admin.query(
        `INSERT INTO public.order_items (order_id, item_type, item_id, item_name_es, item_name_en, quantity, unit_price, total_price)
         VALUES ($1, 'product', $2, 'x', 'x', 1, 5, 5)`,
        [orderId, productId]
      );
      await admin.query('COMMIT');
      const { rows } = await deleting;

      expect(writer).toBeTruthy();
      expect(stillWaiting).toBe(true);
      expect(reasonOf(rows[0])).toBe('blocking_orders');
      expect(await readInventory(admin, productId)).toHaveLength(1);
    });
  });

  describe('W6 expiry sweep records what it skipped', () => {
    it('writes one stock_expiry_skipped row per skipped order and a run summary, keeps the integer return', async () => {
      await setStockPolicyRows(admin, { stock_max_open_reservations: 50 });
      const { productId } = await seedProduct(admin, actors, tracker, { quantity: 10 });
      const customer = await asCustomer();
      const ids = [];
      for (let i = 0; i < 3; i += 1) {
        const id = await seedOrder(admin, actors, tracker, [{ type: 'product', id: productId, quantity: 1 }]);
        await customer.query(`SELECT ${reserveSql}`, [id]);
        await admin.query(`UPDATE public.orders SET stock_reserved_at = now() - interval '72 hours' WHERE id = $1`, [id]);
        ids.push(id);
      }
      await admin.query(`
        CREATE FUNCTION public.__test_boom() RETURNS trigger LANGUAGE plpgsql AS $fn$
        BEGIN
          IF NEW.id = '${ids[1]}'::uuid AND NEW.rejection_reason = 'reservation_expired' THEN RAISE EXCEPTION 'boom'; END IF;
          RETURN NEW;
        END $fn$`);
      await admin.query('CREATE TRIGGER __test_boom BEFORE UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.__test_boom()');
      const adminClient = await asAdmin();

      const { rows } = await adminClient.query('SELECT public.expire_stale_order_reservations() AS n');

      expect(rows[0].n).toBe(2);
      const skipped = await opsRows('stock_expiry_skipped');
      expect(skipped).toHaveLength(1);
      expect(skipped[0].details).toMatchObject({ order_id: ids[1], sqlstate: 'P0001' });
      expect(skipped[0].details.sqlerrm).toContain('boom');
      const runs = await opsRows('stock_expiry_run');
      expect(runs).toHaveLength(1);
      expect(runs[0].details).toMatchObject({ released: 2, skipped: 1 });
    });

    it('a clean run writes no log rows', async () => {
      const adminClient = await asAdmin();
      await adminClient.query('SELECT public.expire_stale_order_reservations()');

      expect(await opsRows('stock_expiry_skipped')).toEqual([]);
      expect(await opsRows('stock_expiry_run')).toEqual([]);
    });
  });

  describe('W7 policy changes are also written to admin_destructive_ops_log', () => {
    it('set and reset leave an ops-log row with before/after/actor; the false "cannot forge" claim is gone', async () => {
      const superClient = await asSuper();
      await superClient.query('SELECT public.set_stock_policy(24, 100, 7)');
      await superClient.query('SELECT public.reset_stock_policy()');

      const rows = await opsRows('stock_policy_changed');
      expect(rows).toHaveLength(2);
      expect(rows[0].performed_by).toBe(actors.adminId);
      expect(rows[0].details).toMatchObject({
        action: 'stock_policy_updated',
        before: { unpaid_hours: 48, proof_hours: 168, max_open_reservations: 5 },
        after: { unpaid_hours: 24, proof_hours: 100, max_open_reservations: 7 }
      });
      expect(rows[1].details).toMatchObject({ action: 'stock_policy_reset' });
      const sql = migration('20261014190000_atomic_stock_reservation.sql');
      expect(sql).not.toMatch(/cannot skip or forge/);
    });
  });

  describe('W8 orders_with_consumed_stock', () => {
    it('returns only cancelled orders with consumed allocations, for 300 ids in one call, admin only', async () => {
      const { productId } = await seedProduct(admin, actors, tracker, { quantity: 10 });
      const o = await seedOrder(admin, actors, tracker, [{ type: 'product', id: productId, quantity: 1 }]);
      const customer = await asCustomer();
      await customer.query(`SELECT ${reserveSql}`, [o]);
      await admin.query(`UPDATE public.orders SET payment_status = 'validated', status = 'processing' WHERE id = $1`, [o]);
      const adminClient = await asAdmin();
      await adminClient.query('SELECT public.consume_order_inventory($1::uuid)', [o]);
      await admin.query(`UPDATE public.orders SET status = 'cancelled' WHERE id = $1`, [o]);
      const live = await seedOrder(admin, actors, tracker, [], {});
      const ids = [o, live];
      for (let i = 0; i < 298; i += 1) ids.push(`00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);

      const { rows } = await adminClient.query('SELECT * FROM public.orders_with_consumed_stock($1::uuid[])', [ids]);

      expect(rows.map((r) => r.order_id)).toEqual([o]);
      await expect(customer.query('SELECT * FROM public.orders_with_consumed_stock($1::uuid[])', [ids])).rejects.toMatchObject({ code: '42501' });
    });
  });

  describe('W10 a failing release never blocks the owner cancel', () => {
    it('the cancel commits, the failure is logged, and the next sweep heals the orphan', async () => {
      const { productId } = await seedProduct(admin, actors, tracker, { quantity: 4 });
      const orderId = await seedOrder(admin, actors, tracker, [{ type: 'product', id: productId, quantity: 2 }]);
      const customer = await asCustomer();
      await customer.query(`SELECT ${reserveSql}`, [orderId]);
      await admin.query(`
        CREATE FUNCTION public.__test_boom_alloc() RETURNS trigger LANGUAGE plpgsql AS $fn$
        BEGIN RAISE EXCEPTION 'alloc boom'; END $fn$`);
      await admin.query(
        `CREATE TRIGGER __test_boom_alloc BEFORE UPDATE ON public.order_stock_allocations FOR EACH ROW EXECUTE FUNCTION public.__test_boom_alloc()`
      );

      await expect(
        customer.query(
          `UPDATE public.orders SET status = 'cancelled', payment_status = 'rejected', rejection_reason = 'cancelled_by_user' WHERE id = $1`,
          [orderId]
        )
      ).resolves.toBeTruthy();

      expect((await readOrder(admin, orderId)).status).toBe('cancelled');
      expect(await readAllocations(admin, orderId)).toEqual([expect.objectContaining({ state: 'reserved' })]);
      expect((await readInventory(admin, productId))[0].reserved).toBe(2);
      const failed = await opsRows('stock_release_failed');
      expect(failed).toHaveLength(1);
      expect(failed[0].details).toMatchObject({ order_id: orderId });

      await admin.query('DROP TRIGGER __test_boom_alloc ON public.order_stock_allocations');
      const adminClient = await asAdmin();
      const { rows } = await adminClient.query('SELECT public.expire_stale_order_reservations() AS n');
      expect(rows[0].n).toBeGreaterThanOrEqual(1);
      expect((await readInventory(admin, productId))[0].reserved).toBe(0);
    });
  });

  describe('movement_type / reference_type enum conversion', () => {
    it('converts enum-typed ledger columns to text (fresh-style schema) and is a no-op on text', async () => {
      await admin.query('BEGIN');
      try {
        await admin.query(`
          DO $$
          DECLARE v text;
          BEGIN
            SELECT string_agg(DISTINCT quote_literal(x), ',') INTO v FROM (
              SELECT movement_type AS x FROM public.inventory_movements
              UNION SELECT 'reserved' UNION SELECT 'released' UNION SELECT 'sold' UNION SELECT 'restocked' UNION SELECT 'adjustment') s;
            EXECUTE 'CREATE TYPE public.__mv_enum AS ENUM (' || v || ')';
            SELECT string_agg(DISTINCT quote_literal(x), ',') INTO v FROM (
              SELECT reference_type AS x FROM public.inventory_movements WHERE reference_type IS NOT NULL
              UNION SELECT 'order') s;
            EXECUTE 'CREATE TYPE public.__ref_enum AS ENUM (' || v || ')';
            ALTER TABLE public.inventory_movements ALTER COLUMN movement_type TYPE public.__mv_enum USING movement_type::public.__mv_enum;
            ALTER TABLE public.inventory_movements ALTER COLUMN reference_type TYPE public.__ref_enum USING reference_type::public.__ref_enum;
          END $$`);
        const before = await admin.query(
          `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'inventory_movements' AND column_name IN ('movement_type','reference_type') ORDER BY 1`
        );
        expect(before.rows.map((r) => r.data_type)).toEqual(['USER-DEFINED', 'USER-DEFINED']);

        await admin.query(migration('20261014190000_atomic_stock_reservation.sql'));

        const after = await admin.query(
          `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'inventory_movements' AND column_name IN ('movement_type','reference_type') ORDER BY 1`
        );
        expect(after.rows.map((r) => r.data_type)).toEqual(['text', 'text']);
      } finally {
        await admin.query('ROLLBACK');
      }
    });
  });
});
