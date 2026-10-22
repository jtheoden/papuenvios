/**
 * E5 (W5a, remittances): atomic transition RPCs on top of one helper.
 * Migration under test: 20261024110100_remittance_transition_rpcs.sql
 *   public.remittance_* wrappers (SECURITY DEFINER, authenticated only) -> public._remittance_transition (lock,
 *   authorization, matrix and status history in ONE transaction).
 *
 * The suite does not list the new functions in `needs`: a missing migration fails loudly (red phase).
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { dbSuiteSkipReason, connectAdmin, connectAs, connectAnon, fireTogether, endAll } from './db';
import { loadActors } from './fixtures';

const skipReason = await dbSuiteSkipReason({
  functions: ['is_admin_user', 'current_user_is_blocked', 'admin_set_remittance_commission', 'recalculate_remittance_at_current_rate'],
  tables: ['remittances', 'remittance_types', 'remittance_status_history', 'user_profiles']
});
const describeDb = skipReason ? describe.skip : describe;

const WRAPPERS = [
  'remittance_submit_proof',
  'remittance_cancel',
  'remittance_validate_payment',
  'remittance_reject_payment',
  'remittance_start_processing',
  'remittance_confirm_delivery',
  'remittance_complete'
];

const STATUSES = [
  'payment_pending', 'payment_proof_uploaded', 'payment_validated', 'payment_rejected',
  'processing', 'delivered', 'completed', 'cancelled'
];

const PROOF = 'user-id/REM-1.jpg';
const DELIVERY = 'admin-id/delivery/REM-1_delivery.jpg';

const MATRIX = [
  {
    name: 'submit_proof (owner)', fn: 'remittance_submit_proof', actor: 'owner',
    args: () => [PROOF, 'Payer Ref', 'transfer note', '+13055550100'],
    allowed: (s) => ['payment_pending', 'payment_rejected'].includes(s),
    to: 'payment_proof_uploaded'
  },
  {
    name: 'cancel (owner)', fn: 'remittance_cancel', actor: 'owner',
    args: () => ['changed my mind'],
    allowed: (s) => ['payment_pending', 'payment_rejected', 'payment_proof_uploaded'].includes(s),
    to: 'cancelled'
  },
  {
    name: 'validate_payment (admin)', fn: 'remittance_validate_payment', actor: 'admin',
    args: () => [],
    allowed: (s) => s === 'payment_proof_uploaded',
    to: 'payment_validated'
  },
  {
    name: 'reject_payment (admin)', fn: 'remittance_reject_payment', actor: 'admin',
    args: () => ['blurry proof'],
    allowed: (s) => s === 'payment_proof_uploaded',
    to: 'payment_rejected'
  },
  {
    name: 'start_processing (admin)', fn: 'remittance_start_processing', actor: 'admin',
    args: () => [],
    allowed: (s) => s === 'payment_validated',
    to: 'processing'
  },
  {
    name: 'confirm_delivery (admin)', fn: 'remittance_confirm_delivery', actor: 'admin',
    args: () => [DELIVERY, 'handed to the recipient'],
    allowed: (s) => s === 'processing',
    to: 'delivered'
  },
  {
    name: 'complete (admin)', fn: 'remittance_complete', actor: 'admin',
    args: () => ['closed'],
    allowed: (s) => s === 'delivered',
    to: 'completed'
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

describeDb('remittance transition RPCs', () => {
  let admin;
  let actors;
  let strangerId;
  let typeId;
  const clients = [];
  const remittances = [];

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
  const row = async (id) => (await admin.query('SELECT * FROM public.remittances WHERE id = $1', [id])).rows[0];
  const history = async (id) =>
    (await admin.query('SELECT old_status, new_status, changed_by, notes FROM public.remittance_status_history WHERE remittance_id = $1 ORDER BY created_at, id', [id])).rows;
  const setUser = (id, fields) =>
    admin.query(`UPDATE public.user_profiles SET ${Object.keys(fields).map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE id = $1`, [id, ...Object.values(fields)]);

  const seed = async (status, extra = {}) => {
    const id = randomUUID();
    await admin.query(
      `INSERT INTO public.remittances (id, user_id, remittance_type_id, amount_sent, exchange_rate,
         commission_percentage, commission_fixed, commission_total, amount_to_deliver, currency_sent,
         currency_delivered, recipient_name, recipient_phone, status, delivery_proof_url)
       VALUES ($1,$2,$3,100,800,2.5,0,2.5,78000,'USD','CUP','Rcpt','+5355550100',$4,$5)`,
      [id, actors.customerId, typeId, status, extra.deliveryProof ?? null]
    );
    remittances.push(id);
    return id;
  };

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
    strangerId = randomUUID();
    await admin.query(
      `INSERT INTO auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
       VALUES ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, '{}'::jsonb, now(), now())`,
      [strangerId, `w5.rstranger.${strangerId.slice(0, 8)}@example.test`]
    );
  });
  afterEach(async () => {
    await endAll(clients.splice(0));
    await setUser(actors.customerId, { is_enabled: true });
    await setUser(actors.adminId, { is_enabled: true, role: 'admin' });
    if (remittances.length) {
      await admin.query('DELETE FROM public.remittance_status_history WHERE remittance_id = ANY($1)', [remittances]);
      await admin.query('DELETE FROM public.remittances WHERE id = ANY($1)', [remittances.splice(0)]);
    }
  });
  afterAll(async () => {
    await admin.query('DELETE FROM public.remittance_types WHERE id = $1', [typeId]);
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

    it('the helper _remittance_transition is not callable by anon or authenticated', async () => {
      const { rows } = await admin.query(
        `SELECT has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
                has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth
           FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = '_remittance_transition'`
      );
      expect(rows[0]).toEqual({ anon: false, auth: false });
    });

    it('anon is refused', async () => {
      const id = await seed('payment_pending');
      const anon = await connectAnon();
      clients.push(anon);
      const err = await failure(anon.query('SELECT * FROM public.remittance_cancel($1, $2)', [id, 'x']));
      expect(err.code).toBe('42501');
    });
  });

  describe('transition matrix (every status)', () => {
    it.each(MATRIX)('$name', async (spec) => {
      const wrong = [];
      for (const status of STATUSES) {
        const id = await seed(status);
        const client = await as(spec.actor === 'owner' ? actors.customerId : actors.adminId);
        const expectedOk = spec.allowed(status);
        try {
          const result = await call(client, spec.fn, [id, ...spec.args()]);
          if (!expectedOk) {
            wrong.push(`${status}: should have been refused`);
            continue;
          }
          if (result.status !== spec.to || (await row(id)).status !== spec.to) wrong.push(`${status}: got ${result.status}`);
        } catch (error) {
          if (expectedOk) {
            wrong.push(`${status}: refused (${error.message})`);
          } else if (error.code !== '22023' || !/invalid_transition/.test(error.message)) {
            wrong.push(`${status}: wrong error ${error.code} ${error.message}`);
          } else if ((await row(id)).status !== status) {
            wrong.push(`${status}: row changed despite refusal`);
          }
        }
      }
      expect(wrong).toEqual([]);
    });

    it('a refusal reports the current status in DETAIL', async () => {
      const id = await seed('completed');
      const c = await as(actors.adminId);
      const err = await failure(call(c, 'remittance_validate_payment', [id]));
      expect(err.code).toBe('22023');
      expect(JSON.parse(err.detail)).toMatchObject({ status: 'completed', action: 'validate_payment' });
    });
  });

  describe('authorization', () => {
    it('an owner (not admin) cannot run admin actions', async () => {
      const id = await seed('payment_proof_uploaded');
      const c = await as(actors.customerId);
      for (const [fn, args] of [
        ['remittance_validate_payment', []],
        ['remittance_reject_payment', ['no']],
        ['remittance_start_processing', []],
        ['remittance_confirm_delivery', [DELIVERY, null]],
        ['remittance_complete', [null]]
      ]) {
        expect((await failure(call(c, fn, [id, ...args]))).code, fn).toBe('42501');
      }
      expect((await row(id)).status).toBe('payment_proof_uploaded');
    });

    it('a stranger gets the same error for somebody else remittance and for an unknown id', async () => {
      const id = await seed('payment_pending');
      const c = await as(strangerId);
      const foreign = await failure(call(c, 'remittance_cancel', [id, 'x']));
      const unknown = await failure(call(c, 'remittance_cancel', [randomUUID(), 'x']));
      expect(foreign.code).toBe('42501');
      expect(unknown.code).toBe('42501');
      expect(foreign.message).toBe(unknown.message);
      expect((await failure(call(c, 'remittance_submit_proof', [id, PROOF, 'r', null, '+13055550100']))).code).toBe('42501');
      expect((await row(id)).status).toBe('payment_pending');
    });

    it('an admin gets remittance_not_found for an unknown id, and cannot use owner-only actions on somebody else remittance', async () => {
      const id = await seed('payment_pending');
      const c = await as(actors.adminId);
      expect((await failure(call(c, 'remittance_cancel', [randomUUID(), 'x']))).code).toBe('P0002');
      expect((await failure(call(c, 'remittance_cancel', [id, 'x']))).code).toBe('42501');
      expect((await failure(call(c, 'remittance_submit_proof', [id, PROOF, 'r', null, '+13055550100']))).code).toBe('42501');
    });

    it('a disabled customer cannot submit a proof or cancel', async () => {
      const a = await seed('payment_pending');
      const b = await seed('payment_pending');
      await setUser(actors.customerId, { is_enabled: false });
      const c = await as(actors.customerId);
      expect((await failure(call(c, 'remittance_submit_proof', [a, PROOF, 'r', null, '+13055550100']))).code).toBe('42501');
      expect((await failure(call(c, 'remittance_cancel', [b, 'x']))).code).toBe('42501');
      expect((await row(a)).status).toBe('payment_pending');
      expect((await row(b)).status).toBe('payment_pending');
    });

    it('a disabled admin cannot validate', async () => {
      const id = await seed('payment_proof_uploaded');
      await setUser(actors.adminId, { is_enabled: false });
      const c = await as(actors.adminId);
      expect((await failure(call(c, 'remittance_validate_payment', [id]))).code).toBe('42501');
      expect((await row(id)).status).toBe('payment_proof_uploaded');
    });
  });

  describe('argument validation', () => {
    const invalidArgument = async (fn, args, state, actor) => {
      const id = await seed(state);
      const c = await as(actor === 'owner' ? actors.customerId : actors.adminId);
      const err = await failure(call(c, fn, [id, ...args]));
      expect(err.code, `${fn} ${JSON.stringify(args)}`).toBe('22023');
      expect(err.message).toMatch(/invalid_argument/);
      expect((await row(id)).status).toBe(state);
    };

    it.each([[null], [''], ['   '], ['x'.repeat(501)]])('reject_payment needs a 1..500 char reason (%j)', async (reason) => {
      await invalidArgument('remittance_reject_payment', [reason], 'payment_proof_uploaded', 'admin');
    });
    it('cancel accepts an empty reason (as before) but not an oversized one', async () => {
      await invalidArgument('remittance_cancel', ['x'.repeat(501)], 'payment_pending', 'owner');
      const id = await seed('payment_pending');
      const c = await as(actors.customerId);
      expect((await call(c, 'remittance_cancel', [id, ''])).status).toBe('cancelled');
    });
    it.each([[''], [null], ['../x.jpg'], ['/abs.jpg'], ['back\\slash.jpg']])('submit_proof rejects the path %j', async (path) => {
      await invalidArgument('remittance_submit_proof', [path, 'ref', null, '+13055550100'], 'payment_pending', 'owner');
    });
    it.each([[''], [null], ['x'.repeat(201)]])('submit_proof needs a reference of 1..200 chars (%j)', async (ref) => {
      await invalidArgument('remittance_submit_proof', [PROOF, ref, null, '+13055550100'], 'payment_pending', 'owner');
    });
    it.each([['123'], ['9'.repeat(31)]])('submit_proof rejects the phone %j', async (phone) => {
      await invalidArgument('remittance_submit_proof', [PROOF, 'ref', null, phone], 'payment_pending', 'owner');
    });
    it('confirm_delivery without a proof (new or existing) is refused by the RPC itself', async () => {
      await invalidArgument('remittance_confirm_delivery', [null, 'n'], 'processing', 'admin');
      await invalidArgument('remittance_confirm_delivery', ['  ', 'n'], 'processing', 'admin');
    });
    it('confirm_delivery keeps the existing proof when no new one is given', async () => {
      const id = await seed('processing', { deliveryProof: 'admin-id/delivery/existing.jpg' });
      const c = await as(actors.adminId);
      const r = await call(c, 'remittance_confirm_delivery', [id, null, 'ok']);
      expect(r).toMatchObject({ status: 'delivered', delivery_proof_url: 'admin-id/delivery/existing.jpg' });
    });
  });

  describe('data written by each transition', () => {
    it('submit_proof stores proof, reference, notes, phone and the upload timestamp', async () => {
      const id = await seed('payment_rejected');
      const c = await as(actors.customerId);
      const r = await call(c, 'remittance_submit_proof', [id, PROOF, '  Jane Doe ', 'note', ' +13055550100 ']);
      expect(r).toMatchObject({ payment_proof_url: PROOF, payment_reference: 'Jane Doe', payment_proof_notes: 'note', payer_phone: '+13055550100' });
      expect(r.payment_proof_uploaded_at).not.toBeNull();
    });

    it('cancel stores cancelled_at / cancelled_by / cancellation_reason', async () => {
      const id = await seed('payment_proof_uploaded');
      const c = await as(actors.customerId);
      const r = await call(c, 'remittance_cancel', [id, '  not needed ']);
      expect(r).toMatchObject({ status: 'cancelled', cancelled_by: actors.customerId, cancellation_reason: 'not needed' });
      expect(r.cancelled_at).not.toBeNull();
    });

    it('validate stamps payment_validated, _at and _by; reject stores the reason', async () => {
      const a = await seed('payment_proof_uploaded');
      const b = await seed('payment_proof_uploaded');
      const c = await as(actors.adminId);
      const v = await call(c, 'remittance_validate_payment', [a]);
      expect(v).toMatchObject({ payment_validated: true, payment_validated_by: actors.adminId });
      expect(v.payment_validated_at).not.toBeNull();
      expect((await call(c, 'remittance_reject_payment', [b, ' wrong amount '])).payment_rejection_reason).toBe('wrong amount');
    });

    it('start_processing stamps processing_started_at; complete stamps completed_at and keeps the delivery notes when none given', async () => {
      const a = await seed('payment_validated');
      const b = await seed('delivered');
      await admin.query(`UPDATE public.remittances SET delivery_notes_admin = 'handed over' WHERE id = $1`, [b]);
      const c = await as(actors.adminId);
      expect((await call(c, 'remittance_start_processing', [a])).processing_started_at).not.toBeNull();
      const done = await call(c, 'remittance_complete', [b, null]);
      expect(done.completed_at).not.toBeNull();
      expect(done.delivery_notes_admin).toBe('handed over');
    });

    it('confirm_delivery stores delivered_at, the proof and the admin notes', async () => {
      const id = await seed('processing');
      const c = await as(actors.adminId);
      const r = await call(c, 'remittance_confirm_delivery', [id, DELIVERY, 'delivered to the sister']);
      expect(r).toMatchObject({ delivery_proof_url: DELIVERY, delivery_notes_admin: 'delivered to the sister' });
      expect(r.delivered_at).not.toBeNull();
    });
  });

  describe('status history (one row per transition, notes carried by the transaction)', () => {
    it.each([
      ['submit_proof', 'payment_pending', 'owner', 'remittance_submit_proof', () => [PROOF, 'ref', null, '+13055550100'], /proof/i],
      ['cancel', 'payment_pending', 'owner', 'remittance_cancel', () => ['changed my mind'], /changed my mind/],
      ['validate_payment', 'payment_proof_uploaded', 'admin', 'remittance_validate_payment', () => [], /validated/i],
      ['reject_payment', 'payment_proof_uploaded', 'admin', 'remittance_reject_payment', () => ['blurry photo'], /blurry photo/],
      ['start_processing', 'payment_validated', 'admin', 'remittance_start_processing', () => [], /processing/i],
      ['confirm_delivery', 'processing', 'admin', 'remittance_confirm_delivery', () => [DELIVERY, null], /deliver/i],
      ['complete', 'delivered', 'admin', 'remittance_complete', () => [null], /complet/i]
    ])('%s writes exactly one history row with a note', async (_n, state, actor, fn, args, notePattern) => {
      const id = await seed(state);
      const uid = actor === 'owner' ? actors.customerId : actors.adminId;
      const c = await as(uid);
      await call(c, fn, [id, ...args()]);
      const rows = await history(id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ old_status: state, changed_by: uid });
      expect(rows[0].notes).toMatch(notePattern);
      expect(rows[0].new_status).toBe((await row(id)).status);
    });

    it('a refused transition leaves no history', async () => {
      const id = await seed('completed');
      const c = await as(actors.adminId);
      await failure(call(c, 'remittance_validate_payment', [id]));
      expect(await history(id)).toHaveLength(0);
    });
  });

  describe('races (two real connections released at the same instant)', () => {
    const okCount = (results) => results.filter((r) => r.error === undefined).length;

    it('two admins validate the same remittance: one wins, the other gets invalid_transition', async () => {
      for (let i = 0; i < 5; i += 1) {
        const id = await seed('payment_proof_uploaded');
        const a = await as(actors.adminId);
        const b = await as(actors.adminId);
        const results = await fireTogether([
          { client: a, sql: 'public.remittance_validate_payment($1::uuid)', params: [id] },
          { client: b, sql: 'public.remittance_validate_payment($1::uuid)', params: [id] }
        ]);
        expect(okCount(results), `run ${i}`).toBe(1);
        expect(results.find((r) => r.error).error.message).toMatch(/invalid_transition/);
        expect(await history(id)).toHaveLength(1);
      }
    });

    it('validate vs reject: exactly one wins and the row is coherent', async () => {
      for (let i = 0; i < 5; i += 1) {
        const id = await seed('payment_proof_uploaded');
        const a = await as(actors.adminId);
        const b = await as(actors.adminId);
        const results = await fireTogether([
          { client: a, sql: 'public.remittance_validate_payment($1::uuid)', params: [id] },
          { client: b, sql: 'public.remittance_reject_payment($1::uuid, $2::text)', params: [id, 'late'] }
        ]);
        expect(okCount(results), `run ${i}`).toBe(1);
        const r = await row(id);
        if (r.status === 'payment_validated') {
          expect(r.payment_validated).toBe(true);
          expect(r.payment_rejection_reason).toBeNull();
        } else {
          expect(r.status).toBe('payment_rejected');
          expect(r.payment_validated).toBe(false);
        }
        expect(await history(id)).toHaveLength(1);
      }
    });

    it('validate vs owner cancel: either validated or cancelled, never both effects', async () => {
      for (let i = 0; i < 5; i += 1) {
        const id = await seed('payment_proof_uploaded');
        const a = await as(actors.adminId);
        const o = await as(actors.customerId);
        const results = await fireTogether([
          { client: a, sql: 'public.remittance_validate_payment($1::uuid)', params: [id] },
          { client: o, sql: 'public.remittance_cancel($1::uuid, $2::text)', params: [id, 'oops'] }
        ]);
        // validate -> cancel is invalid (payment_validated is not cancellable) and cancel -> validate is invalid.
        expect(okCount(results), `run ${i}`).toBe(1);
        const r = await row(id);
        if (r.status === 'cancelled') {
          expect(r.payment_validated).toBe(false);
          expect(r.cancelled_by).toBe(actors.customerId);
        } else {
          expect(r).toMatchObject({ status: 'payment_validated', payment_validated: true, cancelled_at: null });
        }
      }
    });
  });

  describe('neighbours stay intact', () => {
    it('the money guard still rejects a direct PATCH of a money column by an admin', async () => {
      const id = await seed('payment_pending');
      const c = await as(actors.adminId);
      const err = await failure(c.query('UPDATE public.remittances SET commission_total = 0.01 WHERE id = $1', [id]));
      expect(err.code).toBe('42501');
      expect(err.message).toMatch(/remittance_money_columns_rpc_only/);
    });

    it('admin_set_remittance_commission and recalculate keep working in payment_pending / payment_rejected', async () => {
      const a = await seed('payment_pending');
      const b = await seed('payment_rejected');
      const c = await as(actors.adminId);
      await c.query('SELECT * FROM public.admin_set_remittance_commission($1::uuid, $2::numeric, $3::text)', [a, 1.5, 'special rate']);
      const own = await as(actors.customerId);
      await own.query('SELECT * FROM public.recalculate_remittance_at_current_rate($1)', [b]);
      expect((await row(a)).status).toBe('payment_pending');
    });

    it('the owner can still PATCH non-status columns the guard allows (proof notes while pending)', async () => {
      const id = await seed('payment_pending');
      const own = await as(actors.customerId);
      await own.query(`UPDATE public.remittances SET payment_proof_notes = 'n' WHERE id = $1`, [id]);
    });
  });
});
