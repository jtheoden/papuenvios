/**
 * admin_refund_dispute_states(p_refund_ids uuid[]): which of the given refunds have an OPEN dispute.
 * Migration under test: 20261103100100_refund_dispute_states.sql (fails loudly until it exists).
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { dbSuiteSkipReason, connectAdmin, connectAs, connectAnon, endAll } from './db';
import { loadActors, createTracker, seedOrder, cleanup } from './fixtures';

const skipReason = await dbSuiteSkipReason({
  functions: ['is_admin_user', 'order_cancel', 'admin_set_refund_dispute'],
  tables: ['orders', 'refund_requests', 'refund_request_events']
});
const describeDb = skipReason ? describe.skip : describe;

const failure = async (promise) => {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected the statement to fail, but it succeeded');
};

describeDb('admin_refund_dispute_states', () => {
  let admin;
  let actors;
  const clients = [];
  const tracker = createTracker();

  const as = async (id) => {
    const c = await connectAs(id);
    clients.push(c);
    return c;
  };
  const states = async (client, ids) =>
    (await client.query('SELECT public.admin_refund_dispute_states($1::uuid[]) AS r', [ids])).rows[0].r;
  const refundOf = async () => {
    const id = await seedOrder(admin, actors, tracker, [], {
      userId: actors.customerId,
      status: 'pending',
      paymentStatus: 'proof_uploaded',
      stockManaged: false
    });
    const c = await as(actors.customerId);
    await c.query('SELECT * FROM public.order_cancel($1, $2)', [id, 'changed my mind']);
    return (await admin.query('SELECT id FROM public.refund_requests WHERE order_id = $1', [id])).rows[0].id;
  };

  beforeAll(async () => {
    admin = await connectAdmin();
    actors = await loadActors(admin);
  });
  afterEach(async () => {
    await endAll(clients.splice(0));
    await admin.query(
      `DELETE FROM public.activity_logs WHERE entity_type = 'refund_request' AND entity_id IN
         (SELECT id FROM public.refund_requests WHERE order_id = ANY($1))`,
      [tracker.orders]
    );
    await cleanup(admin, tracker);
  });
  afterAll(async () => {
    await admin.end();
  });

  it('is SECURITY DEFINER with a pinned search_path, not executable by anon, executable by authenticated', async () => {
    const { rows } = await admin.query(
      `SELECT prosecdef, proconfig, has_function_privilege('anon', oid, 'EXECUTE') AS anon_x,
              has_function_privilege('authenticated', oid, 'EXECUTE') AS auth_x
         FROM pg_proc WHERE proname = 'admin_refund_dispute_states' AND pronamespace = 'public'::regnamespace`
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].prosecdef).toBe(true);
    expect(rows[0].proconfig.join(',')).toContain('search_path=public, pg_temp');
    expect(rows[0].anon_x).toBe(false);
    expect(rows[0].auth_x).toBe(true);
    const anon = await connectAnon();
    clients.push(anon);
    expect((await failure(anon.query('SELECT public.admin_refund_dispute_states($1::uuid[])', [[]]))).code).toBe('42501');
  });

  it('refuses a non-admin with 42501', async () => {
    const customer = await as(actors.customerId);
    expect((await failure(states(customer, []))).code).toBe('42501');
  });

  it('answers an empty list for an empty or null array', async () => {
    const a = await as(actors.adminId);
    expect(await states(a, [])).toEqual([]);
    expect(await states(a, null)).toEqual([]);
  });

  it('reports only the refunds whose last dispute event is "opened"', async () => {
    const [r1, r2, r3] = [await refundOf(), await refundOf(), await refundOf()];
    const a = await as(actors.adminId);
    await a.query('SELECT public.admin_set_refund_dispute($1, true)', [r1]);
    await a.query('SELECT public.admin_set_refund_dispute($1, true)', [r2]);
    await a.query('SELECT public.admin_set_refund_dispute($1, false)', [r2]);
    const open = await states(a, [r1, r2, r3, '00000000-0000-0000-0000-000000000000']);
    expect(open).toEqual([r1]);
  });

  it('rejects more than 500 ids with 22023', async () => {
    const a = await as(actors.adminId);
    const ids = Array.from({ length: 501 }, (_, i) => `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`);
    expect((await failure(states(a, ids))).code).toBe('22023');
  });
});
