/**
 * get_pending_orders_count(): only staff may read the platform-wide pending-orders count
 * (supabase/migrations/20261019120000_harden_get_pending_orders_count.sql). Local Postgres only.
 *
 * Before the fix the function was SECURITY DEFINER with no caller check, so any authenticated customer
 * could call it through PostgREST and read the global count.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { dbSuiteSkipReason, connectAdmin, connectAs, endAll } from './db';
import { loadActors } from './fixtures';

const skipReason = await dbSuiteSkipReason({ tables: ['orders', 'currencies'] });
const describeDb = skipReason ? describe.skip : describe;

const MIGRATION = 'supabase/migrations/20261019120000_harden_get_pending_orders_count.sql';

describe('get_pending_orders_count migration (static)', () => {
  const sql = readFileSync(resolve(process.cwd(), MIGRATION), 'utf8');

  it('keeps the function hardened: definer, pinned search_path, admin check', () => {
    expect(sql).toMatch(/SECURITY DEFINER/);
    expect(sql).toMatch(/SET search_path = public, pg_temp/);
    expect(sql).toMatch(/is_admin_user\(\)/);
  });

  it('keeps anon / PUBLIC without EXECUTE and documents an exact rollback', () => {
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.get_pending_orders_count\(\) FROM PUBLIC, anon/);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.get_pending_orders_count\(\) TO authenticated, service_role/);
    expect(sql).toMatch(/ROLLBACK/);
  });
});

describeDb('get_pending_orders_count caller check (local Postgres)', () => {
  let admin;
  let actors;
  let orderId;
  const clients = [];

  const as = async (userId) => {
    const c = await connectAs(userId);
    clients.push(c);
    return c;
  };

  beforeAll(async () => {
    admin = await connectAdmin();
    actors = await loadActors(admin);
    const res = await admin.query(
      `INSERT INTO public.orders (user_id, order_type, subtotal, discount_amount, shipping_cost, tax_amount, total_amount, currency_id, payment_method, status)
       VALUES ($1, 'product', 10, 0, 0, 0, 10, $2, 'zelle', 'pending') RETURNING id`,
      [actors.customerId, actors.currencyId]
    );
    orderId = res.rows[0].id;
  });

  afterAll(async () => {
    if (orderId) await admin.query('DELETE FROM public.orders WHERE id = $1', [orderId]);
    await endAll([...clients, admin]);
  });

  it('returns the real count to an admin', async () => {
    const expected = (await admin.query(
      `SELECT COUNT(*)::int AS n FROM public.orders WHERE status = 'pending' OR payment_status = 'pending'`
    )).rows[0].n;
    expect(expected).toBeGreaterThan(0);
    const c = await as(actors.adminId);
    const { rows } = await c.query('SELECT public.get_pending_orders_count() AS n');
    expect(rows[0].n).toBe(expected);
  });

  it('returns 0 to a customer even when pending orders exist', async () => {
    const c = await as(actors.customerId);
    const { rows } = await c.query('SELECT public.get_pending_orders_count() AS n');
    expect(rows[0].n).toBe(0);
  });

  it('still answers the service role / superuser (no JWT subject) with the real count', async () => {
    const { rows } = await admin.query('SELECT public.get_pending_orders_count() AS n');
    expect(rows[0].n).toBeGreaterThan(0);
  });

  it('keeps anon and PUBLIC without EXECUTE and authenticated with it', async () => {
    const { rows } = await admin.query(
      `SELECT has_function_privilege('anon', 'public.get_pending_orders_count()', 'EXECUTE') AS anon,
              has_function_privilege('authenticated', 'public.get_pending_orders_count()', 'EXECUTE') AS auth,
              has_function_privilege('service_role', 'public.get_pending_orders_count()', 'EXECUTE') AS svc`
    );
    expect(rows[0]).toEqual({ anon: false, auth: true, svc: true });
  });
});
