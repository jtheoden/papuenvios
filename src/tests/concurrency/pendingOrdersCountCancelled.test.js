/**
 * get_pending_orders_count() must not count cancelled orders (migration 20261029100400).
 * An admin cancel from pending/pending leaves payment_status = 'pending'; the old predicate kept counting it.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { dbSuiteSkipReason, connectAdmin, connectAs, endAll } from './db';
import { loadActors, createTracker, seedOrder, cleanup } from './fixtures';

const skipReason = await dbSuiteSkipReason({ functions: ['get_pending_orders_count', 'order_cancel'], tables: ['orders'] });
const describeDb = skipReason ? describe.skip : describe;

describeDb('get_pending_orders_count and cancelled orders', () => {
  let admin;
  let actors;
  let adminClient;
  const tracker = createTracker();

  beforeAll(async () => {
    admin = await connectAdmin();
    actors = await loadActors(admin);
    adminClient = await connectAs(actors.adminId);
  });
  afterAll(async () => {
    await cleanup(admin, tracker);
    await endAll([adminClient, admin]);
  });

  const count = async () => (await adminClient.query('SELECT public.get_pending_orders_count() AS n')).rows[0].n;

  it('an admin-cancelled pending/pending order stops counting; a live pending one counts', async () => {
    const before = await count();
    const id = await seedOrder(admin, actors, tracker, [], { stockManaged: false });
    expect(await count()).toBe(before + 1);
    await adminClient.query('SELECT * FROM public.order_cancel($1, $2)', [id, 'out of stock at the supplier']);
    const row = await admin.query('SELECT status, payment_status FROM public.orders WHERE id = $1', [id]);
    expect(row.rows[0]).toEqual({ status: 'cancelled', payment_status: 'pending' });
    expect(await count()).toBe(before);
  });

  it('keeps the live ACL and SECURITY DEFINER shape', async () => {
    const { rows } = await admin.query(
      `SELECT prosecdef, proconfig, has_function_privilege('anon', oid, 'EXECUTE') AS anon,
              has_function_privilege('authenticated', oid, 'EXECUTE') AS auth,
              has_function_privilege('service_role', oid, 'EXECUTE') AS svc
         FROM pg_proc WHERE proname = 'get_pending_orders_count' AND pronamespace = 'public'::regnamespace`
    );
    expect(rows[0]).toMatchObject({ prosecdef: true, anon: false, auth: true, svc: true });
    expect(rows[0].proconfig).toEqual(['search_path=public, pg_temp']);
  });
});
