/**
 * DEC-10 = A: only a super_admin may write exchange_rates.
 * Migration under test: supabase/migrations/20261103100200_exchange_rates_super_admin_write.sql
 * Local scratch Postgres only. The suite does not list the new policy in `needs`, so a missing migration fails (red).
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { dbSuiteSkipReason, connectAdmin, connectAs, connectAnon, endAll } from './db';
import { loadActors } from './fixtures';

const MIGRATION = 'supabase/migrations/20261103100200_exchange_rates_super_admin_write.sql';
const ROLLBACK = 'supabase/rollbacks/20261103100200_exchange_rates_super_admin_write_down.sql';

const skipReason = await dbSuiteSkipReason({
  functions: ['is_admin_user', 'is_super_admin'],
  tables: ['exchange_rates', 'currencies', 'financial_audit_log']
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

describe('exchange_rates super_admin write: migration files', () => {
  it('replaces the write policy with an is_super_admin() initplan and keeps the select policy untouched', () => {
    const sql = readFileSync(MIGRATION, 'utf8');
    expect(sql).toMatch(/\(\s*SELECT\s+public\.is_super_admin\(\)\s*\)/i);
    expect(sql).toMatch(/DROP POLICY IF EXISTS "?exchange_rates_manage"? ON public\.exchange_rates/i);
    expect(sql).not.toMatch(/(DROP|CREATE|ALTER) POLICY[^;]*exchange_rates_select/i);
    expect(sql).not.toMatch(/\bGRANT\b|\bREVOKE\b/i);
  });

  it('has a rollback that restores the exact previous admin policy under a lock_timeout', () => {
    const sql = readFileSync(ROLLBACK, 'utf8');
    expect(sql).toMatch(/lock_timeout/i);
    expect(sql).toMatch(/CREATE POLICY "?exchange_rates_manage"? ON public\.exchange_rates FOR ALL TO authenticated USING \(\(SELECT is_admin_user\(\)\)\)/i);
  });
});

describeDb('exchange_rates is writable by super_admin only (local Postgres)', () => {
  let admin;
  let actors;
  let currencies;
  const clients = [];
  const rows = [];
  let originalRole;

  const as = async (userId) => {
    const c = await connectAs(userId);
    clients.push(c);
    return c;
  };
  const setRole = (role) => admin.query(`UPDATE public.user_profiles SET role = $2 WHERE id = $1`, [actors.adminId, role]);
  const asRole = async (role) => {
    await setRole(role);
    return as(actors.adminId);
  };
  // Far-future inactive rows: no active pair is disturbed.
  let seq = 0;
  const seedRow = async (client = admin) => {
    seq += 1;
    const { rows: r } = await client.query(
      `INSERT INTO public.exchange_rates (from_currency_id, to_currency_id, rate, is_active, effective_date)
       VALUES ($1, $2, 123.45, false, DATE '2090-01-01' + $3::int) RETURNING id`,
      [currencies[0], currencies[1], seq]
    );
    rows.push(r[0].id);
    return r[0].id;
  };
  const rateOf = async (id) =>
    (await admin.query('SELECT rate::text AS rate FROM public.exchange_rates WHERE id = $1', [id])).rows[0]?.rate;

  beforeAll(async () => {
    admin = await connectAdmin();
    actors = await loadActors(admin);
    originalRole = (await admin.query('SELECT role FROM public.user_profiles WHERE id = $1', [actors.adminId])).rows[0].role;
    currencies = (await admin.query('SELECT id FROM public.currencies ORDER BY id LIMIT 2')).rows.map((r) => r.id);
  });

  afterEach(async () => {
    await admin.query('DELETE FROM public.exchange_rates WHERE id = ANY($1)', [rows.splice(0)]);
    await setRole(originalRole);
    await Promise.all(clients.splice(0).map((c) => c.end().catch(() => {})));
  });

  afterAll(async () => {
    await endAll([admin]);
  });

  it('a plain admin cannot INSERT (42501)', async () => {
    const adm = await asRole('admin');
    const err = await failure(
      adm.query(
        `INSERT INTO public.exchange_rates (from_currency_id, to_currency_id, rate, is_active, effective_date)
         VALUES ($1, $2, 1, false, DATE '2091-01-01')`, [currencies[0], currencies[1]]
      )
    );
    expect(err.code).toBe('42501');
  });

  it('a plain admin UPDATE touches 0 rows (no error) and leaves the rate unchanged', async () => {
    const id = await seedRow();
    const adm = await asRole('admin');
    const res = await adm.query('UPDATE public.exchange_rates SET rate = 999 WHERE id = $1', [id]);
    expect(res.rowCount).toBe(0);
    expect(await rateOf(id)).toBe('123.450000');
  });

  it('a plain admin DELETE touches 0 rows (no error) and the row survives', async () => {
    const id = await seedRow();
    const adm = await asRole('admin');
    const res = await adm.query('DELETE FROM public.exchange_rates WHERE id = $1', [id]);
    expect(res.rowCount).toBe(0);
    expect(await rateOf(id)).toBe('123.450000');
  });

  it('a super_admin can INSERT, UPDATE and DELETE', async () => {
    const sup = await asRole('super_admin');
    const id = await seedRow(sup);
    expect((await sup.query('UPDATE public.exchange_rates SET rate = 124.5 WHERE id = $1', [id])).rowCount).toBe(1);
    expect(await rateOf(id)).toBe('124.500000');
    expect((await sup.query('DELETE FROM public.exchange_rates WHERE id = $1', [id])).rowCount).toBe(1);
    expect(await rateOf(id)).toBeUndefined();
  });

  it('a disabled super_admin loses write access', async () => {
    const id = await seedRow();
    const sup = await asRole('super_admin');
    await admin.query('UPDATE public.user_profiles SET is_enabled = false WHERE id = $1', [actors.adminId]);
    try {
      expect((await sup.query('UPDATE public.exchange_rates SET rate = 5 WHERE id = $1', [id])).rowCount).toBe(0);
    } finally {
      await admin.query('UPDATE public.user_profiles SET is_enabled = true WHERE id = $1', [actors.adminId]);
    }
  });

  it('a customer and anon cannot write', async () => {
    const id = await seedRow();
    const customer = await as(actors.customerId);
    const anon = await connectAnon();
    clients.push(anon);
    const insert = `INSERT INTO public.exchange_rates (from_currency_id, to_currency_id, rate, is_active, effective_date)
                    VALUES ($1, $2, 1, false, DATE '2092-01-01')`;
    expect((await failure(customer.query(insert, [currencies[0], currencies[1]]))).code).toBe('42501');
    expect((await failure(anon.query(insert, [currencies[0], currencies[1]]))).code).toBe('42501');
    expect((await customer.query('UPDATE public.exchange_rates SET rate = 5 WHERE id = $1', [id])).rowCount).toBe(0);
    expect((await customer.query('DELETE FROM public.exchange_rates WHERE id = $1', [id])).rowCount).toBe(0);
    expect((await failure(anon.query('UPDATE public.exchange_rates SET rate = 5 WHERE id = $1', [id]))).code).toBe('42501');
  });

  it('SELECT stays public: admin, customer and anon all read the row', async () => {
    const id = await seedRow();
    const anon = await connectAnon();
    clients.push(anon);
    for (const c of [await asRole('admin'), await as(actors.customerId), anon]) {
      expect((await c.query('SELECT id FROM public.exchange_rates WHERE id = $1', [id])).rowCount).toBe(1);
    }
  });

  it('the live policies are exactly select(true) + one super_admin-only write policy', async () => {
    const { rows: p } = await admin.query(
      `SELECT policyname, cmd, roles::text AS roles, qual FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'exchange_rates' ORDER BY policyname`
    );
    const select = p.find((x) => x.policyname === 'exchange_rates_select');
    expect(select).toMatchObject({ cmd: 'SELECT', qual: 'true' });
    const writes = p.filter((x) => x.policyname !== 'exchange_rates_select');
    expect(writes).toHaveLength(1);
    expect(writes[0].qual).toMatch(/is_super_admin/);
    expect(writes[0].qual).not.toMatch(/is_admin_user/);
  });

  it('audit triggers still record a super_admin UPDATE and DELETE', async () => {
    const id = await seedRow();
    const sup = await asRole('super_admin');
    await sup.query('UPDATE public.exchange_rates SET rate = 124.5 WHERE id = $1', [id]);
    await sup.query('DELETE FROM public.exchange_rates WHERE id = $1', [id]);
    const { rows: a } = await admin.query(
      `SELECT operation, changed_by_role FROM public.financial_audit_log WHERE row_id = $1 AND table_name = 'exchange_rates'`, [id]
    );
    expect(a.some((r) => r.operation === 'UPDATE' && r.changed_by_role === 'super_admin')).toBe(true);
    expect(a.some((r) => r.operation === 'DELETE' && r.changed_by_role === 'super_admin')).toBe(true);
  });
});
