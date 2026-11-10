/**
 * my_operation_refund(p_kind, p_operation_id): customer-facing refund status, owner only.
 * Migration under test: 20261103100000_my_operation_refund.sql (the suite fails loudly until it exists).
 */
import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { dbSuiteSkipReason, connectAdmin, connectAs, connectAnon, endAll } from './db';
import { loadActors, createTracker, seedOrder, cleanup } from './fixtures';

const skipReason = await dbSuiteSkipReason({
  functions: ['is_admin_user', 'order_cancel', 'admin_resolve_refund_v2'],
  tables: ['orders', 'refund_requests']
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

describeDb('my_operation_refund', () => {
  let admin;
  let actors;
  const clients = [];
  const tracker = createTracker();
  const objects = [];

  const as = async (id) => {
    const c = await connectAs(id);
    clients.push(c);
    return c;
  };
  const mine = async (client, kind, id) =>
    (await client.query('SELECT public.my_operation_refund($1, $2) AS r', [kind, id])).rows[0].r;

  const cancelledOrder = async () => {
    const id = await seedOrder(admin, actors, tracker, [], {
      userId: actors.customerId,
      status: 'pending',
      paymentStatus: 'proof_uploaded',
      stockManaged: false
    });
    const c = await as(actors.customerId);
    await c.query('SELECT * FROM public.order_cancel($1, $2)', [id, 'changed my mind']);
    return id;
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
    if (objects.length) {
      await admin.query(`DELETE FROM storage.objects WHERE bucket_id = 'refund-proofs' AND name = ANY($1)`, [objects.splice(0)]);
    }
    await cleanup(admin, tracker);
  });
  afterAll(async () => {
    await admin.end();
  });

  it('is not executable by anon or PUBLIC, executable by authenticated, SECURITY DEFINER with a pinned search_path', async () => {
    const { rows } = await admin.query(
      `SELECT prosecdef, proconfig, has_function_privilege('anon', oid, 'EXECUTE') AS anon_x,
              has_function_privilege('authenticated', oid, 'EXECUTE') AS auth_x
         FROM pg_proc WHERE proname = 'my_operation_refund' AND pronamespace = 'public'::regnamespace`
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].prosecdef).toBe(true);
    expect(rows[0].proconfig.join(',')).toContain('search_path=public, pg_temp');
    expect(rows[0].anon_x).toBe(false);
    expect(rows[0].auth_x).toBe(true);
    const anon = await connectAnon();
    clients.push(anon);
    const err = await failure(anon.query('SELECT public.my_operation_refund($1, $2)', ['order', actors.customerId]));
    expect(err.code).toBe('42501');
  });

  it('returns the owner the refund state with no proof, no admin identity and no internal notes', async () => {
    const id = await cancelledOrder();
    const owner = await as(actors.customerId);
    const result = await mine(owner, 'order', id);
    expect(result.refunds).toHaveLength(1);
    const [refund] = result.refunds;
    expect(refund.status).toBe('pending');
    expect(refund.stage).toBe('on_hold');
    expect(refund.eligible_at).toBeTruthy();
    expect(refund.due_at).toBeTruthy();
    expect(Object.keys(refund).sort()).toEqual(
      ['amount', 'cancelled_at', 'currency', 'due_at', 'eligible_at', 'refunded_at', 'stage', 'status'].sort()
    );
  });

  it('reports a refunded request without leaking the reference, the proof or the resolver', async () => {
    const id = await cancelledOrder();
    await admin.query(
      `UPDATE public.refund_requests SET cancelled_at = now() - interval '60 hours', eligible_at = now() - interval '12 hours',
              due_at = now() + interval '100 hours' WHERE order_id = $1`,
      [id]
    );
    const adminClient = await as(actors.adminId);
    const { rows } = await adminClient.query('SELECT id FROM public.refund_requests WHERE order_id = $1', [id]);
    const proofPath = `refunds/${rows[0].id}/${randomUUID()}.png`;
    await admin.query(`INSERT INTO storage.objects (bucket_id, name) VALUES ('refund-proofs', $1)`, [proofPath]);
    objects.push(proofPath);
    await adminClient.query(
      `SELECT public.admin_resolve_refund_v2($1, 'refunded', 'ZEL-1', NULL, NULL, $2, $3, false)`,
      [rows[0].id, proofPath, 'a'.repeat(64)]
    );
    const owner = await as(actors.customerId);
    const [refund] = (await mine(owner, 'order', id)).refunds;
    expect(refund.status).toBe('refunded');
    expect(refund.stage).toBe('refunded');
    expect(refund.refunded_at).toBeTruthy();
    expect(JSON.stringify(refund)).not.toMatch(/ZEL-1|refunds\//);
  });

  it('answers an empty list (not an error, not existence) to someone who does not own the operation', async () => {
    const id = await cancelledOrder();
    const other = await as(actors.adminId);
    expect((await mine(other, 'order', id)).refunds).toEqual([]);
  });

  it('rejects an invalid kind with 22023', async () => {
    const owner = await as(actors.customerId);
    const err = await failure(mine(owner, 'bogus', actors.customerId));
    expect(err.code).toBe('22023');
  });
});
