/**
 * remittance_courier_costs: per-remittance courier (transport) cost snapshot taken by an AFTER INSERT trigger on
 * remittances (supabase/migrations/20261027100000_remittance_courier_costs.sql). Local Postgres only.
 * Mirrors orderCourierCosts.test.js: admin-only data, written only by the SECURITY DEFINER trigger.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { dbSuiteSkipReason, connectAdmin, connectAs, connectAnon, endAll } from './db';
import { loadActors } from './fixtures';

const skipReason = await dbSuiteSkipReason({ tables: ['remittances', 'shipping_zones', 'remittance_courier_costs'] });
const describeDb = skipReason ? describe.skip : describe;

const MIGRATION = 'supabase/migrations/20261027100000_remittance_courier_costs.sql';
const ROLLBACK = 'supabase/rollbacks/20261027100000_remittance_courier_costs_down.sql';

describe('remittance_courier_costs migration (static)', () => {
  const sql = readFileSync(resolve(process.cwd(), MIGRATION), 'utf8');

  it('runs inside an explicit transaction so SET LOCAL lock_timeout takes effect', () => {
    const begin = sql.search(/^BEGIN;/m);
    const setLocal = sql.search(/^SET LOCAL lock_timeout/m);
    const commit = sql.search(/^COMMIT;/m);
    expect(begin).toBeGreaterThanOrEqual(0);
    expect(setLocal).toBeGreaterThan(begin);
    expect(commit).toBeGreaterThan(setLocal);
    expect(sql.trimEnd().endsWith('COMMIT;')).toBe(true);
  });

  it('hardens the trigger function and swallows its own errors', () => {
    expect(sql).toMatch(/SECURITY DEFINER/);
    expect(sql).toMatch(/SET search_path = public, pg_temp/);
    expect(sql).toMatch(/EXCEPTION\s+WHEN OTHERS THEN/);
    expect(sql).toMatch(/RAISE WARNING/);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.snapshot_remittance_courier_cost\(\) FROM PUBLIC, anon, authenticated/);
  });

  it('is admin-read only, never writable by API roles, never realtime, without backfill', () => {
    expect(sql).toMatch(/REVOKE ALL ON TABLE public\.remittance_courier_costs FROM PUBLIC, anon, authenticated/);
    expect(sql).toMatch(/GRANT SELECT ON TABLE public\.remittance_courier_costs TO authenticated/);
    expect(sql).toMatch(/\(SELECT public\.is_admin_user\(\)\)/);
    expect(sql).toMatch(/ON DELETE CASCADE/);
    expect(sql).not.toMatch(/ALTER PUBLICATION/i);
    expect(sql).not.toMatch(/INSERT INTO public\.remittance_courier_costs[\s\S]*FROM public\.remittances/i);
    expect(sql).toMatch(/ROLLBACK/);
  });

  it('ships an exact rollback file', () => {
    const down = readFileSync(resolve(process.cwd(), ROLLBACK), 'utf8');
    expect(existsSync(resolve(process.cwd(), ROLLBACK))).toBe(true);
    expect(down).toMatch(/DROP TRIGGER IF EXISTS remittance_courier_cost_snapshot ON public\.remittances/);
    expect(down).toMatch(/DROP FUNCTION IF EXISTS public\.snapshot_remittance_courier_cost\(\)/);
    expect(down).toMatch(/DROP TABLE IF EXISTS public\.remittance_courier_costs/);
  });
});

describeDb('remittance_courier_costs (local Postgres)', () => {
  let admin;
  let actors;
  const zones = [];
  const remittances = [];
  let typeId;
  const clients = [];

  const as = async (userId) => {
    const c = await connectAs(userId);
    clients.push(c);
    return c;
  };

  const seedZone = async (transportCost) => {
    const { rows } = await admin.query(
      `INSERT INTO public.shipping_zones (province_name, municipality_name, shipping_cost, transport_cost, is_active)
       VALUES ('TestProv', $1, 15, $2, true) RETURNING id`,
      [`T-${randomUUID().slice(0, 8)}`, transportCost]
    );
    zones.push(rows[0].id);
    return rows[0].id;
  };

  const insertRemittance = async (zoneId) => {
    const id = randomUUID();
    await admin.query(
      `INSERT INTO public.remittances (id, user_id, remittance_type_id, amount_sent, exchange_rate,
         commission_percentage, commission_fixed, commission_total, amount_to_deliver, currency_sent,
         currency_delivered, recipient_name, recipient_phone, status, shipping_zone_id, delivery_cost)
       VALUES ($1,$2,$3,100,800,2.5,0,2.5,78000,'USD','CUP','Rcpt','+5355550100','payment_pending',$4,$5)`,
      [id, actors.customerId, typeId, zoneId, zoneId ? 15 : 0]
    );
    remittances.push(id);
    return id;
  };

  const costRow = async (remittanceId) =>
    (await admin.query('SELECT * FROM public.remittance_courier_costs WHERE remittance_id = $1', [remittanceId])).rows[0];

  beforeAll(async () => {
    admin = await connectAdmin();
    actors = await loadActors(admin);
    const t = await admin.query(
      `INSERT INTO public.remittance_types (name, currency_code, delivery_currency, exchange_rate,
         commission_percentage, commission_fixed, min_amount, delivery_method)
       VALUES ($1,'USD','CUP',800,2.5,0,0.01,'transfer') RETURNING id`,
      [`rt-${randomUUID().slice(0, 8)}`]
    );
    typeId = t.rows[0].id;
  });

  afterAll(async () => {
    if (remittances.length) await admin.query('DELETE FROM public.remittances WHERE id = ANY($1)', [remittances]);
    if (typeId) await admin.query('DELETE FROM public.remittance_types WHERE id = $1', [typeId]);
    if (zones.length) await admin.query('DELETE FROM public.shipping_zones WHERE id = ANY($1)', [zones]);
    await endAll([...clients, admin]);
  });

  describe('snapshot trigger', () => {
    it('stores the transport cost of the zone when the remittance is created', async () => {
      const zone = await seedZone('4.00');
      const id = await insertRemittance(zone);
      const row = await costRow(id);
      expect(row.shipping_zone_id).toBe(zone);
      expect(Number(row.amount_usd)).toBe(4);
    });

    it.each([
      ['a zone without transport cost (NULL)', null],
      ['a zone with transport cost 0', '0']
    ])('stores NULL for %s', async (_label, transportCost) => {
      const zone = await seedZone(transportCost);
      const id = await insertRemittance(zone);
      const row = await costRow(id);
      expect(row).toBeDefined();
      expect(row.amount_usd).toBeNull();
    });

    it('records nothing for a remittance without a delivery zone', async () => {
      const id = await insertRemittance(null);
      expect(await costRow(id)).toBeUndefined();
    });

    it('is a snapshot: a later tariff change does not alter it', async () => {
      const zone = await seedZone('6.00');
      const id = await insertRemittance(zone);
      await admin.query('UPDATE public.shipping_zones SET transport_cost = 100 WHERE id = $1', [zone]);
      expect(Number((await costRow(id)).amount_usd)).toBe(6);
    });

    it('never breaks remittance creation when the snapshot write fails', async () => {
      const zone = await seedZone('8.00');
      await admin.query(
        `ALTER TABLE public.remittance_courier_costs ADD CONSTRAINT tmp_force_snapshot_failure CHECK (false) NOT VALID`
      );
      try {
        const id = await insertRemittance(zone);
        const { rows } = await admin.query('SELECT 1 FROM public.remittances WHERE id = $1', [id]);
        expect(rows).toHaveLength(1);
        expect(await costRow(id)).toBeUndefined();
      } finally {
        await admin.query('ALTER TABLE public.remittance_courier_costs DROP CONSTRAINT tmp_force_snapshot_failure');
      }
    });

    it('cannot be called as a function by API roles', async () => {
      const customer = await as(actors.customerId);
      await expect(customer.query('SELECT public.snapshot_remittance_courier_cost()')).rejects.toThrow(/permission denied/i);
      const anon = await connectAnon();
      clients.push(anon);
      await expect(anon.query('SELECT public.snapshot_remittance_courier_cost()')).rejects.toThrow(/permission denied/i);
    });
  });

  describe('visibility and write protection', () => {
    let remittanceId;

    beforeAll(async () => {
      remittanceId = await insertRemittance(await seedZone('5.50'));
    });

    it('an admin reads the rows', async () => {
      const c = await as(actors.adminId);
      const { rows } = await c.query('SELECT amount_usd FROM public.remittance_courier_costs WHERE remittance_id = $1', [remittanceId]);
      expect(rows).toHaveLength(1);
      expect(Number(rows[0].amount_usd)).toBe(5.5);
    });

    it('a customer and anon read nothing', async () => {
      const c = await as(actors.customerId);
      expect((await c.query('SELECT * FROM public.remittance_courier_costs')).rows).toHaveLength(0);
      const anon = await connectAnon();
      clients.push(anon);
      await expect(anon.query('SELECT * FROM public.remittance_courier_costs')).rejects.toThrow(/permission denied/i);
    });

    it.each(['customerId', 'adminId'])('API roles (%s) cannot INSERT, UPDATE or DELETE', async (who) => {
      const c = await as(actors[who]);
      await expect(
        c.query('INSERT INTO public.remittance_courier_costs (remittance_id, amount_usd) VALUES ($1, 1)', [randomUUID()])
      ).rejects.toThrow(/permission denied/i);
      await expect(c.query('UPDATE public.remittance_courier_costs SET amount_usd = 0')).rejects.toThrow(/permission denied/i);
      await expect(c.query('DELETE FROM public.remittance_courier_costs')).rejects.toThrow(/permission denied/i);
      expect(Number((await costRow(remittanceId)).amount_usd)).toBe(5.5);
    });

    it('deleting a remittance cascades to its cost row and the table is not in the realtime publication', async () => {
      const id = await insertRemittance(await seedZone('2.00'));
      await admin.query('DELETE FROM public.remittances WHERE id = $1', [id]);
      expect(await costRow(id)).toBeUndefined();
      const pub = await admin.query(`SELECT 1 FROM pg_publication_tables WHERE tablename = 'remittance_courier_costs'`);
      expect(pub.rows).toHaveLength(0);
    });
  });
});
