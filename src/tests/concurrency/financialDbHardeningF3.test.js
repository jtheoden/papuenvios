/**
 * F3 financial DB hardening (audit 2026-11-04). Migrations under test (PREPARED, NOT APPLIED in prod):
 *   20261104160000_remittance_types_pricing_super_admin_only.sql   (C3: rate/commission writes = super_admin only)
 *   20261104160100_exchange_rate_history.sql                        (append-only rate/commission history)
 *   20261104160200_exchange_rates_validate_distinct_currencies.sql  (VALIDATE the NOT VALID check)
 *   20261104160300_revoke_rate_readers_from_anon.sql                (get_order/get_market_exchange_rate: no PUBLIC/anon)
 *   20261104160400_get_my_role_is_enabled.sql                       (RB-25: disabled account -> 'user')
 * Each one has its rollback in supabase/rollbacks/<same name>_down.sql.
 *
 * Every DB section first installs the LIVE production state captured read-only on 2026-11-04 when the scratch clone
 * differs (get_*_exchange_rate exist only in prod), applies the migration, asserts, runs the rollback, asserts it gives
 * back the live state, and re-applies (idempotency). History rows cannot be deleted (append-only), so assertions are
 * keyed by source_id, never by count(*).
 *
 * RED phase: F3_SKIP_MIGRATION=1 (migrations not applied before the behavioural assertions).
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { dbSuiteSkipReason, connectAdmin, connectAs, connectAnon, endAll } from './db';
import { loadActors } from './fixtures';

const M = {
  rt: '20261104160000_remittance_types_pricing_super_admin_only',
  hist: '20261104160100_exchange_rate_history',
  chk: '20261104160200_exchange_rates_validate_distinct_currencies',
  rev: '20261104160300_revoke_rate_readers_from_anon',
  role: '20261104160400_get_my_role_is_enabled'
};
const mig = (k) => readFileSync(resolve(process.cwd(), `supabase/migrations/${M[k]}.sql`), 'utf8');
const down = (k) => readFileSync(resolve(process.cwd(), `supabase/rollbacks/${M[k]}_down.sql`), 'utf8');
const code = (sql) => sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
const applyFirst = process.env.F3_SKIP_MIGRATION !== '1';

const failure = async (promise) => {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected the statement to fail, but it succeeded');
};

// LIVE production definitions (prosrc + ACL, read-only 2026-11-04). Not in the repo nor in the e2e base schema.
const LIVE_RATE_READERS = `
CREATE OR REPLACE FUNCTION public.get_order_exchange_rate(p_from_currency text, p_to_currency text)
RETURNS numeric LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE v_rate numeric; v_from_id uuid; v_to_id uuid;
BEGIN
  SELECT id INTO v_from_id FROM currencies WHERE code = p_from_currency AND is_active = true;
  SELECT id INTO v_to_id FROM currencies WHERE code = p_to_currency AND is_active = true;
  IF v_from_id IS NULL OR v_to_id IS NULL THEN RETURN 1.0; END IF;
  SELECT rate INTO v_rate FROM exchange_rates
   WHERE from_currency_id = v_from_id AND to_currency_id = v_to_id AND is_active = true
     AND (rate_type = 'orders' OR rate_type = 'general')
   ORDER BY CASE WHEN rate_type = 'orders' THEN 0 ELSE 1 END, effective_date DESC LIMIT 1;
  RETURN COALESCE(v_rate, 1.0);
END $f$;
CREATE OR REPLACE FUNCTION public.get_market_exchange_rate(p_from_currency text, p_to_currency text)
RETURNS numeric LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
BEGIN
  IF NOT is_super_admin() THEN RETURN NULL; END IF;
  RETURN 1.0; -- body trimmed: only the ACL matters for this suite
END $f$;
REVOKE ALL ON FUNCTION public.get_order_exchange_rate(text, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_market_exchange_rate(text, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_order_exchange_rate(text, text) TO PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.get_market_exchange_rate(text, text) TO PUBLIC, authenticated;`;
const LIVE_ACL = {
  get_order_exchange_rate: ['=X/postgres', 'anon=X/postgres', 'authenticated=X/postgres', 'postgres=X/postgres'],
  get_market_exchange_rate: ['=X/postgres', 'authenticated=X/postgres', 'postgres=X/postgres']
};
const LIVE_GET_MY_ROLE_SRC = `
  SELECT COALESCE(
    (SELECT role FROM user_profiles WHERE id = auth.uid() LIMIT 1),
    'user'
  )
`;
const LIVE_GET_MY_ROLE_ACL = ['=X/postgres', 'authenticated=X/postgres', 'postgres=X/postgres'];

describe('F3 migration files (static)', () => {
  it('every migration is marked PREPARED, NOT APPLIED, uses lock_timeout, a transaction and has a rollback', () => {
    for (const k of Object.keys(M)) {
      const sql = mig(k);
      expect(sql).toMatch(/PREPARED, NOT APPLIED/);
      expect(code(sql)).toMatch(/SET LOCAL lock_timeout = '5s'/);
      expect(code(sql)).toMatch(/^BEGIN;/m);
      expect(code(sql)).toMatch(/^COMMIT;/m);
      expect(sql).toMatch(new RegExp(`supabase/rollbacks/${M[k]}_down\\.sql`));
      expect(code(down(k))).toMatch(/SET LOCAL lock_timeout = '5s'/);
    }
  });

  it('no migration rewrites or deletes existing rows, nor touches the transition functions', () => {
    for (const k of Object.keys(M)) {
      const c = code(mig(k));
      expect(c).not.toMatch(/^\s*(DELETE\s+FROM|TRUNCATE|UPDATE\s+public\.\w+\s+SET|DROP\s+TABLE)/im);
      expect(c).not.toMatch(/_order_transition|_remittance_transition/);
    }
  });

  it('the history rollback keeps the table (only a commented DROP TABLE)', () => {
    expect(code(down('hist'))).not.toMatch(/DROP TABLE/i);
    expect(down('hist')).toMatch(/--.*DROP TABLE IF EXISTS public\.exchange_rate_history/);
  });

  it('the anon revoke is guarded for databases where the prod-only functions do not exist', () => {
    expect(code(mig('rev'))).toMatch(/to_regprocedure\('public\.get_order_exchange_rate\(text,text\)'\)/);
    expect(code(mig('rev'))).toMatch(/to_regprocedure\('public\.get_market_exchange_rate\(text,text\)'\)/);
    expect(code(mig('rev'))).toMatch(/FROM PUBLIC, anon/);
  });
});

const skipReason = await dbSuiteSkipReason({
  functions: ['is_admin_user', 'is_super_admin', 'get_my_role', 'audit_financial_changes', 'update_updated_at'],
  tables: ['exchange_rates', 'remittance_types', 'currencies', 'financial_audit_log', 'notification_settings']
});
const describeDb = skipReason ? describe.skip : describe;

describeDb('F3 financial hardening (local Postgres)', () => {
  let admin;
  let actors;
  let cur; // { USD, CUP, EUR } ids
  const clients = [];
  const types = [];
  const rates = [];

  const as = async (userId) => {
    const c = await connectAs(userId);
    clients.push(c);
    return c;
  };
  const anon = async () => {
    const c = await connectAnon();
    clients.push(c);
    return c;
  };
  const profile = (role, enabled = true) =>
    admin.query('UPDATE public.user_profiles SET role = $2, is_enabled = $3 WHERE id = $1', [actors.adminId, role, enabled]);
  const asRole = async (role, enabled = true) => {
    await profile(role, enabled);
    return as(actors.adminId);
  };
  // Live-like type: the form round-trips 915 / 895.00 -> 2.1857923497 (numeric(20,10)).
  const seedType = async () => {
    const { rows } = await admin.query(
      `INSERT INTO public.remittance_types (name, currency_code, delivery_currency, exchange_rate, commission_percentage,
                                            commission_fixed, min_amount, delivery_method, updated_at)
       VALUES ($1, 'USD', 'CUP', 915, 2.1857923497, 0, 1, 'transfer', now() - interval '1 day') RETURNING id`,
      [`f3-${randomUUID().slice(0, 8)}`]);
    types.push(rows[0].id);
    return rows[0].id;
  };
  const typeOf = async (id) =>
    (await admin.query(
      `SELECT name, exchange_rate::text AS rate, commission_percentage::text AS pct, commission_fixed::text AS fixed,
              updated_at > now() - interval '1 hour' AS touched FROM public.remittance_types WHERE id = $1`, [id])).rows[0];
  let seq = 0;
  const seedRate = async (client = admin) => {
    seq += 1;
    const { rows } = await client.query(
      `INSERT INTO public.exchange_rates (from_currency_id, to_currency_id, rate, is_active, effective_date)
       VALUES ($1, $2, 123.45, false, DATE '2093-01-01' + $3::int) RETURNING id`, [cur.USD, cur.CUP, seq]);
    rates.push(rows[0].id);
    return rows[0].id;
  };
  const auditOf = async (id) =>
    (await admin.query(
      'SELECT column_name, changed_by_role FROM public.financial_audit_log WHERE row_id = $1 ORDER BY id', [id])).rows;
  const historyOf = async (id) =>
    (await admin.query(
      `SELECT source_table, operation, from_currency, to_currency, rate::text AS rate, previous_rate::text AS previous_rate,
              commission_percentage::text AS pct, previous_commission_percentage::text AS previous_pct,
              commission_fixed::text AS fixed, is_active, changed_by_role
         FROM public.exchange_rate_history WHERE source_id = $1 ORDER BY id`, [id])).rows;
  const aclOf = async (fn) => {
    const { rows } = await admin.query(
      `SELECT array(SELECT unnest(p.proacl)::text ORDER BY 1) AS acl FROM pg_proc p
        WHERE p.pronamespace = 'public'::regnamespace AND p.proname = $1`, [fn]);
    return rows[0]?.acl;
  };
  const triggersOf = async (table) =>
    (await admin.query(
      `SELECT t.tgname, t.tgenabled FROM pg_trigger t WHERE t.tgrelid = $1::regclass AND NOT t.tgisinternal ORDER BY 1`,
      [`public.${table}`])).rows;

  beforeAll(async () => {
    admin = await connectAdmin();
    actors = await loadActors(admin);
    cur = Object.fromEntries((await admin.query(`SELECT code, id FROM public.currencies WHERE code IN ('USD','CUP','EUR')`))
      .rows.map((r) => [r.code, r.id]));
    await admin.query(LIVE_RATE_READERS);
    if (applyFirst) for (const k of ['rt', 'hist', 'chk', 'rev', 'role']) await admin.query(mig(k));
  });

  afterEach(async () => {
    await endAll(clients.splice(0));
    await profile('admin', true);
    await admin.query('UPDATE public.user_profiles SET is_enabled = true WHERE id = $1', [actors.customerId]);
  });

  afterAll(async () => {
    await admin.query('DELETE FROM public.remittance_types WHERE id = ANY($1)', [types]);
    await admin.query('DELETE FROM public.exchange_rates WHERE id = ANY($1)', [rates]);
    await admin.query(`DELETE FROM public.notification_settings WHERE setting_type LIKE 'f3-%'`);
    // get_*_exchange_rate do not exist in the repo: leave the scratch DB as the repo builds it.
    await admin.query('DROP FUNCTION IF EXISTS public.get_order_exchange_rate(text, text)');
    await admin.query('DROP FUNCTION IF EXISTS public.get_market_exchange_rate(text, text)');
    await admin.end();
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe('(2) remittance_types pricing is super_admin-only', () => {
    it('a plain admin cannot change exchange_rate, commission_percentage or commission_fixed (42501), nothing is audited', async () => {
      const id = await seedType();
      const adm = await asRole('admin');
      for (const set of ['exchange_rate = 999', 'commission_percentage = 1', 'commission_fixed = 5']) {
        const err = await failure(adm.query(`UPDATE public.remittance_types SET ${set} WHERE id = $1`, [id]));
        expect(err).toMatchObject({ code: '42501' });
        expect(err.message).toMatch(/remittance_type_pricing_super_admin_only/);
      }
      expect(await typeOf(id)).toMatchObject({ rate: '915.0000', pct: '2.1857923497', fixed: '0.00' });
      expect(await auditOf(id)).toEqual([]);
    });

    it('a plain admin still edits the rest when the form re-sends the same pricing (JS float round-trip)', async () => {
      const id = await seedType();
      const adm = await asRole('admin');
      const formPct = (1 - 895 / 915) * 100; // what RemittanceTypesConfig recomputes on edit
      const res = await adm.query(
        `UPDATE public.remittance_types
            SET name = 'f3-renamed', description = 'x', is_active = false, min_amount = 2, max_delivery_days = 4,
                exchange_rate = $2, commission_percentage = $3, commission_fixed = $4
          WHERE id = $1`, [id, 915, formPct, 0]);
      expect(res.rowCount).toBe(1);
      expect(await typeOf(id)).toMatchObject({ name: 'f3-renamed', rate: '915.0000', pct: '2.1857923497', touched: true });
    });

    it('a plain admin cannot create a type (it carries a rate) but can still delete one', async () => {
      const adm = await asRole('admin');
      const err = await failure(adm.query(
        `INSERT INTO public.remittance_types (name, currency_code, delivery_currency, exchange_rate, min_amount, delivery_method)
         VALUES ('f3-admin-insert', 'USD', 'CUP', 1, 1, 'transfer')`));
      expect(err).toMatchObject({ code: '42501' });
      const id = await seedType();
      expect((await adm.query('DELETE FROM public.remittance_types WHERE id = $1', [id])).rowCount).toBe(1);
    });

    it('a super_admin changes pricing and creates types; the change is audited as super_admin and updated_at moves', async () => {
      const id = await seedType();
      const sup = await asRole('super_admin');
      expect((await sup.query('UPDATE public.remittance_types SET exchange_rate = 920 WHERE id = $1', [id])).rowCount).toBe(1);
      expect(await typeOf(id)).toMatchObject({ rate: '920.0000', touched: true });
      expect(await auditOf(id)).toEqual([{ column_name: 'exchange_rate', changed_by_role: 'super_admin' }]);
      const { rows } = await sup.query(
        `INSERT INTO public.remittance_types (name, currency_code, delivery_currency, exchange_rate, min_amount, delivery_method)
         VALUES ('f3-sup-insert', 'USD', 'CUP', 900, 1, 'transfer') RETURNING id`);
      types.push(rows[0].id);
    });

    it('a disabled super_admin, a customer and anon change nothing', async () => {
      const id = await seedType();
      const sup = await asRole('super_admin', false);
      expect((await sup.query('UPDATE public.remittance_types SET exchange_rate = 1 WHERE id = $1', [id])).rowCount).toBe(0);
      const customer = await as(actors.customerId);
      expect((await customer.query('UPDATE public.remittance_types SET exchange_rate = 1 WHERE id = $1', [id])).rowCount).toBe(0);
      expect((await failure((await anon()).query('UPDATE public.remittance_types SET exchange_rate = 1 WHERE id = $1', [id]))).code).toBe('42501');
      expect(await typeOf(id)).toMatchObject({ rate: '915.0000' });
    });

    it('system paths (postgres / service_role / SECURITY DEFINER owner) are not gated', async () => {
      const id = await seedType();
      expect((await admin.query('UPDATE public.remittance_types SET exchange_rate = 916 WHERE id = $1', [id])).rowCount).toBe(1);
    });

    it('guard trigger fires ALWAYS, before the updated_at trigger; rollback removes both and re-apply is idempotent', async () => {
      expect(await triggersOf('remittance_types')).toEqual(expect.arrayContaining([
        { tgname: 'guard_remittance_types_pricing', tgenabled: 'A' },
        { tgname: 'trigger_update_remittance_types_updated_at', tgenabled: 'O' }
      ]));
      await admin.query(down('rt'));
      const names = (await triggersOf('remittance_types')).map((t) => t.tgname);
      expect(names).not.toContain('guard_remittance_types_pricing');
      expect(names).not.toContain('trigger_update_remittance_types_updated_at');
      const id = await seedType();
      const adm = await asRole('admin');
      expect((await adm.query('UPDATE public.remittance_types SET exchange_rate = 999 WHERE id = $1', [id])).rowCount).toBe(1);
      await admin.query(mig('rt'));
      await admin.query(mig('rt'));
      expect((await triggersOf('remittance_types')).filter((t) => t.tgname === 'guard_remittance_types_pricing')).toHaveLength(1);
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe('(3) exchange_rate_history (append-only)', () => {
    it('records INSERT and rate UPDATE of exchange_rates with currency codes, previous value and role', async () => {
      const sup = await asRole('super_admin');
      const id = await seedRate(sup);
      await sup.query('UPDATE public.exchange_rates SET rate = 124.5 WHERE id = $1', [id]);
      await sup.query(`UPDATE public.exchange_rates SET effective_date = effective_date + 5000 WHERE id = $1`, [id]); // untracked
      expect(await historyOf(id)).toEqual([
        { source_table: 'exchange_rates', operation: 'INSERT', from_currency: 'USD', to_currency: 'CUP', rate: '123.450000',
          previous_rate: null, pct: null, previous_pct: null, fixed: null, is_active: false, changed_by_role: 'super_admin' },
        { source_table: 'exchange_rates', operation: 'UPDATE', from_currency: 'USD', to_currency: 'CUP', rate: '124.500000',
          previous_rate: '123.450000', pct: null, previous_pct: null, fixed: null, is_active: false, changed_by_role: 'super_admin' }
      ]);
    });

    it('records is_active toggles (which rate is effective) of exchange_rates', async () => {
      const id = await seedRate();
      await admin.query('UPDATE public.exchange_rates SET is_active = true WHERE id = $1', [id]);
      await admin.query('UPDATE public.exchange_rates SET is_active = false WHERE id = $1', [id]);
      const h = await historyOf(id);
      expect(h.map((r) => [r.operation, r.is_active, r.changed_by_role])).toEqual([
        ['INSERT', false, 'system'], ['UPDATE', true, 'system'], ['UPDATE', false, 'system']]);
    });

    it('records remittance_types rate/commission changes and ignores unrelated columns', async () => {
      const id = await seedType();
      const sup = await asRole('super_admin');
      await sup.query('UPDATE public.remittance_types SET commission_percentage = 2.5 WHERE id = $1', [id]);
      await sup.query(`UPDATE public.remittance_types SET name = 'f3-other', description = 'y' WHERE id = $1`, [id]);
      expect(await historyOf(id)).toEqual([
        { source_table: 'remittance_types', operation: 'INSERT', from_currency: 'USD', to_currency: 'CUP', rate: '915.0000',
          previous_rate: null, pct: '2.1857923497', previous_pct: null, fixed: '0.00', is_active: true, changed_by_role: 'system' },
        { source_table: 'remittance_types', operation: 'UPDATE', from_currency: 'USD', to_currency: 'CUP', rate: '915.0000',
          previous_rate: '915.0000', pct: '2.5000000000', previous_pct: '2.1857923497', fixed: '0.00', is_active: true,
          changed_by_role: 'super_admin' }
      ]);
    });

    it('a rejected change (admin, guard 42501) leaves no history row', async () => {
      const id = await seedType();
      const adm = await asRole('admin');
      await failure(adm.query('UPDATE public.remittance_types SET exchange_rate = 1 WHERE id = $1', [id]));
      expect((await historyOf(id)).map((r) => r.operation)).toEqual(['INSERT']);
    });

    it('admins read it, customers see nothing, anon has no access', async () => {
      const id = await seedRate();
      const adm = await asRole('admin');
      expect((await adm.query('SELECT 1 FROM public.exchange_rate_history WHERE source_id = $1', [id])).rowCount).toBe(1);
      const customer = await as(actors.customerId);
      expect((await customer.query('SELECT 1 FROM public.exchange_rate_history WHERE source_id = $1', [id])).rowCount).toBe(0);
      expect((await failure((await anon()).query('SELECT 1 FROM public.exchange_rate_history'))).code).toBe('42501');
    });

    it('is append-only for every role (API roles have no write grant; postgres hits the immutability trigger)', async () => {
      const id = await seedRate();
      const adm = await asRole('super_admin');
      for (const sql of [
        `INSERT INTO public.exchange_rate_history (source_table, source_id, operation, rate, changed_by_role)
         VALUES ('exchange_rates', gen_random_uuid(), 'UPDATE', 1, 'admin')`,
        'UPDATE public.exchange_rate_history SET rate = 1 WHERE source_id = $1',
        'DELETE FROM public.exchange_rate_history WHERE source_id = $1'
      ]) {
        const params = sql.includes('$1') ? [id] : [];
        expect((await failure(adm.query(sql, params))).code).toBe('42501');
      }
      for (const sql of ['UPDATE public.exchange_rate_history SET rate = 1 WHERE source_id = $1',
        'DELETE FROM public.exchange_rate_history WHERE source_id = $1']) {
        const err = await failure(admin.query(sql, [id]));
        expect(err).toMatchObject({ code: '42501' });
        expect(err.message).toMatch(/exchange_rate_history_is_append_only/);
      }
      expect((await failure(admin.query('TRUNCATE public.exchange_rate_history'))).code).toBe('42501');
    });

    it('grants: SELECT only, to authenticated and service_role; writer/blocker functions not executable by API roles', async () => {
      const { rows } = await admin.query(
        `SELECT grantee, string_agg(privilege_type, ',' ORDER BY privilege_type) AS p FROM information_schema.role_table_grants
          WHERE table_schema = 'public' AND table_name = 'exchange_rate_history' AND grantee IN ('anon','authenticated','service_role','PUBLIC')
          GROUP BY grantee ORDER BY grantee`);
      expect(rows).toEqual([{ grantee: 'authenticated', p: 'SELECT' }, { grantee: 'service_role', p: 'SELECT' }]);
      for (const fn of ['record_exchange_rate_history', 'exchange_rate_history_block_mutation']) {
        expect(await aclOf(fn)).toEqual(['postgres=X/postgres']);
      }
      const trg = [...await triggersOf('exchange_rates'), ...await triggersOf('remittance_types')]
        .filter((t) => t.tgname.startsWith('exchange_rate_history_'));
      expect(trg).toHaveLength(4);
      expect(trg.every((t) => t.tgenabled === 'A')).toBe(true);
    });

    it('rollback stops recording but keeps the table and its rows; re-apply resumes', async () => {
      const id = await seedRate();
      await admin.query(down('hist'));
      await admin.query('UPDATE public.exchange_rates SET rate = 200 WHERE id = $1', [id]);
      expect((await historyOf(id)).map((r) => r.operation)).toEqual(['INSERT']);
      await admin.query(mig('hist'));
      await admin.query(mig('hist'));
      await admin.query('UPDATE public.exchange_rates SET rate = 201 WHERE id = $1', [id]);
      expect((await historyOf(id)).map((r) => [r.operation, r.rate])).toEqual([['INSERT', '123.450000'], ['UPDATE', '201.000000']]);
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe('(4) exchange_rates_distinct_currencies_chk is VALIDATED', () => {
    const validated = async () =>
      (await admin.query(`SELECT convalidated FROM pg_constraint WHERE conname = 'exchange_rates_distinct_currencies_chk'`)).rows[0].convalidated;

    it('validated after the migration, NOT VALID again after the rollback, idempotent on re-apply; same definition', async () => {
      expect(await validated()).toBe(true);
      await admin.query(down('chk'));
      expect(await validated()).toBe(false);
      await admin.query(mig('chk'));
      await admin.query(mig('chk'));
      expect(await validated()).toBe(true);
      const { rows } = await admin.query(
        `SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conname = 'exchange_rates_distinct_currencies_chk'`);
      expect(rows[0].d).toBe('CHECK ((from_currency_id <> to_currency_id))');
    });

    it('still rejects a same-currency pair', async () => {
      const err = await failure(admin.query(
        `INSERT INTO public.exchange_rates (from_currency_id, to_currency_id, rate, is_active, effective_date)
         VALUES ($1, $1, 1, false, DATE '2094-01-01')`, [cur.USD]));
      expect(err.code).toBe('23514');
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe('(5) get_order_exchange_rate / get_market_exchange_rate: no PUBLIC / anon EXECUTE', () => {
    it('anon cannot execute either; authenticated still can; ACL is exactly the live one minus PUBLIC/anon', async () => {
      const a = await anon();
      for (const fn of ['get_order_exchange_rate', 'get_market_exchange_rate']) {
        expect((await failure(a.query(`SELECT public.${fn}('USD', 'CUP')`))).code).toBe('42501');
      }
      const customer = await as(actors.customerId);
      expect((await customer.query(`SELECT public.get_order_exchange_rate('XXX', 'YYY') AS r`)).rowCount).toBe(1);
      expect(await aclOf('get_order_exchange_rate')).toEqual(['authenticated=X/postgres', 'postgres=X/postgres']);
      expect(await aclOf('get_market_exchange_rate')).toEqual(['authenticated=X/postgres', 'postgres=X/postgres']);
    });

    it('rollback restores the exact live ACLs; re-apply is idempotent', async () => {
      await admin.query(down('rev'));
      expect(await aclOf('get_order_exchange_rate')).toEqual(LIVE_ACL.get_order_exchange_rate);
      expect(await aclOf('get_market_exchange_rate')).toEqual(LIVE_ACL.get_market_exchange_rate);
      expect((await (await anon()).query(`SELECT public.get_order_exchange_rate('XXX', 'YYY') AS r`)).rowCount).toBe(1);
      await admin.query(mig('rev'));
      await admin.query(mig('rev'));
      expect(await aclOf('get_order_exchange_rate')).toEqual(['authenticated=X/postgres', 'postgres=X/postgres']);
    });

    it('is a no-op (no error) where the prod-only functions do not exist (repo / e2e rebuild)', async () => {
      await admin.query('BEGIN');
      try {
        await admin.query('DROP FUNCTION public.get_order_exchange_rate(text, text)');
        await admin.query('DROP FUNCTION public.get_market_exchange_rate(text, text)');
        await admin.query(code(mig('rev')).replace(/^BEGIN;|^COMMIT;/gm, ''));
        await admin.query(code(down('rev')).replace(/^BEGIN;|^COMMIT;/gm, ''));
      } finally {
        await admin.query('ROLLBACK');
      }
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe('(6) get_my_role honours is_enabled', () => {
    const roleOf = async (client) => (await client.query('SELECT public.get_my_role() AS r')).rows[0].r;

    it('enabled admin / super_admin keep their role', async () => {
      expect(await roleOf(await asRole('admin'))).toBe('admin');
      expect(await roleOf(await asRole('super_admin'))).toBe('super_admin');
    });

    it('a disabled admin or super_admin is just a user', async () => {
      expect(await roleOf(await asRole('admin', false))).toBe('user');
      expect(await roleOf(await asRole('super_admin', false))).toBe('user');
    });

    it('plain user, unknown uid and anon get user (never NULL)', async () => {
      expect(await roleOf(await as(actors.customerId))).toBe('user');
      expect(await roleOf(await as(randomUUID()))).toBe('user');
      expect(await roleOf(await anon())).toBe('user');
    });

    it('keeps language sql, STABLE, SECURITY DEFINER, search_path and the live ACL', async () => {
      const { rows } = await admin.query(
        `SELECT l.lanname, p.prosecdef, p.provolatile, p.proconfig::text AS cfg FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
          WHERE p.oid = 'public.get_my_role()'::regprocedure`);
      expect(rows[0]).toEqual({ lanname: 'sql', prosecdef: true, provolatile: 's', cfg: '{search_path=public}' });
      expect(await aclOf('get_my_role')).toEqual(LIVE_GET_MY_ROLE_ACL);
    });

    it('end to end: a disabled admin can no longer update notification_settings (policy uses get_my_role)', async () => {
      const { rows } = await admin.query(
        `INSERT INTO public.notification_settings (setting_type, value) VALUES ($1, 'v') RETURNING id`, [`f3-${randomUUID().slice(0, 8)}`]);
      const id = rows[0].id;
      const enabled = await asRole('admin');
      expect((await enabled.query(`UPDATE public.notification_settings SET value = 'a' WHERE id = $1`, [id])).rowCount).toBe(1);
      const disabled = await asRole('admin', false);
      expect((await disabled.query(`UPDATE public.notification_settings SET value = 'b' WHERE id = $1`, [id])).rowCount).toBe(0);
    });

    it('rollback restores the exact live body (disabled admin = admin again); re-apply is idempotent', async () => {
      await admin.query(down('role'));
      const { rows } = await admin.query(`SELECT prosrc FROM pg_proc WHERE oid = 'public.get_my_role()'::regprocedure`);
      expect(rows[0].prosrc).toBe(LIVE_GET_MY_ROLE_SRC);
      expect(await roleOf(await asRole('admin', false))).toBe('admin');
      expect(await aclOf('get_my_role')).toEqual(LIVE_GET_MY_ROLE_ACL);
      await admin.query(mig('role'));
      await admin.query(mig('role'));
      expect(await roleOf(await asRole('admin', false))).toBe('user');
    });
  });
});
