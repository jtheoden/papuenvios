/**
 * Courier management, M2 (20261031110000_delivery_assignments_and_accruals.sql): delivery assignment, one accrual per
 * delivery written by an AFTER UPDATE OF status trigger that NEVER blocks the delivery, the single effective cost,
 * void / adjust / reassign / recalculate, late-accrual detection and the persisted margin flag.
 *
 * OWNER RULE: nothing is seeded; with no rule the accrual amount is NULL (unknown), never 0. All values below are TEST values.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { dbSuiteSkipReason, connectAdmin, endAll, fireTogether } from './db';
import { loadActors } from './fixtures';
import { MIGRATIONS, ROLLBACKS, failure, readSql, makeKit } from './courierTestKit';

const skipReason = await dbSuiteSkipReason({
  functions: ['is_admin_user', 'remittance_confirm_delivery', 'order_mark_delivered'],
  tables: ['remittances', 'orders', 'order_courier_costs', 'remittance_courier_costs']
});
const describeDb = skipReason ? describe.skip : describe;

describe('M2 migration hygiene (static)', () => {
  const sql = readSql(MIGRATIONS.m2);
  it('runs in a transaction, documents rollback and M1-first order, pins search_path', () => {
    expect(sql.split('\n').slice(0, 60).join('\n')).toMatch(/ROLLBACK/);
    expect(sql.split('\n').slice(0, 60).join('\n')).toMatch(/Apply order: M1/);
    expect(sql).toMatch(/^BEGIN;/m);
    expect(sql).toMatch(/SET LOCAL lock_timeout/);
    expect(sql.trimEnd().endsWith('COMMIT;')).toBe(true);
    expect(sql).toMatch(/SET search_path = public, pg_temp/);
    expect(() => readSql(ROLLBACKS.m2)).not.toThrow();
  });
  it('does not replace the transition functions and adds no column to orders / remittances', () => {
    expect(sql).not.toMatch(/FUNCTION public\._(order|remittance)_transition/);
    expect(sql).not.toMatch(/ALTER TABLE public\.(orders|remittances)\s+ADD/i);
  });
  it('the trigger function swallows its own errors as a WARNING', () => {
    const fn = sql.match(/FUNCTION public\._courier_accrue_on_delivered[\s\S]*?\$function\$;/)[0];
    expect(fn).toMatch(/EXCEPTION\s+WHEN OTHERS THEN/);
    expect(fn).toMatch(/RAISE WARNING/);
  });
});

describeDb('M2: assignments, accruals, effective cost (local Postgres)', () => {
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
    await admin.query('DROP TRIGGER IF EXISTS courier_test_boom ON public.courier_accruals');
    await admin.query('DROP FUNCTION IF EXISTS public.courier_test_boom()');
    await kit.cleanup();
    typeId = undefined;
  });
  afterAll(async () => {
    await endAll([admin]);
  });

  const rem = async (o = {}) => {
    typeId ??= await kit.seedType();
    return kit.seedRemittance({ typeId, ...o });
  };
  const adminClient = () => kit.as(actors.adminId);
  const one = async (opId) => {
    const rows = await kit.accruals(opId);
    expect(rows).toHaveLength(1);
    return rows[0];
  };

  describe('privileges', () => {
    it.each(['delivery_assignments', 'courier_accruals'])('%s: admin-read only, never writable by API roles', async (table) => {
      const { rows } = await admin.query(
        `SELECT p AS priv, has_table_privilege('anon', $1, p) AS anon, has_table_privilege('authenticated', $1, p) AS auth,
                has_table_privilege('service_role', $1, p) AS svc
           FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE']) p`, [`public.${table}`]);
      for (const r of rows) expect({ a: r.anon, s: r.svc, u: r.auth }).toEqual({ a: false, s: false, u: r.priv === 'SELECT' });
    });
    it('the delivering customer (owner of the remittance) reads no accrual, no assignment and no effective cost', async () => {
      const id = await rem();
      await kit.deliverRemittance(id);
      const owner = await kit.as(actors.customerId);
      for (const t of ['courier_accruals', 'delivery_assignments', 'v_effective_courier_cost']) {
        expect((await owner.query(`SELECT * FROM public.${t}`)).rowCount).toBe(0);
      }
      const adminRows = await (await adminClient()).query('SELECT * FROM public.v_effective_courier_cost');
      expect(adminRows.rowCount).toBeGreaterThan(0);
    });
    it('RPCs: authenticated only, DEFINER; internals are not callable', async () => {
      const pub = ['admin_assign_delivery_courier', 'admin_void_accrual', 'admin_adjust_accrual', 'admin_reassign_accrual',
        'admin_recalculate_accrual', 'admin_list_deliveries_without_accrual', 'admin_backfill_missing_accruals'];
      const internal = ['_courier_compute_accrual', '_courier_create_accrual', '_courier_accrue_on_delivered'];
      const q = (names) => admin.query(
        `SELECT proname, prosecdef, has_function_privilege('anon', p.oid, 'EXECUTE') AS anon, has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth
           FROM pg_proc p WHERE pronamespace = 'public'::regnamespace AND proname = ANY($1)`, [names]);
      const a = (await q(pub)).rows;
      expect(a).toHaveLength(pub.length);
      for (const r of a) expect({ d: r.prosecdef, a: r.anon, u: r.auth }).toEqual({ d: true, a: false, u: true });
      const b = (await q(internal)).rows;
      expect(b).toHaveLength(internal.length);
      for (const r of b) expect({ a: r.anon, u: r.auth }).toEqual({ a: false, u: false });
    });
    it('EVERY internal and trigger function of the module is unreachable for anon, authenticated and service_role (catalog check)', async () => {
      const internals = ['_courier_require_admin', '_courier_audit', '_courier_rule_resolve', '_operation_margin',
        '_courier_compute_accrual', '_courier_create_accrual', '_courier_accrue_on_delivered',
        'messenger_payment_types_guard', 'courier_payments_immutable'];
      const { rows } = await admin.query(
        `SELECT proname, has_function_privilege('anon', p.oid, 'EXECUTE') AS anon, has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth,
                has_function_privilege('service_role', p.oid, 'EXECUTE') AS svc
           FROM pg_proc p WHERE pronamespace = 'public'::regnamespace AND proname = ANY($1)`, [internals]);
      expect(rows.map((r) => r.proname).sort()).toEqual([...internals].sort());
      for (const r of rows) expect({ n: r.proname, a: r.anon, u: r.auth, s: r.svc }).toEqual({ n: r.proname, a: false, u: false, s: false });
    });
    it('every RPC refuses a customer with 42501', async () => {
      const c = await kit.as(actors.customerId);
      const id = await rem();
      const ghost = '00000000-0000-4000-8000-0000000000aa';
      for (const [fn, args] of [
        ['admin_assign_delivery_courier', ['remittance', id, null]],
        ['admin_void_accrual', [ghost, 'a long enough reason']],
        ['admin_adjust_accrual', [ghost, 1, 'a long enough reason']],
        ['admin_reassign_accrual', [ghost, null, 'a long enough reason']],
        ['admin_recalculate_accrual', [ghost]],
        ['admin_list_deliveries_without_accrual', [null, null]],
        ['admin_backfill_missing_accruals', [new Date().toISOString()]]
      ]) {
        expect((await failure(kit.call(c, fn, args))).code, fn).toBe('42501');
      }
    });
  });

  describe('delivery trigger: no rule => unknown amount (NULL), the delivery always happens', () => {
    it('a remittance delivered with no rule and no courier accrues a NULL amount (never 0) in calculated state', async () => {
      const id = await rem();
      const r = (await kit.deliverRemittance(id))[0];
      expect(r.status).toBe('delivered');
      const a = await one(id);
      expect(a).toMatchObject({ remittance_id: id, order_id: null, component: 'delivery', status: 'calculated', courier_id: null, rule_id: null });
      expect(a.amount_cup).toBeNull();
      expect(a.amount_usd).toBeNull();
      expect(a.rule_snapshot).toMatchObject({ source: 'trigger', reason: 'no_rule' });
      expect(a.source_kind).toBe('remittance');
      expect(a.source_id).toBe(id);
    });
    it('same for an order, with and without delivery photo (#124): identical accrual shape', async () => {
      const o1 = await kit.seedDispatchedOrder();
      const o2 = await kit.seedDispatchedOrder();
      await kit.deliverOrder(o1, { proof: null });
      await kit.deliverOrder(o2, { proof: `${actors.adminId}/delivery/p.jpg` });
      const a1 = await one(o1);
      const a2 = await one(o2);
      for (const a of [a1, a2]) expect(a).toMatchObject({ component: 'delivery', status: 'calculated', courier_id: null, rule_id: null, amount_cup: null });
      expect(a1.source_kind).toBe('order');
    });
    it('remittance delivery with and without proof accrues the same way', async () => {
      const a = await rem();
      const b = await rem();
      await kit.deliverRemittance(a, { proof: null });
      await kit.deliverRemittance(b, { proof: `${actors.adminId}/delivery/p.jpg` });
      expect((await one(a)).status).toBe('calculated');
      expect((await one(b)).status).toBe('calculated');
    });
    it('complete (delivered -> completed) does not create a second accrual', async () => {
      const id = await rem();
      await kit.deliverRemittance(id);
      const c = await adminClient();
      expect((await kit.call(c, 'remittance_complete', [id, null]))[0].status).toBe('completed');
      expect(await kit.accruals(id)).toHaveLength(1);
    });
    it('a failing accrual NEVER blocks the delivery: WARNING only, status still delivered', async () => {
      await admin.query(`CREATE FUNCTION public.courier_test_boom() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'boom'; END $$`);
      await admin.query('CREATE TRIGGER courier_test_boom BEFORE INSERT ON public.courier_accruals FOR EACH ROW EXECUTE FUNCTION public.courier_test_boom()');
      const id = await rem();
      const c = await adminClient();
      const notices = [];
      c.on('notice', (n) => notices.push(n.message));
      const r = await kit.call(c, 'remittance_confirm_delivery', [id, null, null]);
      expect(r[0].status).toBe('delivered');
      expect(notices.join(' ')).toMatch(/courier accrual failed/i);
      expect(await kit.accruals(id)).toHaveLength(0);
      // the gap is detectable and recoverable
      await admin.query('DROP TRIGGER courier_test_boom ON public.courier_accruals');
      await kit.setRole(actors.adminId, 'super_admin');
      const missing = await kit.call(c, 'admin_list_deliveries_without_accrual', [null, null]);
      expect(missing.map((m) => m.source_id)).toContain(id);
      expect((await kit.call(c, 'admin_backfill_missing_accruals', [new Date(Date.now() - 86_400_000).toISOString()]))[0].admin_backfill_missing_accruals).toBeGreaterThanOrEqual(1);
      const a = await one(id);
      expect(a.rule_snapshot.source).toBe('late');
      // idempotent
      expect((await kit.call(c, 'admin_backfill_missing_accruals', [new Date(Date.now() - 86_400_000).toISOString()]))[0].admin_backfill_missing_accruals).toBe(0);
      expect(await kit.accruals(id)).toHaveLength(1);
      await kit.setRole(actors.adminId, 'admin');
    });
    it('a second delivery attempt (concurrent) does not duplicate: exactly one accrual', async () => {
      const id = await rem();
      const a = await adminClient();
      const b = await adminClient();
      const res = await fireTogether([
        { client: a, sql: `public.remittance_confirm_delivery('${id}'::uuid, NULL, NULL)::text` },
        { client: b, sql: `public.remittance_confirm_delivery('${id}'::uuid, NULL, NULL)::text` }
      ]);
      expect(res.filter((r) => r.error).length).toBe(1);
      expect(await kit.accruals(id)).toHaveLength(1);
    });
    it('_courier_create_accrual is idempotent (double firing yields one row)', async () => {
      const id = await rem();
      await kit.deliverRemittance(id);
      const { rows } = await admin.query(`SELECT public._courier_create_accrual('remittance', $1, 'trigger') AS id`, [id]);
      expect(rows[0].id).toBeNull();
      expect(await kit.accruals(id)).toHaveLength(1);
    });
    it('the trigger exists on both tables, AFTER UPDATE OF status, firing only when status becomes delivered', async () => {
      const { rows } = await admin.query(
        `SELECT tgrelid::regclass::text AS t, pg_get_triggerdef(oid) AS def FROM pg_trigger
          WHERE tgname = 'courier_accrual_on_delivered' AND NOT tgisinternal ORDER BY 1`);
      expect(rows.map((r) => r.t)).toEqual(['orders', 'remittances']);
      for (const r of rows) {
        expect(r.def).toMatch(/AFTER UPDATE OF status/);
        expect(r.def).toMatch(/new\.status\)?(::text)? = 'delivered'/i);
      }
    });
    it('deleting the operation (platform reset) cascades to its assignment and accruals', async () => {
      const courier = await kit.makeCourier();
      const id = await rem();
      const c = await adminClient();
      await kit.call(c, 'admin_assign_delivery_courier', ['remittance', id, courier]);
      await kit.deliverRemittance(id);
      await admin.query('DELETE FROM public.remittances WHERE id = $1', [id]);
      expect((await admin.query('SELECT 1 FROM public.courier_accruals WHERE remittance_id = $1', [id])).rowCount).toBe(0);
      expect((await admin.query('SELECT 1 FROM public.delivery_assignments WHERE remittance_id = $1', [id])).rowCount).toBe(0);
    });
  });

  describe('calculation per method and base (remittances: fx = the remittance own exchange_rate)', () => {
    // S=100, commission 2.4, rate 810 => amount_to_deliver = 97.6 * 810 = 79056.00
    const run = async (rule, remOpts = {}) => {
      const c = await adminClient();
      await kit.setRule(c, rule);
      const id = await rem(remOpts);
      await kit.deliverRemittance(id);
      return one(id);
    };

    it('fixed_cup: amount_cup = fixed, usd = cup / fx', async () => {
      const a = await run({ method: 'fixed_cup', fixed_cup: 200 });
      expect(a).toMatchObject({ amount_cup: '200.00', fx_used: '810.000000', amount_usd: '0.25' });
      expect(a.rule_snapshot).toMatchObject({ source: 'trigger', method: 'fixed_cup', fx_source: 'remittance' });
      expect(a.rule_id).not.toBeNull();
    });
    it('per_usd_delivered, base nominal_usd: cup_per_usd * amount_sent', async () => {
      const a = await run({ method: 'per_usd_delivered', fixed_cup: null, cup_per_usd: 1.5, base: 'nominal_usd' });
      expect(a).toMatchObject({ amount_cup: '150.00', amount_usd: '0.19' });
    });
    it('per_usd_delivered, base delivered_cup: cup_per_usd * (amount_to_deliver / rate)', async () => {
      const a = await run({ method: 'per_usd_delivered', fixed_cup: null, cup_per_usd: 1, base: 'delivered_cup' });
      expect(a).toMatchObject({ amount_cup: '97.60', amount_usd: '0.12' });
    });
    it('per_usd_delivered on delivered_cup needs the sent currency to be USD: otherwise unknown (NULL), never a wrong amount', async () => {
      const a = await run({ method: 'per_usd_delivered', fixed_cup: null, cup_per_usd: 1, base: 'delivered_cup' }, { sent: 'EUR' });
      expect(a.amount_cup).toBeNull();
      expect(a.rule_snapshot.reason).toBe('no_amount_basis');
    });
    it('percent_of_base, nominal_usd: percent of amount_sent converted at the rate', async () => {
      const a = await run({ method: 'percent_of_base', fixed_cup: null, percent: 2, base: 'nominal_usd' });
      expect(a).toMatchObject({ amount_cup: '1620.00', amount_usd: '2.00' });
    });
    it('percent_of_base, delivered_cup: percent of amount_to_deliver', async () => {
      const a = await run({ method: 'percent_of_base', fixed_cup: null, percent: 0.5, base: 'delivered_cup' });
      expect(a).toMatchObject({ amount_cup: '395.28', amount_usd: '0.49' });
    });
    it('a zero-valued rule is a KNOWN zero (not unknown)', async () => {
      const a = await run({ method: 'fixed_cup', fixed_cup: 0 });
      expect(a).toMatchObject({ amount_cup: '0.00', amount_usd: '0.00' });
    });
    it('delivered_cup base on a remittance not delivered in CUP is unknown (NULL), with the reason in the snapshot', async () => {
      typeId = await kit.seedType({ delivery: 'USD' });
      const a = await run({ method: 'percent_of_base', fixed_cup: null, percent: 1, base: 'delivered_cup' },
        { delivered: 'USD', rate: 1 });
      expect(a.amount_cup).toBeNull();
      expect(a.rule_id).not.toBeNull();
      expect(a.rule_snapshot.reason).toBe('no_amount_basis');
    });
    it('remittance not delivered in CUP falls back to the active USD->CUP rate for the USD figure; none => usd NULL, cup kept', async () => {
      typeId = await kit.seedType({ delivery: 'USD' });
      const c = await adminClient();
      await kit.setRule(c, { method: 'fixed_cup', fixed_cup: 200 });
      const a = await rem({ delivered: 'USD', rate: 1 });
      await kit.deliverRemittance(a);
      expect(await one(a)).toMatchObject({ amount_cup: '200.00', amount_usd: null, fx_used: null });
      await kit.seedUsdCupRate(830);
      const b = await rem({ delivered: 'USD', rate: 1 });
      await kit.deliverRemittance(b);
      expect(await one(b)).toMatchObject({ amount_cup: '200.00', fx_used: '830.000000', amount_usd: '0.24' });
      expect((await one(b)).rule_snapshot.fx_source).toBe('exchange_rates');
    });
    it('orders use the active exchange_rates USD->CUP rate; without one the USD figure is NULL (never 0, never an error)', async () => {
      const c = await adminClient();
      await kit.setRule(c, { applies_to: 'order', method: 'fixed_cup', fixed_cup: 150 });
      const o1 = await kit.seedDispatchedOrder();
      await kit.deliverOrder(o1);
      expect(await one(o1)).toMatchObject({ amount_cup: '150.00', amount_usd: null, fx_used: null });
      await kit.seedUsdCupRate(830);
      const o2 = await kit.seedDispatchedOrder();
      await kit.deliverOrder(o2);
      expect(await one(o2)).toMatchObject({ amount_cup: '150.00', fx_used: '830.000000', amount_usd: '0.18' });
    });
    it('tier (a,b] uses amount_sent for remittances', async () => {
      const c = await adminClient();
      await kit.setRule(c, { code: 'general', fixed_cup: 100 });
      await kit.setRule(c, { code: 'tier', fixed_cup: 300, amount_from: 50, amount_to: 100 });
      const a = await rem({ amount: 100 });
      const b = await rem({ amount: 50 });
      await kit.deliverRemittance(a);
      await kit.deliverRemittance(b);
      expect((await one(a)).amount_cup).toBe('300.00');
      expect((await one(b)).amount_cup).toBe('100.00');
    });
  });

  describe('versioning does not rewrite past accruals', () => {
    it('a new rate version applies only to later deliveries; an earlier accrual keeps its frozen rule and amount', async () => {
      const c = await adminClient();
      await kit.setRule(c, { code: 'g', fixed_cup: 200 });
      const a = await rem();
      await kit.deliverRemittance(a);
      const before = await one(a);
      await kit.setRule(c, { code: 'g', fixed_cup: 999 });
      const b = await rem();
      await kit.deliverRemittance(b);
      const after = await one(a);
      expect(after.amount_cup).toBe(before.amount_cup);
      expect(after.rule_id).toBe(before.rule_id);
      expect(after.rule_snapshot).toEqual(before.rule_snapshot);
      expect((await one(b)).amount_cup).toBe('999.00');
    });
  });

  describe('assignment and dual mode', () => {
    it('an assigned courier is recorded on the accrual and the courier rule wins over the general one', async () => {
      const c = await adminClient();
      const courier = await kit.makeCourier();
      await kit.setRule(c, { code: 'general', fixed_cup: 100 });
      await kit.setRule(c, { code: 'mine', fixed_cup: 250, courier_id: courier });
      const id = await rem();
      await kit.call(c, 'admin_assign_delivery_courier', ['remittance', id, courier]);
      await kit.deliverRemittance(id);
      expect(await one(id)).toMatchObject({ courier_id: courier, amount_cup: '250.00' });
      const other = await rem();
      await kit.deliverRemittance(other);
      expect(await one(other)).toMatchObject({ courier_id: null, amount_cup: '100.00' });
    });
    it('assign: re-assign before delivery replaces; NULL clears; inactive courier, unknown kind or id are refused', async () => {
      const c = await adminClient();
      const c1 = await kit.makeCourier();
      const c2 = await kit.makeCourier();
      const id = await rem();
      await kit.call(c, 'admin_assign_delivery_courier', ['remittance', id, c1]);
      await kit.call(c, 'admin_assign_delivery_courier', ['remittance', id, c2]);
      expect((await admin.query('SELECT courier_id FROM public.delivery_assignments WHERE remittance_id = $1', [id])).rows).toEqual([{ courier_id: c2 }]);
      await kit.call(c, 'admin_assign_delivery_courier', ['remittance', id, null]);
      expect((await admin.query('SELECT 1 FROM public.delivery_assignments WHERE remittance_id = $1', [id])).rowCount).toBe(0);
      await kit.call(c, 'admin_upsert_courier', [c1, 'Inactive', null, null, false]);
      expect((await failure(kit.call(c, 'admin_assign_delivery_courier', ['remittance', id, c1]))).code).toBe('22023');
      expect((await failure(kit.call(c, 'admin_assign_delivery_courier', ['combo', id, c2]))).code).toBe('22023');
      expect((await failure(kit.call(c, 'admin_assign_delivery_courier', ['remittance', '00000000-0000-4000-8000-0000000000aa', c2]))).code).toBe('P0002');
      const order = await kit.seedDispatchedOrder();
      await kit.call(c, 'admin_assign_delivery_courier', ['order', order, c2]);
      expect((await admin.query('SELECT courier_id FROM public.delivery_assignments WHERE order_id = $1', [order])).rows).toEqual([{ courier_id: c2 }]);
    });
    it('assignment is refused once the operation is delivered (the amount is frozen at delivery)', async () => {
      const c = await adminClient();
      const courier = await kit.makeCourier();
      const id = await rem();
      await kit.deliverRemittance(id);
      expect((await failure(kit.call(c, 'admin_assign_delivery_courier', ['remittance', id, courier]))).code).toBe('22023');
      const order = await kit.seedDispatchedOrder();
      await kit.deliverOrder(order);
      expect((await failure(kit.call(c, 'admin_assign_delivery_courier', ['order', order, courier]))).code).toBe('22023');
    });
    it('assignments and accruals are audited', async () => {
      const c = await adminClient();
      const courier = await kit.makeCourier();
      const id = await rem();
      await kit.call(c, 'admin_assign_delivery_courier', ['remittance', id, courier]);
      const { rows } = await admin.query(
        `SELECT 1 FROM public.financial_audit_log WHERE table_name = 'delivery_assignments' AND changed_by = $1`, [actors.adminId]);
      expect(rows.length).toBeGreaterThan(0);
    });
  });

  describe('void / adjust / reassign / recalculate', () => {
    const delivered = async (rule = { fixed_cup: 200 }) => {
      const c = await adminClient();
      if (rule) await kit.setRule(c, rule);
      const id = await rem();
      await kit.deliverRemittance(id);
      return { c, id, a: await one(id) };
    };
    const markPaid = (id) => admin.query(`UPDATE public.courier_accruals SET status = 'paid' WHERE id = $1`, [id]);

    it('void: admin voids a calculated accrual with a reason of 10-500 chars; stays voided; a second void is refused', async () => {
      const { c, a } = await delivered();
      expect((await failure(kit.call(c, 'admin_void_accrual', [a.id, 'short']))).code).toBe('22023');
      await kit.call(c, 'admin_void_accrual', [a.id, 'wrong delivery, voided']);
      const row = (await admin.query('SELECT status, voided_by, void_reason, voided_at FROM public.courier_accruals WHERE id = $1', [a.id])).rows[0];
      expect(row).toMatchObject({ status: 'void', voided_by: actors.adminId, void_reason: 'wrong delivery, voided' });
      expect(row.voided_at).not.toBeNull();
      expect((await failure(kit.call(c, 'admin_void_accrual', [a.id, 'wrong delivery, voided']))).code).toBe('22023');
    });
    it('void of an ALREADY PAID accrual: admin is refused (42501), super_admin may', async () => {
      const { c, a } = await delivered();
      await markPaid(a.id);
      expect((await failure(kit.call(c, 'admin_void_accrual', [a.id, 'paid by mistake here']))).code).toBe('42501');
      expect((await admin.query('SELECT status FROM public.courier_accruals WHERE id = $1', [a.id])).rows[0].status).toBe('paid');
      await kit.setRole(actors.adminId, 'super_admin');
      const sup = await kit.as(actors.adminId);
      await kit.call(sup, 'admin_void_accrual', [a.id, 'paid by mistake here']);
      expect((await admin.query('SELECT status FROM public.courier_accruals WHERE id = $1', [a.id])).rows[0].status).toBe('void');
    });
    it('adjust: only on a paid accrual and only for super_admin; creates a signed adjustment row linked to the original', async () => {
      const { c, a } = await delivered();
      await kit.setRole(actors.adminId, 'super_admin');
      const sup = await kit.as(actors.adminId);
      expect((await failure(kit.call(sup, 'admin_adjust_accrual', [a.id, -50, 'correct the amount']))).code).toBe('22023'); // not paid yet
      await markPaid(a.id);
      await kit.setRole(actors.adminId, 'admin');
      const plain = await kit.as(actors.adminId);
      expect((await failure(kit.call(plain, 'admin_adjust_accrual', [a.id, -50, 'correct the amount']))).code).toBe('42501');
      await kit.setRole(actors.adminId, 'super_admin');
      const sup2 = await kit.as(actors.adminId);
      expect((await failure(kit.call(sup2, 'admin_adjust_accrual', [a.id, 0, 'correct the amount']))).code).toBe('22023');
      expect((await failure(kit.call(sup2, 'admin_adjust_accrual', [a.id, -50, 'short']))).code).toBe('22023');
      const adjId = (await kit.call(sup2, 'admin_adjust_accrual', [a.id, -50, 'correct the amount']))[0].admin_adjust_accrual;
      const adj = (await admin.query('SELECT * FROM public.courier_accruals WHERE id = $1', [adjId])).rows[0];
      expect(adj).toMatchObject({ component: 'adjustment', adjusts_accrual_id: a.id, status: 'calculated', amount_cup: '-50.00', remittance_id: a.remittance_id });
      expect(adj.amount_usd).toBe('-0.06');
      expect(c).toBeTruthy();
    });
    it('negative amounts are only allowed on adjustments (CHECK)', async () => {
      const { a } = await delivered();
      expect((await failure(admin.query('UPDATE public.courier_accruals SET amount_cup = -1 WHERE id = $1', [a.id]))).code).toBe('23514');
    });
    it('reassign: only calculated accruals, reason required, the amount is NOT recalculated', async () => {
      const { c, a } = await delivered();
      const courier = await kit.makeCourier();
      expect((await failure(kit.call(c, 'admin_reassign_accrual', [a.id, courier, 'short']))).code).toBe('22023');
      await kit.call(c, 'admin_reassign_accrual', [a.id, courier, 'delivered by Pedro, not recorded']);
      const row = (await admin.query('SELECT courier_id, amount_cup FROM public.courier_accruals WHERE id = $1', [a.id])).rows[0];
      expect(row).toEqual({ courier_id: courier, amount_cup: '200.00' });
      await markPaid(a.id);
      expect((await failure(kit.call(c, 'admin_reassign_accrual', [a.id, null, 'delivered by Pedro, not recorded']))).code).toBe('22023');
    });
    it('recalculate: fills an UNKNOWN accrual once a rule exists; refuses paid or void accruals', async () => {
      const { c, id, a } = await delivered(null);
      expect(a.amount_cup).toBeNull();
      await kit.setRule(c, { fixed_cup: 200 });
      await kit.call(c, 'admin_recalculate_accrual', [a.id]);
      const b = await one(id);
      expect(b).toMatchObject({ amount_cup: '200.00', amount_usd: '0.25' });
      expect(b.rule_snapshot.source).toBe('recalc');
      expect(b.rule_id).not.toBeNull();
      await markPaid(a.id);
      expect((await failure(kit.call(c, 'admin_recalculate_accrual', [a.id]))).code).toBe('22023');
    });
  });

  describe('recalculate never overwrites a known amount', () => {
    it('known amount + rule deactivated => refused, accrual byte-for-byte unchanged', async () => {
      const c = await adminClient();
      await kit.setRule(c, { code: 'g', fixed_cup: 200 });
      const id = await rem();
      await kit.deliverRemittance(id);
      const before = await one(id);
      await kit.call(c, 'admin_deactivate_messenger_payment_type', ['g']);
      expect((await failure(kit.call(c, 'admin_recalculate_accrual', [before.id]))).code).toBe('22023');
      expect(await one(id)).toEqual(before);
    });
  });

  describe('effective cost: one number per operation, never the sum of snapshot + accrual', () => {
    const eff = async (opId) =>
      (await admin.query('SELECT source_kind, amount_usd, is_estimated FROM public.v_effective_courier_cost WHERE source_id = $1', [opId])).rows;

    it('no accrual amount => the zone snapshot as an ESTIMATE; an accrual amount replaces it (4.00 -> 0.25, not 4.25)', async () => {
      const zone = await kit.seedZone('4.00');
      const id = await rem({ zoneId: zone, deliveryCost: 15 });
      expect(await eff(id)).toEqual([{ source_kind: 'remittance', amount_usd: '4.00', is_estimated: true }]);
      await kit.deliverRemittance(id); // no rule: accrual NULL, estimate stays
      expect(await eff(id)).toEqual([{ source_kind: 'remittance', amount_usd: '4.00', is_estimated: true }]);
      const c = await adminClient();
      await kit.setRule(c, { fixed_cup: 200 });
      await kit.call(c, 'admin_recalculate_accrual', [(await one(id)).id]);
      expect(await eff(id)).toEqual([{ source_kind: 'remittance', amount_usd: '0.25', is_estimated: false }]);
    });
    it('exposes recorded_at (snapshot or accrual creation) so the Dashboard needs no legacy table', async () => {
      const zone = await kit.seedZone('4.00');
      const withSnap = await rem({ zoneId: zone });
      const noSnap = await rem();
      await kit.deliverRemittance(noSnap);
      const { rows } = await admin.query('SELECT source_id, recorded_at FROM public.v_effective_courier_cost WHERE source_id = ANY($1)', [[withSnap, noSnap]]);
      expect(rows).toHaveLength(2);
      for (const r of rows) expect(r.recorded_at).toBeInstanceOf(Date);
    });
    it('an operation without snapshot nor rule has an unknown cost (NULL, estimated), not 0; a void accrual falls back to the estimate', async () => {
      const id = await rem();
      await kit.deliverRemittance(id);
      expect(await eff(id)).toEqual([{ source_kind: 'remittance', amount_usd: null, is_estimated: true }]);
      const c = await adminClient();
      await kit.setRule(c, { fixed_cup: 200 });
      await kit.call(c, 'admin_recalculate_accrual', [(await one(id)).id]);
      await kit.call(c, 'admin_void_accrual', [(await one(id)).id, 'cancelled accrual, no cost']);
      expect(await eff(id)).toEqual([{ source_kind: 'remittance', amount_usd: null, is_estimated: true }]);
    });
    it('adjustments add to the known accrual', async () => {
      const c = await adminClient();
      await kit.setRule(c, { fixed_cup: 810 });
      const id = await rem();
      await kit.deliverRemittance(id);
      const a = await one(id);
      await admin.query(`UPDATE public.courier_accruals SET status = 'paid' WHERE id = $1`, [a.id]);
      await kit.setRole(actors.adminId, 'super_admin');
      const sup = await kit.as(actors.adminId);
      await kit.call(sup, 'admin_adjust_accrual', [a.id, 810, 'courier owed a second delivery']);
      expect(await eff(id)).toEqual([{ source_kind: 'remittance', amount_usd: '2.00', is_estimated: false }]);
    });
  });

  describe('margin flag persisted with the accrual (single source: _operation_margin)', () => {
    const thresholds = async (warning, critical) => {
      const c = await adminClient();
      await kit.call(c, 'admin_set_margin_thresholds', ['remittance', null, warning, critical]);
    };
    it('remittance: income = commission_total + delivery_cost, cost = accrual USD; no thresholds => unknown status, values persisted', async () => {
      const c = await adminClient();
      await kit.setRule(c, { fixed_cup: 200 });
      const id = await rem();
      await kit.deliverRemittance(id);
      const a = await one(id);
      expect(a).toMatchObject({ margin_usd: '2.15', margin_pct: '2.1500', margin_status: 'unknown' });
    });
    it('classifies with the configured thresholds at delivery time and does not change when they change later', async () => {
      await thresholds(3, 0);
      const c = await adminClient();
      await kit.setRule(c, { fixed_cup: 2000 }); // 2.47 USD cost > 2.40 income => loss
      const id = await rem();
      await kit.deliverRemittance(id);
      expect((await one(id)).margin_status).toBe('critical');
      await thresholds(null, null);
      expect((await one(id)).margin_status).toBe('critical');
    });
    it('delivery_cost counts as income', async () => {
      const c = await adminClient();
      await kit.setRule(c, { fixed_cup: 2000 });
      const id = await rem({ deliveryCost: 15 });
      await kit.deliverRemittance(id);
      expect(await one(id)).toMatchObject({ margin_usd: '14.93', margin_status: 'unknown' });
    });
    it('unknown cost (no rule, no snapshot) => unknown, never 0; with only the zone estimate it is computed from the estimate', async () => {
      const id = await rem();
      await kit.deliverRemittance(id);
      expect(await one(id)).toMatchObject({ margin_usd: null, margin_pct: null, margin_status: 'unknown' });
      const zone = await kit.seedZone('4.00');
      const id2 = await rem({ zoneId: zone });
      await kit.deliverRemittance(id2);
      const b = await one(id2);
      expect(b).toMatchObject({ margin_usd: '-1.60', margin_status: 'unknown' });
      expect(b.rule_snapshot.cost_estimated).toBe(true);
    });
    it('orders: the income (order profit) is computed in the app, so the SQL flag is unknown in phase 1', async () => {
      const c = await adminClient();
      await kit.setRule(c, { applies_to: 'order', fixed_cup: 150 });
      const o = await kit.seedDispatchedOrder();
      await kit.deliverOrder(o);
      expect(await one(o)).toMatchObject({ margin_status: 'unknown', margin_usd: null });
    });
    it('recalculate refreshes the margin with the new amount', async () => {
      const c = await adminClient();
      const id = await rem();
      await kit.deliverRemittance(id);
      await kit.setRule(c, { fixed_cup: 200 });
      await kit.call(c, 'admin_recalculate_accrual', [(await one(id)).id]);
      expect(await one(id)).toMatchObject({ margin_usd: '2.15', margin_status: 'unknown' });
    });
  });

  describe('late accruals', () => {
    it('lists only delivered operations without any delivery accrual (a void one still counts as accrued)', async () => {
      const c = await adminClient();
      const id = await rem();
      await kit.deliverRemittance(id);
      expect((await kit.call(c, 'admin_list_deliveries_without_accrual', [null, null])).map((r) => r.source_id)).not.toContain(id);
      await admin.query('DELETE FROM public.courier_accruals WHERE remittance_id = $1', [id]);
      const rows = await kit.call(c, 'admin_list_deliveries_without_accrual', [null, null]);
      expect(rows.find((r) => r.source_id === id)).toMatchObject({ source_kind: 'remittance' });
    });
  });

  describe('backfill with an old start date', () => {
    it('requires p_from; an old p_from creates the missing accrual marked source late; a second run creates nothing', async () => {
      const c = await adminClient();
      const id = await rem();
      await kit.deliverRemittance(id);
      await admin.query('DELETE FROM public.courier_accruals WHERE remittance_id = $1', [id]);
      // backfill creates cost rows for history with the rule and rate of NOW: only a super_admin may run it
      const old0 = new Date(Date.now() - 3650 * 86_400_000).toISOString();
      expect((await failure(kit.call(c, 'admin_backfill_missing_accruals', [old0]))).code).toBe('42501');
      expect(await kit.accruals(id)).toHaveLength(0);
      await kit.setRole(actors.adminId, 'super_admin');
      expect((await failure(kit.call(c, 'admin_backfill_missing_accruals', [null]))).code).toBe('22023');
      const old = new Date(Date.now() - 3650 * 86_400_000).toISOString();
      expect((await kit.call(c, 'admin_backfill_missing_accruals', [old]))[0].admin_backfill_missing_accruals).toBeGreaterThanOrEqual(1);
      expect((await one(id)).rule_snapshot.source).toBe('late');
      expect((await kit.call(c, 'admin_backfill_missing_accruals', [old]))[0].admin_backfill_missing_accruals).toBe(0);
      await kit.setRole(actors.adminId, 'admin');
    });
  });

  describe('migration lock_timeout', () => {
    it('M2 gives up (55P03) instead of queueing behind a lock held on orders', async () => {
      const blocker = await connectAdmin();
      await blocker.query('BEGIN');
      await blocker.query('LOCK TABLE public.orders IN ACCESS EXCLUSIVE MODE');
      const body = readSql(MIGRATIONS.m2).replace(/^\s*(BEGIN|COMMIT);\s*$/gm, '');
      try {
        await admin.query('BEGIN');
        const err = await failure(admin.query(body));
        expect(err.code).toBe('55P03');
      } finally {
        await admin.query('ROLLBACK');
        await blocker.query('ROLLBACK');
        await blocker.end();
      }
    }, 30000);
  });

  describe('rollback of M2 (executed inside a transaction that is rolled back)', () => {
    it('drops the M2 objects and the triggers', async () => {
      const body = readSql(ROLLBACKS.m2).replace(/^\s*(BEGIN|COMMIT);\s*$/gm, '');
      const m3 = readSql(ROLLBACKS.m3).replace(/^\s*(BEGIN|COMMIT);\s*$/gm, '');
      await admin.query('BEGIN');
      try {
        await admin.query(`SET LOCAL app.confirm_courier_rollback = 'yes'`);
        await admin.query(m3);
        await admin.query(body);
        const { rows } = await admin.query(
          `SELECT to_regclass('public.courier_accruals') IS NULL AS a, to_regclass('public.delivery_assignments') IS NULL AS d,
                  to_regclass('public.v_effective_courier_cost') IS NULL AS v,
                  (SELECT count(*) FROM pg_trigger WHERE tgname = 'courier_accrual_on_delivered') = 0 AS t,
                  to_regclass('public.messenger_payment_types') IS NOT NULL AS m1_intact`);
        expect(rows[0]).toEqual({ a: true, d: true, v: true, t: true, m1_intact: true });
      } finally {
        await admin.query('ROLLBACK');
      }
      expect((await admin.query(`SELECT to_regclass('public.courier_accruals') IS NOT NULL AS back`)).rows[0].back).toBe(true);
    });
  });
});
