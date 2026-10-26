/**
 * Courier management, M3 (20261031120000_courier_payments_and_report.sql): courier_payments (immutable evidence of a
 * payment, amount computed by the server) and admin_courier_report (aggregates by courier and period).
 * All amounts are TEST values passed through the admin RPCs; nothing is seeded by the migrations.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { dbSuiteSkipReason, connectAdmin, endAll, fireTogether } from './db';
import { loadActors } from './fixtures';
import { MIGRATIONS, ROLLBACKS, failure, readSql, makeKit } from './courierTestKit';

const skipReason = await dbSuiteSkipReason({
  functions: ['is_admin_user', 'remittance_confirm_delivery', 'order_mark_delivered'],
  tables: ['remittances', 'orders']
});
const describeDb = skipReason ? describe.skip : describe;

describe('M3 migration hygiene (static)', () => {
  const sql = readSql(MIGRATIONS.m3);
  it('transaction, lock_timeout, rollback documented, M1/M2 first, search_path pinned', () => {
    const head = sql.split('\n').slice(0, 60).join('\n');
    expect(head).toMatch(/ROLLBACK/);
    expect(head).toMatch(/Apply order: M1/);
    expect(sql).toMatch(/^BEGIN;/m);
    expect(sql).toMatch(/SET LOCAL lock_timeout/);
    expect(sql.trimEnd().endsWith('COMMIT;')).toBe(true);
    expect(sql).toMatch(/SET search_path = public, pg_temp/);
    expect(() => readSql(ROLLBACKS.m3)).not.toThrow();
  });
  it('rollback files document the order M3 -> M2 -> M1', () => {
    for (const k of ['m1', 'm2', 'm3']) expect(readSql(ROLLBACKS[k]).split('\n').slice(0, 6).join('\n')).toMatch(/M3 -> M2 -> M1/);
  });
});

describeDb('M3: payments and report (local Postgres)', () => {
  let admin;
  let actors;
  let kit;
  let typeId;

  beforeAll(async () => {
    admin = await connectAdmin();
    actors = await loadActors(admin);
    kit = makeKit(admin, actors);
  });
  afterEach(async () => {
    await kit.cleanup();
    typeId = undefined;
  });
  afterAll(async () => {
    await endAll([admin]);
  });

  const adminClient = () => kit.as(actors.adminId);
  const rem = async (o = {}) => {
    typeId ??= await kit.seedType();
    return kit.seedRemittance({ typeId, ...o });
  };
  /** Delivers a remittance (optionally assigned) and returns its accrual id. */
  const deliverRem = async (courierId = null, o = {}) => {
    const id = await rem(o);
    if (courierId) await kit.call(await adminClient(), 'admin_assign_delivery_courier', ['remittance', id, courierId]);
    await kit.deliverRemittance(id);
    return (await kit.accruals(id))[0].id;
  };
  const deliverOrder = async (courierId = null) => {
    const id = await kit.seedDispatchedOrder();
    if (courierId) await kit.call(await adminClient(), 'admin_assign_delivery_courier', ['order', id, courierId]);
    await kit.deliverOrder(id);
    return (await kit.accruals(id))[0].id;
  };
  const pay = (c, courier, ids, method = 'cash', ref = null, paidAt = null, notes = null) =>
    kit.call(c, 'admin_register_courier_payment', [courier, ids, method, ref, paidAt, notes]);
  const payRow = async (id) => (await admin.query('SELECT * FROM public.courier_payments WHERE id = $1', [id])).rows[0];
  const accrual = async (id) => (await admin.query('SELECT * FROM public.courier_accruals WHERE id = $1', [id])).rows[0];

  describe('privileges and immutability', () => {
    it('courier_payments: admin-read only, never writable by API roles, customers see nothing', async () => {
      const { rows } = await admin.query(
        `SELECT p AS priv, has_table_privilege('anon', 'public.courier_payments', p) AS anon,
                has_table_privilege('authenticated', 'public.courier_payments', p) AS auth,
                has_table_privilege('service_role', 'public.courier_payments', p) AS svc
           FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE']) p`);
      for (const r of rows) expect({ a: r.anon, s: r.svc, u: r.auth }).toEqual({ a: false, s: false, u: r.priv === 'SELECT' });
      const owner = await kit.as(actors.customerId);
      expect((await owner.query('SELECT * FROM public.courier_payments')).rowCount).toBe(0);
    });
    it('RPCs are authenticated-only DEFINER functions and refuse a customer (42501)', async () => {
      const { rows } = await admin.query(
        `SELECT proname, prosecdef, has_function_privilege('anon', p.oid, 'EXECUTE') AS anon, has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth
           FROM pg_proc p WHERE pronamespace = 'public'::regnamespace AND proname IN ('admin_register_courier_payment', 'admin_courier_report')`);
      expect(rows).toHaveLength(2);
      for (const r of rows) expect({ d: r.prosecdef, a: r.anon, u: r.auth }).toEqual({ d: true, a: false, u: true });
      const c = await kit.as(actors.customerId);
      expect((await failure(pay(c, null, ['00000000-0000-4000-8000-0000000000aa']))).code).toBe('42501');
      expect((await failure(kit.call(c, 'admin_courier_report', [null, null, null]))).code).toBe('42501');
    });
    it('a payment row cannot be updated or deleted, not even by the table owner', async () => {
      const courier = await kit.makeCourier();
      const a = await deliverRem(courier);
      await kit.setRule(await adminClient(), { fixed_cup: 200 }).catch(() => {});
      // the accrual above has no rule => unknown; build a payable one
      const c = await adminClient();
      await kit.call(c, 'admin_recalculate_accrual', [a]);
      const payment = (await pay(c, courier, [a]))[0].admin_register_courier_payment;
      expect((await failure(admin.query('UPDATE public.courier_payments SET amount_cup = 1 WHERE id = $1', [payment]))).code).toBe('42501');
      expect((await failure(admin.query('DELETE FROM public.courier_payments WHERE id = $1', [payment]))).code).toBe('42501');
    });
    it('courier_accruals.payment_id is a real FK to courier_payments', async () => {
      const a = await deliverRem();
      expect((await failure(admin.query('UPDATE public.courier_accruals SET payment_id = gen_random_uuid() WHERE id = $1', [a]))).code).toBe('23503');
    });
  });

  describe('admin_register_courier_payment', () => {
    const payable = async (courier, rule = { fixed_cup: 810 }, n = 2) => {
      const c = await adminClient();
      if (rule) await kit.setRule(c, rule).catch(() => {});
      const ids = [];
      for (let i = 0; i < n; i++) ids.push(await deliverRem(courier));
      return { c, ids };
    };

    it('pays the selected accruals: the amount is the SERVER sum, accruals become paid and point to the payment', async () => {
      const courier = await kit.makeCourier();
      const { c, ids } = await payable(courier);
      const id = (await pay(c, courier, ids, 'transfer', 'REF-1', null, 'weekly'))[0].admin_register_courier_payment;
      const p = await payRow(id);
      expect(p).toMatchObject({ courier_id: courier, amount_cup: '1620.00', amount_usd: '2.00', method: 'transfer', reference: 'REF-1', notes: 'weekly', paid_by: actors.adminId });
      expect(p.paid_at).not.toBeNull();
      for (const a of ids) expect(await accrual(a)).toMatchObject({ status: 'paid', payment_id: id });
      const audit = await admin.query(`SELECT 1 FROM public.financial_audit_log WHERE table_name = 'courier_payments' AND row_id = $1`, [id]);
      expect(audit.rowCount).toBeGreaterThan(0);
    });
    it('rejects an empty or duplicated list, an unknown accrual and a blank or oversized method', async () => {
      const courier = await kit.makeCourier();
      const { c, ids } = await payable(courier, { fixed_cup: 810 }, 1);
      expect((await failure(pay(c, courier, []))).code).toBe('22023');
      expect((await failure(pay(c, courier, [ids[0], ids[0]]))).code).toBe('22023');
      expect((await failure(pay(c, courier, ['00000000-0000-4000-8000-0000000000aa']))).code).toBe('22023');
      expect((await failure(pay(c, courier, ids, '  '))).code).toBe('22023');
      expect((await failure(pay(c, courier, ids, 'x'.repeat(51)))).code).toBe('22023');
      expect((await failure(pay(c, courier, ids, 'cash', 'r'.repeat(201)))).code).toBe('22023');
      expect((await failure(pay(c, courier, ids, 'cash', null, new Date(Date.now() + 86_400_000).toISOString()))).code).toBe('22023');
      expect((await accrual(ids[0])).status).toBe('calculated');
    });
    it('rejects accruals of another courier, unknown-amount accruals, already paid and void ones', async () => {
      const a1 = await kit.makeCourier();
      const a2 = await kit.makeCourier();
      const { c, ids } = await payable(a1, { fixed_cup: 810 }, 3);
      expect((await failure(pay(c, a2, [ids[0]]))).code).toBe('22023'); // belongs to a1
      await pay(c, a1, [ids[0]]);
      expect((await failure(pay(c, a1, [ids[0]]))).code).toBe('22023'); // already paid
      await kit.call(c, 'admin_void_accrual', [ids[1], 'void this one for the test']);
      expect((await failure(pay(c, a1, [ids[1]]))).code).toBe('22023'); // void
      await admin.query('UPDATE public.courier_accruals SET amount_cup = NULL, amount_usd = NULL WHERE id = $1', [ids[2]]);
      expect((await failure(pay(c, a1, [ids[2]]))).code).toBe('22023'); // unknown amount is never paid
    });
    it('a zero total is refused (nothing to pay)', async () => {
      const courier = await kit.makeCourier();
      const { c, ids } = await payable(courier, { fixed_cup: 0 }, 1);
      expect((await failure(pay(c, courier, ids))).code).toBe('22023');
    });
    it('dual mode: accruals without courier are paid with a NULL courier; mixing couriers is refused', async () => {
      const courier = await kit.makeCourier();
      const c = await adminClient();
      await kit.setRule(c, { fixed_cup: 810 });
      const anon1 = await deliverRem(null);
      const mine = await deliverRem(courier);
      expect((await failure(pay(c, null, [anon1, mine]))).code).toBe('22023');
      expect((await failure(pay(c, courier, [anon1]))).code).toBe('22023');
      const id = (await pay(c, null, [anon1]))[0].admin_register_courier_payment;
      expect((await payRow(id)).courier_id).toBeNull();
    });
    it('a negative adjustment nets against a later payment', async () => {
      const courier = await kit.makeCourier();
      const { c, ids } = await payable(courier, { fixed_cup: 810 }, 2);
      await pay(c, courier, [ids[0]]);
      await kit.setRole(actors.adminId, 'super_admin');
      const sup = await kit.as(actors.adminId);
      const adj = (await kit.call(sup, 'admin_adjust_accrual', [ids[0], -100, 'overpaid by one hundred']))[0].admin_adjust_accrual;
      const id = (await pay(sup, courier, [ids[1], adj]))[0].admin_register_courier_payment;
      expect((await payRow(id)).amount_cup).toBe('710.00');
      expect((await accrual(adj)).status).toBe('paid');
    });
    it('the same accrual paid twice at the same instant: exactly one payment wins', async () => {
      const courier = await kit.makeCourier();
      const { ids } = await payable(courier, { fixed_cup: 810 }, 1);
      const a = await adminClient();
      const b = await adminClient();
      const sql = `public.admin_register_courier_payment('${courier}'::uuid, ARRAY['${ids[0]}']::uuid[], 'cash', NULL, NULL, NULL)::text`;
      const res = await fireTogether([{ client: a, sql }, { client: b, sql }]);
      expect(res.filter((r) => r.error).length).toBe(1);
      expect((await admin.query('SELECT count(*)::int AS n FROM public.courier_payments')).rows[0].n).toBe(1);
    });
  });

  describe('admin_courier_report', () => {
    const window = () => [new Date(Date.now() - 3600_000).toISOString(), new Date(Date.now() + 3600_000).toISOString()];
    const report = async (c, courierId = null) => (await kit.call(c, 'admin_courier_report', [...window(), courierId]));
    const byCourier = (rows, id) => rows.find((r) => r.courier_id === id);

    const scenario = async () => {
      const c = await adminClient();
      await kit.seedUsdCupRate(830);
      await kit.setRule(c, { code: 'rem', applies_to: 'remittance', fixed_cup: 810 });
      await kit.setRule(c, { code: 'ord', applies_to: 'order', fixed_cup: 830 });
      const A = await kit.makeCourier('Courier A');
      const B = await kit.makeCourier('Courier B');
      const r1 = await deliverRem(A);
      const r2 = await deliverRem(A);
      const o1 = await deliverOrder(A);
      const r3 = await deliverRem(B);
      const r4 = await deliverRem(null);
      return { c, A, B, r1, r2, o1, r3, r4 };
    };

    it('aggregates deliveries, amounts and states per courier (and the unassigned group)', async () => {
      const { c, A, B } = await scenario();
      const rows = await report(c);
      expect(byCourier(rows, A)).toMatchObject({
        courier_name: 'Courier A', remittance_deliveries: 2, order_deliveries: 1, remittance_amount_sent_usd: '200.00',
        accrued_cup: '2450.00', accrued_usd: '3.00', paid_cup: '0', pending_cup: '2450.00', voided_cup: '0',
        voided_after_payment_cup: '0', unknown_amount_count: 0
      });
      expect(byCourier(rows, B)).toMatchObject({ remittance_deliveries: 1, order_deliveries: 0, accrued_cup: '810.00' });
      expect(byCourier(rows, null)).toMatchObject({ courier_name: null, remittance_deliveries: 1, accrued_cup: '810.00' });
    });
    it('splits paid / pending / void, and shows what was voided AFTER being paid', async () => {
      const { c, A, r1, r2, o1 } = await scenario();
      await pay(c, A, [r1, r2]);
      await kit.call(c, 'admin_void_accrual', [o1, 'void the order accrual here']);
      let a = byCourier(await report(c), A);
      expect(a).toMatchObject({ paid_cup: '1620.00', pending_cup: '0', voided_cup: '830.00', accrued_cup: '1620.00', order_deliveries: 0, remittance_deliveries: 2 });
      await kit.setRole(actors.adminId, 'super_admin');
      const sup = await kit.as(actors.adminId);
      await kit.call(sup, 'admin_void_accrual', [r1, 'paid by mistake, voided']);
      a = byCourier(await report(sup), A);
      expect(a).toMatchObject({ paid_cup: '810.00', voided_after_payment_cup: '810.00', accrued_cup: '810.00', remittance_deliveries: 1 });
    });
    it('filters by courier and by period (delivered_at, upper bound exclusive)', async () => {
      const { c, A, B, r3 } = await scenario();
      const only = await report(c, B);
      expect(only.map((r) => r.courier_id)).toEqual([B]);
      await admin.query(`UPDATE public.courier_accruals SET delivered_at = now() - interval '10 days' WHERE id = $1`, [r3]);
      expect(byCourier(await report(c), B)).toBeUndefined();
      const past = await kit.call(c, 'admin_courier_report', [new Date(Date.now() - 11 * 86_400_000).toISOString(), new Date(Date.now() - 9 * 86_400_000).toISOString(), null]);
      expect(past.map((r) => r.courier_id)).toEqual([B]);
      expect(A).toBeTruthy();
    });
    it('unknown amounts are counted apart, never added as 0 to the totals; margin flags are counted by level', async () => {
      const c = await adminClient();
      const courier = await kit.makeCourier();
      await deliverRem(courier); // no rule: unknown
      await kit.call(c, 'admin_set_margin_thresholds', ['remittance', null, 3, 0]);
      await kit.setRule(c, { fixed_cup: 2000 }); // loss => critical
      await deliverRem(courier);
      const row = byCourier(await report(c), courier);
      expect(row).toMatchObject({ unknown_amount_count: 1, accrued_cup: '2000.00', margin_critical_count: 1, margin_warning_count: 0 });
      expect(row.margin_unknown_count).toBe(1);
    });
    it('exposes aggregates only: no customer, recipient or operation identifiers', async () => {
      const { c } = await scenario();
      const rows = await report(c);
      const cols = Object.keys(rows[0]);
      expect(cols.filter((k) => /user|customer|recipient|phone|remittance_id|order_id|source_id/.test(k))).toEqual([]);
    });
  });

  describe('rollback guard: real payment data is never dropped by accident', () => {
    it.each(['m1', 'm2', 'm3'])('%s rollback documents the mandatory export step in its header', (k) => {
      expect(readSql(ROLLBACKS[k]).split('\n').slice(0, 12).join('\n')).toMatch(/MANDATORY[\s\S]*(COPY|export)/i);
    });
    it('aborts with a clear error while courier_payments has rows, unless the session confirmation is set', async () => {
      const courier = await kit.makeCourier();
      const c = await adminClient();
      await kit.setRule(c, { fixed_cup: 810 });
      const a = await deliverRem(courier);
      await pay(c, courier, [a]);
      const body = readSql(ROLLBACKS.m3).replace(/^\s*(BEGIN|COMMIT);\s*$/gm, '');
      await admin.query('BEGIN');
      try {
        const err = await failure(admin.query(body));
        expect(err.message).toMatch(/courier_payments has rows.*app\.confirm_courier_rollback/);
      } finally {
        await admin.query('ROLLBACK');
      }
      await admin.query('BEGIN');
      try {
        await admin.query(`SET LOCAL app.confirm_courier_rollback = 'yes'`);
        await admin.query(body);
        expect((await admin.query(`SELECT to_regclass('public.courier_payments') IS NULL AS g`)).rows[0].g).toBe(true);
      } finally {
        await admin.query('ROLLBACK');
      }
      expect((await admin.query('SELECT count(*)::int AS n FROM public.courier_payments')).rows[0].n).toBe(1);
    });
  });

  describe('rollback of M3 (executed inside a transaction that is rolled back)', () => {
    it('drops payments, the FK and the report; accruals stay', async () => {
      const body = readSql(ROLLBACKS.m3).replace(/^\s*(BEGIN|COMMIT);\s*$/gm, '');
      await admin.query('BEGIN');
      try {
        await admin.query(`SET LOCAL app.confirm_courier_rollback = 'yes'`);
        await admin.query(body);
        const { rows } = await admin.query(
          `SELECT to_regclass('public.courier_payments') IS NULL AS p,
                  to_regproc('public.admin_courier_report') IS NULL AS r,
                  to_regclass('public.courier_accruals') IS NOT NULL AS acc,
                  NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'courier_accruals_payment_fk') AS nofk`);
        expect(rows[0]).toEqual({ p: true, r: true, acc: true, nofk: true });
      } finally {
        await admin.query('ROLLBACK');
      }
    });
    it('M3 -> M2 -> M1 in reverse order leaves none of the courier objects', async () => {
      await admin.query('BEGIN');
      try {
        await admin.query(`SET LOCAL app.confirm_courier_rollback = 'yes'`);
        for (const k of ['m3', 'm2', 'm1']) await admin.query(readSql(ROLLBACKS[k]).replace(/^\s*(BEGIN|COMMIT);\s*$/gm, ''));
        const { rows } = await admin.query(
          `SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND c.relname IN ('couriers','messenger_payment_types','courier_margin_settings','delivery_assignments','courier_accruals','courier_payments','v_effective_courier_cost')`);
        expect(rows[0].n).toBe(0);
        const fns = await admin.query(
          `SELECT count(*)::int AS n FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND (proname LIKE '\\_courier\\_%' OR proname LIKE 'admin\\_%courier%' OR proname = '_operation_margin' OR proname LIKE '%accrual%' OR proname LIKE '%messenger%')`);
        expect(fns.rows[0].n).toBe(0);
      } finally {
        await admin.query('ROLLBACK');
      }
    });
  });
});
