/**
 * E4 (W5a, orders): atomic transition RPCs on top of one helper.
 * Migration under test: 20261024110000_order_transition_rpcs.sql
 *   public.order_* wrappers (SECURITY DEFINER, authenticated only) -> public._order_transition (lock, authorization,
 *   matrix, stock side effect and status history in ONE transaction).
 *
 * The suite does not list the new functions in `needs`: a missing migration fails loudly (red phase).
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { dbSuiteSkipReason, connectAdmin, connectAs, connectAnon, fireTogether, endAll } from './db';
import {
  loadActors,
  createTracker,
  seedProduct,
  seedOrder,
  cleanup,
  readInventory,
  readOrder,
  readAllocations
} from './fixtures';

const skipReason = await dbSuiteSkipReason({
  functions: ['reserve_order_inventory', 'consume_order_inventory', 'is_admin_user', 'current_user_is_blocked'],
  tables: ['orders', 'order_status_history', 'inventory', 'order_stock_allocations', 'user_profiles']
});
const describeDb = skipReason ? describe.skip : describe;

const WRAPPERS = [
  'order_submit_proof',
  'order_validate_payment',
  'order_reject_payment',
  'order_start_processing',
  'order_dispatch',
  'order_mark_delivered',
  'order_complete',
  'order_cancel',
  'order_reopen'
];

const STATUSES = ['pending', 'processing', 'dispatched', 'delivered', 'completed', 'cancelled'];
const PAYMENTS = ['pending', 'proof_uploaded', 'validated', 'rejected'];

const PROOF = 'payment-proofs/payment-proof-test.jpg';
const DELIVERY = 'u/o/delivery-proof-test.jpg';

/**
 * The matrix of the plan, written independently of the SQL. `allowed` receives (status, payment_status).
 * `args` builds the arguments after the order id; `to` is the expected row after a successful call.
 */
const MATRIX = [
  {
    name: 'submit_proof (owner)', fn: 'order_submit_proof', actor: 'owner',
    args: () => [PROOF, 'Payer Name', '+13055550100'],
    allowed: (s, p) => s === 'pending' && ['pending', 'rejected', 'proof_uploaded'].includes(p),
    to: () => ({ status: 'pending', payment_status: 'proof_uploaded' })
  },
  {
    name: 'validate_payment (admin)', fn: 'order_validate_payment', actor: 'admin',
    args: () => [],
    allowed: (s, p) => ['pending', 'processing'].includes(s) && ['pending', 'proof_uploaded'].includes(p),
    to: () => ({ status: 'processing', payment_status: 'validated' })
  },
  {
    name: 'reject_payment (admin)', fn: 'order_reject_payment', actor: 'admin',
    args: () => ['blurry proof'],
    allowed: (s, p) => s === 'pending' && ['pending', 'proof_uploaded'].includes(p),
    to: () => ({ status: 'pending', payment_status: 'rejected' })
  },
  {
    name: 'start_processing (admin)', fn: 'order_start_processing', actor: 'admin',
    args: () => [],
    allowed: (s, p) => s === 'pending' && p === 'validated',
    to: () => ({ status: 'processing', payment_status: 'validated' })
  },
  {
    name: 'dispatch (admin)', fn: 'order_dispatch', actor: 'admin',
    args: () => ['TRK-1'],
    allowed: (s) => s === 'processing',
    to: (s, p) => ({ status: 'dispatched', payment_status: p })
  },
  {
    name: 'mark_delivered (admin)', fn: 'order_mark_delivered', actor: 'admin',
    args: () => [DELIVERY],
    allowed: (s) => s === 'dispatched',
    to: (s, p) => ({ status: 'delivered', payment_status: p })
  },
  {
    name: 'complete (admin)', fn: 'order_complete', actor: 'admin',
    args: () => ['all good'],
    allowed: (s) => s === 'delivered',
    to: (s, p) => ({ status: 'completed', payment_status: p })
  },
  {
    name: 'cancel (admin)', fn: 'order_cancel', actor: 'admin',
    args: () => ['out of stock at the supplier'],
    allowed: (s) => ['pending', 'processing'].includes(s),
    to: (s, p) => ({ status: 'cancelled', payment_status: p })
  },
  {
    name: 'cancel (owner)', fn: 'order_cancel', actor: 'owner',
    args: () => ['changed my mind'],
    allowed: (s, p) => s === 'pending' && p !== 'validated',
    to: () => ({ status: 'cancelled', payment_status: 'rejected' })
  },
  {
    name: 'reopen (owner)', fn: 'order_reopen', actor: 'owner',
    args: () => [],
    allowed: (s, p) => s === 'cancelled' && ['pending', 'rejected', 'proof_uploaded'].includes(p),
    to: () => ({ status: 'pending', payment_status: 'pending' })
  }
];

const failure = async (promise) => {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected the statement to fail, but it succeeded');
};

describeDb('order transition RPCs', () => {
  let admin;
  let actors;
  let strangerId;
  const tracker = createTracker();
  const clients = [];

  const as = async (userId) => {
    const c = await connectAs(userId);
    clients.push(c);
    return c;
  };
  const call = async (client, fn, args) => {
    const placeholders = args.map((_, i) => `$${i + 1}`).join(', ');
    const { rows } = await client.query(`SELECT * FROM public.${fn}(${placeholders})`, args);
    return rows[0];
  };
  const row = async (id) => (await admin.query('SELECT * FROM public.orders WHERE id = $1', [id])).rows[0];
  const history = async (id) =>
    (await admin.query('SELECT previous_status, new_status, changed_by, notes FROM public.order_status_history WHERE order_id = $1 ORDER BY created_at, id', [id])).rows;
  const setUser = (id, fields) =>
    admin.query(`UPDATE public.user_profiles SET ${Object.keys(fields).map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE id = $1`, [id, ...Object.values(fields)]);

  /** Unmanaged-stock order in a given state: isolates the matrix from stock effects. */
  const seed = (status, paymentStatus, extra = {}) =>
    seedOrder(admin, actors, tracker, [], { status, paymentStatus, stockManaged: false, ...extra });

  beforeAll(async () => {
    admin = await connectAdmin();
    actors = await loadActors(admin);
    strangerId = randomUUID();
    await admin.query(
      `INSERT INTO auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
       VALUES ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, '{}'::jsonb, now(), now())`,
      [strangerId, `w5.stranger.${strangerId.slice(0, 8)}@example.test`]
    );
  });
  afterEach(async () => {
    await endAll(clients.splice(0));
    await setUser(actors.customerId, { is_enabled: true });
    await setUser(actors.adminId, { is_enabled: true, role: 'admin' });
    await cleanup(admin, tracker);
  });
  afterAll(async () => {
    await admin.query('DELETE FROM public.user_profiles WHERE id = $1', [strangerId]);
    await admin.query('DELETE FROM auth.users WHERE id = $1', [strangerId]);
    await admin.end();
  });

  describe('privileges', () => {
    it.each(WRAPPERS)('%s is executable by authenticated only', async (fn) => {
      const { rows } = await admin.query(
        `SELECT has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
                has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth,
                prosecdef
           FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = $1`,
        [fn]
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]).toEqual({ anon: false, auth: true, prosecdef: true });
    });

    it('the helper _order_transition is not callable by anon or authenticated', async () => {
      const { rows } = await admin.query(
        `SELECT has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
                has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth
           FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = '_order_transition'`
      );
      expect(rows[0]).toEqual({ anon: false, auth: false });
      const id = await seed('pending', 'pending');
      const c = await as(actors.adminId);
      const err = await failure(c.query(`SELECT * FROM public._order_transition($1, 'cancel', '{}'::jsonb)`, [id]));
      expect(err.code).toBe('42501');
    });

    it('anon is refused', async () => {
      const id = await seed('pending', 'pending');
      const anon = await connectAnon();
      clients.push(anon);
      const err = await failure(anon.query('SELECT * FROM public.order_cancel($1, $2)', [id, 'x']));
      expect(err.code).toBe('42501');
    });
  });

  describe('transition matrix (every status x payment_status combination)', () => {
    it.each(MATRIX)('$name', async (spec) => {
      const wrong = [];
      for (const status of STATUSES) {
        for (const payment of PAYMENTS) {
          const id = await seed(status, payment);
          const client = await as(spec.actor === 'owner' ? actors.customerId : actors.adminId);
          const label = `${status}/${payment}`;
          const expectedOk = spec.allowed(status, payment);
          try {
            const result = await call(client, spec.fn, [id, ...spec.args()]);
            if (!expectedOk) {
              wrong.push(`${label}: should have been refused`);
              continue;
            }
            const expected = spec.to(status, payment);
            if (result.status !== expected.status || result.payment_status !== expected.payment_status) {
              wrong.push(`${label}: got ${result.status}/${result.payment_status}, expected ${expected.status}/${expected.payment_status}`);
            }
            const stored = await row(id);
            if (stored.status !== expected.status || stored.payment_status !== expected.payment_status) {
              wrong.push(`${label}: stored ${stored.status}/${stored.payment_status}`);
            }
          } catch (error) {
            if (expectedOk) {
              wrong.push(`${label}: refused (${error.message})`);
            } else if (error.code !== '22023' || !/invalid_transition/.test(error.message)) {
              wrong.push(`${label}: wrong error ${error.code} ${error.message}`);
            } else {
              const stored = await row(id);
              if (stored.status !== status || stored.payment_status !== payment) wrong.push(`${label}: row changed despite refusal`);
            }
          }
        }
      }
      expect(wrong).toEqual([]);
    });

    it('a refusal reports the current state in DETAIL (the front shows "someone else already processed it")', async () => {
      const id = await seed('completed', 'validated');
      const c = await as(actors.adminId);
      const err = await failure(call(c, 'order_cancel', [id, 'late']));
      expect(err.code).toBe('22023');
      expect(JSON.parse(err.detail)).toMatchObject({ status: 'completed', payment_status: 'validated', action: 'cancel' });
    });
  });

  describe('authorization', () => {
    it('an owner (not admin) cannot run admin actions', async () => {
      const id = await seed('pending', 'proof_uploaded');
      const c = await as(actors.customerId);
      for (const [fn, args] of [
        ['order_validate_payment', []],
        ['order_reject_payment', ['no']],
        ['order_start_processing', []],
        ['order_dispatch', ['t']],
        ['order_mark_delivered', [DELIVERY]],
        ['order_complete', ['n']]
      ]) {
        const err = await failure(call(c, fn, [id, ...args]));
        expect(err.code, fn).toBe('42501');
      }
      expect((await row(id)).payment_status).toBe('proof_uploaded');
    });

    it('a stranger cannot touch somebody else order, and gets the same error as for an unknown id', async () => {
      const id = await seed('pending', 'pending');
      const c = await as(strangerId);
      const foreign = await failure(call(c, 'order_cancel', [id, 'x']));
      const unknown = await failure(call(c, 'order_cancel', [randomUUID(), 'x']));
      expect(foreign.code).toBe('42501');
      expect(unknown.code).toBe('42501');
      expect(foreign.message).toBe(unknown.message);
      for (const [fn, args] of [
        ['order_submit_proof', [PROOF, null, '+13055550100']],
        ['order_reopen', []]
      ]) {
        expect((await failure(call(c, fn, [id, ...args]))).code, fn).toBe('42501');
      }
      expect((await row(id)).status).toBe('pending');
    });

    it('an admin gets order_not_found (not an authorization error) for an unknown id', async () => {
      const c = await as(actors.adminId);
      const err = await failure(call(c, 'order_cancel', [randomUUID(), 'x']));
      expect(err.code).toBe('P0002');
    });

    it('owner-only actions are refused to an admin who does not own the order', async () => {
      const proofId = await seed('pending', 'pending');
      const reopenId = await seed('cancelled', 'rejected');
      const c = await as(actors.adminId);
      expect((await failure(call(c, 'order_submit_proof', [proofId, PROOF, null, '+13055550100']))).code).toBe('42501');
      expect((await failure(call(c, 'order_reopen', [reopenId]))).code).toBe('42501');
    });

    it('a disabled customer cannot submit a proof, cancel or reopen', async () => {
      const a = await seed('pending', 'pending');
      const b = await seed('pending', 'pending');
      const d = await seed('cancelled', 'rejected');
      await setUser(actors.customerId, { is_enabled: false });
      const c = await as(actors.customerId);
      for (const [fn, args] of [
        ['order_submit_proof', [a, PROOF, null, '+13055550100']],
        ['order_cancel', [b, 'x']],
        ['order_reopen', [d]]
      ]) {
        expect((await failure(call(c, fn, args))).code, fn).toBe('42501');
      }
      expect((await row(a)).payment_status).toBe('pending');
      expect((await row(b)).status).toBe('pending');
      expect((await row(d)).status).toBe('cancelled');
    });

    it('a disabled admin cannot validate', async () => {
      const id = await seed('pending', 'proof_uploaded');
      await setUser(actors.adminId, { is_enabled: false });
      const c = await as(actors.adminId);
      expect((await failure(call(c, 'order_validate_payment', [id]))).code).toBe('42501');
      expect((await row(id)).status).toBe('pending');
    });
  });

  describe('argument validation', () => {
    const invalidArgument = async (fn, args, orderState = ['pending', 'proof_uploaded'], actor = 'admin') => {
      const id = await seed(...orderState);
      const c = await as(actor === 'owner' ? actors.customerId : actors.adminId);
      const err = await failure(call(c, fn, [id, ...args]));
      expect(err.code, `${fn} ${JSON.stringify(args)}`).toBe('22023');
      expect(err.message).toMatch(/invalid_argument/);
      expect((await row(id)).status).toBe(orderState[0]);
    };

    it.each([[null], [''], ['   '], ['x'.repeat(501)]])('reject_payment needs a 1..500 char reason (%j)', async (reason) => {
      await invalidArgument('order_reject_payment', [reason]);
    });
    it.each([[null], [''], ['  ']])('cancel needs a reason, admin (%j)', async (reason) => {
      await invalidArgument('order_cancel', [reason], ['pending', 'pending']);
    });
    it.each([[null], ['x'.repeat(501)]])('cancel needs a reason, owner (%j)', async (reason) => {
      await invalidArgument('order_cancel', [reason], ['pending', 'pending'], 'owner');
    });
    it.each([[''], [null], ['../other/file.jpg'], ['/absolute.jpg'], ['back\\slash.jpg'], ['x'.repeat(501)]])('submit_proof rejects the path %j', async (path) => {
      await invalidArgument('order_submit_proof', [path, null, '+13055550100'], ['pending', 'pending'], 'owner');
    });
    it.each([['123'], ['9'.repeat(31)]])('submit_proof rejects the phone %j', async (phone) => {
      await invalidArgument('order_submit_proof', [PROOF, null, phone], ['pending', 'pending'], 'owner');
    });
    // W6a: the delivery photo is optional; when a path IS given its shape is still validated.
    it.each([['a/../b.jpg'], ['/abs.jpg'], ['back\\slash.jpg'], ['x'.repeat(501)]])('mark_delivered rejects a malformed proof path (%j)', async (path) => {
      await invalidArgument('order_mark_delivered', [path], ['dispatched', 'validated']);
    });
  });

  describe('data written by each transition', () => {
    it('submit_proof stores proof, reference and phone, clears the rejection reason', async () => {
      const id = await seed('pending', 'rejected');
      await admin.query('UPDATE public.orders SET rejection_reason = $2 WHERE id = $1', [id, 'blurry']);
      const c = await as(actors.customerId);
      const r = await call(c, 'order_submit_proof', [id, PROOF, '  Jane Doe  ', ' +13055550100 ']);
      expect(r).toMatchObject({ payment_proof_url: PROOF, payment_reference: 'Jane Doe', payer_phone: '+13055550100', rejection_reason: null });
    });

    it('submit_proof without reference or phone keeps the stored ones', async () => {
      const id = await seed('pending', 'pending');
      await admin.query(`UPDATE public.orders SET payment_reference = 'Kept', payer_phone = '+13055550199' WHERE id = $1`, [id]);
      const c = await as(actors.customerId);
      const r = await call(c, 'order_submit_proof', [id, PROOF, null, null]);
      expect(r).toMatchObject({ payment_reference: 'Kept', payer_phone: '+13055550199' });
    });

    it('validate_payment stamps validated_by / validated_at; reject stamps them and the reason', async () => {
      const a = await seed('pending', 'proof_uploaded');
      const b = await seed('pending', 'proof_uploaded');
      const c = await as(actors.adminId);
      const v = await call(c, 'order_validate_payment', [a]);
      expect(v.validated_by).toBe(actors.adminId);
      expect(v.validated_at).not.toBeNull();
      const r = await call(c, 'order_reject_payment', [b, '  wrong amount  ']);
      expect(r).toMatchObject({ validated_by: actors.adminId, rejection_reason: 'wrong amount' });
    });

    it('start_processing stamps processing_started_at', async () => {
      const id = await seed('pending', 'validated');
      const c = await as(actors.adminId);
      expect((await call(c, 'order_start_processing', [id])).processing_started_at).not.toBeNull();
    });

    it('dispatch stamps dispatched_at/by and APPENDS the tracking to existing notes (they used to be overwritten)', async () => {
      const withNotes = await seed('processing', 'validated');
      const withoutNotes = await seed('processing', 'validated');
      const untouched = await seed('processing', 'validated');
      await admin.query(`UPDATE public.orders SET notes = 'Customer asked for evening delivery' WHERE id = $1 OR id = $2`, [withNotes, untouched]);
      const c = await as(actors.adminId);
      const a = await call(c, 'order_dispatch', [withNotes, 'TRK-9']);
      expect(a.notes).toBe('Customer asked for evening delivery\n\nTracking: TRK-9');
      expect(a).toMatchObject({ dispatched_by: actors.adminId });
      expect(a.dispatched_at).not.toBeNull();
      expect((await call(c, 'order_dispatch', [withoutNotes, 'TRK-1'])).notes).toBe('Tracking: TRK-1');
      expect((await call(c, 'order_dispatch', [untouched, '  '])).notes).toBe('Customer asked for evening delivery');
    });

    it('mark_delivered stores the proof path and delivered_at', async () => {
      const id = await seed('dispatched', 'validated');
      const c = await as(actors.adminId);
      const r = await call(c, 'order_mark_delivered', [id, DELIVERY]);
      expect(r.delivery_proof_url).toBe(DELIVERY);
      expect(r.delivered_at).not.toBeNull();
    });

    it.each([[null], [''], ['   ']])('mark_delivered without a proof (%j) delivers and stores NULL, never an empty string', async (path) => {
      const id = await seed('dispatched', 'validated');
      const c = await as(actors.adminId);
      const r = await call(c, 'order_mark_delivered', [id, path]);
      expect(r.status).toBe('delivered');
      expect(r.delivery_proof_url).toBeNull();
      expect(r.delivered_at).not.toBeNull();
    });

    it('order_mark_delivered can be called with the order id alone (proof argument has a default)', async () => {
      const id = await seed('dispatched', 'validated');
      const c = await as(actors.adminId);
      const r = await call(c, 'order_mark_delivered', [id]);
      expect(r).toMatchObject({ status: 'delivered', delivery_proof_url: null });
    });

    it('mark_delivered writes "Delivered with proof" / "Delivered without proof" to the history', async () => {
      const withProof = await seed('dispatched', 'validated');
      const without = await seed('dispatched', 'validated');
      const c = await as(actors.adminId);
      await call(c, 'order_mark_delivered', [withProof, DELIVERY]);
      await call(c, 'order_mark_delivered', [without, null]);
      expect((await history(withProof))[0].notes).toBe('Delivered with proof');
      expect((await history(without))[0].notes).toBe('Delivered without proof');
    });

    it('complete stamps completed_at and appends notes without losing the previous ones', async () => {
      const id = await seed('delivered', 'validated');
      await admin.query(`UPDATE public.orders SET notes = 'Tracking: TRK-9' WHERE id = $1`, [id]);
      const c = await as(actors.adminId);
      const r = await call(c, 'order_complete', [id, 'Confirmed by phone']);
      expect(r.completed_at).not.toBeNull();
      expect(r.notes).toBe('Tracking: TRK-9\n\nConfirmed by phone');
    });

    it('cancel stores the reason in rejection_reason', async () => {
      const id = await seed('processing', 'validated');
      const c = await as(actors.adminId);
      expect((await call(c, 'order_cancel', [id, 'Supplier cancelled'])).rejection_reason).toBe('Supplier cancelled');
    });
  });

  describe('characterization of behaviours kept from the JS state machine', () => {
    it('a payment can be validated straight from pending (no proof)', async () => {
      const id = await seed('pending', 'pending');
      const c = await as(actors.adminId);
      expect(await call(c, 'order_validate_payment', [id])).toMatchObject({ status: 'processing', payment_status: 'validated' });
    });

    it('the admin cancel does not touch payment_status; the owner cancel sets it to rejected', async () => {
      const a = await seed('processing', 'validated');
      const b = await seed('pending', 'proof_uploaded');
      const adm = await as(actors.adminId);
      const own = await as(actors.customerId);
      expect((await call(adm, 'order_cancel', [a, 'x'])).payment_status).toBe('validated');
      expect((await call(own, 'order_cancel', [b, 'x'])).payment_status).toBe('rejected');
    });

    it('reopen resets the payment to pending', async () => {
      const id = await seed('cancelled', 'rejected');
      const c = await as(actors.customerId);
      expect(await call(c, 'order_reopen', [id])).toMatchObject({ status: 'pending', payment_status: 'pending' });
    });

    it('a reject does NOT release the reservation (the order is still alive)', async () => {
      const { productId } = await seedProduct(admin, actors, tracker, { quantity: 5 });
      const id = await seedOrder(admin, actors, tracker, [{ type: 'product', id: productId, quantity: 2 }], { paymentStatus: 'proof_uploaded' });
      const owner = await as(actors.customerId);
      await owner.query('SELECT public.reserve_order_inventory($1::uuid)', [id]);
      const c = await as(actors.adminId);
      await call(c, 'order_reject_payment', [id, 'blurry']);
      expect((await readInventory(admin, productId))[0].reserved).toBe(2);
      expect(await readAllocations(admin, id)).toEqual([expect.objectContaining({ state: 'reserved', quantity: 2 })]);
    });
  });

  describe('status history (one row per transition, notes carried by the transaction)', () => {
    it.each([
      ['submit_proof', ['pending', 'pending'], 'owner', 'order_submit_proof', () => [PROOF, 'P', '+13055550100'], /proof/i],
      ['validate_payment', ['pending', 'proof_uploaded'], 'admin', 'order_validate_payment', () => [], /validated/i],
      ['reject_payment', ['pending', 'proof_uploaded'], 'admin', 'order_reject_payment', () => ['blurry photo'], /blurry photo/],
      ['start_processing', ['pending', 'validated'], 'admin', 'order_start_processing', () => [], /processing/i],
      ['dispatch', ['processing', 'validated'], 'admin', 'order_dispatch', () => ['T1'], /dispatch/i],
      ['mark_delivered', ['dispatched', 'validated'], 'admin', 'order_mark_delivered', () => [DELIVERY], /deliver/i],
      ['complete', ['delivered', 'validated'], 'admin', 'order_complete', () => [null], /complet/i],
      ['cancel (admin)', ['pending', 'pending'], 'admin', 'order_cancel', () => ['no stock at supplier'], /no stock at supplier/],
      ['cancel (owner)', ['pending', 'pending'], 'owner', 'order_cancel', () => ['changed my mind'], /changed my mind/],
      ['reopen', ['cancelled', 'rejected'], 'owner', 'order_reopen', () => [], /reopen/i]
    ])('%s writes exactly one history row with a note', async (_n, state, actor, fn, args, notePattern) => {
      const id = await seed(...state);
      const uid = actor === 'owner' ? actors.customerId : actors.adminId;
      const c = await as(uid);
      await call(c, fn, [id, ...args()]);
      const rows = await history(id);
      expect(rows).toHaveLength(1);
      expect(rows[0].changed_by).toBe(uid);
      expect(rows[0].notes).toMatch(notePattern);
      expect(rows[0].new_status).toBe((await row(id)).status);
    });

    it('a refused transition leaves no history', async () => {
      const id = await seed('completed', 'validated');
      const c = await as(actors.adminId);
      await failure(call(c, 'order_cancel', [id, 'x']));
      expect(await history(id)).toHaveLength(0);
    });

    it('the note does not leak to the next statement of the same transaction', async () => {
      const id = await seed('pending', 'proof_uploaded');
      const other = await seed('pending', 'pending');
      const c = await as(actors.adminId);
      await c.query('BEGIN');
      await call(c, 'order_reject_payment', [id, 'first reason']);
      await call(c, 'order_cancel', [other, 'second reason']);
      await c.query('COMMIT');
      expect((await history(other))[0].notes).toMatch(/second reason/);
      expect((await history(other))[0].notes).not.toMatch(/first reason/);
    });
  });

  describe('stock side effects share the transaction', () => {
    const reserved = async (productId, orderId) => {
      const owner = await as(actors.customerId);
      await owner.query('SELECT public.reserve_order_inventory($1::uuid)', [orderId]);
      return readInventory(admin, productId);
    };

    it('validate_payment consumes the reservation', async () => {
      const { productId } = await seedProduct(admin, actors, tracker, { quantity: 5 });
      const id = await seedOrder(admin, actors, tracker, [{ type: 'product', id: productId, quantity: 2 }], { paymentStatus: 'proof_uploaded' });
      await reserved(productId, id);
      const c = await as(actors.adminId);
      await call(c, 'order_validate_payment', [id]);
      expect((await readInventory(admin, productId))[0]).toMatchObject({ quantity: 3, reserved: 0 });
      expect(await readAllocations(admin, id)).toEqual([expect.objectContaining({ state: 'consumed' })]);
    });

    it('validate_payment without enough stock leaves the order UNCHANGED (no manual revert) and raises stock_refused', async () => {
      const { productId } = await seedProduct(admin, actors, tracker, { quantity: 2 });
      const id = await seedOrder(admin, actors, tracker, [{ type: 'product', id: productId, quantity: 5 }], { paymentStatus: 'proof_uploaded' });
      const c = await as(actors.adminId);
      const err = await failure(call(c, 'order_validate_payment', [id]));
      expect(err.code).toBe('P0001');
      expect(err.message).toMatch(/stock_refused/);
      expect(JSON.parse(err.detail)).toMatchObject({ ok: false, reason: 'insufficient_stock' });
      expect(await readOrder(admin, id)).toMatchObject({ status: 'pending', payment_status: 'proof_uploaded' });
      expect(await readAllocations(admin, id)).toEqual([]);
      expect((await readInventory(admin, productId))[0]).toMatchObject({ quantity: 2, reserved: 0 });
      expect(await history(id)).toHaveLength(0);
    });

    it('cancel releases the reservation in the same transaction (trigger)', async () => {
      const { productId } = await seedProduct(admin, actors, tracker, { quantity: 5 });
      const id = await seedOrder(admin, actors, tracker, [{ type: 'product', id: productId, quantity: 3 }]);
      await reserved(productId, id);
      const owner = await as(actors.customerId);
      await call(owner, 'order_cancel', [id, 'nope']);
      expect((await readInventory(admin, productId))[0]).toMatchObject({ quantity: 5, reserved: 0 });
    });

    it('cancelling after the payment was validated keeps the consumed stock (explicit restock decision)', async () => {
      const { productId } = await seedProduct(admin, actors, tracker, { quantity: 5 });
      const id = await seedOrder(admin, actors, tracker, [{ type: 'product', id: productId, quantity: 2 }], { paymentStatus: 'proof_uploaded' });
      await reserved(productId, id);
      const c = await as(actors.adminId);
      await call(c, 'order_validate_payment', [id]);
      await call(c, 'order_cancel', [id, 'customer refund']);
      expect((await readInventory(admin, productId))[0]).toMatchObject({ quantity: 3, reserved: 0 });
    });

    it('reopen re-reserves the stock', async () => {
      const { productId } = await seedProduct(admin, actors, tracker, { quantity: 5 });
      const id = await seedOrder(admin, actors, tracker, [{ type: 'product', id: productId, quantity: 2 }]);
      await reserved(productId, id);
      const owner = await as(actors.customerId);
      await call(owner, 'order_cancel', [id, 'x']);
      expect((await readInventory(admin, productId))[0].reserved).toBe(0);
      await call(owner, 'order_reopen', [id]);
      expect((await readInventory(admin, productId))[0].reserved).toBe(2);
      expect(await readOrder(admin, id)).toMatchObject({ status: 'pending', stock_reserved: true });
    });

    it('reopen without stock stays cancelled and writes NO back-and-forth history', async () => {
      const { productId, inventoryId } = await seedProduct(admin, actors, tracker, { quantity: 5 });
      const id = await seedOrder(admin, actors, tracker, [{ type: 'product', id: productId, quantity: 2 }]);
      await reserved(productId, id);
      const owner = await as(actors.customerId);
      await call(owner, 'order_cancel', [id, 'x']);
      await admin.query('UPDATE public.inventory SET quantity = 0 WHERE id = $1', [inventoryId]);
      const before = (await history(id)).length;
      const err = await failure(call(owner, 'order_reopen', [id]));
      expect(err.code).toBe('P0001');
      expect(err.message).toMatch(/stock_refused/);
      expect(JSON.parse(err.detail)).toMatchObject({ reason: 'insufficient_stock' });
      expect(await readOrder(admin, id)).toMatchObject({ status: 'cancelled', stock_reserved: false });
      expect(await history(id)).toHaveLength(before);
    });
  });

  describe('races (two real connections released at the same instant)', () => {
    const outcome = (results) => ({
      ok: results.filter((r) => r.error === undefined).length,
      errors: results.filter((r) => r.error).map((r) => `${r.error.code}:${r.error.message}`)
    });

    it('two admins validate the same order: one wins, the other gets invalid_transition, stock consumed once', async () => {
      for (let i = 0; i < 5; i += 1) {
        const { productId } = await seedProduct(admin, actors, tracker, { quantity: 10 });
        const id = await seedOrder(admin, actors, tracker, [{ type: 'product', id: productId, quantity: 3 }], { paymentStatus: 'proof_uploaded' });
        const owner = await as(actors.customerId);
        await owner.query('SELECT public.reserve_order_inventory($1::uuid)', [id]);
        const a = await as(actors.adminId);
        const b = await as(actors.adminId);
        const results = await fireTogether([
          { client: a, sql: 'public.order_validate_payment($1::uuid)', params: [id] },
          { client: b, sql: 'public.order_validate_payment($1::uuid)', params: [id] }
        ]);
        const o = outcome(results);
        expect(o.ok, `run ${i}`).toBe(1);
        expect(o.errors[0]).toMatch(/^22023:invalid_transition/);
        expect((await readInventory(admin, productId))[0]).toMatchObject({ quantity: 7, reserved: 0 });
        expect(await history(id)).toHaveLength(1);
      }
    });

    it('owner cancel vs admin validate: never "validated with released stock" nor "cancelled with consumed stock"', async () => {
      const seen = new Set();
      for (let i = 0; i < 8; i += 1) {
        const { productId } = await seedProduct(admin, actors, tracker, { quantity: 10 });
        const id = await seedOrder(admin, actors, tracker, [{ type: 'product', id: productId, quantity: 3 }], { paymentStatus: 'proof_uploaded' });
        const owner = await as(actors.customerId);
        await owner.query('SELECT public.reserve_order_inventory($1::uuid)', [id]);
        const o2 = await as(actors.customerId);
        const a = await as(actors.adminId);
        await fireTogether([
          { client: o2, sql: 'public.order_cancel($1::uuid, $2::text)', params: [id, 'changed my mind'] },
          { client: a, sql: 'public.order_validate_payment($1::uuid)', params: [id] }
        ]);
        const o = await readOrder(admin, id);
        const inv = (await readInventory(admin, productId))[0];
        const allocs = await readAllocations(admin, id);
        if (o.status === 'cancelled') {
          seen.add('cancelled');
          expect(o.payment_status).toBe('rejected');
          expect(inv).toMatchObject({ quantity: 10, reserved: 0 });
          expect(allocs.every((x) => x.state !== 'consumed')).toBe(true);
        } else {
          seen.add('validated');
          expect(o).toMatchObject({ status: 'processing', payment_status: 'validated' });
          expect(inv).toMatchObject({ quantity: 7, reserved: 0 });
          expect(allocs).toEqual([expect.objectContaining({ state: 'consumed' })]);
        }
        expect(await history(id)).toHaveLength(1);
      }
      expect(seen.size).toBeGreaterThanOrEqual(1);
    });

    it('owner reopen vs the expiry sweep: the final state is coherent', async () => {
      for (let i = 0; i < 5; i += 1) {
        const { productId } = await seedProduct(admin, actors, tracker, { quantity: 10 });
        const id = await seedOrder(admin, actors, tracker, [{ type: 'product', id: productId, quantity: 2 }]);
        const owner = await as(actors.customerId);
        await owner.query('SELECT public.reserve_order_inventory($1::uuid)', [id]);
        await call(owner, 'order_cancel', [id, 'x']);
        const o2 = await as(actors.customerId);
        const sweeper = await as(actors.adminId);
        await fireTogether([
          { client: o2, sql: 'public.order_reopen($1::uuid)', params: [id] },
          { client: sweeper, sql: 'public.expire_stale_order_reservations()', params: [] }
        ]);
        const o = await readOrder(admin, id);
        const inv = (await readInventory(admin, productId))[0];
        const allocs = await readAllocations(admin, id);
        if (o.status === 'pending') {
          expect(o.stock_reserved).toBe(true);
          expect(inv.reserved).toBe(2);
          expect(allocs).toEqual([expect.objectContaining({ state: 'reserved' })]);
        } else {
          expect(o.status).toBe('cancelled');
          expect(inv.reserved).toBe(0);
          expect(allocs.every((x) => x.state !== 'reserved')).toBe(true);
        }
      }
    });
  });
});
