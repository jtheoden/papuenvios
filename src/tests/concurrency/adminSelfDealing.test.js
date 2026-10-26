/**
 * Separation of duties: an admin must not operate on his OWN order / remittance (plan_admin-self-dealing-guard.md).
 *
 *   S1 20261101100000_commission_self_adjust_guard.sql      BEFORE INSERT on remittance_commission_overrides (+ proposals belt)
 *   S2 20261101100100_orders_admin_self_dealing_guard.sql   BEFORE UPDATE OF status, payment_status on orders
 *   S3 20261101100200_remittances_admin_self_dealing_guard.sql  BEFORE UPDATE OF status on remittances
 *
 * The triggers only act when auth.uid() = user_id AND is_admin_user() and the transition is NOT one a plain customer
 * could make (allowlist, fail-closed). Customers, other admins and service_role/postgres (uid NULL) are unaffected.
 * The suite does not list the new objects in `needs`: a missing migration fails loudly (red phase).
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dbSuiteSkipReason, connectAdmin, connectAs, endAll } from './db';
import { loadActors, createTracker, seedOrder, seedProduct, cleanup } from './fixtures';

const S1 = 'supabase/migrations/20261101100000_commission_self_adjust_guard.sql';
const S2 = 'supabase/migrations/20261101100100_orders_admin_self_dealing_guard.sql';
const S3 = 'supabase/migrations/20261101100200_remittances_admin_self_dealing_guard.sql';
const DOWNS = [
  'supabase/rollbacks/20261101100000_commission_self_adjust_guard_down.sql',
  'supabase/rollbacks/20261101100100_orders_admin_self_dealing_guard_down.sql',
  'supabase/rollbacks/20261101100200_remittances_admin_self_dealing_guard_down.sql'
];
const REASON = 'self-dealing test reason, long enough';
const BLOCKED = /admin_self_dealing_not_allowed/;

// prosrc md5 of the LIVE functions that this change must never replace (captured from production, 2026-10-26).
const PINNED_MD5 = {
  _order_transition: '28a851a304798873113426d51f2296b9',
  _remittance_transition: 'ebbd27fe90d583f269b76884e65f18ba',
  admin_set_remittance_commission: '61f882648c9208a969a8e21fc26a2135',
  remittance_accept_commission: '5dc1bee0b20cab832c62dd7a2ff7ddf5',
  guard_status_via_rpc: '07f199e8ac086c0e37f488832bdab0e1',
  guard_commission_acceptance: 'a1cc237d3b92ce513082caa7f8a74964'
};

const skipReason = await dbSuiteSkipReason({
  functions: ['is_admin_user', 'admin_set_remittance_commission', 'order_cancel', 'remittance_cancel'],
  tables: ['orders', 'remittances', 'remittance_commission_overrides', 'remittance_commission_proposals']
});
const describeDb = skipReason ? describe.skip : describe;

const PROOF = 'payment-proofs/payment-proof-test.jpg';
const DELIVERY = 'u/o/delivery-proof-test.jpg';
const ORDER_STATUSES = ['pending', 'processing', 'dispatched', 'delivered', 'completed', 'cancelled'];
const ORDER_PAYMENTS = ['pending', 'proof_uploaded', 'validated', 'rejected'];
const REM_STATUSES = ['payment_pending', 'payment_rejected', 'payment_proof_uploaded', 'payment_validated', 'processing', 'delivered', 'completed', 'cancelled'];

const inn = (v, list) => list.includes(v);
/**
 * Written independently of the SQL. rpcOk = the RPC accepts the call when the caller is an admin AND the owner
 * (so both branches apply); customer = same for a plain owner; admin = same for an admin that is not the owner;
 * trig = a plain customer could make this transition (so the guard lets it through for an admin-owner).
 */
const ORDER_ACTIONS = [
  { fn: 'order_submit_proof', args: [PROOF, 'Payer Name', '+13055550100'], ownerOnly: true,
    rpcOk: (s, p) => s === 'pending' && inn(p, ['pending', 'rejected', 'proof_uploaded']), trig: () => true },
  { fn: 'order_reopen', args: [], ownerOnly: true,
    rpcOk: (s, p) => s === 'cancelled' && inn(p, ['pending', 'rejected', 'proof_uploaded']), trig: () => true },
  { fn: 'order_cancel', args: ['changed my mind'], customerOk: (s, p) => s === 'pending' && p !== 'validated',
    rpcOk: (s) => inn(s, ['pending', 'processing']), trig: (s, p) => s === 'pending' && p !== 'validated' },
  { fn: 'order_validate_payment', args: [], adminOnly: true,
    rpcOk: (s, p) => inn(s, ['pending', 'processing']) && inn(p, ['pending', 'proof_uploaded']), trig: () => false },
  { fn: 'order_reject_payment', args: ['blurry proof'], adminOnly: true,
    rpcOk: (s, p) => s === 'pending' && inn(p, ['pending', 'proof_uploaded']), trig: () => false },
  { fn: 'order_start_processing', args: [], adminOnly: true,
    rpcOk: (s, p) => s === 'pending' && p === 'validated', trig: () => false },
  { fn: 'order_dispatch', args: ['TRK-1'], adminOnly: true, rpcOk: (s) => s === 'processing', trig: () => false },
  { fn: 'order_mark_delivered', args: [DELIVERY], adminOnly: true, rpcOk: (s) => s === 'dispatched', trig: () => false },
  { fn: 'order_complete', args: ['all good'], adminOnly: true, rpcOk: (s) => s === 'delivered', trig: () => false }
];

const REM_ACTIONS = [
  { fn: 'remittance_submit_proof', args: ['u/proof.png', 'ref-1'], ownerOnly: true,
    rpcOk: (s) => inn(s, ['payment_pending', 'payment_rejected']), trig: () => true },
  { fn: 'remittance_cancel', args: ['changed my mind'], ownerOnly: true,
    rpcOk: (s) => inn(s, ['payment_pending', 'payment_rejected', 'payment_proof_uploaded']), trig: () => true },
  { fn: 'remittance_validate_payment', args: [], adminOnly: true, rpcOk: (s) => s === 'payment_proof_uploaded', trig: () => false },
  { fn: 'remittance_reject_payment', args: ['blurry proof'], adminOnly: true, rpcOk: (s) => s === 'payment_proof_uploaded', trig: () => false },
  { fn: 'remittance_start_processing', args: [], adminOnly: true, rpcOk: (s) => s === 'payment_validated', trig: () => false },
  { fn: 'remittance_confirm_delivery', args: [DELIVERY, 'ok'], adminOnly: true, rpcOk: (s) => s === 'processing', trig: () => false },
  { fn: 'remittance_complete', args: ['all good'], adminOnly: true, rpcOk: (s) => s === 'delivered', trig: () => false }
];

const failure = async (promise) => {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected the statement to fail, but it succeeded');
};

describeDb('admin self-dealing guard', () => {
  let admin;
  let actors;
  const clients = [];
  const tracker = createTracker();
  const remittances = [];
  const remittanceTypes = [];

  const byUser = new Map(); // one connection per user and test (the matrices would otherwise exhaust the server slots)
  const as = async (userId) => {
    if (!byUser.has(userId)) {
      const c = await connectAs(userId);
      clients.push(c);
      byUser.set(userId, c);
    }
    return byUser.get(userId);
  };
  const call = async (client, fn, args) => {
    const placeholders = args.map((_, i) => `$${i + 1}`).join(', ');
    return (await client.query(`SELECT * FROM public.${fn}(${placeholders})`, args)).rows[0];
  };
  const setRole = (id, role) => admin.query('UPDATE public.user_profiles SET role = $2, is_enabled = true WHERE id = $1', [id, role]);
  const seedO = (userId, status, paymentStatus, stockManaged = false) =>
    seedOrder(admin, actors, tracker, [], { userId, status, paymentStatus, stockManaged });
  const refundsOf = async (id) =>
    (await admin.query('SELECT status, resolution_reason FROM public.refund_requests WHERE order_id = $1 OR remittance_id = $1 ORDER BY created_at, id', [id])).rows;

  const seedType = async () => {
    const { rows } = await admin.query(
      `INSERT INTO public.remittance_types (name, currency_code, delivery_currency, exchange_rate,
                                            commission_percentage, commission_fixed, min_amount, delivery_method)
       VALUES ($1, 'USD', 'CUP', 800, 2.5, 0, 0.01, 'transfer') RETURNING id`,
      [`sd-${randomUUID().slice(0, 8)}`]
    );
    remittanceTypes.push(rows[0].id);
    return rows[0].id;
  };
  const seedR = async (userId, status = 'payment_pending') => {
    const id = randomUUID();
    await admin.query(
      `INSERT INTO public.remittances (id, user_id, remittance_type_id, amount_sent, exchange_rate,
         commission_percentage, commission_fixed, commission_total, amount_to_deliver, currency_sent,
         currency_delivered, recipient_name, recipient_phone, status)
       VALUES ($1,$2,$3,100,800,2.5,0,2.5,78000,'USD','CUP','Rcpt','+5355550100',$4)`,
      [id, userId, await seedType(), status]
    );
    remittances.push(id);
    return id;
  };
  const oRow = async (id) => (await admin.query('SELECT status, payment_status FROM public.orders WHERE id = $1', [id])).rows[0];
  const rRow = async (id) => (await admin.query('SELECT status, commission_total FROM public.remittances WHERE id = $1', [id])).rows[0];

  const restoreActors = async () => {
    await setRole(actors.adminId, 'admin');
    await setRole(actors.customerId, 'user');
  };

  beforeAll(async () => {
    admin = await connectAdmin();
    actors = await loadActors(admin);
    await setRole(actors.customerId, 'user');
  });
  afterEach(async () => {
    try {
      byUser.clear();
      await endAll(clients.splice(0));
    } finally {
      await restoreActors();
    }
    if (tracker.orders.length) await admin.query('DELETE FROM public.refund_requests WHERE order_id = ANY($1)', [tracker.orders]);
    if (remittances.length) await admin.query('DELETE FROM public.refund_requests WHERE remittance_id = ANY($1)', [remittances]);
    await cleanup(admin, tracker);
    if (remittances.length) {
      await admin.query(`DELETE FROM public.user_alerts WHERE metadata->>'remittanceId' = ANY($1::text[])`, [remittances]);
      await admin.query('DELETE FROM public.remittances WHERE id = ANY($1)', [remittances.splice(0)]);
    }
    if (remittanceTypes.length) await admin.query('DELETE FROM public.remittance_types WHERE id = ANY($1)', [remittanceTypes.splice(0)]);
  });
  afterAll(async () => {
    try {
      await restoreActors();
    } finally {
      await admin.end();
    }
  });

  describe('migration hygiene and protected functions', () => {
    it.each([S1, S2, S3])('%s: header with rollback, transaction, lock_timeout, pinned search_path', (file) => {
      const sql = readFileSync(file, 'utf8');
      expect(sql.split('\n').slice(0, 30).join('\n')).toMatch(/ROLLBACK/);
      expect(sql).toMatch(/^BEGIN;/m);
      expect(sql).toMatch(/SET LOCAL lock_timeout/);
      expect(sql).toMatch(/^COMMIT;/m);
      expect(sql).toMatch(/SET search_path = public, pg_temp/);
      expect(sql).not.toMatch(/FUNCTION public\.(_order_transition|_remittance_transition|admin_set_remittance_commission|remittance_accept_commission)\b/);
    });

    it.each(DOWNS)('%s exists and only drops triggers/functions', (file) => {
      const sql = readFileSync(file, 'utf8');
      expect(sql).toMatch(/DROP TRIGGER IF EXISTS/);
      expect(sql).toMatch(/DROP FUNCTION IF EXISTS/);
      expect(sql).not.toMatch(/\b(DELETE FROM|TRUNCATE|DROP TABLE)\b/i);
    });

    it('the live protected functions keep their exact prosrc', async () => {
      const { rows } = await admin.query(
        `SELECT proname, md5(prosrc) AS h FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = ANY($1)`,
        [Object.keys(PINNED_MD5)]
      );
      expect(Object.fromEntries(rows.map((r) => [r.proname, r.h]))).toEqual(PINNED_MD5);
    });

    it('the triggers exist, are ENABLE ALWAYS and the guard functions are not callable by API roles', async () => {
      const { rows } = await admin.query(
        `SELECT t.tgname, t.tgenabled FROM pg_trigger t WHERE NOT t.tgisinternal AND t.tgname = ANY($1) ORDER BY 1`,
        [['trg_commission_override_self_adjust', 'trg_commission_accept_self', 'trg_orders_admin_self_dealing', 'trg_remittances_admin_self_dealing']]
      );
      expect(rows).toEqual([
        { tgname: 'trg_commission_accept_self', tgenabled: 'A' },
        { tgname: 'trg_commission_override_self_adjust', tgenabled: 'A' },
        { tgname: 'trg_orders_admin_self_dealing', tgenabled: 'A' },
        { tgname: 'trg_remittances_admin_self_dealing', tgenabled: 'A' }
      ]);
      const fns = await admin.query(
        `SELECT proname, has_function_privilege('authenticated', oid, 'EXECUTE') AS auth, has_function_privilege('anon', oid, 'EXECUTE') AS anon
           FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = ANY($1)`,
        [['guard_commission_self_adjust', 'guard_commission_accept_self', 'guard_orders_admin_self_dealing', 'guard_remittances_admin_self_dealing']]
      );
      expect(fns.rows).toHaveLength(4);
      for (const f of fns.rows) expect({ auth: f.auth, anon: f.anon }).toEqual({ auth: false, anon: false });
    });
  });

  describe('(a)+(c) commission', () => {
    const SET = 'SELECT * FROM public.admin_set_remittance_commission($1::uuid, $2::numeric, $3::text)';
    const counts = async (rid) => {
      const q = async (sql) => (await admin.query(sql, [rid])).rows[0].n;
      return {
        overrides: await q('SELECT count(*)::int n FROM public.remittance_commission_overrides WHERE remittance_id = $1'),
        proposals: await q('SELECT count(*)::int n FROM public.remittance_commission_proposals WHERE remittance_id = $1'),
        alerts: await q(`SELECT count(*)::int n FROM public.user_alerts WHERE metadata->>'remittanceId' = $1::text`)
      };
    };

    it.each([6, 1])('an admin cannot set (%s) the commission of his own remittance; nothing is written', async (value) => {
      const rid = await seedR(actors.adminId);
      const before = { ...(await rRow(rid)), ...(await counts(rid)) };
      const c = await as(actors.adminId);
      const err = await failure(c.query(SET, [rid, value, REASON]));
      expect(err.code).toBe('42501');
      expect(err.message).toMatch(/commission_self_adjust_not_allowed/);
      expect({ ...(await rRow(rid)), ...(await counts(rid)) }).toEqual(before);
    });

    it('another admin still adjusts that remittance, and any admin adjusts a customer remittance', async () => {
      await setRole(actors.customerId, 'admin');
      const own = await seedR(actors.adminId);
      const c = await as(actors.customerId);
      expect((await c.query(SET, [own, 6, REASON])).rows[0].commission_total).toBe('6.00');
      await setRole(actors.customerId, 'user');
      const theirs = await seedR(actors.customerId);
      const a = await as(actors.adminId);
      expect((await a.query(SET, [theirs, 1, REASON])).rows[0].commission_total).toBe('1.00');
      expect((await counts(theirs)).proposals).toBe(1);
    });

    it('belt: a proposal cannot be accepted when created_by = responded_by', async () => {
      const rid = await seedR(actors.customerId);
      const ins = (createdBy) =>
        admin.query(
          `INSERT INTO public.remittance_commission_proposals (remittance_id, direction, baseline_commission, new_commission, status, created_by)
           VALUES ($1,'increase',2.5,6,'pending',$2) RETURNING id`,
          [rid, createdBy]
        );
      const same = (await ins(actors.customerId)).rows[0].id;
      const err = await failure(
        admin.query(`UPDATE public.remittance_commission_proposals SET status='accepted', responded_by = created_by, responded_at = now() WHERE id = $1`, [same])
      );
      expect(err.code).toBe('42501');
      await admin.query('DELETE FROM public.remittance_commission_proposals WHERE id = $1', [same]);
      const other = (await ins(actors.adminId)).rows[0].id;
      await admin.query(
        `UPDATE public.remittance_commission_proposals SET status='accepted', responded_by = $2, responded_at = now() WHERE id = $1`,
        [other, actors.customerId]
      );
    });
  });

  describe('(b) orders', () => {
    it('is_admin_user() resolves inside the BEFORE trigger: an admin-owner is blocked on validate_payment', async () => {
      const id = await seedO(actors.adminId, 'pending', 'proof_uploaded');
      const err = await failure(call(await as(actors.adminId), 'order_validate_payment', [id]));
      expect(err.code).toBe('42501');
      expect(err.message).toMatch(BLOCKED);
      expect(await oRow(id)).toEqual({ status: 'pending', payment_status: 'proof_uploaded' });
    });

    it('admin-owner matrix: every action x status x payment_status', async () => {
      const wrong = [];
      for (const spec of ORDER_ACTIONS) {
        for (const s of ORDER_STATUSES) {
          for (const p of ORDER_PAYMENTS) {
            const id = await seedO(actors.adminId, s, p);
            const label = `${spec.fn} ${s}/${p}`;
            try {
              await call(await as(actors.adminId), spec.fn, [id, ...spec.args]);
              if (!(spec.rpcOk(s, p) && spec.trig(s, p))) wrong.push(`${label}: should have been refused`);
            } catch (e) {
              if (!spec.rpcOk(s, p)) {
                if (e.code !== '22023') wrong.push(`${label}: wrong error ${e.code} ${e.message}`);
              } else if (spec.trig(s, p)) {
                wrong.push(`${label}: refused (${e.message})`);
              } else if (e.code !== '42501' || !BLOCKED.test(e.message)) {
                wrong.push(`${label}: wrong error ${e.code} ${e.message}`);
              } else if (JSON.stringify(await oRow(id)) !== JSON.stringify({ status: s, payment_status: p })) {
                wrong.push(`${label}: row changed despite refusal`);
              }
            }
          }
        }
      }
      expect(wrong).toEqual([]);
    });

    it('another admin on an admin-owned order, and a customer on his own order: unchanged behaviour', async () => {
      const wrong = [];
      await setRole(actors.customerId, 'admin');
      for (const spec of ORDER_ACTIONS.filter((a) => !a.ownerOnly)) {
        for (const s of ORDER_STATUSES) {
          for (const p of ORDER_PAYMENTS) {
            const id = await seedO(actors.adminId, s, p);
            try {
              await call(await as(actors.customerId), spec.fn, [id, ...spec.args]);
              if (!spec.rpcOk(s, p)) wrong.push(`other-admin ${spec.fn} ${s}/${p}: should have been refused`);
            } catch (e) {
              if (spec.rpcOk(s, p)) wrong.push(`other-admin ${spec.fn} ${s}/${p}: refused (${e.message})`);
            }
          }
        }
      }
      await setRole(actors.customerId, 'user');
      for (const spec of ORDER_ACTIONS.filter((a) => !a.adminOnly)) {
        const ok = spec.customerOk ?? spec.rpcOk;
        for (const s of ORDER_STATUSES) {
          for (const p of ORDER_PAYMENTS) {
            const id = await seedO(actors.customerId, s, p);
            try {
              await call(await as(actors.customerId), spec.fn, [id, ...spec.args]);
              if (!ok(s, p)) wrong.push(`customer ${spec.fn} ${s}/${p}: should have been refused`);
            } catch (e) {
              if (ok(s, p)) wrong.push(`customer ${spec.fn} ${s}/${p}: refused (${e.message})`);
            }
          }
        }
      }
      expect(wrong).toEqual([]);
    });

    it('postgres and a service-role style session (claims without sub, auth.uid() NULL) are not affected, even on an admin-owned order', async () => {
      const a = await seedO(actors.adminId, 'pending', 'proof_uploaded');
      await admin.query(`UPDATE public.orders SET status = 'processing', payment_status = 'validated' WHERE id = $1`, [a]);
      expect(await oRow(a)).toEqual({ status: 'processing', payment_status: 'validated' });
      const b = await seedO(actors.adminId, 'pending', 'proof_uploaded');
      const svc = await connectAdmin();
      clients.push(svc);
      await svc.query(`SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false)`);
      // No SET ROLE: the local clone has no table GRANTs for service_role; what matters is auth.uid() IS NULL.
      await svc.query(`UPDATE public.orders SET status = 'processing', payment_status = 'validated' WHERE id = $1`, [b]);
      expect(await oRow(b)).toEqual({ status: 'processing', payment_status: 'validated' });
    });

    it('non-status updates by the admin-owner are not touched by the guard (notes)', async () => {
      const id = await seedO(actors.adminId, 'pending', 'pending');
      await (await as(actors.adminId)).query(`UPDATE public.orders SET notes = 'x' WHERE id = $1`, [id]);
    });
  });

  describe('(b) remittances', () => {
    it('admin-owner matrix: every action x status', async () => {
      const wrong = [];
      for (const spec of REM_ACTIONS) {
        for (const s of REM_STATUSES) {
          const id = await seedR(actors.adminId, s);
          const label = `${spec.fn} ${s}`;
          try {
            await call(await as(actors.adminId), spec.fn, [id, ...spec.args]);
            if (!(spec.rpcOk(s) && spec.trig(s))) wrong.push(`${label}: should have been refused`);
          } catch (e) {
            if (!spec.rpcOk(s)) {
              if (e.code !== '22023') wrong.push(`${label}: wrong error ${e.code} ${e.message}`);
            } else if (spec.trig(s)) {
              wrong.push(`${label}: refused (${e.message})`);
            } else if (e.code !== '42501' || !BLOCKED.test(e.message)) {
              wrong.push(`${label}: wrong error ${e.code} ${e.message}`);
            } else if ((await rRow(id)).status !== s) {
              wrong.push(`${label}: row changed despite refusal`);
            }
          }
        }
      }
      expect(wrong).toEqual([]);
    });

    it('another admin on an admin-owned remittance, and a customer on his own: unchanged behaviour', async () => {
      const wrong = [];
      await setRole(actors.customerId, 'admin');
      for (const spec of REM_ACTIONS.filter((a) => !a.ownerOnly)) {
        for (const s of REM_STATUSES) {
          const id = await seedR(actors.adminId, s);
          try {
            await call(await as(actors.customerId), spec.fn, [id, ...spec.args]);
            if (!spec.rpcOk(s)) wrong.push(`other-admin ${spec.fn} ${s}: should have been refused`);
          } catch (e) {
            if (spec.rpcOk(s)) wrong.push(`other-admin ${spec.fn} ${s}: refused (${e.message})`);
          }
        }
      }
      await setRole(actors.customerId, 'user');
      for (const spec of REM_ACTIONS.filter((a) => !a.adminOnly)) {
        for (const s of REM_STATUSES) {
          const id = await seedR(actors.customerId, s);
          try {
            await call(await as(actors.customerId), spec.fn, [id, ...spec.args]);
            if (!spec.rpcOk(s)) wrong.push(`customer ${spec.fn} ${s}: should have been refused`);
          } catch (e) {
            if (spec.rpcOk(s)) wrong.push(`customer ${spec.fn} ${s}: refused (${e.message})`);
          }
        }
      }
      expect(wrong).toEqual([]);
    });

    it('postgres and a service-role style session (claims without sub, auth.uid() NULL) are not affected on an admin-owned remittance', async () => {
      const a = await seedR(actors.adminId, 'payment_proof_uploaded');
      await admin.query(`UPDATE public.remittances SET status = 'payment_validated' WHERE id = $1`, [a]);
      expect((await rRow(a)).status).toBe('payment_validated');
      const b = await seedR(actors.adminId, 'payment_proof_uploaded');
      const svc = await connectAdmin();
      clients.push(svc);
      await svc.query(`SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false)`);
      // No SET ROLE: the local clone has no table GRANTs for service_role; what matters is auth.uid() IS NULL.
      await svc.query(`UPDATE public.remittances SET status = 'payment_validated' WHERE id = $1`, [b]);
      expect((await rRow(b)).status).toBe('payment_validated');
    });
  });
  describe('review hardening', () => {
    it('a super_admin owner is blocked too, on orders and remittances', async () => {
      await setRole(actors.adminId, 'super_admin');
      const o = await seedO(actors.adminId, 'pending', 'proof_uploaded');
      const e1 = await failure(call(await as(actors.adminId), 'order_validate_payment', [o]));
      expect([e1.code, BLOCKED.test(e1.message)]).toEqual(['42501', true]);
      const r = await seedR(actors.adminId, 'payment_proof_uploaded');
      const e2 = await failure(call(await as(actors.adminId), 'remittance_validate_payment', [r]));
      expect([e2.code, BLOCKED.test(e2.message)]).toEqual(['42501', true]);
    });

    it('a disabled admin-owner is refused by the RPC itself (user_disabled), not let through by the guard', async () => {
      const o = await seedO(actors.adminId, 'pending', 'proof_uploaded');
      await admin.query('UPDATE public.user_profiles SET is_enabled = false WHERE id = $1', [actors.adminId]);
      const err = await failure(call(await as(actors.adminId), 'order_validate_payment', [o]));
      expect(err.code).toBe('42501');
      expect(err.message).toMatch(/user_disabled/);
      expect(await oRow(o)).toEqual({ status: 'pending', payment_status: 'proof_uploaded' });
    });

    it('stock-managed orders: the admin-owner can still cancel and reopen like a customer', async () => {
      const { productId } = await seedProduct(admin, actors, tracker, { quantity: 5 });
      const o = await seedOrder(admin, actors, tracker, [{ type: 'product', id: productId, quantity: 1 }],
        { userId: actors.adminId, status: 'pending', paymentStatus: 'pending', stockManaged: true });
      const c = await as(actors.adminId);
      expect((await call(c, 'order_cancel', [o, 'changed my mind'])).status).toBe('cancelled');
      expect((await call(c, 'order_reopen', [o])).status).toBe('pending');
    });

    it('an admin-owner cancel still opens the refund request, and the reopen closes it (order and remittance)', async () => {
      const o = await seedO(actors.adminId, 'pending', 'proof_uploaded');
      const c = await as(actors.adminId);
      await call(c, 'order_cancel', [o, 'changed my mind']);
      expect((await refundsOf(o)).map((x) => x.status)).toEqual(['pending']);
      await call(c, 'order_reopen', [o]);
      expect(await refundsOf(o)).toEqual([{ status: 'not_applicable', resolution_reason: 'reopened' }]);

      const r = await seedR(actors.adminId, 'payment_proof_uploaded');
      await call(c, 'remittance_cancel', [r, 'changed my mind']);
      expect((await refundsOf(r)).map((x) => x.status)).toEqual(['pending']);
    });

    it('KNOWN GAP (documented, NOT closed): an admin can still reassign user_id of an order through a direct UPDATE', async () => {
      // The guards key on OLD.user_id, so moving the row to another owner first sidesteps them. Proposed mitigation (needs owner approval):
      // BEFORE UPDATE OF user_id for current_user IN ('authenticated','anon'). See plan, "Brechas residuales aceptadas".
      const o = await seedO(actors.adminId, 'pending', 'proof_uploaded');
      const c = await as(actors.adminId);
      const res = await c.query('UPDATE public.orders SET user_id = $2 WHERE id = $1', [o, actors.customerId]);
      expect(res.rowCount).toBe(1);
      // now the former owner is "another admin" for the guard: validation goes through
      expect((await call(c, 'order_validate_payment', [o])).payment_status).toBe('validated');
    });
  });
});
