/**
 * Refund audit trail, proof and retention (database layer).
 * Migrations under test:
 *   20261029110000_refund_request_events.sql          append-only events + fail-open audit trigger + terminal-row guard
 *   20261029110100_operation_timeline_trace.sql       admin_operation_timeline / admin_get_operation_refunds / admin_refund_trace
 *   20261029110200_refund_metrics_export.sql          admin_refund_metrics / admin_refund_export
 *   20261029110300_refund_proofs_bucket.sql           private bucket refund-proofs + storage policies + refund_proof_required()
 *   20261029110400_refund_resolve_with_proof.sql      admin_resolve_refund_v2 (proof required, self-resolution blocked)
 *   20261029110500_refund_proof_retention.sql         purge RPCs (service_role), disputes, "expiring soon" report
 *
 * The suite does not list the new objects in `needs`: a missing migration fails loudly (red phase).
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { dbSuiteSkipReason, connectAdmin, connectAs, connectAnon, endAll } from './db';
import { loadActors, createTracker, seedOrder, cleanup } from './fixtures';

const skipReason = await dbSuiteSkipReason({
  functions: ['is_admin_user', 'current_user_is_blocked', 'order_cancel', 'order_reopen', 'remittance_cancel', 'admin_resolve_refund'],
  tables: ['orders', 'remittances', 'activity_logs', 'user_profiles', 'refund_requests']
});
const describeDb = skipReason ? describe.skip : describe;

const SHA = 'a'.repeat(64);

const failure = async (promise) => {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected the statement to fail, but it succeeded');
};

describeDb('refund audit trail, proof and retention', () => {
  let admin;
  let actors;
  let typeId;
  const clients = [];
  const tracker = createTracker();
  const remittances = [];
  const objects = [];

  const as = async (userId) => {
    const c = await connectAs(userId);
    clients.push(c);
    return c;
  };
  const call = async (client, fn, args = []) => {
    const placeholders = args.map((_, i) => `$${i + 1}`).join(', ');
    const { rows } = await client.query(`SELECT * FROM public.${fn}(${placeholders})`, args);
    return rows[0];
  };
  const json = async (client, fn, args = []) => {
    const placeholders = args.map((_, i) => `$${i + 1}`).join(', ');
    const { rows } = await client.query(`SELECT public.${fn}(${placeholders}) AS r`, args);
    return rows[0].r;
  };
  const setRole = (id, role) => admin.query('UPDATE public.user_profiles SET role = $2 WHERE id = $1', [id, role]);
  const refundsFor = async (id) =>
    (await admin.query(
      `SELECT * FROM public.refund_requests WHERE order_id = $1 OR remittance_id = $1 ORDER BY created_at, id`,
      [id]
    )).rows;
  const refundById = async (id) => (await admin.query('SELECT * FROM public.refund_requests WHERE id = $1', [id])).rows[0];
  const eventsFor = async (refundId) =>
    (await admin.query('SELECT * FROM public.refund_request_events WHERE refund_id = $1 ORDER BY id', [refundId])).rows;
  const types = async (refundId) => (await eventsFor(refundId)).map((e) => e.event_type);

  const paidOrder = async ({ ownerId = actors.customerId, cancelAs = ownerId } = {}) => {
    const id = await seedOrder(admin, actors, tracker, [], {
      userId: ownerId,
      status: 'pending',
      paymentStatus: 'proof_uploaded',
      stockManaged: false
    });
    const c = await as(cancelAs);
    await call(c, 'order_cancel', [id, 'changed my mind']);
    const [refund] = await refundsFor(id);
    return { orderId: id, refund };
  };
  const paidRemittance = async () => {
    const id = randomUUID();
    await admin.query(
      `INSERT INTO public.remittances (id, user_id, remittance_type_id, amount_sent, exchange_rate,
         commission_percentage, commission_fixed, commission_total, amount_to_deliver, currency_sent,
         currency_delivered, recipient_name, recipient_phone, status)
       VALUES ($1,$2,$3,100,800,2.5,0,2.5,78000,'USD','CUP','Rcpt','+5355550100','payment_proof_uploaded')`,
      [id, actors.customerId, typeId]
    );
    remittances.push(id);
    const c = await as(actors.customerId);
    await call(c, 'remittance_cancel', [id, 'changed my mind']);
    const [refund] = await refundsFor(id);
    return { remittanceId: id, refund };
  };
  /** Lifts the 48 h hold so a refund can be resolved (pending rows may be moved; terminal rows may not). */
  const openHold = (refundId) =>
    admin.query(
      `UPDATE public.refund_requests SET cancelled_at = now() - interval '60 hours', eligible_at = now() - interval '12 hours',
              due_at = now() + interval '100 hours' WHERE id = $1`,
      [refundId]
    );
  const addObject = async (refundId, ext = 'png') => {
    const name = `refunds/${refundId}/${randomUUID()}.${ext}`;
    await admin.query(`INSERT INTO storage.objects (bucket_id, name) VALUES ('refund-proofs', $1)`, [name]);
    objects.push(name);
    return name;
  };
  const resolveV2 = (client, refundId, action, o = {}) =>
    json(client, 'admin_resolve_refund_v2', [
      refundId,
      action,
      o.reference ?? (action === 'refunded' ? 'ZEL-12345' : null),
      o.refundedAt ?? null,
      o.reason ?? (action === 'not_applicable' ? 'duplicate request' : null),
      o.proofPath ?? null,
      o.sha ?? null,
      o.selfConfirm ?? false
    ]);
  /** Fixture helper: runs fn with the terminal-row guard off (simulates elapsed time). Superuser only, scratch DB only. */
  const withGuardOff = async (fn) => {
    await admin.query('ALTER TABLE public.refund_requests DISABLE TRIGGER trg_refund_requests_guard');
    try {
      return await fn();
    } finally {
      await admin.query('ALTER TABLE public.refund_requests ENABLE TRIGGER trg_refund_requests_guard');
    }
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
  });
  afterEach(async () => {
    await endAll(clients.splice(0));
    await setRole(actors.adminId, 'admin');
    await setRole(actors.customerId, 'user');
    await admin
      .query(`ALTER TABLE public.refund_request_events DROP CONSTRAINT IF EXISTS zz_force_failure`)
      .catch(() => {});
    await admin.query('ALTER TABLE public.refund_requests ENABLE TRIGGER trg_refund_requests_guard').catch(() => {});
    const ops = [...tracker.orders, ...remittances];
    if (ops.length) {
      await admin.query(
        `DELETE FROM public.activity_logs WHERE entity_id = ANY($1) AND action IN ('refund_event_failed', 'refund_capture_failed', 'refund_close_failed')`,
        [ops]
      );
      await admin.query(
        `DELETE FROM public.activity_logs WHERE entity_type = 'refund_request' AND entity_id IN
           (SELECT id FROM public.refund_requests WHERE order_id = ANY($1) OR remittance_id = ANY($1))`,
        [ops]
      );
    }
    if (objects.length) {
      await admin.query(`DELETE FROM storage.objects WHERE bucket_id = 'refund-proofs' AND name = ANY($1)`, [objects.splice(0)]);
    }
    if (remittances.length) {
      await admin.query('DELETE FROM public.remittance_status_history WHERE remittance_id = ANY($1)', [remittances]);
      await admin.query('DELETE FROM public.remittances WHERE id = ANY($1)', [remittances.splice(0)]);
    }
    await cleanup(admin, tracker);
  });
  afterAll(async () => {
    await admin.query('DELETE FROM public.remittance_types WHERE id = $1', [typeId]);
    await admin.end();
  });

  describe('events table: append-only, admin-readable, no PII columns', () => {
    it('RLS on, admin-only SELECT, no write grant, no FK (so the platform reset keeps working)', async () => {
      const rls = await admin.query(`SELECT relrowsecurity FROM pg_class WHERE oid = 'public.refund_request_events'::regclass`);
      expect(rls.rows[0].relrowsecurity).toBe(true);
      const pol = await admin.query(
        `SELECT cmd FROM pg_policies WHERE schemaname = 'public' AND tablename = 'refund_request_events'`
      );
      expect(pol.rows).toEqual([{ cmd: 'SELECT' }]);
      const grants = await admin.query(
        `SELECT grantee, privilege_type FROM information_schema.role_table_grants
          WHERE table_schema = 'public' AND table_name = 'refund_request_events' AND grantee IN ('anon', 'authenticated', 'PUBLIC')
          ORDER BY 1, 2`
      );
      expect(grants.rows).toEqual([{ grantee: 'authenticated', privilege_type: 'SELECT' }]);
      const fks = await admin.query(`SELECT 1 FROM pg_constraint WHERE conrelid = 'public.refund_request_events'::regclass AND contype = 'f'`);
      expect(fks.rowCount).toBe(0);
    });

    it('has no PII column (names, email, phone, reference, free text, URLs)', async () => {
      const { rows } = await admin.query(
        `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'refund_request_events'`
      );
      const cols = rows.map((r) => r.column_name);
      for (const forbidden of ['payer_phone', 'payment_reference', 'refund_reference', 'resolution_reason', 'customer_name', 'email', 'phone', 'proof_path', 'notes', 'url']) {
        expect(cols, forbidden).not.toContain(forbidden);
      }
    });

    it('UPDATE, DELETE and TRUNCATE fail even for the table owner', async () => {
      const { refund } = await paidOrder();
      expect((await failure(admin.query(`UPDATE public.refund_request_events SET amount = 1 WHERE refund_id = $1`, [refund.id]))).code).toBe('42501');
      expect((await failure(admin.query(`DELETE FROM public.refund_request_events WHERE refund_id = $1`, [refund.id]))).code).toBe('42501');
      expect((await failure(admin.query('TRUNCATE public.refund_request_events'))).code).toBe('42501');
    });

    it('no API role can INSERT; a customer cannot read events', async () => {
      const { refund } = await paidOrder();
      const customer = await as(actors.customerId);
      expect((await failure(customer.query(`INSERT INTO public.refund_request_events (refund_id, event_type) VALUES ($1, 'created')`, [refund.id]))).code).toBe('42501');
      const { rows } = await customer.query('SELECT * FROM public.refund_request_events');
      expect(rows).toHaveLength(0);
      const adminClient = await as(actors.adminId);
      const seen = await adminClient.query('SELECT * FROM public.refund_request_events WHERE refund_id = $1', [refund.id]);
      expect(seen.rowCount).toBe(1);
    });
  });

  describe('events are written by the audit trigger with actor and timestamp', () => {
    it('cancel: one "created" event with actor, role, owner_is_actor and the transaction timestamp', async () => {
      const { orderId, refund } = await paidOrder();
      const events = await eventsFor(refund.id);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        refund_id: refund.id,
        event_type: 'created',
        operation_type: 'order',
        order_id: orderId,
        remittance_id: null,
        to_status: 'pending',
        actor_id: actors.customerId,
        actor_role: 'customer',
        owner_is_actor: true,
        currency: 'USD'
      });
      expect(Number(events[0].amount)).toBe(Number(refund.amount));
      expect(events[0].occurred_at.toISOString()).toBe(refund.created_at.toISOString());
      expect(events[0].txid).not.toBeNull();
    });

    it('cancel by an admin who is not the owner records admin role and owner_is_actor=false', async () => {
      const { refund } = await paidOrder({ cancelAs: actors.adminId });
      const [event] = await eventsFor(refund.id);
      expect(event).toMatchObject({ actor_id: actors.adminId, actor_role: 'admin', owner_is_actor: false });
    });

    it('cancel by service (no auth.uid) is recorded as system', async () => {
      const id = await seedOrder(admin, actors, tracker, [], { status: 'pending', paymentStatus: 'proof_uploaded', stockManaged: false });
      await admin.query(`UPDATE public.orders SET status = 'cancelled' WHERE id = $1`, [id]);
      const [refund] = await refundsFor(id);
      const [event] = await eventsFor(refund.id);
      expect(event).toMatchObject({ actor_id: null, actor_role: 'system', owner_is_actor: false });
    });

    it('refunded: closed_refunded + proof_attached, no reference value stored, flags only', async () => {
      const { refund } = await paidOrder();
      await openHold(refund.id);
      const proof = await addObject(refund.id);
      const adminClient = await as(actors.adminId);
      const result = await resolveV2(adminClient, refund.id, 'refunded', { proofPath: proof, sha: SHA });
      expect(result.ok).toBe(true);
      const events = await eventsFor(refund.id);
      expect(events.map((e) => e.event_type)).toEqual(['created', 'closed_refunded', 'proof_attached']);
      expect(events[1]).toMatchObject({
        actor_id: actors.adminId,
        actor_role: 'admin',
        owner_is_actor: false,
        from_status: 'pending',
        to_status: 'refunded',
        has_reference: true,
        has_proof: true
      });
      expect(events[2].proof_object_id).toMatch(/^[0-9a-f-]{36}$/);
      const row = (await refundById(refund.id));
      expect(events[1].occurred_at.toISOString()).toBe(row.resolved_at.toISOString());
      expect(JSON.stringify(events)).not.toContain('ZEL-12345');
      expect(JSON.stringify(events)).not.toContain('refunds/');
    });

    it('not applicable (v1) and reopen are recorded; history is never rewritten (re-cancel = new rows)', async () => {
      const { orderId, refund } = await paidOrder();
      const adminClient = await as(actors.adminId);
      await call(adminClient, 'admin_resolve_refund', [refund.id, 'not_applicable', null, null, 'duplicate request']);
      expect(await types(refund.id)).toEqual(['created', 'closed_not_applicable']);

      const second = await paidOrder();
      const customer = await as(actors.customerId);
      await call(customer, 'order_reopen', [second.orderId]);
      expect(await types(second.refund.id)).toEqual(['created', 'closed_by_reopen']);
      const reopened = (await eventsFor(second.refund.id))[1];
      expect(reopened).toMatchObject({ reason_code: 'reopened', to_status: 'not_applicable' });

      const before = await eventsFor(second.refund.id);
      await admin.query(`UPDATE public.orders SET payment_status = 'proof_uploaded' WHERE id = $1`, [second.orderId]);
      await call(await as(actors.customerId), 'order_cancel', [second.orderId, 'again']);
      const rows = await refundsFor(second.orderId);
      expect(rows).toHaveLength(2);
      const after = await eventsFor(second.refund.id);
      expect(after).toEqual(before);
      expect(await types(rows[1].id)).toEqual(['created']);
      expect(orderId).toBeTruthy();
    });
  });

  describe('fail-open: an audit failure never blocks a legitimate cancellation', () => {
    it('forced failure of the events insert: cancel works, refund exists, gap is visible in the trace', async () => {
      await admin.query('ALTER TABLE public.refund_request_events ADD CONSTRAINT zz_force_failure CHECK (false) NOT VALID');
      const { orderId, refund } = await paidOrder();
      expect(refund.status).toBe('pending');
      expect(await eventsFor(refund.id)).toHaveLength(0);
      const logs = await admin.query(
        `SELECT metadata FROM public.activity_logs WHERE action = 'refund_event_failed' AND entity_id = $1`,
        [refund.id]
      );
      expect(logs.rowCount).toBe(1);
      expect(JSON.stringify(logs.rows[0].metadata)).not.toMatch(/@|\+\d{6,}/);
      await admin.query('ALTER TABLE public.refund_request_events DROP CONSTRAINT zz_force_failure');
      const trace = await json(await as(actors.adminId), 'admin_refund_trace', ['order', orderId]);
      expect(trace.gaps.map((g) => g.code)).toContain('no_created_event');
    });
  });

  describe('terminal rows and write-once proof columns', () => {
    it('a resolved row cannot be edited; proof columns are write-once', async () => {
      const { refund } = await paidOrder();
      await openHold(refund.id);
      const proof = await addObject(refund.id);
      await resolveV2(await as(actors.adminId), refund.id, 'refunded', { proofPath: proof, sha: SHA });
      for (const set of ['amount = 1', `refund_reference = 'X'`, `status = 'pending'`, `proof_path = 'refunds/other'`, `resolved_by = NULL`]) {
        const err = await failure(admin.query(`UPDATE public.refund_requests SET ${set} WHERE id = $1`, [refund.id]));
        expect(err.code, set).toBe('42501');
      }
    });
  });

  describe('timeline, refunds of an operation and trace (read only)', () => {
    it('unifies status history, refund events and derived markers in ascending order; admin only', async () => {
      const { remittanceId, refund } = await paidRemittance();
      const adminClient = await as(actors.adminId);
      const items = await json(adminClient, 'admin_operation_timeline', ['remittance', remittanceId]);
      const sources = new Set(items.map((i) => i.source));
      expect([...sources].sort()).toEqual(['refund_event', 'refund_marker', 'status_history']);
      const stamps = items.map((i) => new Date(i.ts).getTime());
      expect(stamps).toEqual([...stamps].sort((a, b) => a - b));
      expect(items.filter((i) => i.source === 'refund_marker').map((i) => i.kind).sort()).toEqual(['refund_due', 'refund_eligible']);
      expect(items.find((i) => i.source === 'refund_event').ref_id).toBe(refund.id);

      const customer = await as(actors.customerId);
      expect((await failure(customer.query(`SELECT public.admin_operation_timeline('remittance', $1)`, [remittanceId]))).code).toBe('42501');
      const anon = await connectAnon();
      clients.push(anon);
      expect((await failure(anon.query(`SELECT public.admin_operation_timeline('remittance', $1)`, [remittanceId]))).code).toBe('42501');
    });

    it('never exposes payment reference, phone or proof paths', async () => {
      const { orderId, refund } = await paidOrder();
      await admin.query(`UPDATE public.orders SET payer_phone = '+13055550123', payment_reference = 'SECRET-REF-9' WHERE id = $1`, [orderId]);
      await openHold(refund.id);
      const proof = await addObject(refund.id);
      const adminClient = await as(actors.adminId);
      await resolveV2(adminClient, refund.id, 'refunded', { proofPath: proof, reference: 'TOPSECRET-77' });
      const text = JSON.stringify([
        await json(adminClient, 'admin_operation_timeline', ['order', orderId]),
        await json(adminClient, 'admin_refund_trace', ['order', orderId])
      ]);
      for (const needle of ['TOPSECRET-77', 'SECRET-REF-9', '+13055550123', proof, 'refunds/']) {
        expect(text, needle).not.toContain(needle);
      }
    });

    it('admin_get_operation_refunds lists every episode (cancel, reopen, cancel again)', async () => {
      const { orderId } = await paidOrder();
      const customer = await as(actors.customerId);
      await call(customer, 'order_reopen', [orderId]);
      await admin.query(`UPDATE public.orders SET payment_status = 'proof_uploaded' WHERE id = $1`, [orderId]);
      await call(customer, 'order_cancel', [orderId, 'again']);
      const list = await json(await as(actors.adminId), 'admin_get_operation_refunds', ['order', orderId]);
      expect(list).toHaveLength(2);
      expect(list.map((r) => r.status).sort()).toEqual(['not_applicable', 'pending']);
    });

    it('trace gaps: refunded_without_proof (legacy v1 path), paid_cancel_without_refund_request, self_dealing_attempt', async () => {
      const first = await paidOrder();
      await openHold(first.refund.id);
      const adminClient = await as(actors.adminId);
      // The guard now refuses this; a legacy row (resolved before the rule existed) is simulated with the guard off.
      await withGuardOff(() => call(adminClient, 'admin_resolve_refund', [first.refund.id, 'refunded', 'ZEL-1', null, null]));
      const t1 = await json(adminClient, 'admin_refund_trace', ['order', first.orderId]);
      expect(t1.gaps.map((g) => g.code)).toContain('refunded_without_proof');

      const rem = await paidRemittance();
      await admin.query('DELETE FROM public.refund_requests WHERE id = $1', [rem.refund.id]);
      const t2 = await json(adminClient, 'admin_refund_trace', ['remittance', rem.remittanceId]);
      expect(t2.gaps.map((g) => g.code)).toContain('paid_cancel_without_refund_request');

      const own = await paidOrder({ ownerId: actors.adminId });
      await openHold(own.refund.id);
      const blocked = await resolveV2(adminClient, own.refund.id, 'refunded', { proofPath: await addObject(own.refund.id) });
      expect(blocked).toMatchObject({ ok: false, code: 'self_resolution_not_allowed' });
      const t3 = await json(adminClient, 'admin_refund_trace', ['order', own.orderId]);
      expect(t3.gaps.map((g) => g.code)).toContain('self_dealing_attempt');
    });

    it('reading RPCs change nothing: counts and checksums are identical before and after', async () => {
      const first = await paidOrder();
      await openHold(first.refund.id);
      await resolveV2(await as(actors.adminId), first.refund.id, 'refunded', { proofPath: await addObject(first.refund.id) });
      const snap = async () =>
        (await admin.query(
          `SELECT (SELECT count(*) FROM public.refund_requests) a,
                  (SELECT md5(string_agg(t::text, '|' ORDER BY t::text)) FROM public.refund_requests t) b,
                  (SELECT count(*) FROM public.refund_request_events) c,
                  (SELECT count(*) FROM public.order_status_history) d,
                  (SELECT count(*) FROM public.activity_logs) e`
        )).rows[0];
      const before = await snap();
      const adminClient = await as(actors.adminId);
      await json(adminClient, 'admin_operation_timeline', ['order', first.orderId]);
      await json(adminClient, 'admin_get_operation_refunds', ['order', first.orderId]);
      await json(adminClient, 'admin_refund_trace', ['order', first.orderId]);
      const win = [new Date(Date.now() - 7 * 86400000).toISOString(), new Date(Date.now() + 86400000).toISOString()];
      await json(adminClient, 'admin_refund_metrics', [...win, null]);
      await json(adminClient, 'admin_refund_export', win);
      await json(adminClient, 'admin_refund_proofs_expiring', [30]);
      expect(await snap()).toEqual(before);
    });
  });

  describe('metrics and export (aggregates only)', () => {
    it('admin only; shape; counts the resolved refund and the proof share; export has no PII columns', async () => {
      const a = await paidOrder();
      await openHold(a.refund.id);
      const adminClient = await as(actors.adminId);
      await resolveV2(adminClient, a.refund.id, 'refunded', { proofPath: await addObject(a.refund.id) });
      const b = await paidOrder();
      await call(adminClient, 'admin_resolve_refund', [b.refund.id, 'not_applicable', null, null, 'dup']);
      await paidOrder();

      const m = await json(adminClient, 'admin_refund_metrics', [new Date(Date.now() - 7 * 86400000).toISOString(), new Date(Date.now() + 86400000).toISOString(), 'order']);
      expect(m.total_refunded).toBeGreaterThanOrEqual(1);
      expect(m.total_not_applicable).toBeGreaterThanOrEqual(1);
      expect(m.total_pending).toBeGreaterThanOrEqual(1);
      expect(m.pct_with_proof).toBe(100);
      expect(m.pct_without_proof).toBe(0);
      expect(m.pending_amount_by_currency).toHaveProperty('USD');
      for (const key of ['time_to_refund_from_cancel_hours', 'time_to_refund_from_eligible_hours', 'queue_age_hours', 'overdue_by_day', 'not_applicable_rate', 'reopen_count', 'self_resolved_count', 'pct_on_time']) {
        expect(m, key).toHaveProperty(key);
      }
      const rows = await json(adminClient, 'admin_refund_export', [new Date(Date.now() - 7 * 86400000).toISOString(), new Date(Date.now() + 86400000).toISOString()]);
      expect(rows.length).toBeGreaterThanOrEqual(3);
      const text = JSON.stringify(rows);
      for (const forbidden of ['payer_phone', 'payment_reference', 'refund_reference', 'resolution_reason', 'customer_email', 'proof_path']) {
        expect(text, forbidden).not.toContain(forbidden);
      }
      const customer = await as(actors.customerId);
      expect((await failure(customer.query(`SELECT public.admin_refund_metrics(now() - interval '1 day', now(), NULL)`))).code).toBe('42501');
      expect((await failure(customer.query(`SELECT public.admin_refund_export(now() - interval '1 day', now())`))).code).toBe('42501');
    });

    it('rejects an inverted or oversized range', async () => {
      const adminClient = await as(actors.adminId);
      expect((await failure(adminClient.query(`SELECT public.admin_refund_metrics(now(), now() - interval '1 day', NULL)`))).code).toBe('22023');
      expect((await failure(adminClient.query(`SELECT public.admin_refund_metrics(now() - interval '400 days', now(), NULL)`))).code).toBe('22023');
    });
  });

  describe('private bucket refund-proofs', () => {
    it('is private, 5 MB, jpeg/png/webp/pdf only; proofs are mandatory', async () => {
      const { rows } = await admin.query(`SELECT public, file_size_limit, allowed_mime_types FROM storage.buckets WHERE id = 'refund-proofs'`);
      expect(rows).toHaveLength(1);
      expect(rows[0].public).toBe(false);
      expect(Number(rows[0].file_size_limit)).toBe(5242880);
      expect([...rows[0].allowed_mime_types].sort()).toEqual(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);
      expect((await admin.query('SELECT public.refund_proof_required() AS r')).rows[0].r).toBe(true);
    });

    it('storage policies: admin reads/uploads inside refunds/{uuid}/; customers and anon see nothing; no UPDATE policy', async () => {
      const { refund } = await paidOrder();
      const name = `refunds/${refund.id}/${randomUUID()}.png`;
      const adminClient = await as(actors.adminId);
      await adminClient.query(`INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('refund-proofs', $1, $2)`, [name, actors.adminId]);
      objects.push(name);
      const mine = await adminClient.query(`SELECT name FROM storage.objects WHERE bucket_id = 'refund-proofs' AND name = $1`, [name]);
      expect(mine.rowCount).toBe(1);
      const customer = await as(actors.customerId);
      expect((await customer.query(`SELECT name FROM storage.objects WHERE bucket_id = 'refund-proofs'`)).rowCount).toBe(0);
      expect((await failure(customer.query(`INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('refund-proofs', $1, $2)`, [`refunds/${refund.id}/${randomUUID()}.png`, actors.customerId]))).code).toBe('42501');
      expect((await failure(adminClient.query(`INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('refund-proofs', 'loose/file.png', $1)`, [actors.adminId]))).code).toBe('42501');
      const upd = await adminClient.query(`UPDATE storage.objects SET name = name || 'x' WHERE bucket_id = 'refund-proofs' AND name = $1`, [name]);
      expect(upd.rowCount).toBe(0);
    });

    it('uploads are accepted only for refunds still pending', async () => {
      const { refund } = await paidOrder();
      const adminClient = await as(actors.adminId);
      await call(adminClient, 'admin_resolve_refund', [refund.id, 'not_applicable', null, null, 'duplicate request']);
      const late = `refunds/${refund.id}/${randomUUID()}.png`;
      const err = await failure(adminClient.query(`INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('refund-proofs', $1, $2)`, [late, actors.adminId]));
      expect(err.code).toBe('42501');
    });

    it('has a partial index on proof_path for the DELETE policy', async () => {
      const { rows } = await admin.query(
        `SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'refund_requests' AND indexdef ILIKE '%proof_path%'`
      );
      expect(rows.some((r) => /WHERE \(?proof_path IS NOT NULL\)?/i.test(r.indexdef))).toBe(true);
    });

    it('DELETE is allowed only for objects not referenced by a refund', async () => {
      const { refund } = await paidOrder();
      await openHold(refund.id);
      const orphan = await addObject(refund.id);
      const used = await addObject(refund.id);
      const adminClient = await as(actors.adminId);
      await resolveV2(adminClient, refund.id, 'refunded', { proofPath: used });
      const del1 = await adminClient.query(`DELETE FROM storage.objects WHERE bucket_id = 'refund-proofs' AND name = $1`, [orphan]);
      expect(del1.rowCount).toBe(1);
      const del2 = await adminClient.query(`DELETE FROM storage.objects WHERE bucket_id = 'refund-proofs' AND name = $1`, [used]);
      expect(del2.rowCount).toBe(0);
    });
  });

  describe('admin_resolve_refund_v2', () => {
    it('coexists with v1 (v1 untouched, still 5 arguments) and is authenticated-only SECURITY DEFINER', async () => {
      const { rows } = await admin.query(
        `SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args, prosecdef,
                has_function_privilege('anon', p.oid, 'EXECUTE') AS anon, has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth
           FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'admin_resolve_refund%' ORDER BY 1`
      );
      expect(rows).toHaveLength(2);
      expect(rows[0].args).toBe('p_refund_id uuid, p_action text, p_reference text, p_refunded_at timestamp with time zone, p_reason text');
      expect(rows.every((r) => r.prosecdef && !r.anon && r.auth)).toBe(true);
    });

    it('refunded without a proof fails proof_required; not_applicable needs only a reason', async () => {
      const { refund } = await paidOrder();
      await openHold(refund.id);
      const adminClient = await as(actors.adminId);
      const err = await failure(resolveV2(adminClient, refund.id, 'refunded'));
      expect(err.code).toBe('22023');
      expect(err.message).toContain('proof_required');
      expect((await refundById(refund.id)).status).toBe('pending');
      const ok = await resolveV2(adminClient, refund.id, 'not_applicable');
      expect(ok.ok).toBe(true);
      expect(ok.refund.status).toBe('not_applicable');
      expect(ok.refund.proof_path ?? null).toBeNull();
    });

    it('rejects a proof for another refund, a malformed path, a missing object and a bad hash', async () => {
      const { refund } = await paidOrder();
      const other = await paidOrder();
      await openHold(refund.id);
      const adminClient = await as(actors.adminId);
      const wrongRefund = await addObject(other.refund.id);
      const missing = `refunds/${refund.id}/${randomUUID()}.png`;
      for (const proofPath of [wrongRefund, missing, `refunds/${refund.id}/../x.png`, `refunds/${refund.id}/${randomUUID()}.exe`, `payment-proofs/${randomUUID()}.png`]) {
        const err = await failure(resolveV2(adminClient, refund.id, 'refunded', { proofPath }));
        expect(err.code, proofPath).toBe('22023');
      }
      const real = await addObject(refund.id);
      expect((await failure(resolveV2(adminClient, refund.id, 'refunded', { proofPath: real, sha: 'zz' }))).code).toBe('22023');
      expect((await refundById(refund.id)).status).toBe('pending');
    });

    it('success stores proof path, hash and expiry = refunded_at + 1 year; before the hold it fails; replay is idempotent', async () => {
      const { refund } = await paidOrder();
      const adminClient = await as(actors.adminId);
      const early = await addObject(refund.id);
      const hold = await failure(resolveV2(adminClient, refund.id, 'refunded', { proofPath: early }));
      expect(hold.message).toContain('refund_on_hold');
      await openHold(refund.id);
      const proof = await addObject(refund.id, 'pdf');
      const result = await resolveV2(adminClient, refund.id, 'refunded', { proofPath: proof, sha: SHA });
      expect(result.ok).toBe(true);
      const row = (await refundById(refund.id));
      expect(row).toMatchObject({ status: 'refunded', proof_path: proof, proof_sha256: SHA, self_resolved: false });
      const expected = await admin.query(`SELECT ($1::timestamptz + interval '1 year') AS e`, [row.refunded_at]);
      expect(row.proof_expires_at.toISOString()).toBe(expected.rows[0].e.toISOString());
      const again = await resolveV2(adminClient, refund.id, 'refunded', { proofPath: proof, sha: SHA });
      expect(again.ok).toBe(true);
      expect(await types(refund.id)).toEqual(['created', 'closed_refunded', 'proof_attached']);
      const different = await failure(resolveV2(adminClient, refund.id, 'refunded', { reference: 'OTHER', proofPath: proof }));
      expect(different.message).toContain('already_resolved');
    });

    it('non-admins and anon are refused', async () => {
      const { refund } = await paidOrder();
      const customer = await as(actors.customerId);
      expect((await failure(resolveV2(customer, refund.id, 'not_applicable'))).code).toBe('42501');
      const anon = await connectAnon();
      clients.push(anon);
      expect((await failure(resolveV2(anon, refund.id, 'not_applicable'))).code).toBe('42501');
    });
  });

  describe('the guard closes the v1 shortcut (proof and separation of duties hold without revoking v1)', () => {
    it('v1 "refunded" without a proof is refused and the row stays pending', async () => {
      const { refund } = await paidOrder();
      await openHold(refund.id);
      const err = await failure(call(await as(actors.adminId), 'admin_resolve_refund', [refund.id, 'refunded', 'ZEL-1', null, null]));
      expect(err.code).toBe('42501');
      expect(err.message).toContain('refund_proof_required');
      expect((await refundById(refund.id)).status).toBe('pending');
    });

    it('v1 on the admin\'s own operation is refused, by an admin it works', async () => {
      const own = await paidOrder({ ownerId: actors.adminId });
      const ownerClient = await as(actors.adminId);
      const err = await failure(call(ownerClient, 'admin_resolve_refund', [own.refund.id, 'not_applicable', null, null, 'duplicate request']));
      expect(err.code).toBe('42501');
      expect(err.message).toContain('refund_self_resolution');
      // faking the reopen reason does not help while the operation is still cancelled
      const fake = await failure(call(ownerClient, 'admin_resolve_refund', [own.refund.id, 'not_applicable', null, null, 'reopened']));
      expect(fake.code).toBe('42501');
      expect((await refundById(own.refund.id)).status).toBe('pending');
      await setRole(actors.customerId, 'admin');
      const other = await as(actors.customerId);
      const ok = await call(other, 'admin_resolve_refund', [own.refund.id, 'not_applicable', null, null, 'duplicate request']);
      expect(ok.status).toBe('not_applicable');
    });

    it('v2 and a real reopen (even by the owner-admin) still work', async () => {
      const own = await paidOrder({ ownerId: actors.adminId });
      await call(await as(actors.adminId), 'order_reopen', [own.orderId]);
      expect((await refundById(own.refund.id)).status).toBe('not_applicable');
      const { refund } = await paidOrder();
      await openHold(refund.id);
      const done = await resolveV2(await as(actors.adminId), refund.id, 'refunded', { proofPath: await addObject(refund.id) });
      expect(done.ok).toBe(true);
    });

    it('refund_proof_required() lives in the first migration (the guard calls it)', async () => {
      const { rows } = await admin.query(`SELECT 1 FROM pg_proc WHERE proname = 'refund_proof_required' AND pronamespace = 'public'::regnamespace`);
      expect(rows).toHaveLength(1);
    });
  });

  describe('self-resolution attempts are rate limited', () => {
    it('repeated blocked attempts by the same admin on the same refund record one event per hour', async () => {
      const own = await paidOrder({ ownerId: actors.adminId });
      const ownerClient = await as(actors.adminId);
      for (let i = 0; i < 4; i += 1) {
        expect(await resolveV2(ownerClient, own.refund.id, 'not_applicable')).toMatchObject({ ok: false });
      }
      await json(ownerClient, 'admin_set_refund_dispute', [own.refund.id, true]);
      const blocked = (await eventsFor(own.refund.id)).filter((e) => e.event_type === 'self_resolution_blocked');
      expect(blocked).toHaveLength(1);
    });
  });

  describe('admin as customer: separation of duties', () => {
    it('the owner-admin cannot resolve his own refund; the attempt is audited; another admin can', async () => {
      const own = await paidOrder({ ownerId: actors.adminId });
      expect(own.refund.user_id).toBe(actors.adminId);
      const ownerClient = await as(actors.adminId);
      const blocked = await resolveV2(ownerClient, own.refund.id, 'not_applicable');
      expect(blocked).toMatchObject({ ok: false, code: 'self_resolution_not_allowed' });
      expect((await refundsFor(own.orderId))[0].status).toBe('pending');
      const ev = (await eventsFor(own.refund.id)).filter((e) => e.event_type === 'self_resolution_blocked');
      expect(ev).toHaveLength(1);
      expect(ev[0]).toMatchObject({ actor_id: actors.adminId, owner_is_actor: true, actor_role: 'admin' });
      expect(ev[0].occurred_at).toBeInstanceOf(Date);

      await setRole(actors.customerId, 'admin');
      const other = await as(actors.customerId);
      const done = await resolveV2(other, own.refund.id, 'not_applicable');
      expect(done.ok).toBe(true);
      const closed = (await eventsFor(own.refund.id)).find((e) => e.event_type === 'closed_not_applicable');
      expect(closed).toMatchObject({ actor_id: actors.customerId, owner_is_actor: false });
    });

    it('a plain admin cannot self-resolve even with the confirmation flag; a super_admin can, flagged self_resolved', async () => {
      const own = await paidOrder({ ownerId: actors.adminId });
      const adminClient = await as(actors.adminId);
      const denied = await resolveV2(adminClient, own.refund.id, 'not_applicable', { selfConfirm: true });
      expect(denied).toMatchObject({ ok: false, code: 'self_resolution_not_allowed' });

      await setRole(actors.adminId, 'super_admin');
      const superClient = await as(actors.adminId);
      const unconfirmed = await resolveV2(superClient, own.refund.id, 'not_applicable');
      expect(unconfirmed).toMatchObject({ ok: false, code: 'self_resolution_not_allowed' });
      const allowed = await resolveV2(superClient, own.refund.id, 'not_applicable', { selfConfirm: true });
      expect(allowed.ok).toBe(true);
      expect((await refundsFor(own.orderId))[0].self_resolved).toBe(true);
      const closed = (await eventsFor(own.refund.id)).find((e) => e.event_type === 'closed_not_applicable');
      expect(closed).toMatchObject({ owner_is_actor: true, reason_code: 'self_resolved' });
      const m = await json(superClient, 'admin_refund_metrics', [new Date(Date.now() - 7 * 86400000).toISOString(), new Date(Date.now() + 86400000).toISOString(), null]);
      expect(m.self_resolved_count).toBeGreaterThanOrEqual(1);
    });

    it('the owner-admin sees and cancels his own operation like any customer (request enters the normal queue)', async () => {
      const own = await paidOrder({ ownerId: actors.adminId });
      const list = await json(await as(actors.adminId), 'admin_list_refunds', ['pending', 200, 0, null]);
      expect(list.items.map((i) => i.id)).toContain(own.refund.id);
    });
  });

  describe('retention: proofs expire one year after the refund (RPCs; the Edge Function is not deployed)', () => {
    const refundedWithProof = async () => {
      const { refund } = await paidOrder();
      await openHold(refund.id);
      const proof = await addObject(refund.id);
      await resolveV2(await as(actors.adminId), refund.id, 'refunded', { proofPath: proof, sha: SHA });
      return { id: refund.id, proof };
    };
    const expireAt = (id, sqlExpr) =>
      withGuardOff(() => admin.query(`UPDATE public.refund_requests SET proof_expires_at = ${sqlExpr} WHERE id = $1`, [id]));
    const due = async () =>
      (await admin.query('SELECT refund_id, proof_path FROM public._refund_proofs_due(1000)')).rows;

    it('purge helpers are service_role only (not callable by anon/authenticated); dispute RPC is authenticated only', async () => {
      for (const fn of ['_refund_proofs_due', '_mark_refund_proof_purged']) {
        const { rows } = await admin.query(
          `SELECT has_function_privilege('anon', p.oid, 'EXECUTE') AS anon, has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth,
                  has_function_privilege('service_role', p.oid, 'EXECUTE') AS svc
             FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = $1`,
          [fn]
        );
        expect(rows, fn).toEqual([{ anon: false, auth: false, svc: true }]);
      }
      const customer = await as(actors.customerId);
      expect((await failure(customer.query('SELECT * FROM public._refund_proofs_due(10)'))).code).toBe('42501');
    });

    it('never returns or purges proofs that have not expired (1 second before, tomorrow, null expiry)', async () => {
      const a = await refundedWithProof();
      const b = await refundedWithProof();
      await expireAt(a.id, `now() + interval '1 second'`);
      await expireAt(b.id, `now() + interval '1 day'`);
      const ids = (await due()).map((r) => r.refund_id);
      expect(ids).not.toContain(a.id);
      expect(ids).not.toContain(b.id);
      const direct = await admin.query('SELECT public._mark_refund_proof_purged($1, NULL) AS ok', [a.id]);
      expect(direct.rows[0].ok).toBe(false);
      const row = await refundById(a.id);
      expect(row.proof_purged_at).toBeNull();
      expect(await types(a.id)).not.toContain('proof_expired');
    });

    it('purges an expired proof once: marks it, writes one proof_expired event, keeps metadata, is idempotent', async () => {
      const a = await refundedWithProof();
      await expireAt(a.id, `now() - interval '1 second'`);
      const found = (await due()).filter((r) => r.refund_id === a.id);
      expect(found).toEqual([{ refund_id: a.id, proof_path: a.proof }]);
      const first = await admin.query('SELECT public._mark_refund_proof_purged($1, $2) AS ok', [a.id, actors.adminId]);
      expect(first.rows[0].ok).toBe(true);
      const second = await admin.query('SELECT public._mark_refund_proof_purged($1, $2) AS ok', [a.id, actors.adminId]);
      expect(second.rows[0].ok).toBe(false);
      const expiredEvents = (await eventsFor(a.id)).filter((e) => e.event_type === 'proof_expired');
      expect(expiredEvents).toHaveLength(1);
      expect(expiredEvents[0]).toMatchObject({ actor_id: actors.adminId, has_proof: false });
      expect(expiredEvents[0].occurred_at).toBeInstanceOf(Date);
      const row = (await admin.query('SELECT * FROM public.refund_requests WHERE id = $1', [a.id])).rows[0];
      expect(row).toMatchObject({ proof_path: a.proof, proof_sha256: SHA, refund_reference: 'ZEL-12345', status: 'refunded' });
      expect(row.proof_purged_at).toBeInstanceOf(Date);
      expect((await due()).map((r) => r.refund_id)).not.toContain(a.id);
    });

    it('never purges a refund with an open dispute; closing it makes it purgeable again', async () => {
      const a = await refundedWithProof();
      await expireAt(a.id, `now() - interval '1 day'`);
      const adminClient = await as(actors.adminId);
      const opened = await json(adminClient, 'admin_set_refund_dispute', [a.id, true]);
      expect(opened.ok).toBe(true);
      expect((await json(adminClient, 'admin_set_refund_dispute', [a.id, true])).ok).toBe(true);
      expect((await eventsFor(a.id)).filter((e) => e.event_type === 'dispute_opened')).toHaveLength(1);
      expect((await due()).map((r) => r.refund_id)).not.toContain(a.id);
      expect((await admin.query('SELECT public._mark_refund_proof_purged($1, NULL) AS ok', [a.id])).rows[0].ok).toBe(false);
      await json(adminClient, 'admin_set_refund_dispute', [a.id, false]);
      expect((await due()).map((r) => r.refund_id)).toContain(a.id);
    });

    it('the owner-admin cannot open or close a dispute on his own refund', async () => {
      const own = await paidOrder({ ownerId: actors.adminId });
      const res = await json(await as(actors.adminId), 'admin_set_refund_dispute', [own.refund.id, true]);
      expect(res).toMatchObject({ ok: false, code: 'self_resolution_not_allowed' });
    });

    it('the dispute check is callable by service_role (the purge re-checks right before each delete), not by API roles', async () => {
      const { rows } = await admin.query(
        `SELECT has_function_privilege('anon', p.oid, 'EXECUTE') AS anon, has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth,
                has_function_privilege('service_role', p.oid, 'EXECUTE') AS svc
           FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = '_refund_dispute_open'`
      );
      expect(rows).toEqual([{ anon: false, auth: false, svc: true }]);
    });

    it('"expiring in 30 days" report counts exactly the proofs inside the window, without paths', async () => {
      const soon = await refundedWithProof();
      const later = await refundedWithProof();
      const gone = await refundedWithProof();
      await expireAt(soon.id, `now() + interval '29 days'`);
      await expireAt(later.id, `now() + interval '31 days'`);
      await expireAt(gone.id, `now() - interval '1 day'`);
      await admin.query('SELECT public._mark_refund_proof_purged($1, NULL)', [gone.id]);
      const adminClient = await as(actors.adminId);
      const report = await json(adminClient, 'admin_refund_proofs_expiring', [30]);
      const ids = report.items.map((i) => i.refund_id);
      expect(ids).toContain(soon.id);
      expect(ids).not.toContain(later.id);
      expect(ids).not.toContain(gone.id);
      expect(report.count).toBe(report.items.length);
      expect(report).toHaveProperty('overdue_unpurged');
      expect(JSON.stringify(report)).not.toContain('refunds/');
      const customer = await as(actors.customerId);
      expect((await failure(customer.query('SELECT public.admin_refund_proofs_expiring(30)'))).code).toBe('42501');
    });
  });

  describe('platform reset compatibility', () => {
    it('deleting the operations (what the reset does) works and the events survive', async () => {
      const { orderId, refund } = await paidOrder();
      const before = await eventsFor(refund.id);
      expect(before.length).toBeGreaterThan(0);
      await admin.query('DELETE FROM public.orders WHERE id = $1', [orderId]);
      expect(await refundsFor(orderId)).toHaveLength(0);
      expect(await eventsFor(refund.id)).toEqual(before);
      tracker.orders.splice(tracker.orders.indexOf(orderId), 1);
    });
  });
});
