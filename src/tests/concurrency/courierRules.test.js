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
      const fns = ['admin_upsert_courier', 'admin_set_messenger_payment_type_v2', 'admin_deactivate_messenger_payment_type', 'admin_set_margin_thresholds'];
      const { rows } = await admin.query(
        `SELECT proname, prosecdef, has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
                has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth
           FROM pg_proc p WHERE pronamespace = 'public'::regnamespace AND proname = ANY($1)`, [fns]);
      expect(rows).toHaveLength(fns.length);
      for (const r of rows) expect({ d: r.prosecdef, a: r.anon, u: r.auth }).toEqual({ d: true, a: false, u: true });
      // phase A: the 15-argument v1 is kept (rollback) but closed to API roles; the client calls v2
      const { rows: v1 } = await admin.query(
        `SELECT prosecdef, has_function_privilege('anon', p.oid, 'EXECUTE') AS anon, has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth
           FROM pg_proc p WHERE pronamespace = 'public'::regnamespace AND proname = 'admin_set_messenger_payment_type'`);
      expect(v1).toEqual([{ prosecdef: true, anon: false, auth: false }]);
      for (const fn of ['_courier_rule_resolve', '_courier_rule_resolve_v2', '_courier_rule_coverage', '_operation_margin']) {
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
      // phase A: percent of the nominal USD is valid for orders; delivered_cup stays remittance-only (base_scope_chk)
      expect((await failure(insert(['order', 'percent_of_base', null, null, 5, 'delivered_cup']))).code).toBe('23514');
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
      const call = (code) => `public.admin_set_messenger_payment_type_v2('${code}','n','remittance','fixed_cup',5,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL)`;
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

  describe('phase A: currency, fixed_amount and amount ranges (20261105150000)', () => {
    const resolve2 = async (kind, { courier = null, zone = null, type = null, amount = 100, currency = 'USD', fx = null } = {}) => {
      const { rows } = await admin.query(
        `SELECT m.code, r.reason FROM public._courier_rule_resolve_v2($1, $2::uuid, $3::uuid, $4::uuid, $5::numeric, $6, $7::numeric) r
           LEFT JOIN public.messenger_payment_types m ON m.id = r.rule_id`, [kind, courier, zone, type, amount, currency, fx]);
      expect(rows).toHaveLength(1);
      return rows[0];
    };
    const bad = async (o, code = '22023') => {
      const c = await kit.as(actors.adminId);
      expect((await failure(kit.setRule(c, o))).code).toBe(code);
    };
    const fixed = (o) => ({ method: 'fixed_amount', fixed_cup: null, fixed_amount: 5, ...o });
    // reference ladder in USD: R1 "up to 100" -> [0,100]; R2 "more than 100 and up to 200" -> (100,200]; R3 "more than 200"
    const ladder = async (c, r2 = { amount_from: 100, amount_to: 200 }, accept = true) => {
      await kit.setRule(c, fixed({ code: 'R1', amount_to: 100, accept_gaps: true }));
      await kit.setRule(c, fixed({ code: 'R3', amount_from: 200, accept_gaps: true }));
      return kit.setRule(c, fixed({ code: 'R2', ...r2, accept_gaps: accept }));
    };

    it('schema: currency NOT NULL DEFAULT USD in (USD, CUP); fixed_amount numeric(12,2) >= 0; fixed_cup kept', async () => {
      const { rows } = await admin.query(
        `SELECT column_name, data_type, is_nullable, column_default, numeric_precision, numeric_scale FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'messenger_payment_types' AND column_name IN ('currency','fixed_amount','fixed_cup')
          ORDER BY column_name`);
      expect(rows.map((r) => r.column_name)).toEqual(['currency', 'fixed_amount', 'fixed_cup']);
      expect(rows[0]).toMatchObject({ data_type: 'text', is_nullable: 'NO' });
      expect(rows[0].column_default).toMatch(/'USD'/);
      expect(rows[1]).toMatchObject({ numeric_precision: 12, numeric_scale: 2, is_nullable: 'YES' });
      const insert = (cur, amount) => admin.query(
        `INSERT INTO public.messenger_payment_types (code, name, version, applies_to, method, fixed_amount, currency, valid_from)
         VALUES ('t','t',1,'order','fixed_amount',$2,$1, now())`, [cur, amount]);
      expect((await failure(insert('EUR', 5))).code).toBe('23514');
      expect((await failure(insert('USD', -1))).code).toBe('23514');
      expect((await failure(insert('USD', null))).code).toBe('23514');
    });

    it('fixed_amount: any scope, the chosen currency, no other parameter; currency outside USD/CUP refused', async () => {
      const c = await kit.as(actors.adminId);
      await bad(fixed({ fixed_amount: null }));
      await bad(fixed({ fixed_amount: -1 }));
      await bad(fixed({ fixed_cup: 5 }));
      await bad(fixed({ percent: 1 }));
      await bad(fixed({ base: 'nominal_usd' }));
      await bad(fixed({ currency: 'EUR' }));
      await bad(fixed({ currency: null }));
      await bad({ fixed_cup: 5, fixed_amount: 5 });
      await expect(kit.setRule(c, fixed({ code: 'fo', applies_to: 'order', currency: 'USD' }))).resolves.toBeTruthy();
      await expect(kit.setRule(c, fixed({ code: 'fr', applies_to: 'remittance', currency: 'CUP', fixed_amount: 250 }))).resolves.toBeTruthy();
      const row = (await rules()).find((r) => r.code === 'fr');
      expect(row).toMatchObject({ method: 'fixed_amount', currency: 'CUP', fixed_amount: '250.00', fixed_cup: null });
    });

    it('percent_of_base on the nominal USD is allowed for orders and both; delivered_cup / per_usd stay remittance-only', async () => {
      const c = await kit.as(actors.adminId);
      const pct = { method: 'percent_of_base', fixed_cup: null, percent: 2, base: 'nominal_usd' };
      await expect(kit.setRule(c, { ...pct, code: 'po', applies_to: 'order' })).resolves.toBeTruthy();
      await bad({ ...pct, base: 'delivered_cup', applies_to: 'order' });
      await bad({ ...pct, base: 'delivered_cup', applies_to: 'both' });
      await bad({ method: 'per_usd_delivered', fixed_cup: null, cup_per_usd: 1, base: 'nominal_usd', applies_to: 'order' });
    });

    it('NaN is refused for every numeric parameter (22023) and no row is left; the table CHECKs refuse it too', async () => {
      for (const o of [
        fixed({ fixed_amount: 'NaN' }), fixed({ amount_from: 'NaN' }), fixed({ amount_to: 'NaN' }), { fixed_cup: 'NaN' },
        { method: 'per_usd_delivered', fixed_cup: null, cup_per_usd: 'NaN', base: 'nominal_usd' },
        { method: 'percent_of_base', fixed_cup: null, percent: 'NaN', base: 'nominal_usd' }
      ]) {
        const c = await kit.as(actors.adminId);
        const e = await failure(kit.setRule(c, o));
        expect(e.code, JSON.stringify(o)).toBe('22023');
        expect(e.message).toMatch(/NaN/);
      }
      expect(await rules()).toEqual([]);
      const insert = (col, method, extra = '') => admin.query(
        `INSERT INTO public.messenger_payment_types (code, name, version, applies_to, method, ${col}, valid_from${extra ? `, ${extra.split('=')[0]}` : ''})
         VALUES ('t','t',1,'remittance',$1,'NaN'::numeric, now()${extra ? `, '${extra.split('=')[1]}'` : ''})`, [method]);
      for (const [col, method, extra] of [['fixed_amount', 'fixed_amount'], ['fixed_cup', 'fixed_cup'],
        ['cup_per_usd', 'per_usd_delivered', 'base=nominal_usd'], ['percent', 'percent_of_base', 'base=nominal_usd']]) {
        expect((await failure(insert(col, method, extra))).code, col).toBe('23514');
      }
      const tier = (col) => admin.query(
        `INSERT INTO public.messenger_payment_types (code, name, version, applies_to, method, fixed_cup, ${col}, valid_from)
         VALUES ('t','t',1,'remittance','fixed_cup',1,'NaN'::numeric, now())`);
      expect((await failure(tier('amount_from'))).code).toBe('23514');
      expect((await failure(tier('amount_to'))).code).toBe('23514');
    });

    it('percent (3 decimals) and cup_per_usd (4 decimals) beyond their column scale are refused, never rounded', async () => {
      const pct = { method: 'percent_of_base', fixed_cup: null, base: 'nominal_usd' };
      const per = { method: 'per_usd_delivered', fixed_cup: null, base: 'nominal_usd' };
      for (const o of [{ ...pct, percent: 1.2345 }, { ...per, cup_per_usd: 1.23456 }]) {
        const c = await kit.as(actors.adminId);
        const e = await failure(kit.setRule(c, o));
        expect(e.code, JSON.stringify(o)).toBe('22023');
        expect(e.message).toMatch(/decimals/);
      }
      expect(await rules()).toEqual([]);
      const c = await kit.as(actors.adminId);
      await kit.setRule(c, { ...pct, code: 'p', percent: 1.235 });
      await kit.setRule(c, { ...per, code: 'q', cup_per_usd: 1.2346, type_id: await kit.seedType() });
      expect((await rules()).map((r) => [r.code, r.percent, r.cup_per_usd])).toEqual([['p', '1.235', null], ['q', null, '1.2346']]);
    });

    it('amounts above the column maximum (9999999999.99) are a typed 22023, not a raw overflow', async () => {
      for (const o of [fixed({ fixed_amount: 10000000000 }), fixed({ amount_from: 10000000000 }), fixed({ amount_to: 1e11 }), { fixed_cup: 10000000000 }]) {
        const c = await kit.as(actors.adminId);
        const e = await failure(kit.setRule(c, o));
        expect(e.code, JSON.stringify(o)).toBe('22023');
        expect(e.message).toMatch(/at most 9999999999\.99/);
      }
      const c = await kit.as(actors.adminId);
      await expect(kit.setRule(c, fixed({ fixed_amount: 9999999999.99 }))).resolves.toBeTruthy();
    });

    it('amounts with more than 2 decimals are refused (never silently rounded); from = to refused', async () => {
      await bad(fixed({ amount_to: 100.005 }));
      await bad(fixed({ amount_from: 0.001 }));
      await bad(fixed({ fixed_amount: 1.005 }));
      await bad(fixed({ amount_from: 100, amount_to: 100 }));
      expect(await rules()).toEqual([]);
    });

    it('reference boundaries (a,b] in exact cents: 0, 99.99, 100 -> R1; 100.01, 200 -> R2; 200.01 -> R3', async () => {
      const c = await kit.as(actors.adminId);
      await ladder(c, undefined, false); // the third rule closes every gap: saved without accepting anything
      for (const [amount, code] of [[0, 'R1'], [99.99, 'R1'], [100, 'R1'], [100.01, 'R2'], [200, 'R2'], [200.01, 'R3'], [1e9, 'R3']]) {
        expect(await resolve2('remittance', { amount }), String(amount)).toEqual({ code, reason: null });
      }
      // "up to Y" is stored with an open lower bound (covers 0.00), "more than X" with an open upper one
      const byCode = Object.fromEntries((await rules()).map((r) => [r.code, [r.amount_from, r.amount_to]]));
      expect(byCode).toEqual({ R1: [null, '100.00'], R2: ['100.00', '200.00'], R3: ['200.00', null] });
    });

    it('a ladder with a hole is a coverage_gap (22023, JSON detail) until accepted; the acceptance is audited', async () => {
      const c = await kit.as(actors.adminId);
      const e = await failure(ladder(c, { amount_from: 100.01, amount_to: 200 }, false));
      expect(e.code).toBe('22023');
      expect(e.message).toMatch(/^coverage_gap/);
      expect(JSON.parse(e.detail)).toEqual({ currency: 'USD', gaps: [{ kind: 'remittance', from: 100, to: 100.01 }] });
      expect((await rules()).map((r) => r.code).sort()).toEqual(['R1', 'R3']); // the refused rule left nothing behind
      const id = await kit.setRule(c, fixed({ code: 'R2', amount_from: 100.01, amount_to: 200, accept_gaps: true }));
      const { rows } = await admin.query(
        `SELECT new_value FROM public.financial_audit_log WHERE table_name = 'messenger_payment_types' AND row_id = $1 AND column_name = 'created'`, [id]);
      expect(JSON.parse(rows[0].new_value)).toMatchObject({
        accept_gaps: true, currency: 'USD', method: 'fixed_amount', fixed_amount: 5,
        gaps: [{ kind: 'remittance', from: 100, to: 100.01 }]
      });
      expect(await resolve2('remittance', { amount: 100.01 })).toEqual({ code: null, reason: 'no_tier_match' });
    });

    it('a ladder whose rule starts below the previous end is an overlap (23P01), not a gap', async () => {
      const c = await kit.as(actors.adminId);
      expect((await failure(ladder(c, { amount_from: 99.99, amount_to: 200 }, true))).code).toBe('23P01');
    });

    it('gaps at the start, between and at the end are all reported; a rule without tramo in the same scope covers them', async () => {
      const c = await kit.as(actors.adminId);
      const e = await failure(kit.setRule(c, fixed({ code: 'mid', amount_from: 50, amount_to: 60, applies_to: 'both', accept_gaps: false })));
      expect(JSON.parse(e.detail).gaps).toEqual([
        { kind: 'remittance', from: null, to: 50 }, { kind: 'remittance', from: 60, to: null },
        { kind: 'order', from: null, to: 50 }, { kind: 'order', from: 60, to: null }
      ]);
      await kit.setRule(c, fixed({ code: 'flat', applies_to: 'both' }));
      await expect(kit.setRule(c, fixed({ code: 'mid', amount_from: 50, amount_to: 60, applies_to: 'both', accept_gaps: false }))).resolves.toBeTruthy();
      // a rule of ANOTHER scope does not cover this one
      const zone = await kit.seedZone();
      expect((await failure(kit.setRule(c, fixed({ code: 'z', zone_id: zone, amount_from: 10, accept_gaps: false })))).message).toMatch(/coverage_gap/);
    });

    it('one currency per tiered scope (22023 mixed_currency_scope); another scope may use another currency', async () => {
      const c = await kit.as(actors.adminId);
      await kit.setRule(c, fixed({ code: 'u', amount_to: 100 }));
      const e = await failure(kit.setRule(c, fixed({ code: 'k', amount_from: 100, currency: 'CUP' })));
      expect(e.code).toBe('22023');
      expect(e.message).toMatch(/^mixed_currency_scope/);
      const zone = await kit.seedZone();
      await expect(kit.setRule(c, fixed({ code: 'k', amount_from: 100, currency: 'CUP', zone_id: zone }))).resolves.toBeTruthy();
      // a rule without tramo has no range to compare: its currency never conflicts
      await expect(kit.setRule(c, fixed({ code: 'flat', currency: 'CUP', fixed_amount: 300 }))).resolves.toBeTruthy();
    });

    it('resolver v2 converts the value to each candidate currency with the given live rate (no rate => no_fx, no fallback)', async () => {
      const c = await kit.as(actors.adminId);
      await kit.setRule(c, fixed({ code: 'flat' })); // lower precedence than any tramo of the same scope
      await kit.setRule(c, fixed({ code: 'low', currency: 'CUP', amount_to: 8300 }));
      await kit.setRule(c, fixed({ code: 'high', currency: 'CUP', amount_from: 8300 }));
      expect(await resolve2('remittance', { amount: 100, fx: 83 })).toEqual({ code: 'low', reason: null }); // 8300.00
      expect(await resolve2('remittance', { amount: 100.01, fx: 83 })).toEqual({ code: 'high', reason: null }); // 8300.83
      expect(await resolve2('remittance', { amount: 8300, currency: 'CUP' })).toEqual({ code: 'low', reason: null }); // same currency: no rate needed
      expect(await resolve2('remittance', { amount: 100, fx: null })).toEqual({ code: null, reason: 'no_fx' }); // never 'flat'
      expect(await resolve2('remittance', { amount: 100, currency: 'EUR', fx: 83 })).toEqual({ code: null, reason: 'no_fx' });
    });

    it('resolver v2: USD tramo with a CUP value divides by the rate; no_tier_match vs no_rule', async () => {
      const c = await kit.as(actors.adminId);
      expect(await resolve2('order', { amount: 5 })).toEqual({ code: null, reason: 'no_rule' });
      await kit.setRule(c, fixed({ code: 'u', applies_to: 'order', amount_to: 100 }));
      expect(await resolve2('order', { amount: 8300, currency: 'CUP', fx: 83 })).toEqual({ code: 'u', reason: null });
      expect(await resolve2('order', { amount: 8300.83, currency: 'CUP', fx: 83 })).toEqual({ code: null, reason: 'no_tier_match' });
      expect(await resolve2('order', { amount: 8300, currency: 'CUP', fx: null })).toEqual({ code: null, reason: 'no_fx' });
      expect(await resolve2('remittance', { amount: 5 })).toEqual({ code: null, reason: 'no_rule' });
    });

    it('resolver v2 keeps the precedence of v1 (courier > zone > type > tramo > general)', async () => {
      const c = await kit.as(actors.adminId);
      const zone = await kit.seedZone();
      const courier = await kit.makeCourier();
      await kit.setRule(c, { code: 'general' });
      await kit.setRule(c, { code: 'tramo', amount_from: 50, amount_to: 200 });
      await kit.setRule(c, { code: 'zone', zone_id: zone });
      await kit.setRule(c, { code: 'courier', courier_id: courier });
      expect((await resolve2('remittance', { amount: 100 })).code).toBe('tramo');
      expect((await resolve2('remittance', { amount: 50 })).code).toBe('general');
      expect((await resolve2('remittance', { zone, amount: 100 })).code).toBe('zone');
      expect((await resolve2('remittance', { courier, zone, amount: 100 })).code).toBe('courier');
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
