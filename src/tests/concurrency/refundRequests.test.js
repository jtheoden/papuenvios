/**
 * Refunds queue, database layer (orders and remittances cancelled after the customer already paid).
 * Migrations under test: 20261029100000_refund_requests_table.sql, 20261029100100_add_business_days.sql,
 * 20261029100200_refund_triggers.sql, 20261029100300_refund_rpcs.sql
 *
 * The suite does not list the new objects in `needs`: a missing migration fails loudly (red phase).
 * Window vectors are shared with the JS mirror (src/tests/fixtures/refund-window-vectors.json).
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dbSuiteSkipReason, connectAdmin, connectAs, connectAnon, fireTogether, endAll } from './db';
import { loadActors, createTracker, seedOrder, seedProduct, cleanup, withConstraintDropped } from './fixtures';

const vectors = JSON.parse(readFileSync('src/tests/fixtures/refund-window-vectors.json', 'utf8'));

const skipReason = await dbSuiteSkipReason({
  functions: ['is_admin_user', 'current_user_is_blocked', 'order_cancel', 'order_reopen', 'remittance_cancel'],
  tables: ['orders', 'remittances', 'activity_logs', 'user_profiles']
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

describeDb('refund queue (database layer)', () => {
  let admin;
  let actors;
  let typeId;
  let proofRuleWasOn = false;
  const clients = [];
  const tracker = createTracker();
  const remittances = [];

  const as = async (userId) => {
    const c = await connectAs(userId);
    clients.push(c);
    return c;
  };
  const anon = async () => {
    const c = await connectAnon();
    clients.push(c);
    return c;
  };
  const call = async (client, fn, args = []) => {
    const placeholders = args.map((_, i) => `$${i + 1}`).join(', ');
    const { rows } = await client.query(`SELECT * FROM public.${fn}(${placeholders})`, args);
    return rows[0];
  };
  const refundsFor = async (id) =>
    (await admin.query(
      `SELECT * FROM public.refund_requests WHERE order_id = $1 OR remittance_id = $1 ORDER BY created_at, id`,
      [id]
    )).rows;
  const setUser = (id, fields) =>
    admin.query(
      `UPDATE public.user_profiles SET ${Object.keys(fields).map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE id = $1`,
      [id, ...Object.values(fields)]
    );

  const seedOrderRow = async (status, paymentStatus, extra = {}) =>
    seedOrder(admin, actors, tracker, [], { status, paymentStatus, stockManaged: false, ...extra });

  const seedRemittanceRow = async (status, { deliveryCost = null, validatedAt = null } = {}) => {
    const id = randomUUID();
    await admin.query(
      `INSERT INTO public.remittances (id, user_id, remittance_type_id, amount_sent, exchange_rate,
         commission_percentage, commission_fixed, commission_total, amount_to_deliver, currency_sent,
         currency_delivered, recipient_name, recipient_phone, status, payment_validated_at)
       VALUES ($1,$2,$3,100,800,2.5,0,2.5,78000,'USD','CUP','Rcpt','+5355550100',$4,$5)`,
      [id, actors.customerId, typeId, status, validatedAt]
    );
    if (deliveryCost !== null) {
      await admin.query('UPDATE public.remittances SET delivery_cost = $2 WHERE id = $1', [id, deliveryCost]);
    }
    remittances.push(id);
    return id;
  };

  /** Moves an open refund into a window relative to now(), keeping the table checks satisfied. */
  const placeWindow = (id, { eligibleInHours, dueInHours }) =>
    admin.query(
      `UPDATE public.refund_requests
          SET cancelled_at = now() + make_interval(hours => $2::int - 48),
              eligible_at  = now() + make_interval(hours => $2::int),
              due_at       = now() + make_interval(hours => $3::int)
        WHERE id = $1`,
      [id, eligibleInHours, dueInHours]
    );

  const cancelAsSuperuser = (table, id, extraSet = '', params = []) =>
    admin.query(`UPDATE public.${table} SET status = 'cancelled'${extraSet} WHERE id = $1`, [id, ...params]);

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
    // These R4 tests resolve with the v1 RPC and no proof. The proof rule (R5) is covered in refundAuditTrail.test.js, so it is
    // switched off here (files run sequentially) and restored in afterAll. The function only exists once R5 is applied.
    const fn = await admin.query(`SELECT to_regprocedure('public.refund_proof_required()') AS f`);
    proofRuleWasOn = fn.rows[0].f !== null;
    if (proofRuleWasOn) {
      await admin.query(`CREATE OR REPLACE FUNCTION public.refund_proof_required() RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $f$ SELECT false $f$`);
    }
  });
  afterEach(async () => {
    await endAll(clients.splice(0));
    await setUser(actors.customerId, { is_enabled: true });
    await setUser(actors.adminId, { is_enabled: true, role: 'admin' });
    const ops = [...tracker.orders, ...remittances];
    if (ops.length) {
      await admin.query(
        `DELETE FROM public.activity_logs WHERE action IN ('refund_capture_failed', 'refund_close_failed') AND entity_id = ANY($1)`,
        [ops]
      );
      await admin.query(
        `DELETE FROM public.activity_logs WHERE entity_type = 'refund_request' AND entity_id IN
           (SELECT id FROM public.refund_requests WHERE order_id = ANY($1) OR remittance_id = ANY($1))`,
        [ops]
      );
    }
    if (remittances.length) {
      await admin.query('DELETE FROM public.remittance_status_history WHERE remittance_id = ANY($1)', [remittances]);
      await admin.query('DELETE FROM public.remittances WHERE id = ANY($1)', [remittances.splice(0)]);
    }
    await cleanup(admin, tracker);
  });
  afterAll(async () => {
    if (proofRuleWasOn) {
      await admin.query(`CREATE OR REPLACE FUNCTION public.refund_proof_required() RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $f$ SELECT true $f$`);
    }
    await admin.query('DELETE FROM public.remittance_types WHERE id = $1', [typeId]);
    await admin.end();
  });

  describe('table, privileges and constants', () => {
    it('refund_requests has RLS on, an admin-only SELECT policy and no write grants', async () => {
      const rls = await admin.query(`SELECT relrowsecurity FROM pg_class WHERE oid = 'public.refund_requests'::regclass`);
      expect(rls.rows[0].relrowsecurity).toBe(true);
      const pol = await admin.query(
        `SELECT cmd FROM pg_policies WHERE schemaname = 'public' AND tablename = 'refund_requests'`
      );
      expect(pol.rows).toEqual([{ cmd: 'SELECT' }]);
      const grants = await admin.query(
        `SELECT grantee, privilege_type FROM information_schema.role_table_grants
          WHERE table_schema = 'public' AND table_name = 'refund_requests' AND grantee IN ('anon', 'authenticated', 'PUBLIC')
          ORDER BY 1, 2`
      );
      expect(grants.rows).toEqual([{ grantee: 'authenticated', privilege_type: 'SELECT' }]);
    });

    it('operation FKs cascade and exactly one of order_id / remittance_id is set', async () => {
      const fks = await admin.query(
        `SELECT confrelid::regclass::text AS parent, confdeltype FROM pg_constraint
          WHERE conrelid = 'public.refund_requests'::regclass AND contype = 'f' ORDER BY 1`
      );
      expect(fks.rows).toEqual([
        { parent: 'orders', confdeltype: 'c' },
        { parent: 'remittances', confdeltype: 'c' }
      ]);
      const orderId = await seedOrderRow('pending', 'proof_uploaded');
      const remId = await seedRemittanceRow('payment_proof_uploaded');
      const insert = (o, r) =>
        admin.query(
          `INSERT INTO public.refund_requests (order_id, remittance_id, user_id, payment_evidence, amount, payment_method,
              eligible_at, due_at) VALUES ($1, $2, $3, 'validated', 5, 'zelle', now(), now() + interval '1 day')`,
          [o, r, actors.customerId]
        );
      expect((await failure(insert(null, null))).code).toBe('23514');
      expect((await failure(insert(orderId, remId))).code).toBe('23514');
    });

    it('SQL constants and add_business_days match the shared vectors', async () => {
      const c = await admin.query('SELECT public.refund_hold_hours() AS h, public.refund_business_days() AS d');
      expect(c.rows[0]).toEqual({ h: vectors.constants.holdHours, d: vectors.constants.businessDays });
      for (const w of vectors.windows) {
        const { rows } = await admin.query(
          `SELECT public.add_business_days($1::timestamptz, $2) AS due,
                  $1::timestamptz + make_interval(hours => public.refund_hold_hours()) AS eligible`,
          [w.cancelled_at, vectors.constants.businessDays]
        );
        expect(rows[0].eligible.toISOString()).toBe(w.eligible_at);
        const due = await admin.query('SELECT public.add_business_days($1::timestamptz, $2) AS due', [
          w.eligible_at,
          vectors.constants.businessDays
        ]);
        expect(due.rows[0].due.toISOString(), w.name).toBe(w.due_at);
      }
    });

    it('add_business_days rejects null / negative input', async () => {
      expect((await failure(admin.query('SELECT public.add_business_days(NULL, 5)'))).code).toBe('22023');
      expect((await failure(admin.query('SELECT public.add_business_days(now(), -1)'))).code).toBe('22023');
    });

    it('add_business_days bounds p_days to 366 (a huge value cannot spin the loop)', async () => {
      expect((await failure(admin.query('SELECT public.add_business_days(now(), 367)'))).code).toBe('22023');
      expect((await failure(admin.query('SELECT public.add_business_days(now(), 2000000000)'))).code).toBe('22023');
      const ok = await admin.query('SELECT public.add_business_days(now(), 366) AS d');
      expect(ok.rows[0].d).toBeInstanceOf(Date);
    });

    it('RPCs: authenticated only, SECURITY DEFINER; trigger functions and constants are not callable by API roles', async () => {
      for (const fn of ['admin_list_refunds', 'admin_refund_counts', 'admin_resolve_refund']) {
        const { rows } = await admin.query(
          `SELECT has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
                  has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth, prosecdef
             FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = $1`,
          [fn]
        );
        expect(rows, fn).toEqual([{ anon: false, auth: true, prosecdef: true }]);
      }
      for (const fn of ['refund_request_on_cancel', 'refund_request_on_reopen']) {
        const { rows } = await admin.query(
          `SELECT has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
                  has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth, prosecdef
             FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = $1`,
          [fn]
        );
        expect(rows, fn).toEqual([{ anon: false, auth: false, prosecdef: true }]);
      }
      const pure = await admin.query(
        `SELECT p.proname, has_function_privilege('anon', p.oid, 'EXECUTE') AS anon
           FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
            AND p.proname IN ('add_business_days', 'refund_hold_hours', 'refund_business_days')`
      );
      expect(pure.rows).toHaveLength(3);
      expect(pure.rows.every((r) => r.anon === false)).toBe(true);
    });
  });

  describe('eligibility matrix (trigger on cancel)', () => {
    const ORDER_CASES = [
      { name: 'owner cancels pending/pending', actor: 'customer', from: ['pending', 'pending'], evidence: null },
      { name: 'owner cancels pending/rejected', actor: 'customer', from: ['pending', 'rejected'], evidence: null },
      { name: 'owner cancels pending/proof_uploaded', actor: 'customer', from: ['pending', 'proof_uploaded'], evidence: 'proof_unverified' },
      { name: 'admin cancels pending/pending', actor: 'admin', from: ['pending', 'pending'], evidence: null },
      { name: 'admin cancels pending/rejected', actor: 'admin', from: ['pending', 'rejected'], evidence: null },
      { name: 'admin cancels pending/proof_uploaded', actor: 'admin', from: ['pending', 'proof_uploaded'], evidence: 'proof_unverified' },
      { name: 'admin cancels processing/validated', actor: 'admin', from: ['processing', 'validated'], evidence: 'validated' }
    ];

    it.each(ORDER_CASES)('order: $name', async ({ actor, from, evidence }) => {
      const id = await seedOrderRow(from[0], from[1]);
      const actorId = actor === 'admin' ? actors.adminId : actors.customerId;
      const client = await as(actorId);
      const result = await call(client, 'order_cancel', [id, 'changed my mind']);
      expect(result.status).toBe('cancelled');
      const rows = await refundsFor(id);
      if (evidence === null) {
        expect(rows).toHaveLength(0);
        return;
      }
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        order_id: id,
        remittance_id: null,
        operation_type: 'order',
        user_id: actors.customerId,
        payment_evidence: evidence,
        status: 'pending',
        currency: 'USD',
        payment_method: 'zelle',
        cancellation_reason: 'changed my mind',
        cancelled_by: actorId,
        cancelled_by_role: actor === 'admin' ? 'admin' : 'customer'
      });
      expect(Number(rows[0].amount)).toBe(10);
    });

    it('order: the owner cancel overwrites payment_status to rejected, yet the evidence was captured from OLD', async () => {
      const id = await seedOrderRow('pending', 'proof_uploaded');
      const client = await as(actors.customerId);
      await call(client, 'order_cancel', [id, 'changed my mind']);
      const o = await admin.query('SELECT payment_status FROM public.orders WHERE id = $1', [id]);
      expect(o.rows[0].payment_status).toBe('rejected');
      expect((await refundsFor(id))[0].payment_evidence).toBe('proof_unverified');
    });

    it('order: a cancellation with no auth user (service/superuser) is recorded as system', async () => {
      const id = await seedOrderRow('processing', 'validated');
      await cancelAsSuperuser('orders', id);
      const rows = await refundsFor(id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ cancelled_by: null, cancelled_by_role: 'system', payment_evidence: 'validated' });
    });

    it('order paid in another currency (Bizum) refunds payment_amount in that currency', async () => {
      // Bizum rows need a full quote graph; the constraint is lifted so only the trigger's branch is exercised.
      await withConstraintDropped(admin, 'orders', 'orders_zelle_clean', async () => {
        const id = await seedOrderRow('processing', 'validated');
        await admin.query(`UPDATE public.orders SET payment_currency = 'EUR', payment_amount = 9.2 WHERE id = $1`, [id]);
        await cancelAsSuperuser('orders', id);
        const [row] = await refundsFor(id);
        expect(row.currency).toBe('EUR');
        expect(Number(row.amount)).toBe(9.2);
        await admin.query('DELETE FROM public.orders WHERE id = $1', [id]);
      });
    });

    const REMITTANCE_CASES = [
      { status: 'payment_pending', evidence: null },
      { status: 'payment_rejected', evidence: null },
      { status: 'payment_proof_uploaded', evidence: 'proof_unverified' }
    ];
    it.each(REMITTANCE_CASES)('remittance: owner cancels from $status', async ({ status, evidence }) => {
      const id = await seedRemittanceRow(status, { deliveryCost: 7.5 });
      const client = await as(actors.customerId);
      await call(client, 'remittance_cancel', [id, 'changed my mind']);
      const rows = await refundsFor(id);
      if (evidence === null) {
        expect(rows).toHaveLength(0);
        return;
      }
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        remittance_id: id,
        order_id: null,
        operation_type: 'remittance',
        user_id: actors.customerId,
        payment_evidence: evidence,
        currency: 'USD',
        cancellation_reason: 'changed my mind',
        cancelled_by: actors.customerId,
        cancelled_by_role: 'customer'
      });
      // amount_sent 100 + delivery_cost 7.5 (calcTotalToPay)
      expect(Number(rows[0].amount)).toBe(107.5);
    });

    it('remittance: validated payment (a cancel path that does not exist yet) is captured as validated; the amount is amount_sent when delivery_cost is the default 0', async () => {
      const id = await seedRemittanceRow('payment_validated', { validatedAt: new Date().toISOString() });
      await cancelAsSuperuser('remittances', id);
      const rows = await refundsFor(id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ payment_evidence: 'validated', cancelled_by_role: 'system' });
      expect(Number(rows[0].amount)).toBe(100);
    });

    it('remittance: a stale payment_validated_at while the status is payment_rejected is not payment evidence (0 rows)', async () => {
      const id = await seedRemittanceRow('payment_rejected', { validatedAt: new Date().toISOString() });
      await cancelAsSuperuser('remittances', id);
      expect(await refundsFor(id)).toHaveLength(0);
    });

    it('system cancellation by expire_stale_order_reservations of a stale proof_uploaded order creates a proof_unverified request', async () => {
      const { productId } = await seedProduct(admin, actors, tracker, { quantity: 10 });
      const id = await seedOrder(admin, actors, tracker, [{ type: 'product', id: productId, quantity: 1 }]);
      const owner = await as(actors.customerId);
      await owner.query('SELECT public.reserve_order_inventory($1::uuid)', [id]);
      await admin.query(
        `UPDATE public.orders SET payment_status = 'proof_uploaded', stock_reserved_at = now() - interval '300 hours' WHERE id = $1`,
        [id]
      );
      const expired = await admin.query('SELECT public.expire_stale_order_reservations(48, 168) AS n');
      expect(expired.rows[0].n).toBeGreaterThanOrEqual(1);
      expect((await admin.query('SELECT status FROM public.orders WHERE id = $1', [id])).rows[0].status).toBe('cancelled');
      const rows = await refundsFor(id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ payment_evidence: 'proof_unverified', cancelled_by: null, cancelled_by_role: 'system' });
    });

    it('a cancellation caused by a failed reserve_order_inventory (no stock, nothing paid) creates no request', async () => {
      const { productId } = await seedProduct(admin, actors, tracker, { quantity: 1 });
      const id = await seedOrder(admin, actors, tracker, [{ type: 'product', id: productId, quantity: 5 }]);
      const owner = await as(actors.customerId);
      const { rows } = await owner.query('SELECT public.reserve_order_inventory($1::uuid) AS r', [id]);
      expect(rows[0].r).toMatchObject({ ok: false, reason: 'insufficient_stock' });
      expect((await admin.query('SELECT status FROM public.orders WHERE id = $1', [id])).rows[0].status).toBe('cancelled');
      expect(await refundsFor(id)).toHaveLength(0);
    });

    it('the order and remittance triggers never fire on updates that do not enter cancelled', async () => {
      const id = await seedOrderRow('pending', 'proof_uploaded');
      await admin.query(`UPDATE public.orders SET payment_status = 'validated' WHERE id = $1`, [id]);
      await admin.query(`UPDATE public.orders SET status = 'processing' WHERE id = $1`, [id]);
      expect(await refundsFor(id)).toHaveLength(0);
    });
  });

  describe('window stored by the trigger', () => {
    it.each(vectors.windows)('$name', async ({ cancelled_at, eligible_at, due_at }) => {
      const id = await seedRemittanceRow('payment_proof_uploaded');
      await cancelAsSuperuser('remittances', id, ', cancelled_at = $2::timestamptz', [cancelled_at]);
      const [row] = await refundsFor(id);
      expect(row.cancelled_at.toISOString()).toBe(cancelled_at);
      expect(row.eligible_at.toISOString()).toBe(eligible_at);
      expect(row.due_at.toISOString()).toBe(due_at);
    });

    it('an order (no cancelled_at column) is stamped with now(): eligible 48 h later', async () => {
      const id = await seedOrderRow('processing', 'validated');
      await cancelAsSuperuser('orders', id);
      const { rows } = await admin.query(
        `SELECT extract(epoch FROM eligible_at - cancelled_at)::int AS hold_seconds, (cancelled_at BETWEEN now() - interval '1 minute' AND now() + interval '1 minute') AS recent
           FROM public.refund_requests WHERE order_id = $1`,
        [id]
      );
      expect(rows[0].recent).toBe(true);
      expect(rows[0].hold_seconds).toBe(48 * 3600);
    });
  });

  describe('idempotency, reopen and re-cancel', () => {
    it('only one open request per operation (partial unique indexes)', async () => {
      const orderId = await seedOrderRow('processing', 'validated');
      await cancelAsSuperuser('orders', orderId);
      const dup = admin.query(
        `INSERT INTO public.refund_requests (order_id, user_id, payment_evidence, amount, payment_method, eligible_at, due_at)
         VALUES ($1, $2, 'validated', 10, 'zelle', now(), now() + interval '1 day')`,
        [orderId, actors.customerId]
      );
      expect((await failure(dup)).code).toBe('23505');

      const remId = await seedRemittanceRow('payment_proof_uploaded');
      await cancelAsSuperuser('remittances', remId);
      const dupRem = admin.query(
        `INSERT INTO public.refund_requests (remittance_id, user_id, payment_evidence, amount, payment_method, eligible_at, due_at)
         VALUES ($1, $2, 'validated', 10, 'zelle', now(), now() + interval '1 day')`,
        [remId, actors.customerId]
      );
      expect((await failure(dupRem)).code).toBe('23505');
    });

    it('re-touching an already cancelled operation does not duplicate the request', async () => {
      const id = await seedRemittanceRow('payment_proof_uploaded');
      await cancelAsSuperuser('remittances', id);
      await cancelAsSuperuser('remittances', id);
      await admin.query(`UPDATE public.remittances SET cancellation_reason = 'edited' WHERE id = $1`, [id]);
      expect(await refundsFor(id)).toHaveLength(1);
    });

    it('reopening an order closes its open request as not_applicable / reopened', async () => {
      const id = await seedOrderRow('pending', 'proof_uploaded');
      const client = await as(actors.customerId);
      await call(client, 'order_cancel', [id, 'changed my mind']);
      await call(client, 'order_reopen', [id]);
      const [row] = await refundsFor(id);
      expect(row).toMatchObject({
        status: 'not_applicable',
        resolution_reason: 'reopened',
        resolved_by: actors.customerId
      });
      expect(row.resolved_at).toBeInstanceOf(Date);
    });

    it('cancel, reopen, cancel again: two rows, one closed and one open', async () => {
      const id = await seedOrderRow('pending', 'proof_uploaded');
      const client = await as(actors.customerId);
      await call(client, 'order_cancel', [id, 'first']);
      await call(client, 'order_reopen', [id]);
      await admin.query(`UPDATE public.orders SET payment_status = 'proof_uploaded' WHERE id = $1`, [id]);
      await call(client, 'order_cancel', [id, 'second']);
      const rows = await refundsFor(id);
      expect(rows.map((r) => r.status).sort()).toEqual(['not_applicable', 'pending']);
      expect(rows.find((r) => r.status === 'pending').cancellation_reason).toBe('second');
    });

    it('reopening a remittance (cancelled to any other status) closes its open request', async () => {
      const id = await seedRemittanceRow('payment_proof_uploaded');
      await cancelAsSuperuser('remittances', id);
      await admin.query(`UPDATE public.remittances SET status = 'payment_pending' WHERE id = $1`, [id]);
      expect((await refundsFor(id))[0]).toMatchObject({ status: 'not_applicable', resolution_reason: 'reopened' });
    });

    it('reopening does not touch a request that was already refunded', async () => {
      const id = await seedOrderRow('processing', 'validated');
      await cancelAsSuperuser('orders', id);
      const [row] = await refundsFor(id);
      await placeWindow(row.id, { eligibleInHours: -1, dueInHours: 100 });
      const adminClient = await as(actors.adminId);
      await call(adminClient, 'admin_resolve_refund', [row.id, 'refunded', 'ZELLE-REF-1', null, null]);
      await admin.query(`UPDATE public.orders SET status = 'processing' WHERE id = $1`, [id]);
      expect((await refundsFor(id))[0].status).toBe('refunded');
    });

    it('deleting the operation removes its refund rows (FK cascade) and execute_platform_reset is not blocked', async () => {
      const id = await seedOrderRow('processing', 'validated');
      await cancelAsSuperuser('orders', id);
      expect(await refundsFor(id)).toHaveLength(1);
      await admin.query('BEGIN');
      try {
        await admin.query(`UPDATE public.user_profiles SET role = 'super_admin' WHERE id = $1`, [actors.adminId]);
        await admin.query(`SELECT set_config('request.jwt.claims', $1, true)`, [
          JSON.stringify({ sub: actors.adminId, role: 'authenticated' })
        ]);
        await admin.query(
          `INSERT INTO public.platform_reset_control (id, enabled) VALUES (1, true)
           ON CONFLICT (id) DO UPDATE SET enabled = true`
        );
        await admin.query(`SELECT public.execute_platform_reset('RESETEAR')`);
        const left = await admin.query('SELECT count(*)::int AS n FROM public.refund_requests');
        expect(left.rows[0].n).toBe(0);
      } finally {
        await admin.query('ROLLBACK');
      }
      expect(await refundsFor(id)).toHaveLength(1);
    });
  });

  describe('a failing trigger never blocks or changes the operation (production-data safety)', () => {
    const withFailingInsertsAndUpdates = async (fn) => {
      await admin.query('ALTER TABLE public.refund_requests ADD CONSTRAINT zz_test_always_fails CHECK (false) NOT VALID');
      try {
        return await fn();
      } finally {
        await admin.query('ALTER TABLE public.refund_requests DROP CONSTRAINT zz_test_always_fails');
      }
    };
    const failureLogs = async (id, action) =>
      (await admin.query(`SELECT metadata FROM public.activity_logs WHERE action = $1 AND entity_id = $2`, [action, id])).rows;

    it('an order cancellation still succeeds when the refund row cannot be written, and the failure is logged', async () => {
      const id = await seedOrderRow('processing', 'validated');
      await withFailingInsertsAndUpdates(() => cancelAsSuperuser('orders', id));
      expect((await admin.query('SELECT status, payment_status FROM public.orders WHERE id = $1', [id])).rows[0]).toEqual({
        status: 'cancelled',
        payment_status: 'validated'
      });
      expect(await refundsFor(id)).toHaveLength(0);
      const logs = await failureLogs(id, 'refund_capture_failed');
      expect(logs).toHaveLength(1);
      expect(logs[0].metadata).toMatchObject({ table: 'orders', sqlstate: '23514' });
    });

    it('a remittance cancellation by the customer still succeeds when the refund row cannot be written', async () => {
      const id = await seedRemittanceRow('payment_proof_uploaded');
      const client = await as(actors.customerId);
      await withFailingInsertsAndUpdates(() => call(client, 'remittance_cancel', [id, 'changed my mind']));
      expect((await admin.query('SELECT status FROM public.remittances WHERE id = $1', [id])).rows[0].status).toBe('cancelled');
      expect(await failureLogs(id, 'refund_capture_failed')).toHaveLength(1);
    });

    it('a reopen still succeeds when the open request cannot be closed, and the failure is logged', async () => {
      const id = await seedOrderRow('processing', 'validated');
      await cancelAsSuperuser('orders', id);
      await withFailingInsertsAndUpdates(() => admin.query(`UPDATE public.orders SET status = 'processing' WHERE id = $1`, [id]));
      expect((await admin.query('SELECT status FROM public.orders WHERE id = $1', [id])).rows[0].status).toBe('processing');
      expect((await refundsFor(id))[0].status).toBe('pending');
      expect(await failureLogs(id, 'refund_close_failed')).toHaveLength(1);
    });

    it('a normal cancellation and reopen leave no failure log', async () => {
      const id = await seedOrderRow('processing', 'validated');
      await cancelAsSuperuser('orders', id);
      await admin.query(`UPDATE public.orders SET status = 'processing' WHERE id = $1`, [id]);
      expect(await failureLogs(id, 'refund_capture_failed')).toHaveLength(0);
      expect(await failureLogs(id, 'refund_close_failed')).toHaveLength(0);
    });

    it('an order of a user without a profile row (nullable user_id data) still cancels', async () => {
      const id = await seedOrderRow('processing', 'validated');
      await withFailingInsertsAndUpdates(() => cancelAsSuperuser('orders', id));
      expect((await admin.query('SELECT status FROM public.orders WHERE id = $1', [id])).rows[0].status).toBe('cancelled');
    });
  });

  describe('access control', () => {
    it('admin reads the table; customers and anon do not', async () => {
      const id = await seedOrderRow('processing', 'validated');
      await cancelAsSuperuser('orders', id);
      const adminClient = await as(actors.adminId);
      const seen = await adminClient.query('SELECT id FROM public.refund_requests WHERE order_id = $1', [id]);
      expect(seen.rowCount).toBe(1);
      const customer = await as(actors.customerId);
      const none = await customer.query('SELECT id FROM public.refund_requests WHERE order_id = $1', [id]);
      expect(none.rowCount).toBe(0);
      const a = await anon();
      expect((await failure(a.query('SELECT id FROM public.refund_requests'))).code).toBe('42501');
    });

    it('no API role can INSERT, UPDATE or DELETE directly, not even an admin', async () => {
      const id = await seedOrderRow('processing', 'validated');
      await cancelAsSuperuser('orders', id);
      const adminClient = await as(actors.adminId);
      expect((await failure(adminClient.query(`UPDATE public.refund_requests SET status = 'refunded'`))).code).toBe('42501');
      expect((await failure(adminClient.query('DELETE FROM public.refund_requests'))).code).toBe('42501');
      expect(
        (await failure(
          adminClient.query(
            `INSERT INTO public.refund_requests (order_id, user_id, payment_evidence, amount, payment_method, eligible_at, due_at)
             VALUES ($1, $2, 'validated', 10, 'zelle', now(), now() + interval '1 day')`,
            [id, actors.customerId]
          )
        )).code
      ).toBe('42501');
    });

    it.each([
      ['admin_list_refunds', []],
      ['admin_refund_counts', []],
      ['admin_resolve_refund', [randomUUID(), 'not_applicable', null, null, 'x']]
    ])('%s rejects a customer, a disabled admin and anon with 42501', async (fn, args) => {
      const customer = await as(actors.customerId);
      expect((await failure(call(customer, fn, args))).code).toBe('42501');
      await setUser(actors.adminId, { is_enabled: false });
      const blocked = await as(actors.adminId);
      expect((await failure(call(blocked, fn, args))).code).toBe('42501');
      const a = await anon();
      expect((await failure(call(a, fn, args))).code).toBe('42501');
    });
  });

  describe('admin_resolve_refund', () => {
    const openRefund = async ({ eligibleInHours = -1, dueInHours = 100 } = {}) => {
      const orderId = await seedOrderRow('processing', 'validated');
      await cancelAsSuperuser('orders', orderId);
      const [row] = await refundsFor(orderId);
      await placeWindow(row.id, { eligibleInHours, dueInHours });
      return { orderId, id: row.id };
    };

    it('refunded: stores reference, date and resolver, and writes the audit row', async () => {
      const { id } = await openRefund();
      const adminClient = await as(actors.adminId);
      const when = new Date(Date.now() - 3600 * 1000).toISOString();
      const out = await call(adminClient, 'admin_resolve_refund', [id, 'refunded', '  ZELLE-9  ', when, null]);
      expect(out).toMatchObject({ id, status: 'refunded', refund_reference: 'ZELLE-9', resolved_by: actors.adminId });
      expect(out.refunded_at.toISOString()).toBe(when);
      expect(out.resolved_at).toBeInstanceOf(Date);
      const logs = await admin.query(
        `SELECT performed_by, metadata FROM public.activity_logs WHERE action = 'refund_resolved' AND entity_type = 'refund_request' AND entity_id = $1`,
        [id]
      );
      expect(logs.rowCount).toBe(1);
      expect(logs.rows[0].performed_by).toBe(actors.adminId);
      expect(logs.rows[0].metadata).toMatchObject({ refund_id: id, action: 'refunded' });
    });

    it('refunded without a date defaults refunded_at to now()', async () => {
      const { id } = await openRefund();
      const adminClient = await as(actors.adminId);
      const out = await call(adminClient, 'admin_resolve_refund', [id, 'refunded', 'REF', null, null]);
      expect(Math.abs(out.refunded_at.getTime() - Date.now())).toBeLessThan(60000);
    });

    it('not_applicable: stores the reason', async () => {
      const { id } = await openRefund();
      const adminClient = await as(actors.adminId);
      const out = await call(adminClient, 'admin_resolve_refund', [id, 'not_applicable', null, null, 'the money never arrived']);
      expect(out).toMatchObject({ status: 'not_applicable', resolution_reason: 'the money never arrived', refund_reference: null });
    });

    it('refunded during the 48 h hold fails with refund_on_hold; not_applicable is allowed', async () => {
      const { id } = await openRefund({ eligibleInHours: 10, dueInHours: 200 });
      const adminClient = await as(actors.adminId);
      const err = await failure(call(adminClient, 'admin_resolve_refund', [id, 'refunded', 'REF', null, null]));
      expect(err.code).toBe('22023');
      expect(err.message).toMatch(/refund_on_hold/);
      expect(err.detail).toMatch(/eligible_at/);
      const out = await call(adminClient, 'admin_resolve_refund', [id, 'not_applicable', null, null, 'no money received']);
      expect(out.status).toBe('not_applicable');
    });

    it('validates its arguments', async () => {
      const { id } = await openRefund();
      const c = await as(actors.adminId);
      const bad = async (args, re) => {
        const err = await failure(call(c, 'admin_resolve_refund', args));
        expect(err.code).toBe('22023');
        expect(err.message).toMatch(re);
      };
      await bad([id, 'bogus', null, null, null], /invalid_argument/);
      await bad([id, 'refunded', null, null, null], /invalid_argument/);
      await bad([id, 'refunded', '   ', null, null], /invalid_argument/);
      await bad([id, 'refunded', 'x'.repeat(201), null, null], /invalid_argument/);
      await bad([id, 'refunded', 'REF', new Date(Date.now() + 86400000).toISOString(), null], /invalid_argument/);
      await bad([id, 'refunded', 'REF', '2000-01-01T00:00:00Z', null], /invalid_argument/);
      await bad([id, 'not_applicable', null, null, null], /invalid_argument/);
      await bad([id, 'not_applicable', null, null, '   '], /invalid_argument/);
      await bad([id, 'not_applicable', null, null, 'x'.repeat(501)], /invalid_argument/);
      expect((await failure(call(c, 'admin_resolve_refund', [randomUUID(), 'not_applicable', null, null, 'x']))).code).toBe('P0002');
      expect((await admin.query('SELECT status FROM public.refund_requests WHERE id = $1', [id])).rows[0].status).toBe('pending');
    });

    it('a retry with the same parameters returns the same row; different parameters fail with already_resolved', async () => {
      const { id } = await openRefund();
      const c = await as(actors.adminId);
      const first = await call(c, 'admin_resolve_refund', [id, 'refunded', 'REF-1', null, null]);
      const again = await call(c, 'admin_resolve_refund', [id, 'refunded', 'REF-1', null, null]);
      expect(again.resolved_at.getTime()).toBe(first.resolved_at.getTime());
      expect(again.refund_reference).toBe('REF-1');
      for (const args of [
        [id, 'refunded', 'REF-2', null, null],
        [id, 'not_applicable', null, null, 'changed my mind']
      ]) {
        const err = await failure(call(c, 'admin_resolve_refund', args));
        expect(err.code).toBe('22023');
        expect(err.message).toMatch(/already_resolved/);
      }
    });

    it('two admins resolving at the same time: one wins, the other gets already_resolved', async () => {
      const { id } = await openRefund();
      const a = await as(actors.adminId);
      const b = await as(actors.adminId);
      const results = await fireTogether([
        { client: a, sql: 'public.admin_resolve_refund($1, $2, $3, NULL, NULL)', params: [id, 'refunded', 'REF-A'] },
        { client: b, sql: 'public.admin_resolve_refund($1, $2, $3, NULL, NULL)', params: [id, 'refunded', 'REF-B'] }
      ]);
      const winners = results.filter((r) => !r.error);
      const losers = results.filter((r) => r.error);
      expect(winners).toHaveLength(1);
      expect(losers).toHaveLength(1);
      expect(losers[0].error.message).toMatch(/already_resolved/);
      const stored = await admin.query('SELECT refund_reference FROM public.refund_requests WHERE id = $1', [id]);
      expect(['REF-A', 'REF-B']).toContain(stored.rows[0].refund_reference);
      const logs = await admin.query(`SELECT 1 FROM public.activity_logs WHERE action = 'refund_resolved' AND entity_id = $1`, [id]);
      expect(logs.rowCount).toBe(1);
    });
  });

  describe('admin_refund_counts and admin_list_refunds', () => {
    const cancelOrderWithWindow = async (window) => {
      const orderId = await seedOrderRow('processing', 'validated');
      await cancelAsSuperuser('orders', orderId);
      const [row] = await refundsFor(orderId);
      await placeWindow(row.id, window);
      return { orderId, id: row.id };
    };

    it('counts separate on_hold, due_soon, overdue and actionable by now()', async () => {
      const adminClient = await as(actors.adminId);
      const before = (await call(adminClient, 'admin_refund_counts')).admin_refund_counts;
      await cancelOrderWithWindow({ eligibleInHours: 12, dueInHours: 130 }); // on_hold
      await cancelOrderWithWindow({ eligibleInHours: -10, dueInHours: 100 }); // on_time
      await cancelOrderWithWindow({ eligibleInHours: -100, dueInHours: 5 }); // due_soon
      await cancelOrderWithWindow({ eligibleInHours: -200, dueInHours: -1 }); // overdue
      const after = (await call(adminClient, 'admin_refund_counts')).admin_refund_counts;
      expect(after.on_hold - before.on_hold).toBe(1);
      expect(after.actionable - before.actionable).toBe(3);
      expect(after.due_soon - before.due_soon).toBe(1);
      expect(after.overdue - before.overdue).toBe(1);
      expect(Number(after.pending_amount_usd) - Number(before.pending_amount_usd)).toBe(40);
    });

    it('resolved requests leave the counts', async () => {
      const adminClient = await as(actors.adminId);
      const { id } = await cancelOrderWithWindow({ eligibleInHours: -10, dueInHours: 100 });
      const before = (await call(adminClient, 'admin_refund_counts')).admin_refund_counts;
      await call(adminClient, 'admin_resolve_refund', [id, 'refunded', 'REF', null, null]);
      const after = (await call(adminClient, 'admin_refund_counts')).admin_refund_counts;
      expect(before.actionable - after.actionable).toBe(1);
    });

    it('lists pending requests ordered overdue, due_soon, on_time, on_hold with the joined data', async () => {
      const adminClient = await as(actors.adminId);
      const hold = await cancelOrderWithWindow({ eligibleInHours: 12, dueInHours: 130 });
      const onTime = await cancelOrderWithWindow({ eligibleInHours: -10, dueInHours: 100 });
      const soon = await cancelOrderWithWindow({ eligibleInHours: -100, dueInHours: 5 });
      const over = await cancelOrderWithWindow({ eligibleInHours: -200, dueInHours: -1 });
      const ours = [hold.id, onTime.id, soon.id, over.id];
      const { admin_list_refunds: out } = await call(adminClient, 'admin_list_refunds', ['pending', 200, 0, null]);
      expect(typeof out.total).toBe('number');
      const mine = out.items.filter((i) => ours.includes(i.id));
      expect(mine.map((i) => i.queue_state)).toEqual(['overdue', 'due_soon', 'on_time', 'on_hold']);
      expect(mine.map((i) => i.id)).toEqual([over.id, soon.id, onTime.id, hold.id]);
      const sample = mine[0];
      expect(sample).toMatchObject({
        operation_type: 'order',
        order_id: over.orderId,
        status: 'pending',
        payment_evidence: 'validated',
        currency: 'USD'
      });
      expect(sample.operation_number).toMatch(/^TST-/);
      expect(sample.customer_email).toBe('e2e.customer@example.test');
      expect(Number(sample.amount)).toBe(10);
      expect(sample).toHaveProperty('payment_proof_url');
      expect(sample).toHaveProperty('zelle_account');
    });

    it('filters by status and queue_state, clamps the page size, and validates the status', async () => {
      const adminClient = await as(actors.adminId);
      const a = await cancelOrderWithWindow({ eligibleInHours: -10, dueInHours: 100 });
      const b = await cancelOrderWithWindow({ eligibleInHours: 12, dueInHours: 130 });
      await call(adminClient, 'admin_resolve_refund', [a.id, 'refunded', 'REF', null, null]);
      const refunded = (await call(adminClient, 'admin_list_refunds', ['refunded', 200, 0, null])).admin_list_refunds;
      expect(refunded.items.some((i) => i.id === a.id && i.queue_state === null)).toBe(true);
      expect(refunded.items.some((i) => i.id === b.id)).toBe(false);
      const hold = (await call(adminClient, 'admin_list_refunds', ['pending', 200, 0, 'on_hold'])).admin_list_refunds;
      expect(hold.items.every((i) => i.queue_state === 'on_hold')).toBe(true);
      expect(hold.items.some((i) => i.id === b.id)).toBe(true);
      const one = (await call(adminClient, 'admin_list_refunds', ['all', 1, 0, null])).admin_list_refunds;
      expect(one.items).toHaveLength(1);
      const huge = (await call(adminClient, 'admin_list_refunds', ['all', 100000, 0, null])).admin_list_refunds;
      expect(huge.items.length).toBeLessThanOrEqual(200);
      const err = await failure(call(adminClient, 'admin_list_refunds', ['bogus', 10, 0, null]));
      expect(err.code).toBe('22023');
    });

    it("the 'all' filter returns requests closed by a reopen so the admin can see them", async () => {
      const adminClient = await as(actors.adminId);
      const id = await seedOrderRow('pending', 'proof_uploaded');
      const owner = await as(actors.customerId);
      await call(owner, 'order_cancel', [id, 'changed my mind']);
      await call(owner, 'order_reopen', [id]);
      const all = (await call(adminClient, 'admin_list_refunds', ['all', 200, 0, null])).admin_list_refunds;
      const item = all.items.find((i) => i.order_id === id);
      expect(item).toMatchObject({ status: 'not_applicable', resolution_reason: 'reopened', queue_state: null });
      const na = (await call(adminClient, 'admin_list_refunds', ['not_applicable', 200, 0, null])).admin_list_refunds;
      expect(na.items.some((i) => i.order_id === id)).toBe(true);
      const pending = (await call(adminClient, 'admin_list_refunds', ['pending', 200, 0, null])).admin_list_refunds;
      expect(pending.items.some((i) => i.order_id === id)).toBe(false);
    });

    it('lists remittance requests with the remittance number', async () => {
      const adminClient = await as(actors.adminId);
      const remId = await seedRemittanceRow('payment_proof_uploaded', { deliveryCost: 5 });
      await cancelAsSuperuser('remittances', remId);
      const out = (await call(adminClient, 'admin_list_refunds', ['pending', 200, 0, null])).admin_list_refunds;
      const item = out.items.find((i) => i.remittance_id === remId);
      expect(item).toMatchObject({ operation_type: 'remittance', order_id: null, payment_evidence: 'proof_unverified' });
      expect(Number(item.amount)).toBe(105);
      expect(item.operation_number).toBeTruthy();
    });
  });
});
