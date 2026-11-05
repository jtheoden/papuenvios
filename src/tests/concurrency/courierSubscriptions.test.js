/**
 * Courier payment types, phase B (20261105160000_courier_payment_type_subscriptions.sql): an admin subscribes a courier
 * to a GENERAL payment type (by code). For that courier the subscribed type ranks as a courier rule; every other courier
 * keeps resolving it as a general rule. Overlaps / mixed currency / gaps are validated on the courier's EFFECTIVE set
 * (own rules + subscribed ones). Subscriptions are append-only: a cancellation closes the row, re-subscribing adds one.
 *
 * Every amount here is a TEST value passed through the admin RPCs (the migration seeds nothing).
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { dbSuiteSkipReason, connectAdmin, connectAnon, endAll, fireTogether } from './db';
import { loadActors } from './fixtures';
import { MIGRATIONS, ROLLBACKS, failure, readSql, makeKit } from './courierTestKit';

const skipReason = await dbSuiteSkipReason({
  functions: ['is_admin_user', 'remittance_confirm_delivery', 'admin_set_messenger_payment_type_v2'],
  tables: ['remittances', 'messenger_payment_types', 'courier_accruals', 'financial_audit_log']
});
const describeDb = skipReason ? describe.skip : describe;

const strip = (sql) => sql.replace(/^\s*(BEGIN|COMMIT);\s*$/gm, '');
/** Text of `CREATE OR REPLACE FUNCTION public.<name>(` up to its closing `$function$;`. */
const fnBlock = (sql, name) => {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  if (start < 0) return null;
  const end = sql.indexOf('$function$;', start);
  return sql.slice(start, end + '$function$;'.length);
};
// function -> migration whose body B starts from (the rollback restores that body verbatim)
const SOURCES = {
  _courier_rule_resolve_v2: 'a', _courier_rule_coverage: 'a', admin_set_messenger_payment_type_v2: 'a', _courier_compute_accrual: 'a',
  admin_deactivate_messenger_payment_type: 'm1'
};
const REPLACED = Object.keys(SOURCES);
const TABLE = 'courier_payment_type_subscriptions';

describe('phase B migration hygiene (static)', () => {
  const sql = readSql(MIGRATIONS.b);
  const code = sql.replace(/--.*$/gm, '');
  const down = readSql(ROLLBACKS.b);

  it('runs in one transaction with lock_timeout, documents its rollback, pins search_path', () => {
    expect(sql.split('\n').slice(0, 50).join('\n')).toMatch(/ROLLBACK/);
    expect(code).toMatch(/^BEGIN;/m);
    expect(code).toMatch(/SET LOCAL lock_timeout = '5s'/);
    expect(code.trimEnd().endsWith('COMMIT;')).toBe(true);
    for (const m of code.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)\([\s\S]*?AS \$function\$/g)) {
      expect(m[0], m[1]).toMatch(/SET search_path = public, pg_temp/);
    }
  });

  it('is additive: only the new table is created/altered, no top-level DML, no TRUNCATE/DROP of data objects', () => {
    expect(code).not.toMatch(/\bTRUNCATE\b/i);
    expect(code).not.toMatch(/DROP\s+(TABLE|COLUMN|FUNCTION|VIEW)\b/i);
    expect(code).not.toMatch(/CREATE TABLE (?!IF NOT EXISTS public\.courier_payment_type_subscriptions)/);
    expect(code).not.toMatch(/CREATE (UNIQUE )?INDEX (?!IF NOT EXISTS)/);
    expect(code).not.toMatch(/CREATE FUNCTION/);
    for (const m of code.matchAll(/ALTER TABLE\s+(?:ONLY\s+)?public\.(\w+)/gi)) expect(m[1]).toBe(TABLE);
    const topLevel = code.replace(/\$function\$[\s\S]*?\$function\$/g, '');
    expect(topLevel).not.toMatch(/^\s*(DELETE\s+FROM|UPDATE\s|INSERT\s+INTO)/im);
    // triggers / policies only on the new table, each preceded by DROP ... IF EXISTS (re-runnable)
    for (const m of code.matchAll(/CREATE\s+(TRIGGER|POLICY)\s+(\w+)[\s\S]*?\bON\s+public\.(\w+)/gi)) {
      expect(m[3]).toBe(TABLE);
      expect(code).toMatch(new RegExp(`DROP ${m[1]} IF EXISTS ${m[2]} ON public\\.${TABLE}`, 'i'));
    }
  });

  it('replaces only the phase A / M1 functions it must, and never the transitions / platform reset', () => {
    const replaced = [...code.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)\(/g)].map((m) => m[1]);
    const allowed = [...REPLACED, 'courier_payment_type_subscriptions_guard', '_courier_effective_conflict',
      'admin_subscribe_courier_payment_type', 'admin_unsubscribe_courier_payment_type', '_courier_subscriber_gaps'];
    for (const f of replaced) expect(allowed).toContain(f);
    for (const f of REPLACED) expect(replaced).toContain(f);
    expect(code).not.toMatch(/execute_platform_reset|_(order|remittance)_transition/);
    const bodies = code.match(/\$function\$[\s\S]*?\$function\$/g) ?? [];
    for (const b of bodies) expect(b).not.toMatch(/\bEXECUTE\b/i);
  });

  it('the rollback restores the phase A bodies of the replaced functions verbatim', () => {
    for (const f of REPLACED) {
      const source = readSql(MIGRATIONS[SOURCES[f]]);
      expect(fnBlock(down, f), f).not.toBeNull();
      expect(fnBlock(down, f), f).toBe(fnBlock(source, f));
    }
    // the guard on phase A columns comes before anything is dropped
    expect(down.indexOf("column_name = 'currency'")).toBeGreaterThan(0);
    expect(down.indexOf("column_name = 'currency'")).toBeLessThan(down.indexOf('DROP FUNCTION'));
    expect(down).toMatch(/app\.confirm_courier_rollback/);
    expect(down).toMatch(/^BEGIN;/m);
    expect(down).toMatch(/SET LOCAL lock_timeout/);
  });
});

describeDb('phase B: courier subscriptions to payment types (local Postgres)', () => {
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

  const adminClient = () => kit.as(actors.adminId);
  const fixed = (o) => ({ method: 'fixed_amount', fixed_cup: null, fixed_amount: 5, ...o });
  const subs = async () => (await admin.query(`SELECT * FROM public.${TABLE} ORDER BY created_at, id`)).rows;
  const resolve2 = async (kind, { courier = null, zone = null, type = null, amount = 100, currency = 'USD', fx = null } = {}) => {
    const { rows } = await admin.query(
      `SELECT m.code, r.reason FROM public._courier_rule_resolve_v2($1, $2::uuid, $3::uuid, $4::uuid, $5::numeric, $6, $7::numeric) r
         LEFT JOIN public.messenger_payment_types m ON m.id = r.rule_id`, [kind, courier, zone, type, amount, currency, fx]);
    return rows[0];
  };

  describe('schema and access', () => {
    it('table shape, partial unique index on active pairs, index by code', async () => {
      const { rows } = await admin.query(
        `SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = $1 ORDER BY ordinal_position`, [TABLE]);
      expect(rows.map((r) => r.column_name)).toEqual(
        ['id', 'courier_id', 'payment_type_code', 'is_active', 'created_by', 'created_at', 'deactivated_by', 'deactivated_at']);
      const idx = (await admin.query(`SELECT indexdef FROM pg_indexes WHERE tablename = $1`, [TABLE])).rows.map((r) => r.indexdef).join('\n');
      expect(idx).toMatch(/UNIQUE INDEX \w+ ON public\.courier_payment_type_subscriptions USING btree \(courier_id, payment_type_code\) WHERE is_active/);
      expect(idx).toMatch(/INDEX \w+ ON public\.courier_payment_type_subscriptions USING btree \(payment_type_code\)/);
      const fk = (await admin.query(`SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conrelid = 'public.${TABLE}'::regclass AND contype = 'f'`)).rows;
      expect(fk.map((r) => r.d)).toEqual(['FOREIGN KEY (courier_id) REFERENCES couriers(id) ON DELETE RESTRICT']);
    });

    it('anon / service_role have no privilege, authenticated only SELECT; a customer reads zero rows (RLS)', async () => {
      const c = await adminClient();
      const courier = await kit.makeCourier();
      await kit.setRule(c, { code: 'g' });
      await kit.subscribe(c, courier, 'g');
      const { rows: priv } = await admin.query(
        `SELECT p AS priv, has_table_privilege('anon', $1, p) AS anon, has_table_privilege('authenticated', $1, p) AS auth,
                has_table_privilege('service_role', $1, p) AS svc
           FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE']) p`, [`public.${TABLE}`]);
      for (const r of priv) expect({ p: r.priv, anon: r.anon, svc: r.svc, auth: r.auth }).toEqual({ p: r.priv, anon: false, svc: false, auth: r.priv === 'SELECT' });
      const anon = await connectAnon();
      kit.clients.push(anon);
      expect((await failure(anon.query(`SELECT * FROM public.${TABLE}`))).code).toBe('42501');
      const customer = await kit.as(actors.customerId);
      expect((await customer.query(`SELECT * FROM public.${TABLE}`)).rowCount).toBe(0);
      expect((await failure(customer.query(`INSERT INTO public.${TABLE} (courier_id, payment_type_code) VALUES ($1, 'g')`, [courier]))).code).toBe('42501');
      expect((await c.query(`SELECT * FROM public.${TABLE}`)).rowCount).toBe(1);
      const rls = (await admin.query(`SELECT relrowsecurity FROM pg_class WHERE oid = 'public.${TABLE}'::regclass`)).rows[0];
      expect(rls.relrowsecurity).toBe(true);
    });

    it('RPCs are SECURITY DEFINER, authenticated-only; customer and disabled admin refused (42501); helpers closed', async () => {
      const fns = ['admin_subscribe_courier_payment_type', 'admin_unsubscribe_courier_payment_type'];
      const { rows } = await admin.query(
        `SELECT proname, prosecdef, has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
                has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth, proconfig
           FROM pg_proc p WHERE pronamespace = 'public'::regnamespace AND proname = ANY($1)`, [fns]);
      expect(rows).toHaveLength(2);
      for (const r of rows) {
        expect({ d: r.prosecdef, a: r.anon, u: r.auth }).toEqual({ d: true, a: false, u: true });
        expect(r.proconfig.join(',')).toMatch(/search_path=public, pg_temp/);
      }
      for (const fn of ['_courier_effective_conflict', 'courier_payment_type_subscriptions_guard', '_courier_rule_resolve_v2', '_courier_rule_coverage']) {
        const { rows: h } = await admin.query(
          `SELECT bool_or(has_function_privilege('authenticated', p.oid, 'EXECUTE')) AS auth, bool_or(has_function_privilege('anon', p.oid, 'EXECUTE')) AS anon
             FROM pg_proc p WHERE pronamespace = 'public'::regnamespace AND proname = $1`, [fn]);
        expect(h[0], fn).toEqual({ auth: false, anon: false });
      }
      const c = await adminClient();
      const courier = await kit.makeCourier();
      await kit.setRule(c, { code: 'g' });
      const customer = await kit.as(actors.customerId);
      expect((await failure(kit.subscribe(customer, courier, 'g'))).code).toBe('42501');
      expect((await failure(kit.unsubscribe(customer, courier, 'g'))).code).toBe('42501');
      await kit.setRole(actors.adminId, 'admin', false);
      const disabled = await adminClient();
      expect((await failure(kit.subscribe(disabled, courier, 'g'))).code).toBe('42501');
      await kit.restoreActors();
      expect(await subs()).toEqual([]);
    });
  });

  describe('subscribe / unsubscribe', () => {
    it('subscribes, audits, is idempotent; unsubscribing closes the row (1 then 0); re-subscribing adds a NEW row', async () => {
      const c = await adminClient();
      const courier = await kit.makeCourier();
      await kit.setRule(c, { code: 'g' });
      const id = await kit.subscribe(c, courier, '  g  ');
      expect(await kit.subscribe(c, courier, 'g')).toBe(id); // idempotent: same active row
      let rows = await subs();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ id, courier_id: courier, payment_type_code: 'g', is_active: true, created_by: actors.adminId, deactivated_at: null });
      expect(await kit.unsubscribe(c, courier, 'g')).toBe(1);
      expect(await kit.unsubscribe(c, courier, 'g')).toBe(0);
      rows = await subs();
      expect(rows[0]).toMatchObject({ is_active: false, deactivated_by: actors.adminId });
      expect(rows[0].deactivated_at).not.toBeNull();
      const again = await kit.subscribe(c, courier, 'g');
      expect(again).not.toBe(id);
      rows = await subs();
      expect(rows.map((r) => r.is_active)).toEqual([false, true]);
      const audit = (await admin.query(
        `SELECT column_name, old_value, new_value, changed_by FROM public.financial_audit_log
          WHERE table_name = $1 AND row_id = ANY($2) ORDER BY changed_at, id`, [TABLE, [id, again]])).rows;
      expect(audit.map((a) => a.column_name)).toEqual(['created', 'is_active', 'created']);
      expect(JSON.parse(audit[0].new_value)).toMatchObject({ courier_id: courier, code: 'g', accept_gaps: false });
      expect(audit[1]).toMatchObject({ old_value: 'true', new_value: 'false', changed_by: actors.adminId });
    });

    it('two concurrent subscriptions of the same pair leave exactly one active row (same id returned)', async () => {
      const c = await adminClient();
      const courier = await kit.makeCourier();
      await kit.setRule(c, { code: 'g' });
      const [a, b] = [await adminClient(), await adminClient()];
      const sql = 'SELECT public.admin_subscribe_courier_payment_type($1::uuid, $2, false)';
      const res = await fireTogether([{ client: a, sql, params: [courier, 'g'] }, { client: b, sql, params: [courier, 'g'] }]);
      expect(res.map((r) => r.error)).toEqual([undefined, undefined]);
      expect(res[0].value).toBe(res[1].value);
      expect((await subs()).filter((r) => r.is_active)).toHaveLength(1);
    });

    it('refuses an inactive courier, an unknown code, a code without an active version and a code owned by another courier', async () => {
      const c = await adminClient();
      const courier = await kit.makeCourier();
      const other = await kit.makeCourier();
      const off = await kit.makeCourier();
      await kit.call(c, 'admin_upsert_courier', [off, 'Off', null, null, false]);
      await kit.setRule(c, { code: 'g' });
      await kit.setRule(c, { code: 'theirs', courier_id: other });
      await kit.setRule(c, { code: 'mine', courier_id: courier, zone_id: await kit.seedZone() });
      await kit.setRule(c, { code: 'dead', zone_id: await kit.seedZone() });
      await kit.call(c, 'admin_deactivate_messenger_payment_type', ['dead']);
      for (const [cid, code] of [[off, 'g'], [courier, 'nope'], [courier, 'dead'], [courier, 'theirs'], [courier, ''], [null, 'g']]) {
        const e = await failure(kit.subscribe(c, cid, code));
        expect(e.code, `${code}`).toBe('22023');
      }
      expect((await failure(kit.subscribe(c, courier, 'theirs'))).message).toMatch(/another courier/);
      // its own code is accepted (redundant but harmless)
      await kit.subscribe(c, courier, 'mine');
      expect((await subs()).map((r) => r.payment_type_code)).toEqual(['mine']);
    });
  });

  describe('deactivating a subscribed code (no inert subscription that revives)', () => {
    it('closes every active subscription, audits the affected couriers; recreating the code revives nothing', async () => {
      const c = await adminClient();
      const zone = await kit.seedZone();
      const x = await kit.makeCourier();
      const y = await kit.makeCourier();
      const gid = await kit.setRule(c, { code: 'g', fixed_cup: 300 });
      const sx = await kit.subscribe(c, x, 'g');
      const sy = await kit.subscribe(c, y, 'g');
      expect(await kit.call(c, 'admin_deactivate_messenger_payment_type', ['g'])).toEqual([{ admin_deactivate_messenger_payment_type: 1 }]);
      expect(await resolve2('remittance', { courier: x })).toEqual({ code: null, reason: 'no_rule' });
      const rows = await subs();
      expect(rows.map((r) => [r.id, r.is_active, r.deactivated_by])).toEqual(
        expect.arrayContaining([[sx, false, actors.adminId], [sy, false, actors.adminId]]));
      expect(rows.every((r) => r.deactivated_at)).toBe(true);
      const closed = (await admin.query(
        `SELECT row_id FROM public.financial_audit_log WHERE table_name = $1 AND column_name = 'is_active' AND new_value = 'false' AND row_id = ANY($2)`,
        [TABLE, [sx, sy]])).rows;
      expect(closed.map((r) => r.row_id).sort()).toEqual([sx, sy].sort());
      const summary = (await admin.query(
        `SELECT new_value FROM public.financial_audit_log WHERE table_name = 'messenger_payment_types' AND column_name = 'subscriptions_closed' AND row_id = $1`,
        [gid])).rows;
      expect(summary).toHaveLength(1);
      const s = JSON.parse(summary[0].new_value);
      expect(s).toMatchObject({ code: 'g' });
      expect(s.couriers.sort()).toEqual([x, y].sort());
      expect(s.subscriber_gaps).toEqual([]); // neither has courier-level tramos left in that scope: general rules apply
      // recreated from scratch: a general rule again for everybody, never with courier precedence for x
      await kit.setRule(c, { code: 'zone', zone_id: zone });
      await kit.setRule(c, { code: 'g', fixed_cup: 999 });
      expect((await resolve2('remittance', { courier: x, zone })).code).toBe('zone');
      expect((await subs()).filter((r) => r.is_active)).toEqual([]);
    });

    it('a subscription to an EXPIRED code (valid_to passed, still is_active) does not revive silently with the next version', async () => {
      const c = await adminClient();
      const typeId = await kit.seedType();
      const k1 = await kit.makeCourier();
      await kit.setRule(c, { code: 'e', valid_to: new Date(Date.now() + 1500).toISOString() });
      await kit.subscribe(c, k1, 'e');
      await new Promise((r) => setTimeout(r, 1700));
      const e = await failure(kit.setRule(c, { code: 'e', fixed_cup: 777, accept_gaps: false }));
      expect(e.code).toBe('22023');
      expect(e.message).toMatch(/stale_subscribers/);
      expect(JSON.parse(e.detail)).toEqual({ code: 'e', couriers: [k1] });
      // confirmed explicitly: saved, and the audit names the subscriber that starts paying with it again
      const id = await kit.setRule(c, { code: 'e', fixed_cup: 777, accept_gaps: true });
      const audit = (await admin.query(
        `SELECT new_value FROM public.financial_audit_log WHERE table_name = 'messenger_payment_types' AND row_id = $1 AND column_name = 'created'`, [id])).rows;
      expect(JSON.parse(audit[0].new_value).stale_subscribers).toEqual([k1]);
      const r = await kit.seedRemittance({ typeId });
      await kit.call(c, 'admin_assign_delivery_courier', ['remittance', r, k1]);
      await kit.deliverRemittance(r);
      const [acc] = await kit.accruals(r);
      expect(acc).toMatchObject({ amount_cup: '777.00' });
      expect(acc.rule_snapshot.via_subscription).toBe(true);
    });

    it('set_v2 refuses to recreate a deactivated code while active subscriptions to it remain (state left by older code)', async () => {
      const c = await adminClient();
      const x = await kit.makeCourier();
      await kit.setRule(c, { code: 'g' });
      await kit.subscribe(c, x, 'g');
      await admin.query(`UPDATE public.messenger_payment_types SET is_active = false WHERE code = 'g'`); // as M1 used to leave it
      const e = await failure(kit.setRule(c, { code: 'g' }));
      expect(e.code).toBe('22023');
      expect(e.message).toMatch(/active subscriptions/);
      expect(e.detail).toContain(x);
    });
  });

  describe('validation on the effective set (own rules + subscribed)', () => {
    it('overlap between an own tramo and a subscribed tramo is refused (23P01) and leaves no row', async () => {
      const c = await adminClient();
      const courier = await kit.makeCourier();
      await kit.setRule(c, fixed({ code: 'own', courier_id: courier, amount_to: 100 }));
      await kit.setRule(c, fixed({ code: 'g', amount_from: 50, amount_to: 150 }));
      const e = await failure(kit.subscribe(c, courier, 'g', true));
      expect(e.code).toBe('23P01');
      expect(e.message).toMatch(/overlapping_rule/);
      expect(await subs()).toEqual([]);
    });

    it('overlap between two subscribed types of the same scope (own code + general code) is refused', async () => {
      const c = await adminClient();
      const courier = await kit.makeCourier();
      await kit.setRule(c, { code: 'own', courier_id: courier });
      await kit.setRule(c, { code: 'g' });
      await kit.subscribe(c, courier, 'own');
      expect((await failure(kit.subscribe(c, courier, 'g'))).code).toBe('23P01');
    });

    it('mixed currency in one tiered scope is refused (mixed_currency_scope)', async () => {
      const c = await adminClient();
      const courier = await kit.makeCourier();
      await kit.setRule(c, fixed({ code: 'own', courier_id: courier, amount_to: 100 }));
      await kit.setRule(c, fixed({ code: 'g', currency: 'CUP', amount_from: 83000 }));
      const e = await failure(kit.subscribe(c, courier, 'g', true));
      expect(e.code).toBe('22023');
      expect(e.message).toMatch(/mixed_currency_scope/);
    });

    it('gaps of the effective ladder need p_accept_gaps (coverage_gap with JSON DETAIL); accepted ones are audited', async () => {
      const c = await adminClient();
      const courier = await kit.makeCourier();
      await kit.setRule(c, fixed({ code: 'own', courier_id: courier, amount_to: 100 }));
      await kit.setRule(c, fixed({ code: 'g', amount_from: 200 }));
      const e = await failure(kit.subscribe(c, courier, 'g'));
      expect(e.code).toBe('22023');
      expect(e.message).toMatch(/coverage_gap/);
      expect(JSON.parse(e.detail)).toEqual({ currency: 'USD', gaps: [{ kind: 'remittance', from: 100, to: 200 }] });
      expect(await subs()).toEqual([]);
      const sid = await kit.subscribe(c, courier, 'g', true);
      const audit = (await admin.query(`SELECT new_value FROM public.financial_audit_log WHERE table_name = $1 AND row_id = $2 AND column_name = 'created'`, [TABLE, sid])).rows;
      expect(JSON.parse(audit[0].new_value)).toMatchObject({ accept_gaps: true, gaps: [{ kind: 'remittance', from: 100, to: 200 }] });
      // the general ladder alone has its own gaps, but a complete effective ladder needs no confirmation
      await kit.unsubscribe(c, courier, 'g');
      await kit.setRule(c, fixed({ code: 'own2', courier_id: courier, amount_from: 100, amount_to: 200 }));
      await kit.subscribe(c, courier, 'g');
    });

    it('set_v2: a new own rule overlapping a subscribed type is refused (23P01)', async () => {
      const c = await adminClient();
      const courier = await kit.makeCourier();
      await kit.setRule(c, fixed({ code: 'g', amount_to: 100 }));
      await kit.subscribe(c, courier, 'g', true);
      expect((await failure(kit.setRule(c, fixed({ code: 'own', courier_id: courier, amount_from: 50, amount_to: 150 })))).code).toBe('23P01');
      expect((await failure(kit.setRule(c, fixed({ code: 'own', courier_id: courier, currency: 'CUP', amount_from: 83000 })))).message).toMatch(/mixed_currency_scope/);
      // non-overlapping own tramo is fine; and another courier is not affected by the subscription
      await kit.setRule(c, fixed({ code: 'own', courier_id: courier, amount_from: 100 }));
      const other = await kit.makeCourier();
      await kit.setRule(c, fixed({ code: 'other', courier_id: other, amount_from: 50, amount_to: 150 }));
    });

    it('set_v2: a new version of a subscribed code that would overlap a subscriber own rule is refused; a compatible one passes', async () => {
      const c = await adminClient();
      const courier = await kit.makeCourier();
      await kit.setRule(c, fixed({ code: 'g', amount_to: 100 }));
      await kit.setRule(c, fixed({ code: 'own', courier_id: courier, amount_from: 100 }));
      await kit.subscribe(c, courier, 'g');
      const at = (s) => new Date(Date.now() + s * 1000).toISOString();
      const e = await failure(kit.setRule(c, fixed({ code: 'g', amount_to: 150, valid_from: at(60) })));
      expect(e.code).toBe('23P01');
      await kit.setRule(c, fixed({ code: 'g', amount_to: 100, fixed_amount: 7, valid_from: at(60) }));
      const versions = (await admin.query(`SELECT version FROM public.messenger_payment_types WHERE code = 'g' ORDER BY version`)).rows;
      expect(versions.map((v) => v.version)).toEqual([1, 2]);
    });

    it('set_v2: a new version of a subscribed code reports the gaps it opens for EACH subscriber (DETAIL + audit)', async () => {
      const c = await adminClient();
      const x = await kit.makeCourier();
      await kit.setRule(c, fixed({ code: 'g', amount_to: 100 }));
      await kit.setRule(c, fixed({ code: 'own', courier_id: x, amount_from: 100 }));
      await kit.subscribe(c, x, 'g'); // x: [0,100] + (100,inf): complete
      const at = new Date(Date.now() + 60000).toISOString();
      const e = await failure(kit.setRule(c, fixed({ code: 'g', amount_to: 50, valid_from: at, accept_gaps: false })));
      expect(e.message).toMatch(/coverage_gap/);
      const d = JSON.parse(e.detail);
      expect(d.subscribers).toEqual([{ courier_id: x, gaps: [{ kind: 'remittance', from: 50, to: 100 }] }]);
      expect(d.gaps).toEqual(expect.arrayContaining([{ kind: 'remittance', from: 50, to: 100 }]));
      const id = await kit.setRule(c, fixed({ code: 'g', amount_to: 50, valid_from: at, accept_gaps: true }));
      const audit = (await admin.query(
        `SELECT new_value FROM public.financial_audit_log WHERE table_name = 'messenger_payment_types' AND row_id = $1 AND column_name = 'created'`, [id])).rows;
      expect(JSON.parse(audit[0].new_value).subscriber_gaps).toEqual([{ courier_id: x, gaps: [{ kind: 'remittance', from: 50, to: 100 }] }]);
    });

    it('set_v2: subscriber gaps alone (the general ladder is complete) still need p_accept_gaps', async () => {
      const c = await adminClient();
      const x = await kit.makeCourier();
      await kit.setRule(c, fixed({ code: 'g', amount_to: 100 }));
      await kit.setRule(c, fixed({ code: 'h', amount_from: 100 }));
      await kit.setRule(c, fixed({ code: 'own', courier_id: x, amount_from: 200 }));
      await kit.subscribe(c, x, 'g', true); // x: [0,100] + (200,inf)
      const at = new Date(Date.now() + 60000).toISOString();
      // general ladder g v2 [0,100] + h: complete; x keeps its (100,200] gap
      const e = await failure(kit.setRule(c, fixed({ code: 'g', amount_to: 100, fixed_amount: 6, valid_from: at, accept_gaps: false })));
      expect(e.message).toMatch(/coverage_gap/);
      expect(JSON.parse(e.detail).gaps).toEqual([{ kind: 'remittance', from: 100, to: 200 }]);
    });

    it('deactivating a subscribed code reports the gaps it leaves in the subscribers own ladders', async () => {
      const c = await adminClient();
      const x = await kit.makeCourier();
      const gid = await kit.setRule(c, fixed({ code: 'g', amount_to: 100 }));
      await kit.setRule(c, fixed({ code: 'own', courier_id: x, amount_from: 100 }));
      await kit.subscribe(c, x, 'g');
      await kit.call(c, 'admin_deactivate_messenger_payment_type', ['g']);
      const summary = (await admin.query(
        `SELECT new_value FROM public.financial_audit_log WHERE table_name = 'messenger_payment_types' AND column_name = 'subscriptions_closed' AND row_id = $1`, [gid])).rows;
      expect(JSON.parse(summary[0].new_value).subscriber_gaps).toEqual([{ courier_id: x, gaps: [{ kind: 'remittance', from: null, to: 100 }] }]);
    });

    it('set_v2: a new version of a subscribed code cannot move it to another courier while someone else is subscribed', async () => {
      const c = await adminClient();
      const courier = await kit.makeCourier();
      const other = await kit.makeCourier();
      await kit.setRule(c, { code: 'g' });
      await kit.subscribe(c, courier, 'g');
      const at = new Date(Date.now() + 60000).toISOString();
      const e = await failure(kit.setRule(c, { code: 'g', courier_id: other, valid_from: at }));
      expect(e.code).toBe('22023');
      expect(e.message).toMatch(/subscribed/);
      // moving it to the subscriber itself is allowed
      await kit.setRule(c, { code: 'g', courier_id: courier, valid_from: at });
    });
  });

  describe('set_v2 keeps every phase A guard (NaN, amount cap, decimals) with B applied', () => {
    it('refuses NaN, amounts above 9999999999.99 and over-precise percent / cup_per_usd (22023), for owners and subscribers alike', async () => {
      const c = await adminClient();
      const courier = await kit.makeCourier();
      await kit.setRule(c, { code: 'g' });
      await kit.subscribe(c, courier, 'g');
      for (const [o, msg] of [
        [fixed({ code: 'g', fixed_amount: 'NaN' }), /NaN/],
        [fixed({ code: 'n', courier_id: courier, amount_from: 'NaN' }), /NaN/],
        [fixed({ code: 'n', courier_id: courier, fixed_amount: 10000000000 }), /9999999999\.99/],
        [{ code: 'n', courier_id: courier, method: 'percent_of_base', fixed_cup: null, percent: 1.0005, base: 'nominal_usd' }, /decimals/],
        [{ code: 'n', courier_id: courier, method: 'per_usd_delivered', fixed_cup: null, cup_per_usd: 1.00005, base: 'nominal_usd' }, /decimals/]
      ]) {
        const e = await failure(kit.setRule(c, { ...o, valid_from: new Date(Date.now() + 60000).toISOString() }));
        expect(e.code, JSON.stringify(o)).toBe('22023');
        expect(e.message).toMatch(msg);
      }
    });
  });

  describe('resolver v2: subscribed type ranks as a courier rule', () => {
    it('subscribed > general zone > general; a non-subscribed courier keeps the general precedence; own beats subscribed', async () => {
      const c = await adminClient();
      const zone = await kit.seedZone();
      const x = await kit.makeCourier();
      const y = await kit.makeCourier();
      await kit.setRule(c, { code: 'flat' });
      await kit.setRule(c, { code: 'zone', zone_id: zone });
      expect((await resolve2('remittance', { courier: x, zone })).code).toBe('zone');
      await kit.subscribe(c, x, 'flat');
      expect((await resolve2('remittance', { courier: x, zone })).code).toBe('flat');
      expect((await resolve2('remittance', { courier: y, zone })).code).toBe('zone');
      expect((await resolve2('remittance', { courier: y })).code).toBe('flat'); // general for everyone else
      expect((await resolve2('remittance', { zone })).code).toBe('zone'); // no courier
      // an own zone rule of x beats the subscribed flat one (both courier level, zone wins next)
      await kit.setRule(c, { code: 'ownz', courier_id: x, zone_id: zone });
      expect((await resolve2('remittance', { courier: x, zone })).code).toBe('ownz');
      expect((await resolve2('remittance', { courier: x })).code).toBe('flat');
      await kit.unsubscribe(c, x, 'flat');
      expect((await resolve2('remittance', { courier: x })).code).toBe('flat'); // general again, still applies
      expect((await resolve2('remittance', { courier: y, zone })).code).toBe('zone');
    });

    it('a subscribed tramo outranks a general zone rule for that courier only', async () => {
      const c = await adminClient();
      const zone = await kit.seedZone();
      const x = await kit.makeCourier();
      await kit.setRule(c, fixed({ code: 'low', amount_to: 100 }));
      await kit.setRule(c, { code: 'zone', zone_id: zone });
      await kit.subscribe(c, x, 'low', true);
      expect((await resolve2('remittance', { courier: x, zone, amount: 50 })).code).toBe('low');
      // above the subscribed tramo nothing of courier level matches: falls to the general zone rule (same as phase A)
      expect((await resolve2('remittance', { courier: x, zone, amount: 150 })).code).toBe('zone');
    });
  });

  describe('history: the cost is frozen at delivery', () => {
    it('unsubscribing after the delivery leaves the accrual intact; before the delivery the rule changes', async () => {
      const c = await adminClient();
      const typeId = await kit.seedType();
      const zone = await kit.seedZone();
      const x = await kit.makeCourier();
      await kit.setRule(c, { code: 'sub', fixed_cup: 300 });
      await kit.setRule(c, { code: 'zone', zone_id: zone, fixed_cup: 100 });
      await kit.subscribe(c, x, 'sub');

      const deliver = async () => {
        const id = await kit.seedRemittance({ typeId, zoneId: zone });
        await kit.call(c, 'admin_assign_delivery_courier', ['remittance', id, x]);
        return id;
      };
      const first = await deliver();
      await kit.deliverRemittance(first);
      const [a1] = await kit.accruals(first);
      expect(a1).toMatchObject({ amount_cup: '300.00', courier_id: x });
      expect(a1.rule_snapshot.rule.code).toBe('sub');
      expect(a1.rule_snapshot.via_subscription).toBe(true);

      const pending = await deliver(); // assigned, not yet delivered
      await kit.unsubscribe(c, x, 'sub');
      expect(await kit.accruals(first)).toEqual([a1]); // byte-identical after the cancellation
      await kit.deliverRemittance(pending);
      const [a2] = await kit.accruals(pending);
      expect(a2).toMatchObject({ amount_cup: '100.00' });
      expect(a2.rule_snapshot.rule.code).toBe('zone');
      expect(a2.rule_snapshot).not.toHaveProperty('via_subscription');
    });
  });

  describe('append-only guard', () => {
    it('forbids DELETE, reactivation and any change other than closing with deactivated_*', async () => {
      const c = await adminClient();
      const x = await kit.makeCourier();
      const y = await kit.makeCourier();
      await kit.setRule(c, { code: 'g' });
      const id = await kit.subscribe(c, x, 'g');
      expect((await failure(admin.query(`DELETE FROM public.${TABLE} WHERE id = $1`, [id]))).code).toBe('42501');
      expect((await failure(admin.query(`UPDATE public.${TABLE} SET courier_id = $2 WHERE id = $1`, [id, y]))).code).toBe('42501');
      expect((await failure(admin.query(`UPDATE public.${TABLE} SET payment_type_code = 'h' WHERE id = $1`, [id]))).code).toBe('42501');
      expect((await failure(admin.query(`UPDATE public.${TABLE} SET is_active = false WHERE id = $1`, [id]))).code).toMatch(/^(42501|23514)$/);
      await admin.query(`UPDATE public.${TABLE} SET is_active = false, deactivated_at = now(), deactivated_by = $2 WHERE id = $1`, [id, actors.adminId]);
      expect((await failure(admin.query(`UPDATE public.${TABLE} SET is_active = true, deactivated_at = NULL, deactivated_by = NULL WHERE id = $1`, [id]))).code).toBe('42501');
      expect((await failure(admin.query(`UPDATE public.${TABLE} SET deactivated_at = now() - interval '1 day' WHERE id = $1`, [id]))).code).toBe('42501');
      expect((await failure(admin.query(`DELETE FROM public.couriers WHERE id = $1`, [x]))).code).toBe('23503'); // ON DELETE RESTRICT
    });
  });

  describe('data safety, idempotency and rollback (inside a rolled-back transaction)', () => {
    const fingerprint = async () => {
      const out = {};
      for (const t of ['courier_accruals', 'messenger_payment_types', 'couriers', 'delivery_assignments', TABLE]) {
        out[t] = (await admin.query(`SELECT count(*)::int AS n, md5(COALESCE(string_agg(x::text, '|' ORDER BY x::text), '')) AS h FROM public.${t} x`)).rows[0];
      }
      return out;
    };
    const seedState = async () => {
      const c = await adminClient();
      const typeId = await kit.seedType();
      const x = await kit.makeCourier();
      const before = await kit.seedRemittance({ typeId });
      await kit.deliverRemittance(before); // existing no_rule accrual
      await kit.setRule(c, { code: 'g', fixed_cup: 300 });
      await kit.subscribe(c, x, 'g');
      const r = await kit.seedRemittance({ typeId });
      await kit.call(c, 'admin_assign_delivery_courier', ['remittance', r, x]);
      await kit.deliverRemittance(r);
      return { x };
    };

    it('re-applying B is a no-op for every existing row (accruals included)', async () => {
      await seedState();
      const before = await fingerprint();
      await admin.query('BEGIN');
      let during;
      try {
        await admin.query(strip(readSql(MIGRATIONS.b)));
        during = await fingerprint();
      } finally {
        await admin.query('ROLLBACK');
      }
      expect(during).toEqual(before);
    });

    it('rollback aborts (55000) while subscriptions exist, unless confirmed; then restores phase A exactly', async () => {
      await seedState();
      const defs = async () => (await admin.query(
        `SELECT proname, md5(pg_get_functiondef(p.oid)) AS h FROM pg_proc p
          WHERE pronamespace = 'public'::regnamespace AND proname = ANY($1) ORDER BY proname`, [REPLACED])).rows;
      await admin.query('BEGIN');
      try {
        const e = await admin.query(strip(readSql(ROLLBACKS.b))).then(() => null, (err) => err);
        expect(e?.code).toBe('55000');
      } finally {
        await admin.query('ROLLBACK');
      }
      const accrualsBefore = (await fingerprint()).courier_accruals;
      await admin.query('BEGIN');
      try {
        await admin.query(`SET LOCAL app.confirm_courier_rollback = 'yes'`);
        await admin.query(strip(readSql(ROLLBACKS.b)));
        const { rows } = await admin.query(
          `SELECT to_regclass('public.${TABLE}') IS NULL AS t,
                  to_regprocedure('public.admin_subscribe_courier_payment_type(uuid,text,boolean)') IS NULL AS s,
                  to_regprocedure('public.admin_unsubscribe_courier_payment_type(uuid,text)') IS NULL AS u,
                  to_regprocedure('public._courier_effective_conflict(uuid)') IS NULL AS h,
                  NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'courier_payment_type_subscriptions_guard') AS g`);
        expect(rows[0]).toEqual({ t: true, s: true, u: true, h: true, g: true });
        const afterRollback = await defs();
        await admin.query(strip(readSql(MIGRATIONS.a))); // phase A bodies, as shipped
        expect(await defs()).toEqual(afterRollback);
        expect((await admin.query(`SELECT count(*)::int AS n, md5(COALESCE(string_agg(x::text, '|' ORDER BY x::text), '')) AS h FROM public.courier_accruals x`)).rows[0]).toEqual(accrualsBefore);
        // and B re-applies cleanly on top
        await admin.query(strip(readSql(MIGRATIONS.b)));
      } finally {
        await admin.query('ROLLBACK');
      }
      expect((await admin.query(`SELECT to_regclass('public.${TABLE}') IS NOT NULL AS back`)).rows[0].back).toBe(true);
    });

    it('the rollback aborts (55000) when phase A is no longer there (currency column missing)', async () => {
      await admin.query('BEGIN');
      try {
        await admin.query('ALTER TABLE public.messenger_payment_types DROP COLUMN currency CASCADE');
        const e = await admin.query(strip(readSql(ROLLBACKS.b))).then(() => null, (err) => err);
        expect(e?.code).toBe('55000');
        expect(e?.message).toMatch(/phase A/);
      } finally {
        await admin.query('ROLLBACK');
      }
    });

    it('with no subscriptions the rollback runs without confirmation', async () => {
      await admin.query('BEGIN');
      try {
        await admin.query(strip(readSql(ROLLBACKS.b)));
        expect((await admin.query(`SELECT to_regclass('public.${TABLE}') IS NULL AS g`)).rows[0].g).toBe(true);
      } finally {
        await admin.query('ROLLBACK');
      }
    });

    it('platform reset keeps courier configuration: it touches neither couriers, rules nor subscriptions', async () => {
      const { rows } = await admin.query(`SELECT pg_get_functiondef('public.execute_platform_reset(text)'::regprocedure) AS d`);
      expect(rows[0].d).not.toMatch(/courier|messenger/);
    });
  });
});
