/** Phase C: local scratch PostgreSQL only; no production connection or backfill. */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { dbSuiteSkipReason, connectAdmin, connectAnon, endAll, fireTogether } from './db';
import { loadActors } from './fixtures';
import { MIGRATIONS, ROLLBACKS, failure, readSql, makeKit } from './courierTestKit';
const migration = 'supabase/migrations/20261105170000_courier_assign_after_delivery.sql';
const rollback = 'supabase/rollbacks/20261105170000_courier_assign_after_delivery_down.sql';
const strip = (sql) => sql.replace(/^\s*(BEGIN|COMMIT);\s*$/gm, '');
const fn = 'admin_assign_courier_after_delivery';
const skip = await dbSuiteSkipReason({ functions: ['admin_set_messenger_payment_type_v2'], tables: ['courier_accruals'] });
describe('phase C migration hygiene', () => {
  it('is PREPARED, NOT APPLIED, transactional, additive and replaces no existing function', () => {
    const sql = readSql(migration);
    expect(sql.slice(0, 2000)).toMatch(/PREPARED, NOT APPLIED/);
    expect(sql).toMatch(/^BEGIN;/m);
    expect(sql).toMatch(/SET LOCAL lock_timeout = '5s'/);
    expect(sql.trimEnd().endsWith('COMMIT;')).toBe(true);
    expect(sql).not.toMatch(/CREATE OR REPLACE|ALTER TABLE|CREATE TABLE/);
    const top = sql.replace(/\$function\$[\s\S]*?\$function\$/g, '').replace(/--.*$/gm, '');
    expect(top).not.toMatch(/\b(INSERT|UPDATE|DELETE|TRUNCATE)\b/);
    expect(readSql(rollback)).toMatch(/SET LOCAL lock_timeout = '5s'/);
  });
});
(skip ? describe.skip : describe)('phase C retroactive assignment (local PostgreSQL)', () => {
  let admin, actors, kit;
  beforeAll(async () => {
    admin = await connectAdmin(); actors = await loadActors(admin); kit = makeKit(admin, actors);
  });
  afterEach(async () => { await kit.cleanup(); });
  afterAll(async () => { await endAll([admin]); });
  const client = async () => { await kit.setRole(actors.adminId, 'super_admin'); return kit.as(actors.adminId); };
  const call = async (c, kind, id, courier, confirm = false, token = null, reason = 'Historical assignment') =>
    (await c.query(`SELECT public.${fn}($1,$2::uuid,$3::uuid,$4,$5,$6) AS result`, [kind, id, courier, reason, confirm, token])).rows[0].result;
  const seed = async (kind = 'remittance', over = {}) => {
    const c = await client(); const courier = await kit.makeCourier();
    const id = kind === 'order' ? await kit.seedDispatchedOrder() : await kit.seedRemittance({ typeId: await kit.seedType(), ...over });
    if (kind === 'order') await kit.deliverOrder(id); else await kit.deliverRemittance(id);
    return { c, courier, id, kind };
  };
  const preview = (s) => call(s.c, s.kind, s.id, s.courier);
  const confirm = (s, token, reason) => call(s.c, s.kind, s.id, s.courier, true, token, reason);
  const fingerprint = async () => (await admin.query(`SELECT md5(COALESCE(string_agg(x::text,'|' ORDER BY x::text),'')) AS h FROM public.courier_accruals x`)).rows[0].h;
  const definitions = async () => (await admin.query(`SELECT proname, md5(prosrc) AS h FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname = ANY($1) ORDER BY proname`, [['_courier_compute_accrual','_courier_create_accrual','_courier_accrue_on_delivered','admin_assign_delivery_courier','admin_recalculate_accrual','_courier_rule_resolve_v2']])).rows;
  it('only enabled super_admin can preview or confirm; authenticated only, helpers private', async () => {
    const s = await seed();
    for (const role of ['admin', 'user', 'super_admin']) {
      await kit.setRole(actors.adminId, role, role !== 'super_admin');
      for (const confirm of [false, true]) expect((await failure(call(s.c, s.kind, s.id, s.courier, confirm))).code).toBe('42501');
    }
    await kit.setRole(actors.adminId, 'super_admin');
    const anon = await connectAnon(); kit.clients.push(anon);
    expect((await failure(call(anon, s.kind, s.id, s.courier))).code).toBe('42501');
    const rows = (await admin.query(`SELECT prosecdef, proconfig, has_function_privilege('authenticated',oid,'EXECUTE') AS auth, has_function_privilege('anon',oid,'EXECUTE') AS anon, has_function_privilege('service_role',oid,'EXECUTE') AS svc FROM pg_proc WHERE proname=$1`, [fn])).rows;
    expect(rows).toHaveLength(1); expect(rows[0]).toMatchObject({ prosecdef: true, auth: true, anon: false, svc: false });
    expect(rows[0].proconfig).toContain('search_path=public, pg_temp');
    expect((await admin.query(`SELECT has_function_privilege('authenticated','public._courier_compute_accrual_retroactive(text,uuid,uuid)','EXECUTE') AS allowed`)).rows[0].allowed).toBe(false);
  });
  it('preview writes nothing; confirm writes once, audits reason, preserves operation date and is idempotent', async () => {
    const s = await seed();
    await kit.setRule(s.c, { courier_id: s.courier, fixed_cup: 810 });
    const before = await kit.accruals(s.id);
    const audits = async () => (await admin.query(`SELECT * FROM public.financial_audit_log WHERE table_name='courier_accruals' AND row_id=$1`, [before[0].id])).rows;
    const auditBefore = await audits();
    const p = await preview(s);
    expect(p).toMatchObject({ amount_cup: 810, amount_usd: 1, fx_used: 810, fx_source: 'remittance', retroactive: true, precedence: 'courier', confirmed: false });
    expect(await kit.accruals(s.id)).toEqual(before); expect(await audits()).toEqual(auditBefore);
    expect((await admin.query('SELECT * FROM public.delivery_assignments WHERE remittance_id=$1', [s.id])).rowCount).toBe(0);
    await confirm(s, p.preview_token);
    const after = await kit.accruals(s.id);
    expect(after).toHaveLength(1); expect(after[0]).toMatchObject({ courier_id: s.courier, amount_cup: '810.00', delivered_at: before[0].delivered_at });
    expect(after[0].rule_snapshot).toMatchObject({ retroactive: true, source: 'retroactive', assignment_reason: 'Historical assignment', fx_source: 'remittance' });
    expect((await audits()).length).toBe(auditBefore.length + 1);
    expect(JSON.parse((await audits()).at(-1).new_value)).toMatchObject({ reason: 'Historical assignment' });
    expect((await confirm(s, p.preview_token)).already_assigned).toBe(true);
    expect(await kit.accruals(s.id)).toEqual(after); expect((await audits()).length).toBe(auditBefore.length + 1);
  });
  it.each(['order', 'remittance'])('%s: rate is current except frozen USD to CUP; fixed USD uses that same rate', async (kind) => {
    const s = await seed(kind, { delivered: 'USD', rate: 1 });
    await kit.seedUsdCupRate(400);
    await kit.setRule(s.c, { applies_to: kind, method: 'fixed_amount', fixed_cup: null, fixed_amount: 2, courier_id: s.courier });
    expect(await preview(s)).toMatchObject({ amount_cup: 800, amount_usd: 2, fx_used: 400, fx_source: 'exchange_rates' });
    if (kind === 'remittance') {
      const id = await kit.seedRemittance({ typeId: await kit.seedType(), rate: 810 }); await kit.deliverRemittance(id);
      expect(await preview({ ...s, id })).toMatchObject({ amount_cup: 1620, amount_usd: 2, fx_used: 810, fx_source: 'remittance' });
    }
  });
  it('no-rule preview stays NULL; confirmation writes nothing and stays eligible for a later rule', async () => {
    const s = await seed();
    const before = await kit.accruals(s.id);
    const audits = async () => (await admin.query(`SELECT * FROM public.financial_audit_log WHERE row_id=$1 ORDER BY id`, [before[0].id])).rows;
    const auditBefore = await audits();
    const p = await preview(s);
    expect(p).toMatchObject({ amount_cup: null, amount_usd: null, reason: 'no_rule' });
    expect(await kit.accruals(s.id)).toEqual(before);
    expect(await audits()).toEqual(auditBefore);
    expect(await failure(confirm(s, p.preview_token))).toMatchObject({ code: '22023', message: 'no_amount: no_rule' });
    expect(await kit.accruals(s.id)).toEqual(before);
    expect(await audits()).toEqual(auditBefore);
    await kit.setRule(s.c, { courier_id: s.courier, fixed_cup: 810 });
    const fresh = await preview(s);
    expect(await confirm(s, fresh.preview_token)).toMatchObject({ confirmed: true, already_assigned: false });
    expect((await kit.accruals(s.id))[0]).toMatchObject({ courier_id: s.courier, amount_cup: '810.00' });
  });
  it('exact retry after payment acknowledges without writes; paid mismatches and void are refused', async () => {
    const s = await seed();
    await kit.setRule(s.c, { courier_id: s.courier, fixed_cup: 810 });
    const p = await preview(s);
    await confirm(s, p.preview_token);
    const payment = (await s.c.query(`SELECT public.admin_register_courier_payment($1::uuid,$2::uuid[],$3,$4,$5::timestamptz,$6) AS id`, [s.courier, (await kit.accruals(s.id)).map((a) => a.id), 'cash', null, new Date().toISOString(), null])).rows[0].id;
    expect(payment).toBeTruthy();
    const paid = await kit.accruals(s.id);
    expect(paid[0].payment_id).toBeTruthy();
    const audits = async () => (await admin.query(`SELECT * FROM public.financial_audit_log WHERE row_id=$1 ORDER BY id`, [paid[0].id])).rows;
    const auditBefore = await audits();
    expect(await confirm(s, p.preview_token)).toMatchObject({ confirmed: true, already_assigned: true });
    expect(await kit.accruals(s.id)).toEqual(paid);
    expect(await audits()).toEqual(auditBefore);
    expect((await failure(confirm(s, 'other-token'))).message).toMatch(/invalid_status/);
    expect((await failure(confirm(s, p.preview_token, 'Different historical reason'))).message).toMatch(/invalid_status/);
    const other = await kit.makeCourier();
    expect((await failure(call(s.c, s.kind, s.id, other, true, p.preview_token))).message).toMatch(/invalid_status/);
    await admin.query(`UPDATE public.courier_accruals SET status='void',void_reason='Voided after payment' WHERE id=$1`, [paid[0].id]);
    const voided = await kit.accruals(s.id);
    expect((await failure(confirm(s, p.preview_token))).message).toMatch(/invalid_status/);
    expect(await kit.accruals(s.id)).toEqual(voided);
    expect(await audits()).toEqual(auditBefore);
  });
  it('requires reason and a fresh server preview; rejects existing courier, paid/void, or payment-linked accruals', async () => {
    const s = await seed();
    for (const reason of [null, '', 'short', 'x'.repeat(501)]) expect((await failure(call(s.c, s.kind, s.id, s.courier, false, null, reason))).message).toMatch(/invalid_reason/);
    expect((await failure(confirm(s, null))).message).toMatch(/preview_required/);
    const p = await preview(s); await kit.setRule(s.c, { fixed_cup: 123 });
    expect((await failure(confirm(s, p.preview_token))).message).toMatch(/preview_changed/);
    const [a] = await kit.accruals(s.id);
    for (const status of ['paid', 'void']) {
      await admin.query('UPDATE public.courier_accruals SET status=$2, void_reason=$3 WHERE id=$1', [a.id, status, status === 'void' ? 'test reason' : null]);
      expect((await failure(preview(s))).message).toMatch(/invalid_status/);
    }
    await admin.query(`UPDATE public.courier_accruals SET status='calculated', courier_id=$2 WHERE id=$1`, [a.id, s.courier]);
    expect((await failure(preview(s))).message).toMatch(/already_assigned/);
  });
  it('concurrent double confirm makes exactly one accrual and one audit write', async () => {
    const s = await seed();
    await kit.setRule(s.c, { courier_id: s.courier, fixed_cup: 810 });
    const p = await preview(s); const other = await kit.as(actors.adminId);
    const sql = `public.${fn}($1,$2::uuid,$3::uuid,$4,true,$5)`;
    const params = [s.kind, s.id, s.courier, 'Historical assignment', p.preview_token];
    const results = await fireTogether([{ client: s.c, sql, params }, { client: other, sql, params }]);
    expect(results.every((r) => !r.error)).toBe(true);
    expect(results.filter((r) => r.value.already_assigned)).toHaveLength(1);
    const [a] = await kit.accruals(s.id);
    expect((await admin.query(`SELECT * FROM public.financial_audit_log WHERE row_id=$1 AND column_name='retroactive_assignment'`, [a.id])).rowCount).toBe(1);
  });
  it('migration and rollback leave all previous function bodies and business rows intact; B then A still roll back', async () => {
    const s = await seed();
    await kit.setRule(s.c, { courier_id: s.courier, fixed_cup: 810 });
    const p = await preview(s); await confirm(s, p.preview_token);
    const before = await definitions(); const data = await fingerprint();
    await admin.query('BEGIN');
    try {
      await admin.query(strip(readSql(rollback)));
      expect((await admin.query(`SELECT to_regproc('public.${fn}') IS NULL AS gone`)).rows[0].gone).toBe(true);
      expect(await definitions()).toEqual(before); expect(await fingerprint()).toBe(data);
      await admin.query(strip(readSql(migration))); expect(await fingerprint()).toBe(data); expect(await definitions()).toEqual(before);
      await admin.query(strip(readSql(ROLLBACKS.b))); await admin.query(strip(readSql(ROLLBACKS.a)));
    } finally { await admin.query('ROLLBACK'); }
    const id = await kit.seedRemittance({ typeId: await kit.seedType() }); await kit.deliverRemittance(id);
    expect((await kit.accruals(id))[0].rule_snapshot).not.toHaveProperty('retroactive');
    expect(readSql(MIGRATIONS.b)).toContain('FUNCTION public._courier_compute_accrual(');
  });
});
