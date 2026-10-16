/**
 * get_public_landing_stats(): aggregate-only counters for the public landing page.
 *
 * Migration under test: 20261016100000_public_landing_stats.sql
 *
 * Runs against the LOCAL scratch database. The new function is deliberately NOT listed in `needs`:
 * when the migration is missing the tests must fail loudly (red phase), not skip.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dbSuiteSkipReason, connectAdmin, connectAs, connectAnon, endAll } from './db';
import { loadActors, createTracker, seedOrder, cleanup } from './fixtures';

const skipReason = await dbSuiteSkipReason({
  functions: ['is_admin_user'],
  tables: ['orders', 'remittances', 'user_profiles', 'remittance_types']
});
const describeDb = skipReason ? describe.skip : describe;

const MIGRATION = new URL('../../../supabase/migrations/20261016100000_public_landing_stats.sql', import.meta.url);
const FN = 'public.get_public_landing_stats()';
const EXPECTED_KEYS = ['first_year', 'orders_completed', 'remittances_completed', 'users'];

describeDb('get_public_landing_stats', () => {
  let admin;
  let actors;
  let typeId;
  const clients = [];
  const tracker = createTracker();
  const remittanceIds = [];

  const stats = async (client) => (await client.query(`SELECT ${FN} AS s`)).rows[0].s;

  const seedRemittance = async (status, createdAt = null) => {
    const id = randomUUID();
    await admin.query(
      `INSERT INTO public.remittances (id, user_id, remittance_type_id, remittance_number, status, amount_sent,
                                       exchange_rate, commission_percentage, commission_fixed, commission_total,
                                       amount_to_deliver, currency_sent, currency_delivered, recipient_name,
                                       recipient_phone, created_at)
       VALUES ($1, $2, $3, $4, $5, 10, 1, 0, 0, 0, 10, 'USD', 'USD', 'x', '1', COALESCE($6::timestamptz, now()))`,
      [id, actors.customerId, typeId, `TST-${id.slice(0, 13)}`, status, createdAt]
    );
    remittanceIds.push(id);
    return id;
  };

  beforeAll(async () => {
    admin = await connectAdmin();
    actors = await loadActors(admin);
    const existing = await admin.query(`SELECT id FROM public.remittance_types LIMIT 1`);
    if (existing.rowCount) {
      typeId = existing.rows[0].id;
    } else {
      typeId = randomUUID();
      await admin.query(
        `INSERT INTO public.remittance_types (id, name, currency_code, delivery_currency, exchange_rate, min_amount, delivery_method)
         VALUES ($1, 'tst-landing-stats', 'USD', 'USD', 1, 1, 'cash')`,
        [typeId]
      );
      remittanceIds.typeSeeded = true;
    }
  });

  afterEach(async () => {
    await endAll(clients.splice(0));
    if (remittanceIds.length) {
      await admin.query(`DELETE FROM public.remittances WHERE id = ANY($1)`, [remittanceIds]);
      remittanceIds.length = 0;
    }
    await cleanup(admin, tracker);
  });

  afterAll(async () => {
    if (remittanceIds.typeSeeded) await admin.query(`DELETE FROM public.remittance_types WHERE id = $1`, [typeId]);
    await admin.end();
  });

  it('exists, is SECURITY DEFINER with a pinned search_path and returns jsonb', async () => {
    const { rows } = await admin.query(
      `SELECT p.prosecdef, p.provolatile, format_type(p.prorettype, NULL) AS ret, p.proconfig
         FROM pg_proc p WHERE p.oid = to_regprocedure('public.get_public_landing_stats()')`
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].prosecdef).toBe(true);
    expect(rows[0].provolatile).toBe('s');
    expect(rows[0].ret).toBe('jsonb');
    expect(rows[0].proconfig).toContain('search_path=public, pg_temp');
  });

  it('grants EXECUTE to anon and authenticated but not to PUBLIC', async () => {
    const { rows } = await admin.query(
      `SELECT has_function_privilege('anon', $1, 'EXECUTE') AS anon,
              has_function_privilege('authenticated', $1, 'EXECUTE') AS authenticated,
              EXISTS (SELECT 1 FROM pg_proc p, aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
                       WHERE p.oid = to_regprocedure($1) AND a.grantee = 0) AS public_grant`,
      ['public.get_public_landing_stats()']
    );
    expect(rows[0]).toEqual({ anon: true, authenticated: true, public_grant: false });
  });

  it('returns exactly the four aggregate keys, all integers', async () => {
    await seedRemittance('completed');
    const s = await stats(admin);
    expect(Object.keys(s).sort()).toEqual(EXPECTED_KEYS);
    for (const key of EXPECTED_KEYS) expect(Number.isInteger(s[key])).toBe(true);
    expect(s.first_year).toBeGreaterThanOrEqual(2000);
  });

  it('counts completed vs non-completed remittances and orders (delivered and completed both count)', async () => {
    const before = await stats(admin);
    for (const status of ['delivered', 'completed', 'payment_pending', 'processing', 'cancelled']) {
      await seedRemittance(status);
    }
    for (const status of ['completed', 'completed', 'pending', 'processing', 'delivered', 'cancelled']) {
      await seedOrder(admin, actors, tracker, [], { status });
    }
    const after = await stats(admin);
    expect(after.remittances_completed - before.remittances_completed).toBe(2);
    expect(after.orders_completed - before.orders_completed).toBe(2);
  });

  it('counts every user profile', async () => {
    const { rows } = await admin.query(`SELECT count(*)::int AS n FROM public.user_profiles`);
    expect((await stats(admin)).users).toBe(rows[0].n);
  });

  it('first_year is the earliest year among orders and remittances', async () => {
    await seedRemittance('pending', '2018-06-01T12:00:00Z');
    const orderId = await seedOrder(admin, actors, tracker, [], { status: 'pending' });
    await admin.query(`UPDATE public.orders SET created_at = '2017-02-03T12:00:00Z' WHERE id = $1`, [orderId]);
    expect((await stats(admin)).first_year).toBe(2017);
    await admin.query(`UPDATE public.orders SET created_at = '2019-02-03T12:00:00Z' WHERE id = $1`, [orderId]);
    expect((await stats(admin)).first_year).toBe(2018);
  });

  it('gives anon and a regular customer the SAME global figures (not their own rows)', async () => {
    await seedRemittance('completed');
    await seedOrder(admin, actors, tracker, [], { status: 'completed', userId: actors.adminId });
    const anon = await connectAnon();
    const customer = await connectAs(actors.customerId);
    clients.push(anon, customer);
    const [a, c, owner] = [await stats(anon), await stats(customer), await stats(admin)];
    expect(a).toEqual(owner);
    expect(c).toEqual(owner);
  });

  it('anon still cannot read the base tables directly (42501)', async () => {
    for (const table of ['orders', 'remittances', 'user_profiles']) {
      const anon = await connectAnon();
      clients.push(anon);
      await expect(anon.query(`SELECT count(*) FROM public.${table}`)).rejects.toMatchObject({ code: '42501' });
    }
  });

  it('is idempotent: re-applying the migration keeps definition and grants', async () => {
    const sql = readFileSync(MIGRATION, 'utf8');
    await admin.query('BEGIN');
    try {
      await admin.query(sql);
      await admin.query(sql);
      const { rows } = await admin.query(
        `SELECT has_function_privilege('anon', $1, 'EXECUTE') AS anon,
                has_function_privilege('authenticated', $1, 'EXECUTE') AS authenticated`,
        ['public.get_public_landing_stats()']
      );
      expect(rows[0]).toEqual({ anon: true, authenticated: true });
    } finally {
      await admin.query('ROLLBACK');
    }
  });

  it('the documented rollback removes the function (inside a transaction that is rolled back)', async () => {
    const sql = readFileSync(MIGRATION, 'utf8');
    expect(sql).toContain('DROP FUNCTION IF EXISTS public.get_public_landing_stats();');
    await admin.query('BEGIN');
    try {
      await admin.query('DROP FUNCTION IF EXISTS public.get_public_landing_stats();');
      const { rows } = await admin.query(`SELECT to_regprocedure('public.get_public_landing_stats()') IS NULL AS gone`);
      expect(rows[0].gone).toBe(true);
    } finally {
      await admin.query('ROLLBACK');
    }
    const { rows } = await admin.query(`SELECT to_regprocedure('public.get_public_landing_stats()') IS NOT NULL AS back`);
    expect(rows[0].back).toBe(true);
  });
});
