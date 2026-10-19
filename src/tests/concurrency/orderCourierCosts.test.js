/**
 * order_courier_costs: per-order courier cost snapshot taken by an AFTER INSERT trigger on orders
 * (supabase/migrations/20261019140000_order_courier_costs.sql). Local Postgres only.
 *
 * The cost is admin-only data: customers share the `authenticated` role with admins, so visibility is
 * enforced by RLS on is_admin_user(), and nobody but the SECURITY DEFINER trigger can write.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { dbSuiteSkipReason, connectAdmin, connectAs, connectAnon, endAll } from './db';
import { loadActors } from './fixtures';

const skipReason = await dbSuiteSkipReason({ tables: ['orders', 'shipping_zones', 'order_courier_costs'] });
const describeDb = skipReason ? describe.skip : describe;

const MIGRATION = 'supabase/migrations/20261019140000_order_courier_costs.sql';

describe('order_courier_costs migration (static)', () => {
  const sql = readFileSync(resolve(process.cwd(), MIGRATION), 'utf8');

  it('hardens the trigger function and swallows its own errors', () => {
    expect(sql).toMatch(/SECURITY DEFINER/);
    expect(sql).toMatch(/SET search_path = public, pg_temp/);
    expect(sql).toMatch(/EXCEPTION\s+WHEN OTHERS THEN/);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.snapshot_order_courier_cost\(\) FROM PUBLIC, anon, authenticated/);
  });

  it('is admin-read only, never writable by API roles, never realtime, and documents the rollback', () => {
    expect(sql).toMatch(/REVOKE ALL ON TABLE public\.order_courier_costs FROM PUBLIC, anon, authenticated/);
    expect(sql).toMatch(/GRANT SELECT ON TABLE public\.order_courier_costs TO authenticated/);
    expect(sql).toMatch(/\(SELECT public\.is_admin_user\(\)\)/);
    expect(sql).not.toMatch(/ALTER PUBLICATION/i);
    expect(sql).toMatch(/ROLLBACK/);
    expect(sql).toMatch(/DROP TRIGGER IF EXISTS order_courier_cost_snapshot/);
  });
});

describeDb('order_courier_costs (local Postgres)', () => {
  let admin;
  let actors;
  const zones = [];
  const orders = [];
  const clients = [];

  const as = async (userId) => {
    const c = await connectAs(userId);
    clients.push(c);
    return c;
  };

  const seedZone = async (transportCost) => {
    const { rows } = await admin.query(
      `INSERT INTO public.shipping_zones (province_name, municipality_name, shipping_cost, transport_cost, is_active)
       VALUES ('TestProv', $1, 5, $2, true) RETURNING id`,
      [`T-${randomUUID().slice(0, 8)}`, transportCost]
    );
    zones.push(rows[0].id);
    return rows[0].id;
  };

  const insertOrder = async (client, zoneId, userId = actors.customerId) => {
    const id = randomUUID();
    await client.query(
      `INSERT INTO public.orders (id, user_id, order_type, subtotal, discount_amount, shipping_cost, tax_amount,
                                  total_amount, currency_id, payment_method, status, shipping_zone_id, order_number)
       VALUES ($1, $2, 'product', 10, 0, 0, 0, 10, $3, 'zelle', 'pending', $4, $5)`,
      [id, userId, actors.currencyId, zoneId, `TST-${id.slice(0, 13)}`]
    );
    orders.push(id);
    return id;
  };

  const costRow = async (orderId) =>
    (await admin.query('SELECT * FROM public.order_courier_costs WHERE order_id = $1', [orderId])).rows[0];

  beforeAll(async () => {
    admin = await connectAdmin();
    actors = await loadActors(admin);
  });

  afterAll(async () => {
    if (orders.length) await admin.query('DELETE FROM public.orders WHERE id = ANY($1)', [orders]);
    if (zones.length) await admin.query('DELETE FROM public.shipping_zones WHERE id = ANY($1)', [zones]);
    await endAll([...clients, admin]);
  });

  describe('snapshot trigger', () => {
    it('stores the transport cost of the zone when the order is created', async () => {
      const zone = await seedZone('7.50');
      const orderId = await insertOrder(admin, zone);
      const row = await costRow(orderId);
      expect(row.shipping_zone_id).toBe(zone);
      expect(Number(row.amount_usd)).toBe(7.5);
    });

    it('works on the real path: a customer inserting under RLS', async () => {
      const zone = await seedZone('4.00');
      const customer = await as(actors.customerId);
      const orderId = await insertOrder(customer, zone);
      expect(Number((await costRow(orderId)).amount_usd)).toBe(4);
    });

    it.each([
      ['a zone without transport cost (NULL)', null],
      ['a zone with transport cost 0', '0']
    ])('stores NULL for %s', async (_label, transportCost) => {
      const zone = await seedZone(transportCost);
      const orderId = await insertOrder(admin, zone);
      const row = await costRow(orderId);
      expect(row).toBeDefined();
      expect(row.amount_usd).toBeNull();
      expect(row.shipping_zone_id).toBe(zone);
    });

    it('records nothing for an order without a zone', async () => {
      const orderId = await insertOrder(admin, null);
      expect(await costRow(orderId)).toBeUndefined();
    });

    it('is a snapshot: a later tariff change or zone swap does not alter it', async () => {
      const zone = await seedZone('6.00');
      const other = await seedZone('9.00');
      const orderId = await insertOrder(admin, zone);
      await admin.query('UPDATE public.shipping_zones SET transport_cost = 100 WHERE id = $1', [zone]);
      await admin.query('UPDATE public.orders SET shipping_zone_id = $2 WHERE id = $1', [orderId, other]);
      const row = await costRow(orderId);
      expect(Number(row.amount_usd)).toBe(6);
      expect(row.shipping_zone_id).toBe(zone);
    });

    it('is idempotent: re-running the snapshot never duplicates or overwrites the row', async () => {
      const zone = await seedZone('3.25');
      const orderId = await insertOrder(admin, zone);
      await admin.query('UPDATE public.shipping_zones SET transport_cost = 50 WHERE id = $1', [zone]);
      await admin.query(
        `INSERT INTO public.order_courier_costs (order_id, shipping_zone_id, amount_usd) VALUES ($1, $2, 50)
         ON CONFLICT (order_id) DO NOTHING`,
        [orderId, zone]
      );
      const { rows } = await admin.query('SELECT amount_usd FROM public.order_courier_costs WHERE order_id = $1', [orderId]);
      expect(rows).toHaveLength(1);
      expect(Number(rows[0].amount_usd)).toBe(3.25);
    });

    it('never breaks order creation when the snapshot write fails', async () => {
      const zone = await seedZone('8.00');
      await admin.query(
        `ALTER TABLE public.order_courier_costs ADD CONSTRAINT tmp_force_snapshot_failure CHECK (false) NOT VALID`
      );
      try {
        const orderId = await insertOrder(admin, zone);
        const { rows } = await admin.query('SELECT 1 FROM public.orders WHERE id = $1', [orderId]);
        expect(rows).toHaveLength(1);
        expect(await costRow(orderId)).toBeUndefined();
      } finally {
        await admin.query('ALTER TABLE public.order_courier_costs DROP CONSTRAINT tmp_force_snapshot_failure');
      }
    });

    it('cannot be called as a function by API roles', async () => {
      const customer = await as(actors.customerId);
      await expect(customer.query('SELECT public.snapshot_order_courier_cost()')).rejects.toThrow(/permission denied/i);
      const anon = await connectAnon();
      clients.push(anon);
      await expect(anon.query('SELECT public.snapshot_order_courier_cost()')).rejects.toThrow(/permission denied/i);
    });
  });

  describe('visibility and write protection', () => {
    let zone;
    let orderId;

    beforeAll(async () => {
      zone = await seedZone('5.50');
      orderId = await insertOrder(admin, zone);
    });

    it('an admin reads the rows', async () => {
      const c = await as(actors.adminId);
      const { rows } = await c.query('SELECT amount_usd FROM public.order_courier_costs WHERE order_id = $1', [orderId]);
      expect(rows).toHaveLength(1);
      expect(Number(rows[0].amount_usd)).toBe(5.5);
    });

    it('a customer sees no row at all, not even the one of their own order', async () => {
      const c = await as(actors.customerId);
      const own = await c.query('SELECT 1 FROM public.orders WHERE id = $1', [orderId]);
      expect(own.rows).toHaveLength(1); // the order is theirs ...
      const { rows } = await c.query('SELECT * FROM public.order_courier_costs');
      expect(rows).toHaveLength(0); // ... the cost is not
    });

    it('anon has no access', async () => {
      const anon = await connectAnon();
      clients.push(anon);
      await expect(anon.query('SELECT * FROM public.order_courier_costs')).rejects.toThrow(/permission denied/i);
    });

    it.each(['customerId', 'adminId'])('API roles (%s) cannot INSERT, UPDATE or DELETE', async (who) => {
      const c = await as(actors[who]);
      await expect(
        c.query('INSERT INTO public.order_courier_costs (order_id, amount_usd) VALUES ($1, 1)', [randomUUID()])
      ).rejects.toThrow(/permission denied/i);
      await expect(c.query('UPDATE public.order_courier_costs SET amount_usd = 0')).rejects.toThrow(/permission denied/i);
      await expect(c.query('DELETE FROM public.order_courier_costs')).rejects.toThrow(/permission denied/i);
      expect(Number((await costRow(orderId)).amount_usd)).toBe(5.5);
    });

    it('is not in the realtime publication and rejects negative amounts', async () => {
      const pub = await admin.query(
        `SELECT 1 FROM pg_publication_tables WHERE tablename = 'order_courier_costs'`
      );
      expect(pub.rows).toHaveLength(0);
      await expect(
        admin.query('INSERT INTO public.order_courier_costs (order_id, amount_usd) VALUES ($1, -1)', [orderId])
      ).rejects.toThrow();
    });
  });

  describe('order deletion and platform reset', () => {
    it('deleting an order cascades to its cost row', async () => {
      const zone = await seedZone('2.00');
      const orderId = await insertOrder(admin, zone);
      expect(await costRow(orderId)).toBeDefined();
      await admin.query('DELETE FROM public.orders WHERE id = $1', [orderId]);
      expect(await costRow(orderId)).toBeUndefined();
    });

    it('execute_platform_reset still runs and leaves no cost rows behind', async () => {
      const zone = await seedZone('2.00');
      await insertOrder(admin, zone);
      await admin.query('BEGIN');
      try {
        await admin.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: actors.adminId, role: 'authenticated' })]);
        await admin.query(`SET LOCAL session_replication_role = 'replica'`);
        await admin.query(`UPDATE public.user_profiles SET role = 'super_admin' WHERE id = $1`, [actors.adminId]);
        await admin.query(`SET LOCAL session_replication_role = 'origin'`);
        await admin.query(`INSERT INTO public.platform_reset_control (id, enabled) VALUES (1, true) ON CONFLICT (id) DO UPDATE SET enabled = true`);
        await admin.query(`SELECT public.execute_platform_reset('RESETEAR')`);
        expect((await admin.query('SELECT count(*)::int AS n FROM public.orders')).rows[0].n).toBe(0);
        expect((await admin.query('SELECT count(*)::int AS n FROM public.order_courier_costs')).rows[0].n).toBe(0);
      } finally {
        await admin.query('ROLLBACK');
      }
    });
  });
});
