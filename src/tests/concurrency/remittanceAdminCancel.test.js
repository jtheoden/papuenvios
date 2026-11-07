/**
 * Admin cancel of a pending remittance (no payment proof yet).
 * Migration under test: 20261105100000_remittance_admin_cancel.sql
 *   public.remittance_admin_cancel(uuid, text) -> public._remittance_transition(..., 'admin_cancel', ...)
 *   admin / super_admin only, payment_pending only, reason 1..500 required. remittance_cancel stays owner-only.
 *
 * The suite does not list the new function in `needs`: a missing migration fails loudly (red phase).
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { dbSuiteSkipReason, connectAdmin, connectAs, connectAnon, endAll } from './db';
import { loadActors } from './fixtures';

const skipReason = await dbSuiteSkipReason({
  functions: ['is_admin_user', 'current_user_is_blocked', 'remittance_cancel'],
  tables: ['remittances', 'remittance_types', 'remittance_status_history', 'user_profiles', 'refund_requests']
});
const describeDb = skipReason ? describe.skip : describe;

const STATUSES = [
  'payment_pending', 'payment_proof_uploaded', 'payment_validated', 'payment_rejected',
  'processing', 'delivered', 'completed', 'cancelled'
];

const failure = async (promise) => {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected the statement to fail, but it succeeded');
};

describeDb('remittance_admin_cancel', () => {
  let admin;
  let actors;
  let typeId;
  const clients = [];
  const remittances = [];

  const as = async (userId) => {
    const c = await connectAs(userId);
    clients.push(c);
    return c;
  };
  const cancel = async (client, id, reason) =>
    (await client.query('SELECT * FROM public.remittance_admin_cancel($1, $2)', [id, reason])).rows[0];
  const row = async (id) => (await admin.query('SELECT * FROM public.remittances WHERE id = $1', [id])).rows[0];
  const history = async (id) =>
    (await admin.query('SELECT old_status, new_status, changed_by, notes FROM public.remittance_status_history WHERE remittance_id = $1', [id])).rows;
  const setUser = (id, fields) =>
    admin.query(`UPDATE public.user_profiles SET ${Object.keys(fields).map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE id = $1`, [id, ...Object.values(fields)]);

  const seed = async (status) => {
    const id = randomUUID();
    await admin.query(
      `INSERT INTO public.remittances (id, user_id, remittance_type_id, amount_sent, exchange_rate,
         commission_percentage, commission_fixed, commission_total, amount_to_deliver, currency_sent,
         currency_delivered, recipient_name, recipient_phone, status)
       VALUES ($1,$2,$3,100,800,2.5,0,2.5,78000,'USD','CUP','Rcpt','+5355550100',$4)`,
      [id, actors.customerId, typeId, status]
    );
    remittances.push(id);
    return id;
  };

  let adminOriginal;

  beforeAll(async () => {
    admin = await connectAdmin();
    actors = await loadActors(admin);
    adminOriginal = (await admin.query('SELECT role, is_enabled FROM public.user_profiles WHERE id = $1', [actors.adminId])).rows[0];
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
    await setUser(actors.adminId, { is_enabled: adminOriginal.is_enabled, role: adminOriginal.role });
    if (remittances.length) {
      await admin.query('DELETE FROM public.refund_requests WHERE remittance_id = ANY($1)', [remittances]);
      await admin.query('DELETE FROM public.remittance_status_history WHERE remittance_id = ANY($1)', [remittances]);
      await admin.query('DELETE FROM public.remittances WHERE id = ANY($1)', [remittances.splice(0)]);
    }
  });
  afterAll(async () => {
    await admin.query('DELETE FROM public.remittance_types WHERE id = $1', [typeId]);
    await admin.end();
  });

  it('is SECURITY DEFINER and executable by authenticated only', async () => {
    const { rows } = await admin.query(
      `SELECT has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
              has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth, prosecdef
         FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'remittance_admin_cancel'`
    );
    expect(rows).toEqual([{ anon: false, auth: true, prosecdef: true }]);
    const helper = await admin.query(
      `SELECT has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth
         FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = '_remittance_transition'`
    );
    expect(helper.rows[0].auth).toBe(false);
  });

  it.each(['admin', 'super_admin'])('%s cancels a pending remittance without proof: audit trail, no refund request', async (role) => {
    await setUser(actors.adminId, { role });
    const id = await seed('payment_pending');
    const c = await as(actors.adminId);
    const r = await cancel(c, id, '  customer never paid ');
    expect(r.status).toBe('cancelled');
    const after = await row(id);
    expect(after.cancelled_by).toBe(actors.adminId);
    expect(after.cancellation_reason).toBe('customer never paid');
    expect(after.cancelled_at).not.toBeNull();
    expect(await history(id)).toEqual([{
      old_status: 'payment_pending', new_status: 'cancelled', changed_by: actors.adminId,
      notes: 'Cancelled by admin: customer never paid'
    }]);
    const refunds = await admin.query('SELECT count(*)::int AS n FROM public.refund_requests WHERE remittance_id = $1', [id]);
    expect(refunds.rows[0].n).toBe(0);
  });

  it('only payment_pending can be cancelled by an admin; every other status is invalid_transition and unchanged', async () => {
    for (const status of STATUSES.filter((s) => s !== 'payment_pending')) {
      const id = await seed(status);
      const c = await as(actors.adminId);
      const err = await failure(cancel(c, id, 'x'));
      expect(err.code, status).toBe('22023');
      expect(err.message, status).toBe('invalid_transition');
      expect((await row(id)).status, status).toBe(status);
    }
  });

  it('requires a reason of 1..500 characters', async () => {
    const id = await seed('payment_pending');
    const c = await as(actors.adminId);
    for (const reason of [null, '', '   ', 'x'.repeat(501)]) {
      const err = await failure(cancel(c, id, reason));
      expect(err.code).toBe('22023');
      expect(err.message).toBe('invalid_argument');
    }
    expect((await row(id)).status).toBe('payment_pending');
  });

  it('the owner (not admin), a disabled admin and anon are refused', async () => {
    const id = await seed('payment_pending');
    const owner = await as(actors.customerId);
    expect((await failure(cancel(owner, id, 'x'))).code).toBe('42501');
    await setUser(actors.adminId, { is_enabled: false });
    const disabled = await as(actors.adminId);
    expect((await failure(cancel(disabled, id, 'x'))).code).toBe('42501');
    const anon = await connectAnon();
    clients.push(anon);
    expect((await failure(anon.query('SELECT * FROM public.remittance_admin_cancel($1, $2)', [id, 'x']))).code).toBe('42501');
    expect((await row(id)).status).toBe('payment_pending');
  });

  it('an unknown id is remittance_not_found for an admin', async () => {
    const c = await as(actors.adminId);
    expect((await failure(cancel(c, randomUUID(), 'x'))).code).toBe('P0002');
  });

  it('accepts a reason of exactly 500 characters', async () => {
    const id = await seed('payment_pending');
    const c = await as(actors.adminId);
    const reason = 'r'.repeat(500);
    expect((await cancel(c, id, reason)).status).toBe('cancelled');
    expect((await row(id)).cancellation_reason).toBe(reason);
  });

  it('an admin may cancel his OWN pending remittance (a customer action, allowed by the self-dealing guard)', async () => {
    const id = await seed('payment_pending');
    await admin.query('UPDATE public.remittances SET user_id = $2 WHERE id = $1', [id, actors.adminId]);
    const c = await as(actors.adminId);
    expect((await cancel(c, id, 'my own test request')).status).toBe('cancelled');
    expect((await row(id)).cancelled_by).toBe(actors.adminId);
  });

  it('race A: the customer uploads the proof holding the row lock; admin_cancel waits and gets invalid_transition', async () => {
    const id = await seed('payment_pending');
    const owner = await as(actors.customerId);
    const adm = await as(actors.adminId);
    const admPid = (await adm.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    await owner.query('BEGIN');
    await owner.query('SELECT * FROM public.remittance_submit_proof($1, $2, $3, $4, $5)',
      [id, 'user-id/REM-1.jpg', 'Payer Ref', null, '+13055550100']);
    const pending = failure(cancel(adm, id, 'never paid'));
    // Wait until the admin call is parked on the row lock, then let the customer commit.
    let parked = false;
    for (let i = 0; i < 100 && !parked; i += 1) {
      const { rows } = await admin.query('SELECT wait_event_type FROM pg_stat_activity WHERE pid = $1', [admPid]);
      parked = rows[0]?.wait_event_type === 'Lock';
      if (!parked) await new Promise((r) => setTimeout(r, 20));
    }
    await owner.query('COMMIT');
    expect(parked).toBe(true);
    const err = await pending;
    expect(err.code).toBe('22023');
    expect(err.message).toBe('invalid_transition');
    expect((await row(id)).status).toBe('payment_proof_uploaded');
  });

  it('race B: submit_proof after the admin cancelled gets invalid_transition and the remittance stays cancelled', async () => {
    const id = await seed('payment_pending');
    const adm = await as(actors.adminId);
    await cancel(adm, id, 'never paid');
    const owner = await as(actors.customerId);
    const err = await failure(owner.query('SELECT * FROM public.remittance_submit_proof($1, $2, $3, $4, $5)',
      [id, 'user-id/REM-1.jpg', 'Payer Ref', null, '+13055550100']));
    expect(err.code).toBe('22023');
    expect(err.message).toBe('invalid_transition');
    expect((await row(id)).status).toBe('cancelled');
  });

  it('remittance_cancel stays owner-only: the admin still gets 42501 there', async () => {
    const id = await seed('payment_pending');
    const c = await as(actors.adminId);
    expect((await failure(c.query('SELECT * FROM public.remittance_cancel($1, $2)', [id, 'x']))).code).toBe('42501');
    const owner = await as(actors.customerId);
    expect((await owner.query('SELECT * FROM public.remittance_cancel($1, $2)', [id, 'x'])).rows[0].status).toBe('cancelled');
  });
});
