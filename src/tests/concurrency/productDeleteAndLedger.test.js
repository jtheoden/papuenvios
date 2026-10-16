/**
 * Migration 20261014200000: shared product-delete predicate (get_product_blockers, preview and
 * bulk delete) and the inventory ledger safety net (adjustment movements, reserved guard,
 * delete snapshot). Local Postgres only; skipped when unreachable.
 */
import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { dbSuiteSkipReason, connectAdmin, connectAs, connectAnon, endAll } from './db';
import {
  loadActors,
  createTracker,
  seedProduct,
  seedCombo,
  seedOrder,
  cleanup,
  readInventory,
  restoreStockPolicyRows
} from './fixtures';

const skipReason = await dbSuiteSkipReason({ functions: ['delete_product', 'get_product_blockers', 'bulk_delete_products', 'reserve_order_inventory', 'consume_order_inventory'], tables: ['orders', 'inventory', 'inventory_movements', 'order_stock_allocations', 'admin_destructive_ops_log'] });
const describeDb = skipReason ? describe.skip : describe;

const reserveSql = 'public.reserve_order_inventory($1::uuid)';
const consumeSql = 'public.consume_order_inventory($1::uuid)';

describeDb('product delete safety + inventory ledger safety net (local Postgres)', () => {
  let admin;
  let actors;
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

  const blockers = async (client, productId) => {
    const { rows } = await client.query('SELECT * FROM public.get_product_blockers($1::uuid)', [productId]);
    return rows;
  };
  const bulk = async (client, ids) => {
    const { rows } = await client.query('SELECT * FROM public.bulk_delete_products($1::uuid[])', [ids]);
    return rows;
  };
  const preview = async (client, ids) => {
    const { rows } = await client.query('SELECT * FROM public.preview_bulk_delete_products($1::uuid[])', [ids]);
    return rows;
  };
  const opsLog = async (productId) => {
    const { rows } = await admin.query(
      `SELECT details, performed_by FROM public.admin_destructive_ops_log
        WHERE op_type = 'inventory_batch_deleted' AND details->>'product_id' = $1`,
      [productId]
    );
    return rows;
  };
  const movements = async (inventoryId) => {
    const { rows } = await admin.query(
      `SELECT movement_type, quantity_change, reserved_change, notes, created_by
         FROM public.inventory_movements WHERE inventory_id = $1 ORDER BY created_at, id`,
      [inventoryId]
    );
    return rows;
  };

  beforeAll(async () => {
    admin = await connectAdmin();
    actors = await loadActors(admin);
  });

  afterEach(async () => {
    await endAll(clients.splice(0));
    await admin.query(`SET session_replication_role = DEFAULT`);
    const productIds = [...tracker.products];
    await cleanup(admin, tracker);
    if (productIds.length) {
      await admin.query(
        `DELETE FROM public.admin_destructive_ops_log WHERE op_type = 'inventory_batch_deleted' AND details->>'product_id' = ANY($1)`,
        [productIds]
      );
    }
    await restoreStockPolicyRows(admin);
    await admin.query(`UPDATE public.user_profiles SET role = 'admin' WHERE id = $1`, [actors.adminId]);
  });

  afterAll(async () => {
    await admin.end();
  });

  describe('get_product_blockers (one predicate for front, preview and bulk)', () => {
    it('blocks a product that sits in an open order directly (inventory_id is NULL, as in production)', async () => {
      const { productId } = await seedProduct(admin, actors, tracker, { quantity: 5 });
      const orderId = await seedOrder(admin, actors, tracker, [{ type: 'product', id: productId, quantity: 1 }]);
      const superClient = await asSuper();

      const rows = await blockers(superClient, productId);

      expect(rows).toEqual([expect.objectContaining({ order_id: orderId, status: 'pending', via: 'direct' })]);
    });

    it('blocks a product that is only inside a combo that sits in an open order', async () => {
      const { productId } = await seedProduct(admin, actors, tracker, { quantity: 5 });
      const comboId = await seedCombo(admin, tracker, [{ productId, quantity: 2 }]);
      const orderId = await seedOrder(admin, actors, tracker, [{ type: 'combo', id: comboId, quantity: 1 }], {
        status: 'processing',
        paymentStatus: 'validated'
      });
      const superClient = await asSuper();

      expect(await blockers(superClient, productId)).toEqual([
        expect.objectContaining({ order_id: orderId, via: 'combo' })
      ]);
    });

    it('blocks through a combo stored mislabelled as item_type = product (prod "COMBO 10" case)', async () => {
      const { productId } = await seedProduct(admin, actors, tracker, { quantity: 5 });
      const comboId = await seedCombo(admin, tracker, [{ productId, quantity: 1 }]);
      const orderId = await seedOrder(admin, actors, tracker, [{ type: 'product', id: comboId, quantity: 1 }]);
      const superClient = await asSuper();

      expect(await blockers(superClient, productId)).toEqual([
        expect.objectContaining({ order_id: orderId, via: 'combo' })
      ]);
    });

    it('blocks through order_items.inventory_id (legacy rows that do carry it)', async () => {
      const { productId, inventoryId } = await seedProduct(admin, actors, tracker, { quantity: 5 });
      const orderId = await seedOrder(admin, actors, tracker, []);
      await admin.query(
        `INSERT INTO public.order_items (order_id, item_type, item_id, item_name_es, item_name_en, quantity, unit_price, total_price, inventory_id)
         VALUES ($1, 'product', $2, 'x', 'x', 1, 5, 5, $3)`,
        [orderId, randomUUID(), inventoryId]
      );
      const superClient = await asSuper();

      expect(await blockers(superClient, productId)).toEqual([
        expect.objectContaining({ order_id: orderId, via: 'inventory' })
      ]);
    });

    it.each(['dispatched', 'delivered', 'completed', 'cancelled'])(
      'does not block when the only orders are %s',
      async (status) => {
        const { productId } = await seedProduct(admin, actors, tracker, { quantity: 5 });
        await seedOrder(admin, actors, tracker, [{ type: 'product', id: productId, quantity: 1 }], { status });
        const superClient = await asSuper();

        expect(await blockers(superClient, productId)).toEqual([]);
      }
    );

    it('fails closed on an unknown status', async () => {
      const { productId } = await seedProduct(admin, actors, tracker, { quantity: 5 });
      const orderId = await seedOrder(admin, actors, tracker, [{ type: 'product', id: productId, quantity: 1 }], {
        status: 'on_hold_review'
      });
      const superClient = await asSuper();

      expect(await blockers(superClient, productId)).toEqual([expect.objectContaining({ order_id: orderId })]);
    });

    it('blocks a CANCELLED order that still holds a reserved allocation (orphan), via allocation', async () => {
      const { productId } = await seedProduct(admin, actors, tracker, { quantity: 5 });
      const orderId = await seedOrder(admin, actors, tracker, [{ type: 'product', id: productId, quantity: 1 }]);
      const customer = await asCustomer();
      await customer.query(`SELECT ${reserveSql}`, [orderId]);
      await admin.query(`SET session_replication_role = replica`); // bypass the release trigger on purpose
      await admin.query(`UPDATE public.orders SET status = 'cancelled' WHERE id = $1`, [orderId]);
      await admin.query(`SET session_replication_role = DEFAULT`);
      const superClient = await asSuper();

      expect(await blockers(superClient, productId)).toEqual([
        expect.objectContaining({ order_id: orderId, status: 'cancelled', via: 'allocation' })
      ]);
    });

    it('does NOT block on consumed allocations alone (completed history stays deletable)', async () => {
      const { productId } = await seedProduct(admin, actors, tracker, { quantity: 5 });
      const orderId = await seedOrder(admin, actors, tracker, [{ type: 'product', id: productId, quantity: 1 }]);
      const customer = await asCustomer();
      await customer.query(`SELECT ${reserveSql}`, [orderId]);
      await admin.query(`UPDATE public.orders SET payment_status = 'validated', status = 'processing' WHERE id = $1`, [orderId]);
      const adminClient = await asAdmin();
      await adminClient.query(`SELECT ${consumeSql}`, [orderId]);
      await admin.query(`UPDATE public.orders SET status = 'completed' WHERE id = $1`, [orderId]);
      const superClient = await asSuper();

      expect(await blockers(superClient, productId)).toEqual([]);
    });

    it('is admin only: customers get 42501, anon has no EXECUTE', async () => {
      const { productId } = await seedProduct(admin, actors, tracker, { quantity: 1 });
      const customer = await asCustomer();
      await expect(blockers(customer, productId)).rejects.toMatchObject({ code: '42501' });

      const anon = await connectAnon();
      clients.push(anon);
      await expect(blockers(anon, productId)).rejects.toMatchObject({ code: '42501' });
    });
  });

  describe('preview and bulk delete agree with the predicate', () => {
    it('product in an open order: preview says cannot delete, bulk blocks it and deletes nothing', async () => {
      const { productId } = await seedProduct(admin, actors, tracker, { quantity: 5 });
      await seedOrder(admin, actors, tracker, [{ type: 'product', id: productId, quantity: 1 }]);
      const superClient = await asSuper();

      const [p] = await preview(superClient, [productId]);
      const [b] = await bulk(superClient, [productId]);

      expect(p).toMatchObject({ can_delete: false, block_reason: 'blocking_orders', blocking_orders_count: 1 });
      expect(b).toMatchObject({ blocked_id: productId, block_reason: 'blocking_orders' });
      expect(await readInventory(admin, productId)).toHaveLength(1);
    });

    it('mixed set: blocked, deletable by completed-only history and deletable by consumed allocations', async () => {
      const blockedProduct = await seedProduct(admin, actors, tracker, { quantity: 5 });
      await seedOrder(admin, actors, tracker, [{ type: 'product', id: blockedProduct.productId, quantity: 1 }]);
      const historyProduct = await seedProduct(admin, actors, tracker, { quantity: 5 });
      await seedOrder(admin, actors, tracker, [{ type: 'product', id: historyProduct.productId, quantity: 1 }], {
        status: 'completed'
      });
      const consumedProduct = await seedProduct(admin, actors, tracker, { quantity: 5 });
      const consumedOrder = await seedOrder(admin, actors, tracker, [
        { type: 'product', id: consumedProduct.productId, quantity: 2 }
      ]);
      const customer = await asCustomer();
      await customer.query(`SELECT ${reserveSql}`, [consumedOrder]);
      await admin.query(`UPDATE public.orders SET payment_status = 'validated', status = 'processing' WHERE id = $1`, [consumedOrder]);
      const adminClient = await asAdmin();
      await adminClient.query(`SELECT ${consumeSql}`, [consumedOrder]);
      await admin.query(`UPDATE public.orders SET status = 'completed' WHERE id = $1`, [consumedOrder]);
      const ids = [blockedProduct.productId, historyProduct.productId, consumedProduct.productId];
      const superClient = await asSuper();

      const previews = await preview(superClient, ids);
      const result = await bulk(superClient, ids);

      expect(previews.map((r) => r.can_delete)).toEqual([false, true, true]);
      const deleted = result.filter((r) => r.deleted_id).map((r) => r.deleted_id).sort();
      expect(deleted).toEqual([historyProduct.productId, consumedProduct.productId].sort());
      expect(result.filter((r) => r.blocked_id).map((r) => r.blocked_id)).toEqual([blockedProduct.productId]);
      // the previews and the bulk run agree product by product
      for (const pr of previews) {
        const wasDeleted = deleted.includes(pr.id);
        expect(pr.can_delete).toBe(wasDeleted);
      }
    });

    it('deleting through consumed allocations writes a snapshot with the allocation states', async () => {
      const { productId, inventoryId } = await seedProduct(admin, actors, tracker, { quantity: 5 });
      const orderId = await seedOrder(admin, actors, tracker, [{ type: 'product', id: productId, quantity: 2 }]);
      const customer = await asCustomer();
      await customer.query(`SELECT ${reserveSql}`, [orderId]);
      await admin.query(`UPDATE public.orders SET payment_status = 'validated', status = 'processing' WHERE id = $1`, [orderId]);
      const adminClient = await asAdmin();
      await adminClient.query(`SELECT ${consumeSql}`, [orderId]);
      await admin.query(`UPDATE public.orders SET status = 'completed' WHERE id = $1`, [orderId]);
      const superClient = await asSuper();

      const [row] = await bulk(superClient, [productId]);

      expect(row.deleted_id).toBe(productId);
      const logs = await opsLog(productId);
      expect(logs).toHaveLength(1);
      expect(logs[0].performed_by).toBe(actors.adminId);
      expect(logs[0].details).toMatchObject({
        batch_id: inventoryId,
        product_id: productId,
        quantity: 3,
        reserved_quantity: 0,
        allocations: [{ order_id: orderId, state: 'consumed', quantity: 2 }]
      });
    });
  });

  describe('execute_platform_reset still works after the new inventory triggers', () => {
    it('runs inside a rolled-back transaction: flag + confirmation text, snapshots written, flag consumed', async () => {
      const { productId } = await seedProduct(admin, actors, tracker, { quantity: 4 });
      await admin.query('BEGIN');
      try {
        await admin.query(`UPDATE public.user_profiles SET role = 'super_admin' WHERE id = $1`, [actors.adminId]);
        await admin.query(`SELECT set_config('request.jwt.claims', $1, true)`, [
          JSON.stringify({ sub: actors.adminId, role: 'authenticated' })
        ]);
        // The local table may be empty (disarmed); inside this rolled-back transaction arm it.
        await admin.query(
          `INSERT INTO public.platform_reset_control (id, enabled) VALUES (1, true)
           ON CONFLICT (id) DO UPDATE SET enabled = true`
        );

        const { rows } = await admin.query(`SELECT public.execute_platform_reset('RESETEAR') AS r`);

        expect(rows[0].r.inventory).toBeGreaterThanOrEqual(1);
        const snap = await admin.query(
          `SELECT count(*)::int AS n FROM public.admin_destructive_ops_log
            WHERE op_type = 'inventory_batch_deleted' AND details->>'product_id' = $1`,
          [productId]
        );
        expect(snap.rows[0].n).toBe(1);
        const flag = await admin.query(`SELECT enabled FROM public.platform_reset_control WHERE id = 1`);
        expect(flag.rows[0].enabled).toBe(false);
      } finally {
        await admin.query('ROLLBACK');
      }
      // Nothing leaked out of the rolled back transaction.
      expect(await readInventory(admin, productId)).toHaveLength(1);
    });
  });

  describe('ledger safety net', () => {
    it('inserting a batch logs an "initial batch" adjustment with both deltas', async () => {
      const { inventoryId } = await seedProduct(admin, actors, tracker, { quantity: 7, reserved: 0 });

      expect(await movements(inventoryId)).toEqual([
        expect.objectContaining({ movement_type: 'adjustment', quantity_change: 7, reserved_change: 0, notes: 'initial batch' })
      ]);
    });

    it('an admin quantity edit as role authenticated creates an adjustment and the sums hold', async () => {
      const { productId, inventoryId } = await seedProduct(admin, actors, tracker, { quantity: 10 });
      const adminClient = await asAdmin();

      await adminClient.query(`UPDATE public.inventory SET quantity = quantity + 5 WHERE id = $1`, [inventoryId]);
      await adminClient.query(`UPDATE public.inventory SET quantity = quantity - 2 WHERE id = $1`, [inventoryId]);

      const rows = await movements(inventoryId);
      expect(rows.map((r) => [r.movement_type, r.quantity_change, r.reserved_change, r.notes])).toEqual([
        ['adjustment', 10, 0, 'initial batch'],
        ['adjustment', 5, 0, 'manual edit'],
        ['adjustment', -2, 0, 'manual edit']
      ]);
      expect(rows[1].created_by).toBe(actors.adminId);
      const [inv] = await readInventory(admin, productId);
      expect(rows.reduce((a, r) => a + r.quantity_change, 0)).toBe(inv.quantity);
      expect(rows.reduce((a, r) => a + r.reserved_change, 0)).toBe(inv.reserved);
    });

    it('the RPC paths do not double-log: one movement per operation', async () => {
      const { inventoryId } = await seedProduct(admin, actors, tracker, { quantity: 10 });
      const orderId = await seedOrder(admin, actors, tracker, [{ type: 'product', id: (await admin.query(
        'SELECT product_id FROM public.inventory WHERE id = $1', [inventoryId])).rows[0].product_id, quantity: 3 }]);
      const customer = await asCustomer();
      const adminClient = await asAdmin();

      await customer.query(`SELECT ${reserveSql}`, [orderId]);
      await admin.query(`UPDATE public.orders SET payment_status = 'validated', status = 'processing' WHERE id = $1`, [orderId]);
      await adminClient.query(`SELECT ${consumeSql}`, [orderId]);
      await admin.query(`UPDATE public.orders SET status = 'cancelled' WHERE id = $1`, [orderId]);
      await adminClient.query(`SELECT public.restock_order_inventory($1::uuid, 'returned')`, [orderId]);

      const types = (await movements(inventoryId)).map((r) => r.movement_type);
      expect(types).toEqual(['adjustment', 'reserved', 'sold', 'restocked']);
    });

    it('the RPC flag does not leak: a manual edit later in the same transaction is still ledgered', async () => {
      const { productId, inventoryId } = await seedProduct(admin, actors, tracker, { quantity: 10 });
      const orderId = await seedOrder(admin, actors, tracker, [{ type: 'product', id: productId, quantity: 2 }]);

      await admin.query('BEGIN');
      try {
        await admin.query(`SELECT ${reserveSql}`, [orderId]);
        await admin.query(`UPDATE public.inventory SET quantity = quantity + 1 WHERE id = $1`, [inventoryId]);
        await admin.query('COMMIT');
      } catch (e) {
        await admin.query('ROLLBACK');
        throw e;
      }

      // Same transaction => identical created_at, so compare as a set.
      const rows = await movements(inventoryId);
      expect(rows).toHaveLength(3);
      expect(rows).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ movement_type: 'adjustment', notes: 'initial batch' }),
          expect.objectContaining({ movement_type: 'reserved', reserved_change: 2 }),
          expect.objectContaining({ movement_type: 'adjustment', notes: 'manual edit', quantity_change: 1 })
        ])
      );
    });

    it('editing reserved_quantity outside the RPCs is refused for app roles (42501) but not for the owner', async () => {
      const { productId, inventoryId } = await seedProduct(admin, actors, tracker, { quantity: 10 });
      const adminClient = await asAdmin();

      await expect(
        adminClient.query(`UPDATE public.inventory SET reserved_quantity = 3 WHERE id = $1`, [inventoryId])
      ).rejects.toMatchObject({ code: '42501' });
      expect((await readInventory(admin, productId))[0].reserved).toBe(0);

      await expect(
        admin.query(`UPDATE public.inventory SET reserved_quantity = 3 WHERE id = $1`, [inventoryId])
      ).resolves.toBeTruthy();
    });

    it('the existing CHECK reserved <= quantity still applies to quantity edits', async () => {
      const { inventoryId } = await seedProduct(admin, actors, tracker, { quantity: 10, reserved: 4 });
      const adminClient = await asAdmin();

      await expect(
        adminClient.query(`UPDATE public.inventory SET quantity = 3 WHERE id = $1`, [inventoryId])
      ).rejects.toMatchObject({ code: '23514' });
    });

    it('deleting a batch writes a snapshot to admin_destructive_ops_log and never touches inventory_movements', async () => {
      const { productId, inventoryId } = await seedProduct(admin, actors, tracker, { quantity: 6 });
      await admin.query(`DELETE FROM public.inventory_movements WHERE inventory_id = $1`, [inventoryId]);

      await admin.query(`DELETE FROM public.inventory WHERE id = $1`, [inventoryId]);

      const logs = await opsLog(productId);
      expect(logs).toHaveLength(1);
      expect(logs[0].details).toMatchObject({ batch_id: inventoryId, quantity: 6, reserved_quantity: 0, allocations: [] });
      const mv = await admin.query(`SELECT count(*)::int AS n FROM public.inventory_movements WHERE inventory_id = $1`, [inventoryId]);
      expect(mv.rows[0].n).toBe(0);
    });
  });
});
