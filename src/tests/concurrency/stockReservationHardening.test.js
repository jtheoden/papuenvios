/**
 * Second adversarial review hardening (W1-W4, S1, S5). Local Postgres only; skipped when unreachable.
 *  W1  expiry sweep: per-order exception isolation + clamped, truthful release
 *  W2  AFTER UPDATE OF status trigger releases the reservation on ANY cancel path
 *  W3  order_items guard takes a FOR SHARE lock on the order (no item/reserve race)
 *  W4  policy changes are audited inside the database
 *  S1  per-key bounds when reading the policy
 *  S5  consume answers 'no_allocations' instead of a fake 'already_consumed'
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { dbSuiteSkipReason, connectAdmin, connectAs, fireTogether, endAll } from './db';
import {
  loadActors,
  createTracker,
  seedProduct,
  seedOrder,
  cleanup,
  readInventory,
  readOrder,
  readAllocations,
  setStockPolicyRows,
  restoreStockPolicyRows
} from './fixtures';

const skipReason = await dbSuiteSkipReason({ functions: ['reserve_order_inventory', 'release_order_inventory', 'consume_order_inventory', 'expire_stale_order_reservations'], tables: ['orders', 'order_items', 'inventory', 'inventory_movements', 'order_stock_allocations', 'system_config'] });
const describeDb = skipReason ? describe.skip : describe;

const reserveSql = 'public.reserve_order_inventory($1::uuid)';
const releaseSql = 'public.release_order_inventory($1::uuid)';
const expireSql = 'public.expire_stale_order_reservations()';

describeDb('stock reservation hardening (local Postgres)', () => {
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

  const movements = async (orderId, type) => {
    const { rows } = await admin.query(
      `SELECT quantity_change, reserved_change FROM public.inventory_movements
        WHERE reference_id = $1 AND movement_type = $2`,
      [orderId, type]
    );
    return rows;
  };
  const makeStale = (orderId, hours = 72) =>
    admin.query(`UPDATE public.orders SET stock_reserved_at = now() - make_interval(hours => $2) WHERE id = $1`, [
      orderId,
      hours
    ]);

  beforeAll(async () => {
    admin = await connectAdmin();
    actors = await loadActors(admin);
    await admin.query(`
      CREATE OR REPLACE FUNCTION public.__test_cancel_direct(p_order_id uuid) RETURNS boolean
      LANGUAGE plpgsql SECURITY INVOKER AS $fn$
      BEGIN
        UPDATE public.orders SET status = 'cancelled' WHERE id = p_order_id;
        RETURN true;
      END
      $fn$`);
  });

  afterEach(async () => {
    await endAll(clients.splice(0));
    await admin.query('DROP TRIGGER IF EXISTS __test_boom ON public.orders');
    await admin.query('DROP FUNCTION IF EXISTS public.__test_boom()');
    await admin.query(`SET session_replication_role = DEFAULT`);
    await cleanup(admin, tracker);
    await restoreStockPolicyRows(admin);
    await admin.query(`DELETE FROM public.activity_logs WHERE entity_type = 'system_config' AND action LIKE 'stock_policy_%'`);
    await admin.query(`UPDATE public.user_profiles SET role = 'admin' WHERE id = $1`, [actors.adminId]);
  });

  afterAll(async () => {
    await admin.query('DROP FUNCTION IF EXISTS public.__test_cancel_direct(uuid)');
    await admin.end();
  });

  describe('W1 expiry sweep isolation and clamped release', () => {
    it('one order that fails to expire does not abort the sweep: the others are released and counted', async () => {
      await setStockPolicyRows(admin, { stock_max_open_reservations: 50 });
      const { productId } = await seedProduct(admin, actors, tracker, { quantity: 10 });
      const customer = await asCustomer();
      const ids = [];
      for (let i = 0; i < 3; i += 1) {
        const id = await seedOrder(admin, actors, tracker, [{ type: 'product', id: productId, quantity: 1 }]);
        await customer.query(`SELECT ${reserveSql}`, [id]);
        await makeStale(id);
        ids.push(id);
      }
      const poisoned = ids[1];
      await admin.query(`
        CREATE FUNCTION public.__test_boom() RETURNS trigger LANGUAGE plpgsql AS $fn$
        BEGIN
          IF NEW.id = '${poisoned}'::uuid AND NEW.rejection_reason = 'reservation_expired' THEN
            RAISE EXCEPTION 'boom';
          END IF;
          RETURN NEW;
        END $fn$`);
      await admin.query(
        `CREATE TRIGGER __test_boom BEFORE UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.__test_boom()`
      );

      const adminClient = await asAdmin();
      const { rows } = await adminClient.query(`SELECT ${expireSql} AS n`);

      expect(rows[0].n).toBe(2);
      expect((await readOrder(admin, ids[0])).status).toBe('cancelled');
      expect((await readOrder(admin, ids[2])).status).toBe('cancelled');
      expect(await readOrder(admin, poisoned)).toMatchObject({ status: 'pending', stock_reserved: true });
      expect((await readInventory(admin, productId))[0].reserved).toBe(1);
    });

    it('release never drives reserved_quantity negative and the ledger records the real delta', async () => {
      const { productId, inventoryId } = await seedProduct(admin, actors, tracker, { quantity: 5 });
      const orderId = await seedOrder(admin, actors, tracker, [{ type: 'product', id: productId, quantity: 3 }]);
      const customer = await asCustomer();
      await customer.query(`SELECT ${reserveSql}`, [orderId]);
      // Drift: somebody zeroed the counter behind our back (e.g. a manual inventory edit).
      await admin.query(`UPDATE public.inventory SET reserved_quantity = 1 WHERE id = $1`, [inventoryId]);

      await customer.query(
        `UPDATE public.orders SET status = 'cancelled', payment_status = 'rejected', rejection_reason = 'cancelled_by_user' WHERE id = $1`,
        [orderId]
      );

      const [inv] = await readInventory(admin, productId);
      expect(inv.reserved).toBe(0);
      expect(await readAllocations(admin, orderId)).toEqual([expect.objectContaining({ state: 'released' })]);
      expect(await movements(orderId, 'released')).toEqual([{ quantity_change: 0, reserved_change: -1 }]);
    });
  });

  describe('W2 cancel releases through the trigger, on every path', () => {
    it('an owner direct UPDATE to cancelled releases the reservation without any RPC', async () => {
      const { productId } = await seedProduct(admin, actors, tracker, { quantity: 4 });
      const orderId = await seedOrder(admin, actors, tracker, [{ type: 'product', id: productId, quantity: 2 }]);
      const customer = await asCustomer();
      await customer.query(`SELECT ${reserveSql}`, [orderId]);
      expect((await readInventory(admin, productId))[0].reserved).toBe(2);

      await customer.query(
        `UPDATE public.orders SET status = 'cancelled', payment_status = 'rejected', rejection_reason = 'cancelled_by_user' WHERE id = $1`,
        [orderId]
      );

      expect((await readInventory(admin, productId))[0].reserved).toBe(0);
      expect(await readOrder(admin, orderId)).toMatchObject({ status: 'cancelled', stock_reserved: false });
      expect(await readAllocations(admin, orderId)).toEqual([expect.objectContaining({ state: 'released' })]);
    });

    it('a service-role style cancel (admin connection) releases too, and release_order_inventory afterwards is a no-op', async () => {
      const { productId } = await seedProduct(admin, actors, tracker, { quantity: 4 });
      const orderId = await seedOrder(admin, actors, tracker, [{ type: 'product', id: productId, quantity: 2 }]);
      const customer = await asCustomer();
      await customer.query(`SELECT ${reserveSql}`, [orderId]);

      await admin.query(`UPDATE public.orders SET status = 'cancelled' WHERE id = $1`, [orderId]);
      const { rows } = await customer.query(`SELECT ${releaseSql} AS r`, [orderId]);

      expect(rows[0].r).toMatchObject({ ok: true, reason: 'nothing_to_release', released: false });
      expect((await readInventory(admin, productId))[0].reserved).toBe(0);
      expect(await movements(orderId, 'released')).toHaveLength(1);
    });

    it('a consumed order that is cancelled keeps its consumed allocations (no automatic restock)', async () => {
      const { productId } = await seedProduct(admin, actors, tracker, { quantity: 4 });
      const orderId = await seedOrder(admin, actors, tracker, [{ type: 'product', id: productId, quantity: 2 }]);
      const customer = await asCustomer();
      await customer.query(`SELECT ${reserveSql}`, [orderId]);
      await admin.query(`UPDATE public.orders SET payment_status = 'validated', status = 'processing' WHERE id = $1`, [orderId]);
      const adminClient = await asAdmin();
      await adminClient.query(`SELECT public.consume_order_inventory($1::uuid)`, [orderId]);

      await adminClient.query(`UPDATE public.orders SET status = 'cancelled' WHERE id = $1`, [orderId]);

      const [inv] = await readInventory(admin, productId);
      expect(inv).toMatchObject({ quantity: 2, reserved: 0 });
      expect(await readAllocations(admin, orderId)).toEqual([expect.objectContaining({ state: 'consumed' })]);
    });

    it('cancel N / create N / reopen: a directly cancelled order cannot be reopened past the cap', async () => {
      await setStockPolicyRows(admin, { stock_max_open_reservations: 2 });
      const { productId } = await seedProduct(admin, actors, tracker, { quantity: 20 });
      const customer = await asCustomer();
      const first = [];
      for (let i = 0; i < 2; i += 1) {
        const id = await seedOrder(admin, actors, tracker, [{ type: 'product', id: productId, quantity: 1 }]);
        await customer.query(`SELECT ${reserveSql}`, [id]);
        first.push(id);
      }
      for (const id of first) {
        await customer.query(
          `UPDATE public.orders SET status = 'cancelled', payment_status = 'rejected', rejection_reason = 'cancelled_by_user' WHERE id = $1`,
          [id]
        );
      }
      // The two cancelled orders no longer count: two fresh ones fit.
      for (let i = 0; i < 2; i += 1) {
        const id = await seedOrder(admin, actors, tracker, [{ type: 'product', id: productId, quantity: 1 }]);
        const { rows } = await customer.query(`SELECT ${reserveSql} AS r`, [id]);
        expect(rows[0].r.ok).toBe(true);
      }

      // Reopening one of the old ones (status back to pending, then reserve) hits the cap.
      await admin.query(`UPDATE public.orders SET status = 'pending', payment_status = 'pending' WHERE id = $1`, [first[0]]);
      const { rows } = await customer.query(`SELECT ${reserveSql} AS r`, [first[0]]);

      expect(rows[0].r).toMatchObject({ ok: false, reason: 'too_many_open_reservations' });
      expect((await readInventory(admin, productId))[0].reserved).toBe(2);
    });

    it('the cap counts every order that still holds a reserved allocation, whatever its status', async () => {
      await setStockPolicyRows(admin, { stock_max_open_reservations: 1 });
      const { productId } = await seedProduct(admin, actors, tracker, { quantity: 5 });
      const customer = await asCustomer();
      const a = await seedOrder(admin, actors, tracker, [{ type: 'product', id: productId, quantity: 1 }]);
      await customer.query(`SELECT ${reserveSql}`, [a]);
      // Orphan: cancelled while the release trigger was bypassed (replica role), allocation still reserved.
      await admin.query(`SET session_replication_role = replica`);
      await admin.query(`UPDATE public.orders SET status = 'cancelled' WHERE id = $1`, [a]);
      await admin.query(`SET session_replication_role = DEFAULT`);
      expect(await readAllocations(admin, a)).toEqual([expect.objectContaining({ state: 'reserved' })]);

      const b = await seedOrder(admin, actors, tracker, [{ type: 'product', id: productId, quantity: 1 }]);
      const { rows } = await customer.query(`SELECT ${reserveSql} AS r`, [b]);

      expect(rows[0].r).toMatchObject({ ok: false, reason: 'too_many_open_reservations' });
    });

    it('consumed (validated) orders do not count against the cap', async () => {
      await setStockPolicyRows(admin, { stock_max_open_reservations: 1 });
      const { productId } = await seedProduct(admin, actors, tracker, { quantity: 5 });
      const customer = await asCustomer();
      const adminClient = await asAdmin();
      const a = await seedOrder(admin, actors, tracker, [{ type: 'product', id: productId, quantity: 1 }]);
      await customer.query(`SELECT ${reserveSql}`, [a]);
      await admin.query(`UPDATE public.orders SET payment_status = 'validated', status = 'processing' WHERE id = $1`, [a]);
      await adminClient.query(`SELECT public.consume_order_inventory($1::uuid)`, [a]);

      const b = await seedOrder(admin, actors, tracker, [{ type: 'product', id: productId, quantity: 1 }]);
      const { rows } = await customer.query(`SELECT ${reserveSql} AS r`, [b]);

      expect(rows[0].r.ok).toBe(true);
    });

    it('cancel (direct UPDATE) racing release RPC and the expiry sweep releases exactly once (15 rounds)', async () => {
      const { productId } = await seedProduct(admin, actors, tracker, { quantity: 50 });
      for (let round = 0; round < 15; round += 1) {
        const orderId = await seedOrder(admin, actors, tracker, [{ type: 'product', id: productId, quantity: 2 }]);
        const owner = await asCustomer();
        await owner.query(`SELECT ${reserveSql}`, [orderId]);
        await makeStale(orderId);
        const ownerCancel = await asCustomer();
        const releaser = await asCustomer();
        const sweeper = await asAdmin();

        const results = await fireTogether([
          {
            client: ownerCancel,
            sql: 'public.__test_cancel_direct($1::uuid)',
            params: [orderId]
          },
          { client: releaser, sql: releaseSql, params: [orderId] },
          { client: sweeper, sql: expireSql }
        ]).catch((e) => [{ error: e }]);

        expect(results.filter((r) => r.error)).toEqual([]);
        const [inv] = await readInventory(admin, productId);
        expect(inv.reserved).toBe(0);
        expect(await movements(orderId, 'released')).toHaveLength(1);
        expect((await readOrder(admin, orderId)).status).toBe('cancelled');
        await admin.query(`DELETE FROM public.orders WHERE id = $1`, [orderId]);
      }
    });
  });

  describe('W3 order_items guard serializes against reserve', () => {
    it('an item insert in flight makes reserve wait, and the reservation then covers the new line', async () => {
      const { productId } = await seedProduct(admin, actors, tracker, { quantity: 10 });
      const orderId = await seedOrder(admin, actors, tracker, [{ type: 'product', id: productId, quantity: 1 }]);
      const inserter = await asCustomer();
      const reserver = await asCustomer();

      await inserter.query('BEGIN');
      await inserter.query(
        `INSERT INTO public.order_items (order_id, item_type, item_id, item_name_es, item_name_en, quantity, unit_price, total_price)
         VALUES ($1, 'product', $2, 'x', 'x', 2, 5, 10)`,
        [orderId, productId]
      );
      let settled = false;
      const reserving = reserver.query(`SELECT ${reserveSql} AS r`, [orderId]).then((res) => {
        settled = true;
        return res;
      });
      await new Promise((resolve) => setTimeout(resolve, 400));
      const waitedForInserter = settled === false;
      await inserter.query('COMMIT');
      const { rows } = await reserving;

      expect(waitedForInserter).toBe(true);
      expect(rows[0].r.ok).toBe(true);
      expect((await readInventory(admin, productId))[0].reserved).toBe(3);
    });
  });

  describe('W4 policy audit lives in the database', () => {
    const auditRows = async (action) => {
      const { rows } = await admin.query(
        `SELECT action, entity_type, performed_by, description, metadata
           FROM public.activity_logs
          WHERE entity_type = 'system_config' AND action = $1
          ORDER BY created_at DESC`,
        [action]
      );
      return rows;
    };

    it('set_stock_policy writes one audit row with before/after and the actor', async () => {
      const superClient = await asSuper();
      await superClient.query('SELECT public.set_stock_policy(24, 100, 7)');

      const logs = await auditRows('stock_policy_updated');

      expect(logs).toHaveLength(1);
      expect(logs[0].performed_by).toBe(actors.adminId);
      expect(logs[0].metadata).toEqual({
        before: { unpaid_hours: 48, proof_hours: 168, max_open_reservations: 5 },
        after: { unpaid_hours: 24, proof_hours: 100, max_open_reservations: 7 }
      });
    });

    it('reset_stock_policy writes exactly one stock_policy_reset row (not an update row too)', async () => {
      const superClient = await asSuper();
      await superClient.query('SELECT public.set_stock_policy(24, 100, 7)');
      await admin.query(`DELETE FROM public.activity_logs WHERE entity_type = 'system_config' AND action LIKE 'stock_policy_%'`);

      await superClient.query('SELECT public.reset_stock_policy()');

      expect(await auditRows('stock_policy_updated')).toHaveLength(0);
      const logs = await auditRows('stock_policy_reset');
      expect(logs).toHaveLength(1);
      expect(logs[0].metadata).toEqual({
        before: { unpaid_hours: 24, proof_hours: 100, max_open_reservations: 7 },
        after: { unpaid_hours: 48, proof_hours: 168, max_open_reservations: 5 }
      });
    });

    it('a refused change (non super_admin or out of bounds) leaves no audit row', async () => {
      const plain = await asAdmin();
      await expect(plain.query('SELECT public.set_stock_policy(24, 100, 7)')).rejects.toMatchObject({ code: '42501' });
      const superClient = await asSuper();
      await expect(superClient.query('SELECT public.set_stock_policy(1, 100, 7)')).rejects.toMatchObject({ code: '22023' });

      expect(await auditRows('stock_policy_updated')).toHaveLength(0);
    });
  });

  describe('S1 per-key bounds when reading the policy', () => {
    const effective = async () => {
      const adminClient = await asAdmin();
      const { rows } = await adminClient.query('SELECT public.get_stock_policy() AS p');
      return rows[0].p;
    };

    it.each([
      ['3000000000 (integer overflow)', 3000000000],
      ['1000000 (above the max)', 1000000],
      ['0', 0],
      ['-4', -4],
      ['5.5 (fractional)', 5.5]
    ])('an out-of-range or fractional value %s falls back to the default for every key', async (_label, bad) => {
      await admin.query(`UPDATE public.system_config SET value_numeric = $1 WHERE key = ANY($2)`, [
        bad,
        ['stock_unpaid_expiry_hours', 'stock_proof_expiry_hours', 'stock_max_open_reservations']
      ]);

      expect(await effective()).toMatchObject({ unpaid_hours: 48, proof_hours: 168, max_open_reservations: 5 });
    });

    it('values inside the per-key bounds are honoured, outside are not (unpaid 6..720, proof 24..2160, cap 1..50)', async () => {
      await setStockPolicyRows(admin, {
        stock_unpaid_expiry_hours: 5, // below its min 6
        stock_proof_expiry_hours: 24, // exact min
        stock_max_open_reservations: 51 // above its max 50
      });

      expect(await effective()).toMatchObject({ unpaid_hours: 48, proof_hours: 24, max_open_reservations: 5 });
    });
  });

  describe('S5 consume with nothing to consume', () => {
    it('a managed order flagged reserved but without allocations is refused as no_allocations, not "already_consumed"', async () => {
      const { productId } = await seedProduct(admin, actors, tracker, { quantity: 5 });
      const orderId = await seedOrder(admin, actors, tracker, [{ type: 'product', id: productId, quantity: 1 }], {
        status: 'processing',
        paymentStatus: 'validated'
      });
      await admin.query(`UPDATE public.orders SET stock_reserved = true WHERE id = $1`, [orderId]);
      const adminClient = await asAdmin();

      const { rows } = await adminClient.query(`SELECT public.consume_order_inventory($1::uuid) AS r`, [orderId]);

      expect(rows[0].r).toMatchObject({ ok: false, reason: 'no_allocations', consumed: false });
      expect((await readInventory(admin, productId))[0]).toMatchObject({ quantity: 5, reserved: 0 });
    });

    it('a second consume of a consumed order is still the idempotent already_consumed', async () => {
      const { productId } = await seedProduct(admin, actors, tracker, { quantity: 5 });
      const orderId = await seedOrder(admin, actors, tracker, [{ type: 'product', id: productId, quantity: 1 }]);
      const customer = await asCustomer();
      await customer.query(`SELECT ${reserveSql}`, [orderId]);
      await admin.query(`UPDATE public.orders SET payment_status = 'validated', status = 'processing' WHERE id = $1`, [orderId]);
      const adminClient = await asAdmin();
      await adminClient.query(`SELECT public.consume_order_inventory($1::uuid)`, [orderId]);

      const { rows } = await adminClient.query(`SELECT public.consume_order_inventory($1::uuid) AS r`, [orderId]);

      expect(rows[0].r).toMatchObject({ ok: true, reason: 'already_consumed', consumed: false });
    });
  });

  it('S2 every SECURITY DEFINER function pins search_path to public, pg_temp', async () => {
    const { rows } = await admin.query(`
      SELECT p.proname, p.proconfig
        FROM pg_proc p
       WHERE p.pronamespace = 'public'::regnamespace
         AND p.prosecdef
         AND p.proname = ANY($1)`, [[
      '_stock_policy_int', 'get_stock_policy', 'set_stock_policy', 'reset_stock_policy',
      '_reserve_order_locked', '_release_order_locked', '_consume_order_locked',
      'reserve_order_inventory', 'release_order_inventory', 'consume_order_inventory',
      'restock_order_inventory', 'expire_stale_order_reservations', 'release_stock_on_order_cancel',
      '_apply_stock_policy'
    ]]);
    expect(rows.length).toBe(14);
    for (const r of rows) {
      expect(r.proconfig, r.proname).toContain('search_path=public, pg_temp');
    }
  });

});
