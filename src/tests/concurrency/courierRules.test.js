/**
 * Courier management, M1 (20261031100000_couriers_and_payment_types.sql): couriers, messenger_payment_types
 * (versioned, append-only), margin thresholds, the rule resolver and the pure margin function.
 *
 * OWNER RULE: no amount/percentage/threshold/rate/tier is seeded or hard-coded by the migrations; every value below is a
 * TEST value passed through the admin RPCs. The suite does not list the new objects in `needs`: a missing migration
 * fails loudly (red phase).
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { dbSuiteSkipReason, connectAdmin, connectAnon, endAll, fireTogether } from './db';
import { loadActors } from './fixtures';
import { MIGRATIONS, ROLLBACKS, failure, readSql, makeKit } from './courierTestKit';

const skipReason = await dbSuiteSkipReason({
  functions: ['is_admin_user', 'is_super_admin', 'remittance_confirm_delivery'],
  tables: ['remittances', 'shipping_zones', 'financial_audit_log']
});
const describeDb = skipReason ? describe.skip : describe;

describe('M1 migration hygiene (static)', () => {
  const sql = readSql(MIGRATIONS.m1);
  it('runs in an explicit transaction with lock_timeout, documents its rollback and pins search_path', () => {
    expect(sql.split('\n').slice(0, 60).join('\n')).toMatch(/ROLLBACK/);
    expect(sql).toMatch(/^BEGIN;/m);
    expect(sql).toMatch(/SET LOCAL lock_timeout/);
    expect(sql.trimEnd().endsWith('COMMIT;')).toBe(true);
    expect(sql).toMatch(/SET search_path = public, pg_temp/);
  });
  it('seeds no payment types, couriers, amounts or thresholds (owner rule)', () => {
    expect(sql).not.toMatch(/^INSERT INTO public\.messenger_payment_types/m);
    expect(sql).not.toMatch(/^INSERT INTO public\.couriers/m);
    // the only seed row is the empty settings row per kind (all values NULL)
    const seeds = sql.match(/INSERT INTO public\.courier_margin_settings[\s\S]*?;/g) ?? [];
    expect(seeds.join('\n')).not.toMatch(/\d/);
  });
  it('has no hard FK to the pre-existing zones / remittance types tables (deleting them must keep working)', () => {
    expect(sql).not.toMatch(/REFERENCES\s+public\.(shipping_zones|remittance_types)/);
  });
  it('ships a rollback and no free-form expressions (no EXECUTE / eval of rule text)', () => {
    expect(() => readSql(ROLLBACKS.m1)).not.toThrow();
    const bodies = sql.match(/\$function\$[\s\S]*?\$function\$/g) ?? [];
    expect(bodies.length).toBeGreaterThan(5);
    for (const b of bodies) expect(b).not.toMatch(/\bEXECUTE\b/i);
  });
});

describeDb('M1: couriers, payment types, thresholds (local Postgres)', () => {
  let admin;
  let actors;
  let kit;

  beforeAll(async () => {
    admin = await connectAdmin();
    actors = await loadActors(admin);
    kit = makeKit(admin, actors);
  });
  afterEach(async () => {
    await kit.cleanup();
  });
  afterAll(async () => {
    await endAll([admin]);
  });

  const rules = async () => (await admin.query('SELECT * FROM public.messenger_payment_types ORDER BY code, version')).rows;

  describe('start empty / access', () => {
    it('tables start empty: no payment types, no couriers, thresholds all NULL', async () => {
      expect((await rules()).length).toBe(0);
      expect((await admin.query('SELECT count(*)::int AS n FROM public.couriers')).rows[0].n).toBe(0);
      const { rows } = await admin.query('SELECT kind, target_pct, warning_pct, critical_pct FROM public.courier_margin_settings ORDER BY kind');
      expect(rows).toEqual([
        { kind: 'order', target_pct: null, warning_pct: null, critical_pct: null },
        { kind: 'remittance', target_pct: null, warning_pct: null, critical_pct: null }
      ]);
    });

    it.each(['couriers', 'messenger_payment_types', 'courier_margin_settings'])(
      '%s: anon has no privilege; authenticated only SELECT and the customer sees zero rows',
      async (table) => {
        const { rows: priv } = await admin.query(
          `SELECT p AS priv, has_table_privilege('anon', $1, p) AS anon, has_table_privilege('authenticated', $1, p) AS auth,
                  has_table_privilege('service_role', $1, p) AS svc
             FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE']) p`, [`public.${table}`]);
        for (const r of priv) {
          expect(r.anon).toBe(false);
          expect(r.svc).toBe(false);
          expect(r.auth).toBe(r.priv === 'SELECT');
        }
        const anon = await connectAnon();
        kit.clients.push(anon);
        expect((await failure(anon.query(`SELECT * FROM public.${table}`))).code).toBe('42501');
        const customer = await kit.as(actors.customerId);
        expect((await customer.query(`SELECT * FROM public.${table}`)).rowCount).toBe(0);
        expect((await failure(customer.query(`DELETE FROM public.${table}`))).code).toBe('42501');
      }
    );

    it('RPCs are authenticated-only; a customer and a disabled admin are refused (42501), admin and super_admin pass', async () => {
      const fns = ['admin_upsert_courier', 'admin_set_messenger_payment_type', 'admin_deactivate_messenger_payment_type', 'admin_set_margin_thresholds'];
      const { rows } = await admin.query(
        `SELECT proname, prosecdef, has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
                has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth
           FROM pg_proc p WHERE pronamespace = 'public'::regnamespace AND proname = ANY($1)`, [fns]);
      expect(rows).toHaveLength(fns.length);
      for (const r of rows) expect({ d: r.prosecdef, a: r.anon, u: r.auth }).toEqual({ d: true, a: false, u: true });
      for (const fn of ['_courier_rule_resolve', '_operation_margin']) {
        const { rows: h } = await admin.query(
          `SELECT has_function_privilege('anon', p.oid, 'EXECUTE') AS anon, has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth
             FROM pg_proc p WHERE pronamespace = 'public'::regnamespace AND proname = $1`, [fn]);
        expect(h[0]).toEqual({ anon: false, auth: false });
      }
      const customer = await kit.as(actors.customerId);
      expect((await failure(customer.query(`SELECT public.admin_upsert_courier(NULL,'x',NULL,NULL,true)`))).code).toBe('42501');
      expect((await failure(kit.setRule(customer))).code).toBe('42501');
      expect((await failure(customer.query(`SELECT public.admin_set_margin_thresholds('remittance', NULL, NULL, NULL)`))).code).toBe('42501');
      await kit.setRole(actors.adminId, 'admin', false);
      const disabled = await kit.as(actors.adminId);
      expect((await failure(kit.setRule(disabled))).code).toBe('42501');
      await kit.setRole(actors.adminId, 'admin', true);
      const adminC = await kit.as(actors.adminId);
      await expect(kit.setRule(adminC, { code: 'by-admin' })).resolves.toBeTruthy();
      await kit.setRole(actors.adminId, 'super_admin', true);
      const sup = await kit.as(actors.adminId);
      await expect(kit.setRule(sup, { code: 'by-super', applies_to: 'order' })).resolves.toBeTruthy();
    });

    it('orders and remittances get no courier column (the owner of the row must not read courier data)', async () => {
      const { rows } = await admin.query(
        `SELECT table_name, column_name FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name IN ('orders','remittances') AND column_name ~* 'courier|messenger|accrual'`);
      expect(rows).toEqual([]);
    });
  });

  describe('couriers', () => {
    it('creates, updates and deactivates; the name is unique among active couriers (case and spacing insensitive)', async () => {
      const c = await kit.as(actors.adminId);
      const id = await kit.makeCourier('Pedro Pérez');
      expect((await failure(kit.call(c, 'admin_upsert_courier', [null, '  pedro   pérez ', null, null, true]))).code).toBe('23505');
      const upd = (await kit.call(c, 'admin_upsert_courier', [id, 'Pedro P.', '+5355550101', 'notes', true]))[0].admin_upsert_courier;
      expect(upd).toBe(id);
      await kit.call(c, 'admin_upsert_courier', [id, 'Pedro P.', '+5355550101', 'notes', false]);
      // inactive names are free again
      await expect(kit.makeCourier('Pedro P.')).resolves.toBeTruthy();
      const row = (await admin.query('SELECT name, phone, is_active, created_by FROM public.couriers WHERE id = $1', [id])).rows[0];
      expect(row).toEqual({ name: 'Pedro P.', phone: '+5355550101', is_active: false, created_by: actors.adminId });
    });

    it.each([[''], ['   '], ['x'.repeat(201)]])('rejects a blank or oversized name %j', async (name) => {
      const c = await kit.as(actors.adminId);
      expect((await failure(kit.call(c, 'admin_upsert_courier', [null, name, null, null, true]))).code).toBe('22023');
    });

    it('records the change in financial_audit_log (ids and flags only, no name or phone)', async () => {
      const id = await kit.makeCourier('Audit Courier');
      const { rows } = await admin.query(
        `SELECT operation, column_name, new_value, changed_by FROM public.financial_audit_log WHERE table_name = 'couriers' AND row_id = $1`, [id]);
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((r) => r.changed_by === actors.adminId)).toBe(true);
      expect(JSON.stringify(rows)).not.toMatch(/Audit Courier/);
    });
  });

  describe('messenger_payment_types: validation', () => {
    const bad = async (o, code = '22023') => {
      const c = await kit.as(actors.adminId);
      expect((await failure(kit.setRule(c, o))).code).toBe(code);
    };

    it('fixed_cup requires fixed_cup and no other parameter', async () => {
      await bad({ fixed_cup: null });
      await bad({ fixed_cup: -1 });
      await bad({ fixed_cup: 5, percent: 1 });
      await bad({ fixed_cup: 5, cup_per_usd: 1 });
      await bad({ fixed_cup: 5, base: 'nominal_usd' });
    });
    it('per_usd_delivered requires cup_per_usd and a base; only for remittances', async () => {
      const ok = { method: 'per_usd_delivered', fixed_cup: null, cup_per_usd: 1, base: 'nominal_usd' };
      await bad({ ...ok, cup_per_usd: null });
      await bad({ ...ok, base: null });
      await bad({ ...ok, base: 'commission_usd' });
      await bad({ ...ok, cup_per_usd: -0.5 });
      await bad({ ...ok, applies_to: 'order' });
      await bad({ ...ok, applies_to: 'both' });
      const c = await kit.as(actors.adminId);
      await expect(kit.setRule(c, ok)).resolves.toBeTruthy();
    });
    it('percent_of_base requires percent in [0,100] and a base; only for remittances', async () => {
      const ok = { method: 'percent_of_base', fixed_cup: null, percent: 2.5, base: 'delivered_cup' };
      await bad({ ...ok, percent: null });
      await bad({ ...ok, percent: 100.001 });
      await bad({ ...ok, percent: -1 });
      await bad({ ...ok, base: null });
      await bad({ ...ok, applies_to: 'order' });
      const c = await kit.as(actors.adminId);
      await expect(kit.setRule(c, { ...ok, percent: 100 })).resolves.toBeTruthy();
      await expect(kit.setRule(c, { ...ok, percent: 0, amount_from: 500 })).resolves.toBeTruthy();
    });
    it('rejects unknown method / applies_to, blank code or name, bad tramo, type on an order-only rule', async () => {
      await bad({ method: 'combo_threshold' });
      await bad({ method: 'x; DROP TABLE couriers' });
      await bad({ applies_to: 'combo' });
      await bad({ code: '  ' });
      await bad({ name: '' });
      await bad({ amount_from: 10, amount_to: 10 });
      await bad({ amount_from: 20, amount_to: 10 });
      await bad({ amount_from: -1, amount_to: 10 });
      const type = await kit.seedType();
      await bad({ applies_to: 'order', type_id: type });
    });
    it('rejects unknown or inactive courier, unknown zone or type, and a delivered_cup base on a non-CUP type', async () => {
      const c = await kit.as(actors.adminId);
      const ghost = '00000000-0000-4000-8000-0000000000aa';
      await bad({ courier_id: ghost });
      await bad({ zone_id: ghost });
      await bad({ type_id: ghost });
      const id = await kit.makeCourier();
      await kit.call(c, 'admin_upsert_courier', [id, 'Inactive', null, null, false]);
      await bad({ courier_id: id });
      const usdType = await kit.seedType({ delivery: 'USD' });
      await bad({ method: 'percent_of_base', fixed_cup: null, percent: 1, base: 'delivered_cup', type_id: usdType });
      await expect(kit.setRule(c, { method: 'percent_of_base', fixed_cup: null, percent: 1, base: 'nominal_usd', type_id: usdType })).resolves.toBeTruthy();
    });
    it('deleting a referenced zone or remittance type is NOT blocked and leaves the rule inert (never widened to "all")', async () => {
      const c = await kit.as(actors.adminId);
      const zone = await kit.seedZone();
      const type = await kit.seedType();
      await kit.setRule(c, { code: 'zr', zone_id: zone });
      await kit.setRule(c, { code: 'tr', type_id: type, fixed_cup: 7 });
      await admin.query('DELETE FROM public.shipping_zones WHERE id = $1', [zone]);
      await admin.query('DELETE FROM public.remittance_types WHERE id = $1', [type]);
      const rows = await rules();
      expect(rows.map((r) => [r.code, r.shipping_zone_id, r.remittance_type_id])).toEqual([['tr', null, type], ['zr', zone, null]]);
      const resolve = async (z, t) => (await admin.query(
        `SELECT m.code FROM public.messenger_payment_types m WHERE m.id = public._courier_rule_resolve('remittance', NULL, $1::uuid, $2::uuid, 100)`, [z, t])).rows[0];
      expect(await resolve(null, null)).toBeUndefined();
      expect(await resolve(await kit.seedZone(), null)).toBeUndefined();
    });
    it('table CHECKs hold even against a direct INSERT (defence in depth)', async () => {
      const insert = (cols) => admin.query(
        `INSERT INTO public.messenger_payment_types (code, name, version, applies_to, method, fixed_cup, cup_per_usd, percent, base, valid_from)
         VALUES ('t','t',1,$1,$2,$3,$4,$5,$6, now())`, cols);
      expect((await failure(insert(['remittance', 'fixed_cup', null, null, null, null]))).code).toBe('23514');
      expect((await failure(insert(['order', 'percent_of_base', null, null, 5, 'nominal_usd']))).code).toBe('23514');
      expect((await failure(insert(['remittance', 'percent_of_base', null, null, 101, 'nominal_usd']))).code).toBe('23514');
      expect((await failure(insert(['both', 'fixed_cup', 5, 1, null, null]))).code).toBe('23514');
    });
  });

  describe('versioning (append-only)', () => {
    it('a new version closes the previous one at its valid_from and never rewrites its parameters', async () => {
      const c = await kit.as(actors.adminId);
      await kit.setRule(c, { code: 'general', fixed_cup: 100 });
      const [v1] = await rules();
      await kit.setRule(c, { code: 'general', fixed_cup: 150 });
      const all = await rules();
      expect(all.map((r) => [r.version, Number(r.fixed_cup)])).toEqual([[1, 100], [2, 150]]);
      expect(all[0].valid_to).not.toBeNull();
      expect(all[0].valid_to.getTime()).toBe(all[1].valid_from.getTime());
      expect(Number(all[0].fixed_cup)).toBe(Number(v1.fixed_cup));
      expect(all[1].created_by).toBe(actors.adminId);
    });
    it('only the future is editable: a past valid_from is refused, a future one is scheduled', async () => {
      const c = await kit.as(actors.adminId);
      expect((await failure(kit.setRule(c, { valid_from: new Date(Date.now() - 3600_000).toISOString() }))).code).toBe('22023');
      await expect(kit.setRule(c, { code: 'later', valid_from: new Date(Date.now() + 86_400_000).toISOString() })).resolves.toBeTruthy();
    });
    it('a version cannot start before an existing active version of the same code', async () => {
      const c = await kit.as(actors.adminId);
      await kit.setRule(c, { code: 'g', valid_from: new Date(Date.now() + 5 * 86_400_000).toISOString() });
      expect((await failure(kit.setRule(c, { code: 'g', fixed_cup: 1, valid_from: new Date(Date.now() + 86_400_000).toISOString() }))).code).toBe('22023');
    });
    it('the guard trigger blocks DELETE and any parameter UPDATE, even for the owner; closing columns stay writable by the RPCs', async () => {
      const c = await kit.as(actors.adminId);
      await kit.setRule(c, { code: 'g' });
      expect((await failure(admin.query('DELETE FROM public.messenger_payment_types'))).code).toBe('42501');
      expect((await failure(admin.query('UPDATE public.messenger_payment_types SET fixed_cup = 999'))).code).toBe('42501');
      expect((await failure(admin.query(`UPDATE public.messenger_payment_types SET code = 'z'`))).code).toBe('42501');
      expect((await failure(admin.query(`UPDATE public.messenger_payment_types SET created_by = NULL`))).code).toBe('42501');
      expect(Number((await rules())[0].fixed_cup)).toBe(200);
    });
    it('deactivate switches every version of a code off; the resolver stops using it; unknown code is a 22023', async () => {
      const c = await kit.as(actors.adminId);
      await kit.setRule(c, { code: 'g' });
      const n = (await kit.call(c, 'admin_deactivate_messenger_payment_type', ['g']))[0].admin_deactivate_messenger_payment_type;
      expect(n).toBe(1);
      expect((await rules()).every((r) => r.is_active === false)).toBe(true);
      const resolved = (await admin.query(`SELECT public._courier_rule_resolve('remittance', NULL, NULL, NULL, 100) AS id`)).rows[0].id;
      expect(resolved).toBeNull();
      expect((await failure(kit.call(c, 'admin_deactivate_messenger_payment_type', ['nope']))).code).toBe('22023');
    });
    it('the migration leaves financial_audit_log untouched (no constraint change)', () => {
      expect(readSql(MIGRATIONS.m1)).not.toMatch(/ALTER TABLE public\.financial_audit_log/);
    });
    it('every change is recorded in financial_audit_log with the actor', async () => {
      const c = await kit.as(actors.adminId);
      const id = await kit.setRule(c, { code: 'g' });
      await kit.call(c, 'admin_deactivate_messenger_payment_type', ['g']);
      const { rows } = await admin.query(
        `SELECT operation, column_name, changed_by, changed_by_role FROM public.financial_audit_log
          WHERE table_name = 'messenger_payment_types' AND row_id = $1 ORDER BY id`, [id]);
      expect(rows.map((r) => r.column_name)).toContain('created');
      expect(rows.map((r) => r.column_name)).toContain('is_active');
      expect(rows.every((r) => r.changed_by === actors.adminId && r.changed_by_role === 'admin')).toBe(true);
    });
  });

  describe('overlap validation (no btree_gist)', () => {
    const T0 = Date.now();
    const future = (d) => new Date(T0 + d * 86_400_000).toISOString();

    it('rejects two codes with the same scope and overlapping validity', async () => {
      const c = await kit.as(actors.adminId);
      await kit.setRule(c, { code: 'a' });
      expect((await failure(kit.setRule(c, { code: 'b' }))).code).toBe('23P01');
    });
    it('allows different scopes (zone, courier, type) and different specificity', async () => {
      const c = await kit.as(actors.adminId);
      const z1 = await kit.seedZone();
      const z2 = await kit.seedZone();
      const courier = await kit.makeCourier();
      await kit.setRule(c, { code: 'a' });
      await kit.setRule(c, { code: 'b', zone_id: z1 });
      await kit.setRule(c, { code: 'c', zone_id: z2 });
      await kit.setRule(c, { code: 'd', courier_id: courier });
      await kit.setRule(c, { code: 'e', amount_from: 0, amount_to: 50 });
      expect((await rules()).length).toBe(5);
    });
    it('tramos use (a,b]: adjacent tramos coexist, intersecting ones do not, open ends overlap everything on that side', async () => {
      const c = await kit.as(actors.adminId);
      await kit.setRule(c, { code: 't1', amount_from: 0, amount_to: 50 });
      await kit.setRule(c, { code: 't2', amount_from: 50, amount_to: 100 });
      await kit.setRule(c, { code: 't3', amount_from: 100 });
      expect((await failure(kit.setRule(c, { code: 't4', amount_from: 40, amount_to: 60 }))).code).toBe('23P01');
      expect((await failure(kit.setRule(c, { code: 't5', amount_from: 500 }))).code).toBe('23P01');
      expect((await failure(kit.setRule(c, { code: 't6', amount_to: 10 }))).code).toBe('23P01');
    });
    it("'both' overlaps remittance and order, 'order' and 'remittance' do not overlap each other", async () => {
      const c = await kit.as(actors.adminId);
      await kit.setRule(c, { code: 'o', applies_to: 'order' });
      await kit.setRule(c, { code: 'r', applies_to: 'remittance' });
      expect((await failure(kit.setRule(c, { code: 'b', applies_to: 'both' }))).code).toBe('23P01');
    });
    it('disjoint validity windows coexist; overlapping ones do not; the superseded version of the same code is excluded', async () => {
      const c = await kit.as(actors.adminId);
      await kit.setRule(c, { code: 'a', valid_from: future(1), valid_to: future(10) });
      expect((await failure(kit.setRule(c, { code: 'b', valid_from: future(5), valid_to: future(20) }))).code).toBe('23P01');
      await kit.setRule(c, { code: 'b', valid_from: future(10), valid_to: future(20) });
      await kit.setRule(c, { code: 'a', fixed_cup: 7, valid_from: future(2), valid_to: future(10) });
      expect((await rules()).filter((r) => r.code === 'a').length).toBe(2);
    });
    it('two admins creating overlapping rules at the same instant: exactly one wins', async () => {
      const a = await kit.as(actors.adminId);
      const b = await kit.as(actors.adminId);
      const call = (code) => `public.admin_set_messenger_payment_type('${code}','n','remittance','fixed_cup',5,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL)`;
      const res = await fireTogether([{ client: a, sql: call('x1') }, { client: b, sql: call('x2') }]);
      expect(res.filter((r) => r.error).length).toBe(1);
      expect(res.find((r) => r.error).error.code).toBe('23P01');
      expect((await rules()).length).toBe(1);
    });
  });

  describe('_courier_rule_resolve: deterministic precedence (courier > zone > type > tramo > general)', () => {
    const resolve = async (kind, { courier = null, zone = null, type = null, amount = 100 } = {}) => {
      const { rows } = await admin.query(
        `SELECT m.code FROM public.messenger_payment_types m
          WHERE m.id = public._courier_rule_resolve($1, $2::uuid, $3::uuid, $4::uuid, $5::numeric)`, [kind, courier, zone, type, amount]);
      return rows[0]?.code ?? null;
    };

    it('picks the most specific rule; a single rule wins per operation', async () => {
      const c = await kit.as(actors.adminId);
      const zone = await kit.seedZone();
      const type = await kit.seedType();
      const courier = await kit.makeCourier();
      expect(await resolve('remittance')).toBeNull(); // no rule => nothing (amount stays unknown downstream)
      await kit.setRule(c, { code: 'general' });
      expect(await resolve('remittance', { zone, type, courier })).toBe('general');
      await kit.setRule(c, { code: 'tramo', amount_from: 50, amount_to: 200 });
      expect(await resolve('remittance', { amount: 100 })).toBe('tramo');
      expect(await resolve('remittance', { amount: 50 })).toBe('general'); // (50, 200]: 50 is excluded
      expect(await resolve('remittance', { amount: 200 })).toBe('tramo'); // 200 is included
      expect(await resolve('remittance', { amount: 200.01 })).toBe('general');
      await kit.setRule(c, { code: 'type', type_id: type });
      expect(await resolve('remittance', { type, amount: 100 })).toBe('type'); // type beats tramo
      await kit.setRule(c, { code: 'zone', zone_id: zone });
      expect(await resolve('remittance', { zone, type, amount: 100 })).toBe('zone'); // zone beats type
      await kit.setRule(c, { code: 'courier', courier_id: courier });
      expect(await resolve('remittance', { courier, zone, type, amount: 100 })).toBe('courier'); // courier beats zone
      expect(await resolve('remittance', { zone, type, amount: 100 })).toBe('zone'); // rule bound to another courier is ignored
    });
    it('a tuple with more matching dimensions beats a lone one (courier+zone > courier)', async () => {
      const c = await kit.as(actors.adminId);
      const zone = await kit.seedZone();
      const courier = await kit.makeCourier();
      await kit.setRule(c, { code: 'courier', courier_id: courier });
      await kit.setRule(c, { code: 'courier-zone', courier_id: courier, zone_id: zone });
      expect(await resolve('remittance', { courier, zone })).toBe('courier-zone');
      expect(await resolve('remittance', { courier })).toBe('courier');
    });
    it("applies_to is honoured: 'order' rules never match remittances and 'both' matches both", async () => {
      const c = await kit.as(actors.adminId);
      await kit.setRule(c, { code: 'o', applies_to: 'order' });
      expect(await resolve('remittance')).toBeNull();
      expect(await resolve('order')).toBe('o');
      await kit.call(c, 'admin_deactivate_messenger_payment_type', ['o']);
      await kit.setRule(c, { code: 'b', applies_to: 'both' });
      expect(await resolve('remittance')).toBe('b');
      expect(await resolve('order')).toBe('b');
    });
    it('ignores scheduled (future) and expired rules', async () => {
      const c = await kit.as(actors.adminId);
      await kit.setRule(c, { code: 'future', valid_from: new Date(Date.now() + 86_400_000).toISOString() });
      expect(await resolve('remittance')).toBeNull();
      const { rows } = await admin.query(
        `SELECT m.code FROM public.messenger_payment_types m WHERE m.id = public._courier_rule_resolve('remittance', NULL, NULL, NULL, 100, now() + interval '2 days')`);
      expect(rows[0].code).toBe('future');
    });
  });

  describe('margin thresholds', () => {
    it('admin sets them per kind; ordering critical <= warning <= target is enforced; each may stay NULL', async () => {
      const c = await kit.as(actors.adminId);
      await kit.call(c, 'admin_set_margin_thresholds', ['remittance', 5, 3, 0]);
      let row = (await admin.query(`SELECT target_pct, warning_pct, critical_pct, updated_by FROM public.courier_margin_settings WHERE kind='remittance'`)).rows[0];
      expect(row).toMatchObject({ target_pct: '5.0000', warning_pct: '3.0000', critical_pct: '0.0000', updated_by: actors.adminId });
      expect((await failure(kit.call(c, 'admin_set_margin_thresholds', ['remittance', 5, 3, 4]))).code).toBe('22023');
      expect((await failure(kit.call(c, 'admin_set_margin_thresholds', ['remittance', 2, 3, 0]))).code).toBe('22023');
      expect((await failure(kit.call(c, 'admin_set_margin_thresholds', ['combo', 1, 1, 1]))).code).toBe('22023');
      await kit.call(c, 'admin_set_margin_thresholds', ['remittance', null, null, -1]);
      row = (await admin.query(`SELECT target_pct, warning_pct, critical_pct FROM public.courier_margin_settings WHERE kind='remittance'`)).rows[0];
      expect(row).toMatchObject({ target_pct: null, warning_pct: null, critical_pct: '-1.0000' });
      const audit = await admin.query(`SELECT 1 FROM public.financial_audit_log WHERE table_name = 'courier_margin_settings'`);
      expect(audit.rowCount).toBeGreaterThan(0);
    });
    it('the table CHECK rejects a disordered row even through a direct UPDATE', async () => {
      expect((await failure(admin.query(`UPDATE public.courier_margin_settings SET critical_pct = 9, warning_pct = 1 WHERE kind = 'order'`))).code).toBe('23514');
    });
  });

  describe('_operation_margin (pure, single source of the margin)', () => {
    const m = async (base, income, cost, warning = null, critical = null) =>
      (await admin.query('SELECT * FROM public._operation_margin($1::numeric,$2::numeric,$3::numeric,$4::numeric,$5::numeric)', [base, income, cost, warning, critical])).rows[0];

    it('is IMMUTABLE and takes the thresholds as arguments (it reads no table)', async () => {
      const { rows } = await admin.query(`SELECT provolatile FROM pg_proc WHERE proname = '_operation_margin' AND pronamespace = 'public'::regnamespace`);
      expect(rows[0].provolatile).toBe('i');
    });
    it('unknown cost, unknown income or a non-positive base is "unknown", never 0 nor an error', async () => {
      for (const args of [[100, 2.4, null], [100, null, 1], [0, 2, 1], [null, 2, 1], [-5, 2, 1]]) {
        expect(await m(...args)).toEqual({ margin_usd: null, margin_pct: null, status: 'unknown' });
      }
    });
    it('with no thresholds configured it never alerts and the status is "unknown" (not "ok"), keeping the numbers', async () => {
      expect(await m(100, 2.4, 3.0)).toMatchObject({ margin_usd: '-0.60', status: 'unknown' });
      expect(await m(100, 2.4, 0)).toMatchObject({ margin_usd: '2.40', margin_pct: '2.4000', status: 'unknown' });
    });
    it('classifies against the given thresholds with a 0.005 cent tolerance (inclusive at the limit)', async () => {
      expect(await m(100, 3, 1, 3, 1)).toMatchObject({ margin_pct: '2.0000', status: 'warning' });
      expect(await m(100, 3, 2, 3, 1)).toMatchObject({ margin_pct: '1.0000', status: 'warning' }); // == critical: not critical
      expect(await m(100, 3, 2.01, 3, 1)).toMatchObject({ status: 'critical' });
      expect(await m(100, 4, 1, 3, 1)).toMatchObject({ margin_pct: '3.0000', status: 'ok' }); // == warning: ok
      expect(await m(100, 4, 1.01, 3, 1)).toMatchObject({ status: 'warning' });
      expect(await m(100, 1, 3, 3, 0)).toMatchObject({ margin_usd: '-2.00', status: 'critical' });
      expect(await m(100, 1, 3, null, 0)).toMatchObject({ status: 'critical' });
      expect(await m(100, 2.4, 0, 3, null)).toMatchObject({ status: 'warning' });
    });
  });
});

describeDb('rollback of M1 (executed inside a transaction that is rolled back)', () => {
  it('drops every M1 object', async () => {
    const admin = await connectAdmin();
    const body = ['m3', 'm2', 'm1'].map((k) => readSql(ROLLBACKS[k]).replace(/^\s*(BEGIN|COMMIT);\s*$/gm, '')).join('\n');
    try {
      await admin.query('BEGIN');
      await admin.query(`SET LOCAL app.confirm_courier_rollback = 'yes'`);
      await admin.query(body);
      const { rows } = await admin.query(
        `SELECT to_regclass('public.couriers') IS NULL AS c, to_regclass('public.messenger_payment_types') IS NULL AS t,
                to_regclass('public.courier_margin_settings') IS NULL AS s,
                to_regprocedure('public._operation_margin(numeric,numeric,numeric,numeric,numeric)') IS NULL AS f`);
      expect(rows[0]).toEqual({ c: true, t: true, s: true, f: true });
    } finally {
      await admin.query('ROLLBACK');
      await admin.end();
    }
  });
});
