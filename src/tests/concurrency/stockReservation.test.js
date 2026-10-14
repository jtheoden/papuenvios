/**
 * REAL concurrency tests for atomic stock reservation.
 * Runs against the LOCAL Supabase Postgres only; skipped automatically when it is unreachable.
 * Each worker is its own connection running as role `authenticated` with a JWT sub claim, so the
 * owner/admin checks and the orders owner guards are exercised exactly like a PostgREST call.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import {
  isDbReachable,
  connectAdmin,
  connectAs,
  connectAnon,
  fireTogether,
  endAll
} from './db';
import {
  loadActors,
  createTracker,
  seedProduct,
  seedBatch,
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

if (!reachable) {
  // eslint-disable-next-line no-console
  console.warn('[concurrency] Local Supabase DB unreachable (127.0.0.1:55322) - suite skipped.');
}

const reserveSql = 'public.reserve_order_inventory($1::uuid)';
const releaseSql = 'public.release_order_inventory($1::uuid)';
const consumeSql = 'public.consume_order_inventory($1::uuid)';
const restockSql = 'public.restock_order_inventory($1::uuid, $2::text)';

describeDb('atomic stock reservation (local Postgres)', () => {
  let admin;
  let actors;
  const tracker = createTracker();
  const clients = [];

  const asCustomer = async () => {
    const c = await connectAs(actors.customerId);
    clients.push(c);
    return c;
  };
  const asAdmin = async () => {
    const c = await connectAs(actors.adminId);
    clients.push(c);
    return c;
  };

  beforeAll(async () => {
    admin = await connectAdmin();
    actors = await loadActors(admin);
    await admin.query(`
      CREATE OR REPLACE FUNCTION public.__test_admin_cancel(p_order_id uuid) RETURNS jsonb
      LANGUAGE plpgsql SECURITY INVOKER AS $fn$
      BEGIN
        UPDATE public.orders SET status = 'cancelled' WHERE id = p_order_id;
        RETURN public.release_order_inventory(p_order_id);
      END
      $fn$`);
    await admin.query(`
      CREATE OR REPLACE FUNCTION public.__test_admin_reopen(p_order_id uuid) RETURNS jsonb
      LANGUAGE plpgsql SECURITY INVOKER AS $fn$
      BEGIN
        UPDATE public.orders SET status = 'pending', payment_status = 'pending' WHERE id = p_order_id;
        RETURN public.reserve_order_inventory(p_order_id);
      END
      $fn$`);
  });

  afterEach(async () => {
    await endAll(clients.splice(0));
    await cleanup(admin, tracker);
    await restoreStockPolicyRows(admin);
  });

  afterAll(async () => {
    await admin.query('DROP FUNCTION IF EXISTS public.__test_admin_cancel(uuid)');
    await admin.query('DROP FUNCTION IF EXISTS public.__test_admin_reopen(uuid)');
    await admin.end();
  });

  it('10 parallel reserves on 1 unit: exactly 1 succeeds, reserved == 1, never negative', async () => {
    await setStockPolicyRows(admin, { stock_max_open_reservations: 50 }); // isolate stock from the per-user cap
    const { productId, inventoryId } = await seedProduct(admin, actors, tracker, { quantity: 1 });
    const orderIds = [];
    for (let i = 0; i < 10; i += 1) {
      orderIds.push(
        await seedOrder(admin, actors, tracker, [{ type: 'product', id: productId, quantity: 1 }])
      );
    }
    const workers = await Promise.all(orderIds.map(() => asCustomer()));

    const results = await fireTogether(
      workers.map((client, i) => ({ client, sql: reserveSql, params: [orderIds[i]] }))
    );

    expect(results.filter((r) => r.error)).toEqual([]);
    const oks = results.filter((r) => r.value.ok === true);
    const rejected = results.filter((r) => r.value.ok === false);
    expect(oks).toHaveLength(1);
    expect(rejected).toHaveLength(9);
    for (const r of rejected) {
      expect(r.value.reason).toBe('insufficient_stock');
      expect(r.value.product_id).toBe(productId);
    }

    const [inv] = await readInventory(admin, productId);
    expect(inv.id).toBe(inventoryId);
    expect(inv.quantity).toBe(1);
    expect(inv.reserved).toBe(1);

    // The 9 losers were cancelled in the same transaction (owner guard bypassed by the definer).
    const states = await Promise.all(orderIds.map((id) => readOrder(admin, id)));
    expect(states.filter((s) => s.stock_reserved)).toHaveLength(1);
    const cancelled = states.filter((s) => s.status === 'cancelled');
    expect(cancelled).toHaveLength(9);
    for (const s of cancelled) {
      expect(s.rejection_reason).toBe('insufficient_stock');
      expect(s.stock_reserved).toBe(false);
    }
  });

  it('reserves a multi-unit order and splits across batches FEFO (earliest expiry first)', async () => {
    const { productId, inventoryId: late } = await seedProduct(admin, actors, tracker, {
      quantity: 5,
      expiry: '2030-01-01'
    });
    const early = await seedBatch(admin, productId, { quantity: 2, expiry: '2029-01-01' });
    const noExpiry = await seedBatch(admin, productId, { quantity: 10, expiry: null });
    const orderId = await seedOrder(admin, actors, tracker, [
      { type: 'product', id: productId, quantity: 4 }
    ]);
    const customer = await asCustomer();

    const { rows } = await customer.query(`SELECT ${reserveSql} AS r`, [orderId]);
    expect(rows[0].r.ok).toBe(true);

    const byId = Object.fromEntries((await readInventory(admin, productId)).map((r) => [r.id, r]));
    expect(byId[early].reserved).toBe(2);
    expect(byId[late].reserved).toBe(2);
    expect(byId[noExpiry].reserved).toBe(0);
  });

  it('combo vs product competing for the last component unit: exactly 1 wins (20 rounds)', async () => {
    for (let round = 0; round < 20; round += 1) {
      const { productId } = await seedProduct(admin, actors, tracker, { quantity: 1 });
      const comboId = await seedCombo(admin, tracker, [{ productId, quantity: 1 }]);
      const productOrder = await seedOrder(admin, actors, tracker, [
        { type: 'product', id: productId, quantity: 1 }
      ]);
      const comboOrder = await seedOrder(admin, actors, tracker, [
        { type: 'combo', id: comboId, quantity: 1 }
      ]);
      const [c1, c2] = [await asCustomer(), await asCustomer()];

      const results = await fireTogether([
        { client: c1, sql: reserveSql, params: [productOrder] },
        { client: c2, sql: reserveSql, params: [comboOrder] }
      ]);

      expect(results.filter((r) => r.error)).toEqual([]);
      expect(results.filter((r) => r.value.ok === true)).toHaveLength(1);
      const [inv] = await readInventory(admin, productId);
      expect(inv.reserved).toBe(1);
      expect(inv.quantity).toBe(1);
      await endAll(clients.splice(0));
      // Keep each round independent of the per-user open-reservation cap.
      await cleanup(admin, tracker);
    }
  });

  it('expands combos (combo_items.quantity * item quantity) and aggregates repeated products', async () => {
    const { productId } = await seedProduct(admin, actors, tracker, { quantity: 10 });
    const comboId = await seedCombo(admin, tracker, [{ productId, quantity: 3 }]);
    const orderId = await seedOrder(admin, actors, tracker, [
      { type: 'combo', id: comboId, quantity: 2 },
      { type: 'product', id: productId, quantity: 1 }
    ]);
    const customer = await asCustomer();

    const { rows } = await customer.query(`SELECT ${reserveSql} AS r`, [orderId]);
    expect(rows[0].r.ok).toBe(true);
    const [inv] = await readInventory(admin, productId);
    expect(inv.reserved).toBe(7);
    const allocations = await readAllocations(admin, orderId);
    expect(allocations).toHaveLength(1);
    expect(allocations[0]).toMatchObject({ quantity: 7, state: 'reserved' });
  });

  it('treats a combo mislabeled as item_type=product (prod COMBO 10 case) as a combo', async () => {
    const { productId } = await seedProduct(admin, actors, tracker, { quantity: 4 });
    const comboId = await seedCombo(admin, tracker, [{ productId, quantity: 2 }]);
    const orderId = await seedOrder(admin, actors, tracker, [
      { type: 'product', id: comboId, quantity: 1 }
    ]);
    const customer = await asCustomer();

    const { rows } = await customer.query(`SELECT ${reserveSql} AS r`, [orderId]);
    expect(rows[0].r.ok).toBe(true);
    expect((await readInventory(admin, productId))[0].reserved).toBe(2);
  });

  it('rejects an item that is neither a product nor a combo (invalid_item) and cancels the order', async () => {
    const orderId = await seedOrder(admin, actors, tracker, [
      { type: 'product', id: '00000000-0000-4000-8000-0000000000aa', quantity: 1 }
    ]);
    const customer = await asCustomer();

    const { rows } = await customer.query(`SELECT ${reserveSql} AS r`, [orderId]);
    expect(rows[0].r).toMatchObject({ ok: false, reason: 'invalid_item' });
    expect(await readOrder(admin, orderId)).toMatchObject({
      status: 'cancelled',
      rejection_reason: 'invalid_item'
    });
  });

  it('a product without an inventory row has zero stock (insufficient_stock, available 0)', async () => {
    const { productId, inventoryId } = await seedProduct(admin, actors, tracker, { quantity: 3 });
    // The seeded batch has an 'initial batch' ledger row (FK), delete it first like the app does.
    await admin.query(`DELETE FROM public.inventory_movements WHERE inventory_id = $1`, [inventoryId]);
    await admin.query(`DELETE FROM public.inventory WHERE id = $1`, [inventoryId]);
    const orderId = await seedOrder(admin, actors, tracker, [
      { type: 'product', id: productId, quantity: 1 }
    ]);
    const customer = await asCustomer();

    const { rows } = await customer.query(`SELECT ${reserveSql} AS r`, [orderId]);
    expect(rows[0].r).toMatchObject({ ok: false, reason: 'insufficient_stock', available: 0 });
  });

  it('reserve is idempotent: a second call does not reserve twice', async () => {
    const { productId } = await seedProduct(admin, actors, tracker, { quantity: 5 });
    const orderId = await seedOrder(admin, actors, tracker, [
      { type: 'product', id: productId, quantity: 2 }
    ]);
    const customer = await asCustomer();

    const first = await customer.query(`SELECT ${reserveSql} AS r`, [orderId]);
    const second = await customer.query(`SELECT ${reserveSql} AS r`, [orderId]);
    expect(first.rows[0].r.ok).toBe(true);
    expect(second.rows[0].r).toMatchObject({ ok: true, reason: 'already_reserved' });
    expect((await readInventory(admin, productId))[0].reserved).toBe(2);
  });

  it('double release / concurrent cancel releases exactly once (reserved back to 0)', async () => {
    const { productId } = await seedProduct(admin, actors, tracker, { quantity: 3 });
    const orderId = await seedOrder(admin, actors, tracker, [
      { type: 'product', id: productId, quantity: 2 }
    ]);
    const owner = await asCustomer();
    await owner.query(`SELECT ${reserveSql} AS r`, [orderId]);
    expect((await readInventory(admin, productId))[0].reserved).toBe(2);

    // Cancel as the owner would (allowed by the owner guard), then 6 concurrent releases.
    await owner.query(
      `UPDATE public.orders SET status = 'cancelled', payment_status = 'rejected', rejection_reason = 'cancelled_by_user' WHERE id = $1`,
      [orderId]
    );
    const workers = await Promise.all(Array.from({ length: 6 }, () => asCustomer()));
    const results = await fireTogether(
      workers.map((client) => ({ client, sql: releaseSql, params: [orderId] }))
    );

    expect(results.filter((r) => r.error)).toEqual([]);
    // The owner's cancel UPDATE already released through the trigger: no RPC releases again.
    expect(results.filter((r) => r.value.released === true)).toHaveLength(0);
    const [inv] = await readInventory(admin, productId);
    expect(inv.reserved).toBe(0);
    expect(inv.quantity).toBe(3);
    expect(await readAllocations(admin, orderId)).toEqual([
      expect.objectContaining({ state: 'released' })
    ]);
    const { rows } = await admin.query(
      `SELECT count(*)::int AS n FROM public.inventory_movements WHERE reference_id = $1 AND movement_type = 'released'`,
      [orderId]
    );
    expect(rows[0].n).toBe(1);
    expect((await readOrder(admin, orderId)).stock_reserved).toBe(false);
  });

  it('release refuses while the order is still live (owner cannot free stock of a pending order)', async () => {
    const { productId } = await seedProduct(admin, actors, tracker, { quantity: 3 });
    const orderId = await seedOrder(admin, actors, tracker, [
      { type: 'product', id: productId, quantity: 1 }
    ]);
    const owner = await asCustomer();
    await owner.query(`SELECT ${reserveSql} AS r`, [orderId]);

    const { rows } = await owner.query(`SELECT ${releaseSql} AS r`, [orderId]);
    expect(rows[0].r).toMatchObject({ ok: false, reason: 'order_not_cancelled' });
    expect((await readInventory(admin, productId))[0].reserved).toBe(1);
    expect((await readOrder(admin, orderId)).stock_reserved).toBe(true);
  });

  it('consume decrements quantity and reserved together, once (idempotent under concurrency)', async () => {
    const { productId } = await seedProduct(admin, actors, tracker, { quantity: 5 });
    const orderId = await seedOrder(admin, actors, tracker, [
      { type: 'product', id: productId, quantity: 2 }
    ]);
    const owner = await asCustomer();
    await owner.query(`SELECT ${reserveSql} AS r`, [orderId]);
    await admin.query(
      `UPDATE public.orders SET payment_status = 'validated', status = 'processing' WHERE id = $1`,
      [orderId]
    );

    const workers = await Promise.all(Array.from({ length: 4 }, () => asAdmin()));
    const results = await fireTogether(
      workers.map((client) => ({ client, sql: consumeSql, params: [orderId] }))
    );

    expect(results.filter((r) => r.error)).toEqual([]);
    expect(results.filter((r) => r.value.consumed === true)).toHaveLength(1);
    const [inv] = await readInventory(admin, productId);
    expect(inv).toMatchObject({ quantity: 3, reserved: 0 });
    expect((await readAllocations(admin, orderId))[0].state).toBe('consumed');
  });

  it('cancel racing consume stays consistent and never negative (20 rounds)', async () => {
    for (let round = 0; round < 20; round += 1) {
      const { productId } = await seedProduct(admin, actors, tracker, { quantity: 1 });
      const orderId = await seedOrder(admin, actors, tracker, [
        { type: 'product', id: productId, quantity: 1 }
      ]);
      const owner = await asCustomer();
      await owner.query(`SELECT ${reserveSql} AS r`, [orderId]);
      await admin.query(
        `UPDATE public.orders SET payment_status = 'validated', status = 'processing' WHERE id = $1`,
        [orderId]
      );
      const adminA = await asAdmin();
      const adminB = await asAdmin();

      const results = await fireTogether([
        { client: adminA, sql: consumeSql, params: [orderId] },
        // Admin cancel = status update followed by release (helper defined in beforeAll).
        { client: adminB, sql: 'public.__test_admin_cancel($1::uuid)', params: [orderId] }
      ]);

      expect(results.filter((r) => r.error)).toEqual([]);
      const [inv] = await readInventory(admin, productId);
      const [alloc] = await readAllocations(admin, orderId);
      expect(inv.quantity).toBeGreaterThanOrEqual(0);
      expect(inv.reserved).toBe(0);
      // Allocation state and physical stock must agree: consumed <=> stock decremented.
      if (alloc.state === 'consumed') expect(inv.quantity).toBe(0);
      else expect(inv).toMatchObject({ quantity: 1, reserved: 0 });
      expect(['consumed', 'released']).toContain(alloc.state);
      await endAll(clients.splice(0));
    }
  });

  it('legacy order (stock_managed=false) validated: consume is a no-op, stock untouched', async () => {
    const { productId } = await seedProduct(admin, actors, tracker, { quantity: 5 });
    const orderId = await seedOrder(
      admin,
      actors,
      tracker,
      [{ type: 'product', id: productId, quantity: 2 }],
      { stockManaged: false, status: 'processing', paymentStatus: 'validated' }
    );
    const adminClient = await asAdmin();

    const { rows } = await adminClient.query(`SELECT ${consumeSql} AS r`, [orderId]);
    expect(rows[0].r).toMatchObject({ ok: true, consumed: false, reason: 'legacy_order' });
    expect((await readInventory(admin, productId))[0]).toMatchObject({ quantity: 5, reserved: 0 });
    expect(await readAllocations(admin, orderId)).toEqual([]);
  });

  it('managed order that never got reserved (reserve call lost): consume reserves + consumes atomically', async () => {
    const { productId } = await seedProduct(admin, actors, tracker, { quantity: 5 });
    const orderId = await seedOrder(
      admin,
      actors,
      tracker,
      [{ type: 'product', id: productId, quantity: 2 }],
      { stockManaged: true, status: 'processing', paymentStatus: 'validated' }
    );
    const adminClient = await asAdmin();

    const { rows } = await adminClient.query(`SELECT ${consumeSql} AS r`, [orderId]);
    expect(rows[0].r).toMatchObject({ ok: true, consumed: true });
    expect((await readInventory(admin, productId))[0]).toMatchObject({ quantity: 3, reserved: 0 });
  });

  it('consume refuses when the order payment is not validated', async () => {
    const { productId } = await seedProduct(admin, actors, tracker, { quantity: 5 });
    const orderId = await seedOrder(admin, actors, tracker, [
      { type: 'product', id: productId, quantity: 1 }
    ]);
    const owner = await asCustomer();
    await owner.query(`SELECT ${reserveSql} AS r`, [orderId]);
    const adminClient = await asAdmin();

    const { rows } = await adminClient.query(`SELECT ${consumeSql} AS r`, [orderId]);
    expect(rows[0].r).toMatchObject({ ok: false, reason: 'payment_not_validated' });
    expect((await readInventory(admin, productId))[0]).toMatchObject({ quantity: 5, reserved: 1 });
  });

  describe('authorization', () => {
    it('a non-owner customer cannot reserve, release or consume someone else\'s order', async () => {
      const { productId } = await seedProduct(admin, actors, tracker, { quantity: 5 });
      const orderId = await seedOrder(admin, actors, tracker, [
        { type: 'product', id: productId, quantity: 1 }
      ]);
      // Impersonate a different authenticated user (a random sub that is neither owner nor admin).
      const stranger = await connectAs('e2e00000-0000-4000-8000-00000000dead');
      clients.push(stranger);

      for (const sql of [reserveSql, releaseSql, consumeSql]) {
        await expect(stranger.query(`SELECT ${sql}`, [orderId])).rejects.toMatchObject({ code: '42501' });
      }
      expect((await readInventory(admin, productId))[0].reserved).toBe(0);
    });

    it('the order owner cannot consume (admin only)', async () => {
      const { productId } = await seedProduct(admin, actors, tracker, { quantity: 5 });
      const orderId = await seedOrder(
        admin,
        actors,
        tracker,
        [{ type: 'product', id: productId, quantity: 1 }],
        { status: 'processing', paymentStatus: 'validated' }
      );
      const owner = await asCustomer();
      await expect(owner.query(`SELECT ${consumeSql}`, [orderId])).rejects.toMatchObject({ code: '42501' });
    });

    it('anon has no EXECUTE on any of the RPCs', async () => {
      const anon = await connectAnon();
      clients.push(anon);
      for (const sql of [
        reserveSql,
        releaseSql,
        consumeSql,
        'public.expire_stale_order_reservations(1)'
      ]) {
        await expect(
          anon.query(`SELECT ${sql}`, sql.includes('expire') ? [] : ['00000000-0000-4000-8000-000000000001'])
        ).rejects.toMatchObject({ code: '42501' });
      }
    });

    it('owner-created orders cannot opt out of stock management (insert is forced to managed)', async () => {
      const owner = await asCustomer();
      const { rows } = await owner.query(
        `INSERT INTO public.orders (user_id, order_type, subtotal, total_amount, currency_id, payment_method,
                                    stock_managed, stock_reserved)
         VALUES ($1, 'product', 10, 10, $2, 'zelle', false, true) RETURNING id, stock_managed, stock_reserved`,
        [actors.customerId, actors.currencyId]
      );
      tracker.orders.push(rows[0].id);
      expect(rows[0]).toMatchObject({ stock_managed: true, stock_reserved: false });
    });

    it('the owner cannot flip stock flags on an existing order', async () => {
      const orderId = await seedOrder(admin, actors, tracker, []);
      const owner = await asCustomer();
      await expect(
        owner.query(`UPDATE public.orders SET stock_managed = false WHERE id = $1`, [orderId])
      ).rejects.toMatchObject({ code: '42501' });
    });
  });

  describe('expire_stale_order_reservations', () => {
    const age = (orderId, hours) =>
      admin.query(
        `UPDATE public.orders SET stock_reserved_at = now() - make_interval(hours => $2) WHERE id = $1`,
        [orderId, hours]
      );

    it('denies non-admin callers', async () => {
      const owner = await asCustomer();
      await expect(
        owner.query('SELECT public.expire_stale_order_reservations(48)')
      ).rejects.toMatchObject({ code: '42501' });
    });

    it('cancels + releases stale unpaid orders only; keeps proof_uploaded and fresh ones', async () => {
      const { productId } = await seedProduct(admin, actors, tracker, { quantity: 10 });
      const mk = async (paymentStatus) => {
        const id = await seedOrder(admin, actors, tracker, [
          { type: 'product', id: productId, quantity: 1 }
        ]);
        const owner = await asCustomer();
        await owner.query(`SELECT ${reserveSql}`, [id]);
        await admin.query(`UPDATE public.orders SET payment_status = $2 WHERE id = $1`, [id, paymentStatus]);
        return id;
      };
      const staleUnpaid = await mk('pending');
      const staleRejected = await mk('rejected');
      const staleProof = await mk('proof_uploaded');
      const fresh = await mk('pending');
      await age(staleUnpaid, 72);
      await age(staleRejected, 72);
      await age(staleProof, 72);
      await age(fresh, 1);
      // A rejection is timed from the rejection (validated_at), not only from the reservation.
      await admin.query(`UPDATE public.orders SET validated_at = now() - interval '72 hours' WHERE id = $1`, [
        staleRejected
      ]);
      const freshRejected = await mk('rejected');
      await age(freshRejected, 72);
      await admin.query(`UPDATE public.orders SET validated_at = now() WHERE id = $1`, [freshRejected]);

      const adminClient = await asAdmin();
      const { rows } = await adminClient.query('SELECT public.expire_stale_order_reservations(48) AS n');

      expect(rows[0].n).toBe(2);
      expect(await readOrder(admin, staleUnpaid)).toMatchObject({
        status: 'cancelled',
        rejection_reason: 'reservation_expired',
        stock_reserved: false
      });
      expect((await readOrder(admin, staleRejected)).status).toBe('cancelled');
      expect(await readOrder(admin, staleProof)).toMatchObject({ status: 'pending', stock_reserved: true });
      expect(await readOrder(admin, fresh)).toMatchObject({ status: 'pending', stock_reserved: true });
      expect(await readOrder(admin, freshRejected)).toMatchObject({ status: 'pending', stock_reserved: true });
      expect((await readInventory(admin, productId))[0].reserved).toBe(3);

      // Running it again is a no-op.
      const again = await adminClient.query('SELECT public.expire_stale_order_reservations(48) AS n');
      expect(again.rows[0].n).toBe(0);
    });

    it('sweeps orphans: a cancelled order that still holds a reservation is released', async () => {
      const { productId } = await seedProduct(admin, actors, tracker, { quantity: 4 });
      const orderId = await seedOrder(admin, actors, tracker, [
        { type: 'product', id: productId, quantity: 2 }
      ]);
      const owner = await asCustomer();
      await owner.query(`SELECT ${reserveSql}`, [orderId]);
      // Cancel succeeded but the follow-up release call was lost.
      // (the cancel trigger is bypassed on purpose: replica role simulates a lost release)
      await admin.query(`SET session_replication_role = replica`);
      await admin.query(`UPDATE public.orders SET status = 'cancelled' WHERE id = $1`, [orderId]);
      await admin.query(`SET session_replication_role = DEFAULT`);

      const adminClient = await asAdmin();
      const { rows } = await adminClient.query('SELECT public.expire_stale_order_reservations(48) AS n');
      expect(rows[0].n).toBe(1);
      expect((await readInventory(admin, productId))[0].reserved).toBe(0);
    });

    it('does not count or lock consumed+cancelled orders again (admin-cancelled processing order): 0 on every run', async () => {
      const { productId } = await seedProduct(admin, actors, tracker, { quantity: 4 });
      const orderId = await seedOrder(admin, actors, tracker, [
        { type: 'product', id: productId, quantity: 1 }
      ]);
      const owner = await asCustomer();
      await owner.query(`SELECT ${reserveSql}`, [orderId]);
      await admin.query(
        `UPDATE public.orders SET payment_status = 'validated', status = 'processing' WHERE id = $1`,
        [orderId]
      );
      const adminClient = await asAdmin();
      await adminClient.query(`SELECT ${consumeSql}`, [orderId]);
      await adminClient.query(`UPDATE public.orders SET status = 'cancelled' WHERE id = $1`, [orderId]);
      await adminClient.query(`SELECT ${releaseSql}`, [orderId]);

      for (let run = 0; run < 2; run += 1) {
        const { rows } = await adminClient.query('SELECT public.expire_stale_order_reservations(48) AS n');
        expect(rows[0].n).toBe(0);
      }
      expect((await readInventory(admin, productId))[0]).toMatchObject({ quantity: 3, reserved: 0 });
    });

    it('expiring several multi-product orders while reserves run concurrently never deadlocks', async () => {
      await setStockPolicyRows(admin, { stock_max_open_reservations: 50 });
      const a = await seedProduct(admin, actors, tracker, { quantity: 50 });
      const b = await seedProduct(admin, actors, tracker, { quantity: 50 });
      const stale = [];
      for (let i = 0; i < 4; i += 1) {
        const id = await seedOrder(admin, actors, tracker, [
          { type: 'product', id: i % 2 ? a.productId : b.productId, quantity: 1 },
          { type: 'product', id: i % 2 ? b.productId : a.productId, quantity: 1 }
        ]);
        const owner = await asCustomer();
        await owner.query(`SELECT ${reserveSql}`, [id]);
        await age(id, 72);
        stale.push(id);
      }
      const live = [];
      for (let i = 0; i < 4; i += 1) {
        live.push(
          await seedOrder(admin, actors, tracker, [
            { type: 'product', id: i % 2 ? a.productId : b.productId, quantity: 1 },
            { type: 'product', id: i % 2 ? b.productId : a.productId, quantity: 1 }
          ])
        );
      }
      const workers = await Promise.all(live.map(() => asCustomer()));
      const sweeper = await asAdmin();

      const results = await fireTogether([
        { client: sweeper, sql: 'public.expire_stale_order_reservations(48)' },
        ...workers.map((client, i) => ({ client, sql: reserveSql, params: [live[i]] }))
      ]);

      expect(results.filter((r) => r.error)).toEqual([]);
      expect(results[0].value).toBe(4);
      for (const r of results.slice(1)) expect(r.value.ok).toBe(true);
      expect((await readInventory(admin, a.productId))[0].reserved).toBe(4);
      expect((await readInventory(admin, b.productId))[0].reserved).toBe(4);
    });

    it('also expires proof_uploaded orders, but only after the longer proof window (C2b)', async () => {
      const { productId } = await seedProduct(admin, actors, tracker, { quantity: 10 });
      const mk = async (hoursOld) => {
        const id = await seedOrder(admin, actors, tracker, [{ type: 'product', id: productId, quantity: 1 }]);
        const owner = await asCustomer();
        await owner.query(`SELECT ${reserveSql}`, [id]);
        await admin.query(`UPDATE public.orders SET payment_status = 'proof_uploaded' WHERE id = $1`, [id]);
        await age(id, hoursOld);
        return id;
      };
      const old = await mk(200);
      const mid = await mk(100);
      const adminClient = await asAdmin();

      const { rows } = await adminClient.query('SELECT public.expire_stale_order_reservations(48, 168) AS n');
      expect(rows[0].n).toBe(1);
      expect(await readOrder(admin, old)).toMatchObject({ status: 'cancelled', rejection_reason: 'reservation_expired' });
      expect(await readOrder(admin, mid)).toMatchObject({ status: 'pending', stock_reserved: true });

      const shorter = await adminClient.query('SELECT public.expire_stale_order_reservations(48, 72) AS n');
      expect(shorter.rows[0].n).toBe(1);
      expect((await readInventory(admin, productId))[0].reserved).toBe(0);
    });

    it('enforces the windows floors: p_hours >= 6 and p_proof_hours >= 24 (S5)', async () => {
      const adminClient = await asAdmin();
      await expect(adminClient.query('SELECT public.expire_stale_order_reservations(5)')).rejects.toMatchObject({
        code: '22023'
      });
      await expect(adminClient.query('SELECT public.expire_stale_order_reservations(48, 23)')).rejects.toMatchObject({
        code: '22023'
      });
      await expect(adminClient.query('SELECT public.expire_stale_order_reservations(6, 24)')).resolves.toBeTruthy();
    });

    it('a reopened order gets a fresh reservation clock (not expired by its old age)', async () => {
      const { productId } = await seedProduct(admin, actors, tracker, { quantity: 4 });
      const orderId = await seedOrder(admin, actors, tracker, [
        { type: 'product', id: productId, quantity: 1 }
      ]);
      await admin.query(`UPDATE public.orders SET created_at = now() - interval '30 days' WHERE id = $1`, [orderId]);
      const owner = await asCustomer();
      await owner.query(`SELECT ${reserveSql}`, [orderId]);

      const adminClient = await asAdmin();
      const { rows } = await adminClient.query('SELECT public.expire_stale_order_reservations(48) AS n');
      expect(rows[0].n).toBe(0);
      expect(await readOrder(admin, orderId)).toMatchObject({ status: 'pending', stock_reserved: true });
    });
  });

  it('does not allocate or count expired batches (W2)', async () => {
    const { productId, inventoryId: expired } = await seedProduct(admin, actors, tracker, {
      quantity: 5,
      expiry: '2020-01-01'
    });
    const valid = await seedBatch(admin, productId, { quantity: 1, expiry: '2099-01-01' });
    const tooMany = await seedOrder(admin, actors, tracker, [{ type: 'product', id: productId, quantity: 2 }]);
    const fits = await seedOrder(admin, actors, tracker, [{ type: 'product', id: productId, quantity: 1 }]);
    const owner = await asCustomer();

    const refused = await owner.query(`SELECT ${reserveSql} AS r`, [tooMany]);
    expect(refused.rows[0].r).toMatchObject({ ok: false, reason: 'insufficient_stock', available: 1 });
    const ok = await owner.query(`SELECT ${reserveSql} AS r`, [fits]);
    expect(ok.rows[0].r.ok).toBe(true);

    const byId = Object.fromEntries((await readInventory(admin, productId)).map((r) => [r.id, r]));
    expect(byId[expired].reserved).toBe(0);
    expect(byId[valid].reserved).toBe(1);
  });

  it('an order with no stock needs is refused as empty_order and cancelled (S4)', async () => {
    const orderId = await seedOrder(admin, actors, tracker, []);
    const owner = await asCustomer();

    const { rows } = await owner.query(`SELECT ${reserveSql} AS r`, [orderId]);
    expect(rows[0].r).toMatchObject({ ok: false, reason: 'empty_order' });
    expect(await readOrder(admin, orderId)).toMatchObject({
      status: 'cancelled',
      rejection_reason: 'empty_order',
      stock_reserved: false
    });
  });

  it('caps open reservations per user at the default 5: the 6th concurrent reserve is refused and cancelled (C2a)', async () => {
    const { productId } = await seedProduct(admin, actors, tracker, { quantity: 100 });
    const orderIds = [];
    for (let i = 0; i < 8; i += 1) {
      orderIds.push(await seedOrder(admin, actors, tracker, [{ type: 'product', id: productId, quantity: 1 }]));
    }
    const workers = await Promise.all(orderIds.map(() => asCustomer()));

    const results = await fireTogether(
      workers.map((client, i) => ({ client, sql: reserveSql, params: [orderIds[i]] }))
    );

    expect(results.filter((r) => r.error)).toEqual([]);
    expect(results.filter((r) => r.value.ok === true)).toHaveLength(5);
    const refused = results.filter((r) => r.value.ok === false);
    expect(refused).toHaveLength(3);
    for (const r of refused) expect(r.value.reason).toBe('too_many_open_reservations');
    expect((await readInventory(admin, productId))[0].reserved).toBe(5);
    const states = await Promise.all(orderIds.map((id) => readOrder(admin, id)));
    expect(states.filter((x) => x.rejection_reason === 'too_many_open_reservations')).toHaveLength(3);
  });

  it('consume refuses a cancelled order even if it is validated and reserved (W5)', async () => {
    const { productId } = await seedProduct(admin, actors, tracker, { quantity: 5 });
    const orderId = await seedOrder(admin, actors, tracker, [{ type: 'product', id: productId, quantity: 1 }]);
    const owner = await asCustomer();
    await owner.query(`SELECT ${reserveSql}`, [orderId]);
    await admin.query(
      `UPDATE public.orders SET status = 'cancelled', payment_status = 'validated' WHERE id = $1`,
      [orderId]
    );
    const adminClient = await asAdmin();

    const { rows } = await adminClient.query(`SELECT ${consumeSql} AS r`, [orderId]);
    expect(rows[0].r).toMatchObject({ ok: false, reason: 'order_not_active', consumed: false });
    // The cancel trigger already released the reservation; consume must not touch anything.
    expect((await readInventory(admin, productId))[0]).toMatchObject({ quantity: 5, reserved: 0 });
  });

  it('does not leak order existence: unknown id and someone else\'s order look the same (S2)', async () => {
    const { productId } = await seedProduct(admin, actors, tracker, { quantity: 5 });
    const orderId = await seedOrder(admin, actors, tracker, [{ type: 'product', id: productId, quantity: 1 }]);
    const stranger = await connectAs('e2e00000-0000-4000-8000-00000000dead');
    clients.push(stranger);
    const unknown = '00000000-0000-4000-8000-0000000000bb';

    for (const sql of [reserveSql, releaseSql]) {
      await expect(stranger.query(`SELECT ${sql}`, [unknown])).rejects.toMatchObject({ code: '42501' });
      await expect(stranger.query(`SELECT ${sql}`, [orderId])).rejects.toMatchObject({ code: '42501' });
    }
    const adminClient = await asAdmin();
    const { rows } = await adminClient.query(`SELECT ${reserveSql} AS r`, [unknown]);
    expect(rows[0].r).toMatchObject({ ok: false, reason: 'order_not_found' });
  });

  describe('order_items insert guard (W1)', () => {
    const insertItem = (client, orderId, productId) =>
      client.query(
        `INSERT INTO public.order_items (order_id, item_type, item_id, item_name_es, item_name_en, quantity, unit_price, total_price)
         VALUES ($1, 'product', $2, 'x', 'x', 1, 5, 5)`,
        [orderId, productId]
      );

    it('lets the owner add lines to a pending, unreserved order (the createOrder path)', async () => {
      const { productId } = await seedProduct(admin, actors, tracker, { quantity: 5 });
      const orderId = await seedOrder(admin, actors, tracker, []);
      const owner = await asCustomer();

      await expect(insertItem(owner, orderId, productId)).resolves.toBeTruthy();
    });

    it('rejects lines once the order is reserved, cancelled or validated', async () => {
      const { productId } = await seedProduct(admin, actors, tracker, { quantity: 5 });
      const reserved = await seedOrder(admin, actors, tracker, [{ type: 'product', id: productId, quantity: 1 }]);
      const owner = await asCustomer();
      await owner.query(`SELECT ${reserveSql}`, [reserved]);
      const cancelled = await seedOrder(admin, actors, tracker, [], { status: 'cancelled' });
      const validated = await seedOrder(admin, actors, tracker, [], { status: 'processing', paymentStatus: 'validated' });

      for (const id of [reserved, cancelled, validated]) {
        await expect(insertItem(owner, id, productId)).rejects.toMatchObject({ code: '42501' });
      }
    });

    it('does not restrict admins or the service connection', async () => {
      const { productId } = await seedProduct(admin, actors, tracker, { quantity: 5 });
      // RLS only lets a user insert lines into their own orders, so use an admin-owned order.
      const orderId = await seedOrder(admin, actors, tracker, [], {
        userId: actors.adminId,
        status: 'processing',
        paymentStatus: 'validated'
      });
      const adminClient = await asAdmin();

      await expect(insertItem(adminClient, orderId, productId)).resolves.toBeTruthy();
      await expect(insertItem(admin, orderId, productId)).resolves.toBeTruthy();
    });
  });

  // The "owner cannot insert movements" check moved to reviewThreeHardening.test.js (W2): the policy is
  // dropped by its own migration, 20261014210000, applied after the front end is deployed.

  describe('restock after consume (W7: explicit admin decision)', () => {
    /** Reserve + validate + consume an order for `quantity` units; returns its id. */
    const consumedOrder = async (productId, quantity) => {
      const orderId = await seedOrder(admin, actors, tracker, [{ type: 'product', id: productId, quantity }]);
      const owner = await asCustomer();
      await owner.query(`SELECT ${reserveSql}`, [orderId]);
      await admin.query(
        `UPDATE public.orders SET payment_status = 'validated', status = 'processing' WHERE id = $1`,
        [orderId]
      );
      const adminClient = await asAdmin();
      await adminClient.query(`SELECT ${consumeSql}`, [orderId]);
      return orderId;
    };
    const cancel = (orderId) =>
      admin.query(`UPDATE public.orders SET status = 'cancelled' WHERE id = $1`, [orderId]);

    it('returns the consumed units, flips allocations to restocked and records a +q movement with the reason', async () => {
      const { productId } = await seedProduct(admin, actors, tracker, { quantity: 5 });
      const orderId = await consumedOrder(productId, 2);
      expect((await readInventory(admin, productId))[0]).toMatchObject({ quantity: 3, reserved: 0 });
      await cancel(orderId);
      const adminClient = await asAdmin();

      const { rows } = await adminClient.query(`SELECT ${restockSql} AS r`, [orderId, 'goods came back']);

      expect(rows[0].r).toMatchObject({ ok: true, restocked: true });
      expect((await readInventory(admin, productId))[0]).toMatchObject({ quantity: 5, reserved: 0 });
      expect((await readAllocations(admin, orderId))[0].state).toBe('restocked');
      expect((await readOrder(admin, orderId)).stock_reserved).toBe(false);
      const mv = await admin.query(
        `SELECT quantity_change, reserved_change, notes FROM public.inventory_movements
          WHERE reference_id = $1 AND movement_type = 'restocked'`,
        [orderId]
      );
      expect(mv.rows).toHaveLength(1);
      expect(mv.rows[0]).toMatchObject({ quantity_change: 2, reserved_change: 0 });
      expect(mv.rows[0].notes).toContain('goods came back');
    });

    it('is idempotent: a second call is nothing_to_restock', async () => {
      const { productId } = await seedProduct(admin, actors, tracker, { quantity: 5 });
      const orderId = await consumedOrder(productId, 2);
      await cancel(orderId);
      const adminClient = await asAdmin();
      await adminClient.query(`SELECT ${restockSql}`, [orderId, 'r']);

      const { rows } = await adminClient.query(`SELECT ${restockSql} AS r`, [orderId, 'r']);

      expect(rows[0].r).toMatchObject({ ok: true, restocked: false, reason: 'nothing_to_restock' });
      expect((await readInventory(admin, productId))[0].quantity).toBe(5);
    });

    it('concurrent double restock restocks exactly once', async () => {
      const { productId } = await seedProduct(admin, actors, tracker, { quantity: 5 });
      const orderId = await consumedOrder(productId, 2);
      await cancel(orderId);
      const workers = await Promise.all(Array.from({ length: 5 }, () => asAdmin()));

      const results = await fireTogether(
        workers.map((client) => ({ client, sql: restockSql, params: [orderId, 'race'] }))
      );

      expect(results.filter((r) => r.error)).toEqual([]);
      expect(results.filter((r) => r.value.restocked === true)).toHaveLength(1);
      expect((await readInventory(admin, productId))[0]).toMatchObject({ quantity: 5, reserved: 0 });
    });

    it('is refused for non-admins, live orders and empty reasons', async () => {
      const { productId } = await seedProduct(admin, actors, tracker, { quantity: 5 });
      const orderId = await consumedOrder(productId, 1);
      const owner = await asCustomer();
      await cancel(orderId);
      await expect(owner.query(`SELECT ${restockSql}`, [orderId, 'x'])).rejects.toMatchObject({ code: '42501' });

      const live = await consumedOrder(productId, 1);
      const adminClient = await asAdmin();
      const notCancelled = await adminClient.query(`SELECT ${restockSql} AS r`, [live, 'x']);
      expect(notCancelled.rows[0].r).toMatchObject({ ok: false, reason: 'order_not_cancelled' });

      for (const reason of ['', '   ', null]) {
        const refused = await adminClient.query(`SELECT ${restockSql} AS r`, [orderId, reason]);
        expect(refused.rows[0].r).toMatchObject({ ok: false, reason: 'reason_required' });
      }
      expect((await readInventory(admin, productId))[0]).toMatchObject({ quantity: 3, reserved: 0 });
    });

    it('release, consume and expire ignore restocked allocations', async () => {
      const { productId } = await seedProduct(admin, actors, tracker, { quantity: 5 });
      const orderId = await consumedOrder(productId, 2);
      await cancel(orderId);
      const adminClient = await asAdmin();
      await adminClient.query(`SELECT ${restockSql}`, [orderId, 'r']);

      const rel = await adminClient.query(`SELECT ${releaseSql} AS r`, [orderId]);
      expect(rel.rows[0].r).toMatchObject({ ok: true, released: false, reason: 'nothing_to_release' });
      const con = await adminClient.query(`SELECT ${consumeSql} AS r`, [orderId]);
      expect(con.rows[0].r).toMatchObject({ ok: false, reason: 'order_not_active' });
      const exp = await adminClient.query('SELECT public.expire_stale_order_reservations(48) AS n');
      expect(exp.rows[0].n).toBe(0);
      expect((await readInventory(admin, productId))[0]).toMatchObject({ quantity: 5, reserved: 0 });
      expect((await readAllocations(admin, orderId))[0].state).toBe('restocked');
    });

    it('reopen after restock re-reserves with an availability check', async () => {
      const { productId } = await seedProduct(admin, actors, tracker, { quantity: 2 });
      const orderId = await consumedOrder(productId, 2);
      await cancel(orderId);
      const adminClient = await asAdmin();
      await adminClient.query(`SELECT ${restockSql}`, [orderId, 'r']);

      // Someone else takes the returned units before the reopen: the reopen is refused.
      const other = await seedOrder(admin, actors, tracker, [{ type: 'product', id: productId, quantity: 1 }]);
      const owner = await asCustomer();
      await owner.query(`SELECT ${reserveSql}`, [other]);
      const refused = await adminClient.query('SELECT public.__test_admin_reopen($1::uuid) AS r', [orderId]);
      expect(refused.rows[0].r).toMatchObject({ ok: false, reason: 'insufficient_stock', available: 1 });
      expect((await readOrder(admin, orderId)).status).toBe('cancelled');

      // Free the units again: the reopen now reserves anew.
      await admin.query(`UPDATE public.orders SET status = 'cancelled' WHERE id = $1`, [other]);
      await owner.query(`SELECT ${releaseSql}`, [other]);
      await adminClient.query(`UPDATE public.orders SET status = 'cancelled' WHERE id = $1`, [orderId]);
      const reopened = await adminClient.query('SELECT public.__test_admin_reopen($1::uuid) AS r', [orderId]);
      expect(reopened.rows[0].r.ok).toBe(true);
      expect((await readInventory(admin, productId))[0]).toMatchObject({ quantity: 2, reserved: 2 });
      expect((await readAllocations(admin, orderId))[0].state).toBe('reserved');
    });

    it('a consumed+cancelled order that is NOT restocked reopens as already_reserved and validates as already_consumed', async () => {
      const { productId } = await seedProduct(admin, actors, tracker, { quantity: 5 });
      const orderId = await consumedOrder(productId, 2);
      await cancel(orderId);
      const adminClient = await asAdmin();

      const reopened = await adminClient.query('SELECT public.__test_admin_reopen($1::uuid) AS r', [orderId]);
      expect(reopened.rows[0].r).toMatchObject({ ok: true, reason: 'already_reserved' });
      await admin.query(`UPDATE public.orders SET payment_status = 'validated', status = 'processing' WHERE id = $1`, [orderId]);
      const again = await adminClient.query(`SELECT ${consumeSql} AS r`, [orderId]);
      expect(again.rows[0].r).toMatchObject({ ok: true, consumed: false, reason: 'already_consumed' });
      expect((await readInventory(admin, productId))[0]).toMatchObject({ quantity: 3, reserved: 0 });
    });

    it('restock racing a reopen ends in one of two consistent states (20 rounds)', async () => {
      for (let round = 0; round < 20; round += 1) {
        const { productId } = await seedProduct(admin, actors, tracker, { quantity: 5 });
        const orderId = await consumedOrder(productId, 1);
        await cancel(orderId);
        const [a, b] = [await asAdmin(), await asAdmin()];

        const results = await fireTogether([
          { client: a, sql: restockSql, params: [orderId, 'race'] },
          { client: b, sql: 'public.__test_admin_reopen($1::uuid)', params: [orderId] }
        ]);

        expect(results.filter((r) => r.error)).toEqual([]);
        const [inv] = await readInventory(admin, productId);
        const [alloc] = await readAllocations(admin, orderId);
        if (results[0].value.restocked === true) {
          // restock won: units are back and the reopen reserved them again
          expect(inv).toMatchObject({ quantity: 5, reserved: 1 });
          expect(alloc.state).toBe('reserved');
        } else {
          // reopen won: stock stays consumed, restock was refused
          expect(results[0].value.reason).toBe('order_not_cancelled');
          expect(inv).toMatchObject({ quantity: 4, reserved: 0 });
          expect(alloc.state).toBe('consumed');
        }
        await endAll(clients.splice(0));
        await cleanup(admin, tracker);
      }
    });
  });

  it('inventory_movements is a real ledger: both sums reproduce the inventory row after any mix of operations', async () => {
    const INITIAL = 20;
    const { productId, inventoryId } = await seedProduct(admin, actors, tracker, { quantity: INITIAL });
    const owner = await asCustomer();
    const adminClient = await asAdmin();
    const mk = async (qty) => {
      const id = await seedOrder(admin, actors, tracker, [{ type: 'product', id: productId, quantity: qty }]);
      await owner.query(`SELECT ${reserveSql}`, [id]);
      return id;
    };
    const validate = (id) =>
      admin.query(`UPDATE public.orders SET payment_status = 'validated', status = 'processing' WHERE id = $1`, [id]);
    const cancel = (id) => admin.query(`UPDATE public.orders SET status = 'cancelled' WHERE id = $1`, [id]);

    const a = await mk(3); // consumed, then cancelled and restocked
    const b = await mk(2); // cancelled + released
    const c = await mk(4); // expired
    const d = await mk(1); // consumed and kept
    const e = await mk(5); // stays reserved
    await validate(a);
    await adminClient.query(`SELECT ${consumeSql}`, [a]);
    await cancel(a);
    await adminClient.query(`SELECT ${restockSql}`, [a, 'returned']);
    await cancel(b);
    await owner.query(`SELECT ${releaseSql}`, [b]);
    await admin.query(`UPDATE public.orders SET stock_reserved_at = now() - interval '100 hours' WHERE id = $1`, [c]);
    await adminClient.query('SELECT public.expire_stale_order_reservations(48) AS n');
    await validate(d);
    await adminClient.query(`SELECT ${consumeSql}`, [d]);
    // reopen the restocked order: reserves again
    await adminClient.query('SELECT public.__test_admin_reopen($1::uuid)', [a]);
    expect(e).toBeTruthy();

    const [inv] = await readInventory(admin, productId);
    const sums = await admin.query(
      `SELECT COALESCE(SUM(quantity_change), 0)::int AS q, COALESCE(SUM(reserved_change), 0)::int AS r
         FROM public.inventory_movements WHERE inventory_id = $1`,
      [inventoryId]
    );
    // The seeded batch is itself ledgered ('initial batch' adjustment of +INITIAL), so the sum is the full quantity.
    expect(sums.rows[0].q).toBe(inv.quantity);
    expect(sums.rows[0].r).toBe(inv.reserved);
    // sanity: the scenario really moved stock (d consumed 1; a reserved 3 again; e reserved 5)
    expect(inv).toMatchObject({ quantity: 19, reserved: 8 });
  });

  it('reopen path: release then reserve again works and re-reserves (stock_reserved flips back)', async () => {
    const { productId } = await seedProduct(admin, actors, tracker, { quantity: 2 });
    const orderId = await seedOrder(admin, actors, tracker, [
      { type: 'product', id: productId, quantity: 2 }
    ]);
    const owner = await asCustomer();
    await owner.query(`SELECT ${reserveSql}`, [orderId]);
    await owner.query(`UPDATE public.orders SET status = 'cancelled', payment_status = 'rejected', rejection_reason = 'x' WHERE id = $1`, [orderId]);
    await owner.query(`SELECT ${releaseSql}`, [orderId]);
    expect((await readInventory(admin, productId))[0].reserved).toBe(0);

    // Someone else takes the stock meanwhile.
    const other = await seedOrder(admin, actors, tracker, [{ type: 'product', id: productId, quantity: 1 }]);
    await owner.query(`SELECT ${reserveSql}`, [other]);

    // Reopen: status back to pending, then reserve -> insufficient -> cancelled again with reason.
    await owner.query(`UPDATE public.orders SET status = 'pending', payment_status = 'pending' WHERE id = $1`, [orderId]);
    const { rows } = await owner.query(`SELECT ${reserveSql} AS r`, [orderId]);
    expect(rows[0].r).toMatchObject({ ok: false, reason: 'insufficient_stock' });
    expect(await readOrder(admin, orderId)).toMatchObject({ status: 'cancelled', stock_reserved: false });
    expect((await readInventory(admin, productId))[0].reserved).toBe(1);
  });

  it('SECURITY DEFINER functions are owned by postgres (guard bypass relies on current_user)', async () => {
    const { rows } = await admin.query(
      `SELECT proname, proowner::regrole::text AS owner, prosecdef,
              array_to_string(proconfig, ',') AS cfg
         FROM pg_proc
        WHERE pronamespace = 'public'::regnamespace
          AND proname IN ('reserve_order_inventory','release_order_inventory','consume_order_inventory','expire_stale_order_reservations')`
    );
    expect(rows).toHaveLength(4);
    for (const r of rows) {
      expect(r.owner).toBe('postgres');
      expect(r.prosecdef).toBe(true);
      expect(r.cfg).toContain('search_path=public');
    }
  });
});
