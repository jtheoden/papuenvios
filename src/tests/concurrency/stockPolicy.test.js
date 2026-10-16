/**
 * Configurable stock reservation policy (system_config keys stock_*), read by
 * reserve_order_inventory / expire_stale_order_reservations and written only by
 * set_stock_policy / reset_stock_policy (super_admin). Local Postgres only.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { dbSuiteSkipReason, connectAdmin, connectAs, connectAnon, fireTogether, endAll } from './db';
import {
  loadActors,
  createTracker,
  seedProduct,
  seedOrder,
  cleanup,
  readOrder,
  setStockPolicyRows,
  restoreStockPolicyRows
} from './fixtures';

const skipReason = await dbSuiteSkipReason({ functions: ['reserve_order_inventory', 'expire_stale_order_reservations', 'set_stock_policy', 'reset_stock_policy', 'get_stock_policy'], tables: ['orders', 'inventory', 'system_config'] });
const describeDb = skipReason ? describe.skip : describe;

const KEYS = ['stock_unpaid_expiry_hours', 'stock_proof_expiry_hours', 'stock_max_open_reservations'];
const reserveSql = 'public.reserve_order_inventory($1::uuid)';

describeDb('stock policy (system_config)', () => {
  let admin;
  let actors;
  const tracker = createTracker();
  const clients = [];

  const as = async (userId) => {
    const c = await connectAs(userId);
    clients.push(c);
    return c;
  };
  const asSuper = async () => {
    await admin.query(`UPDATE public.user_profiles SET role = 'super_admin' WHERE id = $1`, [actors.adminId]);
    return as(actors.adminId);
  };
  const asAdmin = () => as(actors.adminId);
  const asCustomer = () => as(actors.customerId);

  const rows = async () => {
    const { rows: r } = await admin.query(
      `SELECT key, value_numeric::int AS v, description FROM public.system_config WHERE key = ANY($1) ORDER BY key`,
      [KEYS]
    );
    return Object.fromEntries(r.map((x) => [x.key, x]));
  };

  beforeAll(async () => {
    admin = await connectAdmin();
    actors = await loadActors(admin);
  });

  afterEach(async () => {
    await endAll(clients.splice(0));
    await cleanup(admin, tracker);
    await restoreStockPolicyRows(admin);
    await admin.query(`UPDATE public.user_profiles SET role = 'admin' WHERE id = $1`, [actors.adminId]);
  });

  afterAll(async () => {
    await admin.end();
  });

  it('the migration seeds the three approved defaults with descriptions', async () => {
    const r = await rows();
    expect(r.stock_unpaid_expiry_hours.v).toBe(48);
    expect(r.stock_proof_expiry_hours.v).toBe(168);
    expect(r.stock_max_open_reservations.v).toBe(5);
    for (const key of KEYS) expect(r[key].description.length).toBeGreaterThan(20);
  });

  it('get_stock_policy returns effective values, defaults and bounds to admins', async () => {
    const adminClient = await asAdmin();

    const { rows: out } = await adminClient.query('SELECT public.get_stock_policy() AS p');

    expect(out[0].p).toMatchObject({
      unpaid_hours: 48,
      proof_hours: 168,
      max_open_reservations: 5,
      defaults: { unpaid_hours: 48, proof_hours: 168, max_open_reservations: 5 },
      bounds: {
        unpaid_hours: { min: 6, max: 720 },
        proof_hours: { min: 24, max: 2160 },
        max_open_reservations: { min: 1, max: 50 }
      }
    });
  });

  it('get_stock_policy is refused to customers and anon', async () => {
    const customer = await asCustomer();
    await expect(customer.query('SELECT public.get_stock_policy()')).rejects.toMatchObject({ code: '42501' });
    const anon = await connectAnon();
    clients.push(anon);
    await expect(anon.query('SELECT public.get_stock_policy()')).rejects.toMatchObject({ code: '42501' });
  });

  it('super_admin can set the policy and the three rows change together', async () => {
    const superAdmin = await asSuper();

    const { rows: out } = await superAdmin.query('SELECT public.set_stock_policy(12, 72, 3) AS p');

    expect(out[0].p).toMatchObject({ unpaid_hours: 12, proof_hours: 72, max_open_reservations: 3 });
    const r = await rows();
    expect([r.stock_unpaid_expiry_hours.v, r.stock_proof_expiry_hours.v, r.stock_max_open_reservations.v]).toEqual([
      12, 72, 3
    ]);
  });

  it('set and reset are refused to plain admins and customers (42501) and to anon', async () => {
    const adminClient = await asAdmin();
    const customer = await asCustomer();
    const anon = await connectAnon();
    clients.push(anon);

    for (const c of [adminClient, customer, anon]) {
      await expect(c.query('SELECT public.set_stock_policy(12, 72, 3)')).rejects.toMatchObject({ code: '42501' });
      await expect(c.query('SELECT public.reset_stock_policy()')).rejects.toMatchObject({ code: '42501' });
    }
    expect((await rows()).stock_max_open_reservations.v).toBe(5);
  });

  it.each([
    ['unpaid below floor', [5, 168, 5]],
    ['unpaid above max', [721, 2160, 5]],
    ['proof below floor', [6, 23, 5]],
    ['proof above max', [48, 2161, 5]],
    ['proof lower than unpaid', [100, 50, 5]],
    ['max_open below 1', [48, 168, 0]],
    ['max_open above 50', [48, 168, 51]],
    ['null argument', [48, null, 5]]
  ])('rejects out-of-bounds values with 22023 (%s) and writes nothing', async (_label, args) => {
    const superAdmin = await asSuper();

    await expect(
      superAdmin.query('SELECT public.set_stock_policy($1::int, $2::int, $3::int)', args)
    ).rejects.toMatchObject({ code: '22023' });

    const r = await rows();
    expect([r.stock_unpaid_expiry_hours.v, r.stock_proof_expiry_hours.v, r.stock_max_open_reservations.v]).toEqual([
      48, 168, 5
    ]);
  });

  it('accepts the exact bounds', async () => {
    const superAdmin = await asSuper();
    await expect(superAdmin.query('SELECT public.set_stock_policy(6, 24, 1)')).resolves.toBeTruthy();
    await expect(superAdmin.query('SELECT public.set_stock_policy(720, 2160, 50)')).resolves.toBeTruthy();
  });

  it('reset_stock_policy restores the approved defaults', async () => {
    const superAdmin = await asSuper();
    await superAdmin.query('SELECT public.set_stock_policy(12, 72, 3)');

    const { rows: out } = await superAdmin.query('SELECT public.reset_stock_policy() AS p');

    expect(out[0].p).toMatchObject({ unpaid_hours: 48, proof_hours: 168, max_open_reservations: 5 });
    expect((await rows()).stock_unpaid_expiry_hours.v).toBe(48);
  });

  it('admins cannot write the stock keys directly (the system_config write policies are not widened)', async () => {
    const adminClient = await asAdmin();

    const update = await adminClient.query(
      `UPDATE public.system_config SET value_numeric = 1 WHERE key = 'stock_max_open_reservations'`
    );
    expect(update.rowCount).toBe(0);
    await expect(
      adminClient.query(`INSERT INTO public.system_config (key, value_numeric) VALUES ('stock_evil', 1)`)
    ).rejects.toMatchObject({ code: '42501' });
    expect((await rows()).stock_max_open_reservations.v).toBe(5);
  });

  it('concurrent set calls never leave a mixed policy (all three values come from one call)', async () => {
    const workers = await Promise.all(Array.from({ length: 6 }, () => asSuper()));

    const results = await fireTogether(
      workers.map((client, i) => ({
        client,
        sql: 'public.set_stock_policy($1::int, $2::int, $3::int)',
        params: [10 + i, 100 + i, 1 + i]
      }))
    );

    expect(results.filter((r) => r.error)).toEqual([]);
    const r = await rows();
    const i = r.stock_unpaid_expiry_hours.v - 10;
    expect(r.stock_proof_expiry_hours.v).toBe(100 + i);
    expect(r.stock_max_open_reservations.v).toBe(1 + i);
  });

  describe('the configured values drive the RPCs', () => {
    it('reserve honours the configured cap: with 2, the third open reservation is refused', async () => {
      const superAdmin = await asSuper();
      await superAdmin.query('SELECT public.set_stock_policy(48, 168, 2)');
      const { productId } = await seedProduct(admin, actors, tracker, { quantity: 50 });
      const customer = await asCustomer();
      const results = [];
      for (let i = 0; i < 3; i += 1) {
        const id = await seedOrder(admin, actors, tracker, [{ type: 'product', id: productId, quantity: 1 }]);
        const { rows: out } = await customer.query(`SELECT ${reserveSql} AS r`, [id]);
        results.push(out[0].r);
      }

      expect(results.map((r) => r.ok)).toEqual([true, true, false]);
      expect(results[2].reason).toBe('too_many_open_reservations');
    });

    it('expire() with no arguments uses the configured windows', async () => {
      const superAdmin = await asSuper();
      await superAdmin.query('SELECT public.set_stock_policy(6, 24, 5)');
      const { productId } = await seedProduct(admin, actors, tracker, { quantity: 50 });
      const customer = await asCustomer();
      const mk = async (paymentStatus, hours) => {
        const id = await seedOrder(admin, actors, tracker, [{ type: 'product', id: productId, quantity: 1 }]);
        await customer.query(`SELECT ${reserveSql}`, [id]);
        await admin.query(
          `UPDATE public.orders SET payment_status = $2, stock_reserved_at = now() - make_interval(hours => $3) WHERE id = $1`,
          [id, paymentStatus, hours]
        );
        return id;
      };
      const unpaid10 = await mk('pending', 10); // > 6 h  -> expires
      const unpaid3 = await mk('pending', 3); // < 6 h  -> kept
      const proof30 = await mk('proof_uploaded', 30); // > 24 h -> expires
      const proof20 = await mk('proof_uploaded', 20); // < 24 h -> kept

      const { rows: out } = await superAdmin.query('SELECT public.expire_stale_order_reservations() AS n');

      expect(out[0].n).toBe(2);
      expect((await readOrder(admin, unpaid10)).status).toBe('cancelled');
      expect((await readOrder(admin, unpaid3)).status).toBe('pending');
      expect((await readOrder(admin, proof30)).status).toBe('cancelled');
      expect((await readOrder(admin, proof20)).status).toBe('pending');
    });

    it('explicit arguments override the configuration and keep the 6 h / 24 h floors', async () => {
      const superAdmin = await asSuper();
      await superAdmin.query('SELECT public.set_stock_policy(6, 24, 5)');
      const { productId } = await seedProduct(admin, actors, tracker, { quantity: 50 });
      const customer = await asCustomer();
      const id = await seedOrder(admin, actors, tracker, [{ type: 'product', id: productId, quantity: 1 }]);
      await customer.query(`SELECT ${reserveSql}`, [id]);
      await admin.query(`UPDATE public.orders SET stock_reserved_at = now() - interval '10 hours' WHERE id = $1`, [id]);

      const kept = await superAdmin.query('SELECT public.expire_stale_order_reservations(48, 168) AS n');
      expect(kept.rows[0].n).toBe(0);
      await expect(superAdmin.query('SELECT public.expire_stale_order_reservations(5, 168)')).rejects.toMatchObject({
        code: '22023'
      });
      await expect(superAdmin.query('SELECT public.expire_stale_order_reservations(48, 23)')).rejects.toMatchObject({
        code: '22023'
      });
      expect((await readOrder(admin, id)).status).toBe('pending');
    });

    it('missing config rows fall back to 48 / 168 / 5 and never break reserve or expire', async () => {
      await admin.query(`DELETE FROM public.system_config WHERE key = ANY($1)`, [KEYS]);
      const adminClient = await asAdmin();
      const { rows: out } = await adminClient.query('SELECT public.get_stock_policy() AS p');
      expect(out[0].p).toMatchObject({ unpaid_hours: 48, proof_hours: 168, max_open_reservations: 5 });

      const { productId } = await seedProduct(admin, actors, tracker, { quantity: 50 });
      const customer = await asCustomer();
      const oks = [];
      for (let i = 0; i < 6; i += 1) {
        const id = await seedOrder(admin, actors, tracker, [{ type: 'product', id: productId, quantity: 1 }]);
        const { rows: res } = await customer.query(`SELECT ${reserveSql} AS r`, [id]);
        oks.push(res[0].r.ok);
        if (i === 0) {
          await admin.query(`UPDATE public.orders SET stock_reserved_at = now() - interval '72 hours' WHERE id = $1`, [id]);
        }
      }
      expect(oks).toEqual([true, true, true, true, true, false]);
      const exp = await adminClient.query('SELECT public.expire_stale_order_reservations() AS n');
      expect(exp.rows[0].n).toBe(1);
    });

    it('a garbage config value (0 or negative) falls back to the default instead of locking everyone out', async () => {
      await setStockPolicyRows(admin, { stock_max_open_reservations: 0 });
      const { productId } = await seedProduct(admin, actors, tracker, { quantity: 5 });
      const id = await seedOrder(admin, actors, tracker, [{ type: 'product', id: productId, quantity: 1 }]);
      const customer = await asCustomer();

      const { rows: out } = await customer.query(`SELECT ${reserveSql} AS r`, [id]);

      expect(out[0].r.ok).toBe(true);
    });
  });
});
