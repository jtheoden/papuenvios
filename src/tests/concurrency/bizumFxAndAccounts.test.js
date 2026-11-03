/**
 * Bizum slices S3 + S4 (design v2, sections 3.1 M1-M3 / 3.2): payment_methods.currency, the single-row
 * bizum_settings table, the append-only payment_fx_rates ledger and its RPCs, and bizum_accounts.
 *
 * Migrations under test:
 *   20261015120000_bizum_s3_currency_settings_fx_rates.sql
 *   20261015130000_bizum_s4_accounts.sql
 *
 * Runs against the LOCAL scratch database built by `npm run test:db:bootstrap`. The suite deliberately
 * does NOT list the new objects in `needs`: when the migrations are missing the tests must fail loudly
 * (they are the red phase of the TDD cycle), not skip.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dbSuiteSkipReason, connectAdmin, connectAs, connectAnon, endAll, fireTogether } from './db';
import { loadActors } from './fixtures';

const skipReason = await dbSuiteSkipReason({
  functions: ['is_admin_user', 'is_super_admin', 'list_payment_methods_public'],
  tables: ['payment_methods', 'activity_logs', 'user_profiles']
});
const describeDb = skipReason ? describe.skip : describe;

// Recommended defaults chosen by the owner (design v2 section 5).
const SETTINGS_DEFAULTS = {
  default_spread_pct: '1.50',
  quote_validity_minutes: 240,
  quote_grace_hours: 24,
  fx_warn_hours: 24,
  fx_block_hours: 96,
  fx_max_change_pct: '5.00',
  default_per_operation_limit: '1000.00',
  remittance_warn_hours: 48,
  remittance_expire_hours: 72,
  max_unpaid_ops_per_user: 3,
  max_open_quotes_per_user: 3,
  max_quotes_per_hour: 10,
  proof_retention_years: 5
};
const SETTING_KEYS = Object.keys(SETTINGS_DEFAULTS);

// [key, value that must be rejected]. Every CHECK of the table is hit from both sides.
const OUT_OF_RANGE = [
  ['default_spread_pct', -0.01], ['default_spread_pct', 10.01],
  ['quote_validity_minutes', 14], ['quote_validity_minutes', 1441],
  ['quote_grace_hours', -1], ['quote_grace_hours', 73],
  ['fx_warn_hours', 0], ['fx_warn_hours', 721],
  ['fx_block_hours', 0], ['fx_block_hours', 721],
  ['fx_max_change_pct', 0.49], ['fx_max_change_pct', 20.01],
  ['default_per_operation_limit', 0], ['default_per_operation_limit', -5],
  ['remittance_warn_hours', 0], ['remittance_warn_hours', 721],
  ['remittance_expire_hours', 0], ['remittance_expire_hours', 721],
  ['max_unpaid_ops_per_user', 0], ['max_unpaid_ops_per_user', 21],
  ['max_open_quotes_per_user', 0], ['max_open_quotes_per_user', 21],
  ['max_quotes_per_hour', 0], ['max_quotes_per_hour', 101],
  ['proof_retention_years', 0], ['proof_retention_years', 16]
];
// Boundary values that must be accepted.
const IN_RANGE_EDGES = [
  ['default_spread_pct', 0], ['default_spread_pct', 10],
  ['quote_validity_minutes', 15], ['quote_validity_minutes', 1440],
  ['quote_grace_hours', 0], ['quote_grace_hours', 72],
  ['fx_max_change_pct', 0.5], ['fx_max_change_pct', 20],
  ['default_per_operation_limit', 0.01],
  ['max_unpaid_ops_per_user', 1], ['max_unpaid_ops_per_user', 20],
  ['max_open_quotes_per_user', 1], ['max_open_quotes_per_user', 20],
  ['max_quotes_per_hour', 1], ['max_quotes_per_hour', 100],
  ['proof_retention_years', 1], ['proof_retention_years', 15]
];

const PUBLIC_RPCS = [
  'get_bizum_settings()',
  'set_bizum_settings(jsonb)',
  'set_payment_fx_rate(numeric, numeric, text, text, boolean)',
  'get_payment_fx_status()'
];
const INTERNAL_FUNCTIONS = [
  '_bizum_setting(text)',
  '_bizum_setting_keys()',
  '_payment_fx_latest()',
  '_current_payment_fx()',
  '_bizum_amount(numeric, numeric)',
  '_pick_bizum_account(text, numeric)',
  'payment_fx_rates_append_only()',
  'bizum_accounts_no_delete()',
  'bizum_settings_no_delete()',
  'bizum_accounts_guard()'
];

const failure = async (promise) => {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected the statement to fail, but it succeeded');
};

describeDb('Bizum S3 + S4: currency, settings, FX rates, accounts', () => {
  let admin;
  let actors;
  let ids;
  const clients = [];
  const accountIds = [];

  const as = async (userId, role = 'authenticated') => {
    const c = await connectAs(userId, role);
    clients.push(c);
    return c;
  };
  const asAdmin = () => as(actors.adminId);
  const asCustomer = () => as(actors.customerId);
  const asService = () => as(actors.adminId, 'service_role');
  const asAnon = async () => {
    const c = await connectAnon();
    clients.push(c);
    return c;
  };

  /** Run a statement as the owner with triggers off (append-only / no-delete guards). Test fixtures only. */
  const ownerBypass = async (sql, params = []) => {
    await admin.query('BEGIN');
    try {
      await admin.query(`SET LOCAL session_replication_role = 'replica'`);
      const res = await admin.query(sql, params);
      await admin.query('COMMIT');
      return res;
    } catch (error) {
      await admin.query('ROLLBACK');
      throw error;
    }
  };

  const resetSettings = () =>
    admin.query(
      `UPDATE public.bizum_settings SET ${SETTING_KEYS.map((k) => `${k} = DEFAULT`).join(', ')},
              updated_at = now(), updated_by = NULL`
    );
  const readSettings = async () =>
    (await admin.query(`SELECT ${SETTING_KEYS.join(', ')}, updated_by FROM public.bizum_settings`)).rows[0];

  const patch = (client, obj) =>
    client.query(`SELECT public.set_bizum_settings($1::jsonb) AS r`, [JSON.stringify(obj)]);
  /** The deprecated ledger RPC; kept to prove it no longer writes anything. */
  const setRate = async (client, mid) =>
    (await client.query(
      `SELECT public.set_payment_fx_rate($1::numeric, NULL::numeric, 'manual'::text, NULL::text, false::boolean) AS r`,
      [mid]
    )).rows[0].r;
  const fxStatus = async (client) => (await client.query(`SELECT public.get_payment_fx_status() AS r`)).rows[0].r;
  /** Writes the central USD->EUR pair the way Financial Settings does (an admin through RLS); upserts per day. */
  const setCentralRate = async (client, mid, { daysAgo = 0, active = true } = {}) =>
    (await client.query(
      `INSERT INTO public.exchange_rates (from_currency_id, to_currency_id, rate, is_active, effective_date)
       VALUES ($1, $2, $3, $4, CURRENT_DATE - $5::int)
       ON CONFLICT (from_currency_id, to_currency_id, effective_date)
       DO UPDATE SET rate = EXCLUDED.rate, is_active = EXCLUDED.is_active
       RETURNING *`,
      [ids.usd, ids.eur, mid, active, daysAgo]
    )).rows[0];
  const centralRows = async () =>
    (await admin.query(
      `SELECT * FROM public.exchange_rates WHERE from_currency_id = $1 AND to_currency_id = $2`,
      [ids.usd, ids.eur]
    )).rows;
  /** Ages the newest USD->EUR row by moving its effective_date back `days` days (age basis = effective date). */
  const backdateCentral = (days) =>
    admin.query(
      `UPDATE public.exchange_rates SET effective_date = CURRENT_DATE - $1::int
        WHERE id = (SELECT id FROM public.exchange_rates WHERE from_currency_id = $2 AND to_currency_id = $3
                     ORDER BY effective_date DESC, id DESC LIMIT 1)`,
      [days, ids.usd, ids.eur]
    );
  /** Touches updated_at / created_at WITHOUT changing the effective date (what a stray UPDATE would do). */
  const touchCentral = (id) =>
    admin.query(`UPDATE public.exchange_rates SET updated_at = now(), created_at = now() WHERE id = $1`, [id]);
  const currentFxRows = async () =>
    (await admin.query(`SELECT * FROM public._current_payment_fx()`)).rows;
  const fxRowCount = async () =>
    (await admin.query(`SELECT count(*)::int AS n FROM public.payment_fx_rates`)).rows[0].n;
  const logsFor = async (action) =>
    (await admin.query(`SELECT * FROM public.activity_logs WHERE action = $1 ORDER BY created_at`, [action])).rows;

  const seedAccount = async (overrides = {}) => {
    const a = {
      accountName: `bz-${randomUUID().slice(0, 8)}`,
      holder: 'Holder Test',
      phone: `+34${Math.floor(600000000 + Math.random() * 99999999)}`,
      isActive: true,
      forProducts: true,
      forRemittances: true,
      priority: 0,
      limit: 0,
      id: null,
      ...overrides
    };
    const { rows } = await admin.query(
      `INSERT INTO public.bizum_accounts (id, account_name, holder_name, phone, is_active, for_products,
                                          for_remittances, priority_order, per_operation_limit)
       VALUES (COALESCE($9::uuid, gen_random_uuid()),$1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [a.accountName, a.holder, a.phone, a.isActive, a.forProducts, a.forRemittances, a.priority, a.limit, a.id]
    );
    accountIds.push(rows[0].id);
    return { ...a, id: rows[0].id };
  };
  const pick = async (flow, eur) =>
    (await admin.query(`SELECT public._pick_bizum_account($1, $2::numeric) AS id`, [flow, eur])).rows[0].id;

  beforeAll(async () => {
    admin = await connectAdmin();
    actors = await loadActors(admin);
    const { rows } = await admin.query(`SELECT code, id FROM public.currencies WHERE code IN ('USD', 'EUR', 'CUP')`);
    const byCode = Object.fromEntries(rows.map((r) => [r.code, r.id]));
    ids = { usd: byCode.USD, eur: byCode.EUR, cup: byCode.CUP };
  });

  afterEach(async () => {
    await endAll(clients.splice(0));
    await admin.query(`UPDATE public.user_profiles SET role = 'admin', is_enabled = true WHERE id = $1`, [actors.adminId]);
    accountIds.splice(0);
    // bizum_accounts belongs to this suite alone: wipe every row, not only the tracked ones, so a row a
    // failing assertion let through can never leak into the next test.
    await ownerBypass(`DELETE FROM public.bizum_accounts`);
    await ownerBypass(`DELETE FROM public.payment_fx_rates`);
    await admin.query(`DELETE FROM public.exchange_rates WHERE from_currency_id = ANY($1::uuid[]) OR to_currency_id = ANY($1::uuid[])`, [[ids.usd, ids.eur]]);
    await admin.query(`INSERT INTO public.bizum_settings (id) VALUES (true) ON CONFLICT DO NOTHING`);
    await resetSettings();
    await admin.query(
      `DELETE FROM public.activity_logs WHERE action IN ('bizum_settings_updated', 'payment_fx_rate_set')`
    );
  });

  afterAll(async () => {
    await admin.end();
  });

  // --------------------------------------------------------------------------------------------
  describe('payment_methods.currency (M1)', () => {
    it('bizum is EUR and zelle stays USD; the column is NOT NULL', async () => {
      const { rows } = await admin.query(`SELECT code, currency FROM public.payment_methods ORDER BY code`);
      expect(rows).toEqual([
        { code: 'bizum', currency: 'EUR' },
        { code: 'zelle', currency: 'USD' }
      ]);
      const col = await admin.query(
        `SELECT is_nullable, column_default FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'payment_methods' AND column_name = 'currency'`
      );
      expect(col.rows[0].is_nullable).toBe('NO');
      expect(col.rows[0].column_default).toContain('USD');
    });

    it('the CHECK rejects any currency other than USD / EUR (and NULL)', async () => {
      const bad = await failure(admin.query(`UPDATE public.payment_methods SET currency = 'GBP' WHERE code = 'zelle'`));
      expect(bad.code).toBe('23514');
      const nul = await failure(admin.query(`UPDATE public.payment_methods SET currency = NULL WHERE code = 'zelle'`));
      expect(nul.code).toBe('23502');
    });

    it('does not change Zelle: flags, public listing columns and ACLs stay as characterized', async () => {
      const { rows } = await admin.query(
        `SELECT code, available, enabled_for_orders, enabled_for_remittances FROM public.payment_methods ORDER BY code`
      );
      expect(rows).toEqual([
        { code: 'bizum', available: false, enabled_for_orders: false, enabled_for_remittances: false },
        { code: 'zelle', available: true, enabled_for_orders: true, enabled_for_remittances: true }
      ]);
      const sig = await admin.query(
        `SELECT pg_get_function_result('public.list_payment_methods_public()'::regprocedure) AS res`
      );
      expect(sig.rows[0].res).toBe(
        'TABLE(code text, available boolean, enabled_for_orders boolean, enabled_for_remittances boolean)'
      );
      const customer = await asCustomer();
      const listing = await customer.query(`SELECT * FROM public.list_payment_methods_public()`);
      expect(Object.keys(listing.rows[0])).toEqual(['code', 'available', 'enabled_for_orders', 'enabled_for_remittances']);
      const acl = await admin.query(
        `SELECT has_table_privilege('authenticated', 'public.payment_methods', 'SELECT') AS sel,
                has_table_privilege('authenticated', 'public.payment_methods', 'UPDATE') AS upd,
                has_table_privilege('anon', 'public.payment_methods', 'SELECT') AS anon_sel`
      );
      expect(acl.rows[0]).toEqual({ sel: true, upd: false, anon_sel: false });
    });
  });

  // --------------------------------------------------------------------------------------------
  describe('grants, RLS and function hygiene (every new object)', () => {
    const fn = (sig) => `public.${sig}`;

    it.each(PUBLIC_RPCS)('%s: EXECUTE for authenticated + service_role, never anon or PUBLIC', async (sig) => {
      const { rows } = await admin.query(
        `SELECT has_function_privilege('anon', $1, 'EXECUTE') AS anon,
                has_function_privilege('authenticated', $1, 'EXECUTE') AS authenticated,
                has_function_privilege('service_role', $1, 'EXECUTE') AS service_role,
                (SELECT bool_or(a.grantee = 0) FROM pg_proc p, aclexplode(p.proacl) a WHERE p.oid = $1::regprocedure) AS public_grant`,
        [fn(sig)]
      );
      expect(rows[0].anon).toBe(false);
      expect(rows[0].authenticated).toBe(true);
      expect(rows[0].service_role).toBe(true);
      expect(rows[0].public_grant).toBeFalsy();
    });

    it.each(INTERNAL_FUNCTIONS)('%s: no EXECUTE for anon / authenticated / PUBLIC', async (sig) => {
      const { rows } = await admin.query(
        `SELECT has_function_privilege('anon', $1, 'EXECUTE') AS anon,
                has_function_privilege('authenticated', $1, 'EXECUTE') AS authenticated,
                has_function_privilege('service_role', $1, 'EXECUTE') AS service_role,
                (SELECT bool_or(a.grantee = 0) FROM pg_proc p, aclexplode(p.proacl) a WHERE p.oid = $1::regprocedure) AS public_grant`,
        [fn(sig)]
      );
      expect(rows[0].anon).toBe(false);
      expect(rows[0].authenticated).toBe(false);
      expect(rows[0].public_grant).toBeFalsy();
      // Trigger functions are never called directly; every other helper stays reachable for service_role.
      if (!/^(payment_fx_rates_append_only|bizum_accounts_no_delete|bizum_settings_no_delete|bizum_accounts_guard)\(/.test(sig)) expect(rows[0].service_role).toBe(true);
    });

    it('every SECURITY DEFINER function pins search_path = public, pg_temp', async () => {
      const { rows } = await admin.query(
        `SELECT p.proname, p.prosecdef, p.proconfig
           FROM pg_proc p
          WHERE p.pronamespace = 'public'::regnamespace
            AND p.proname IN ('get_bizum_settings','set_bizum_settings','set_payment_fx_rate','get_payment_fx_status',
                              '_bizum_setting','_payment_fx_latest','_current_payment_fx','_pick_bizum_account')`
      );
      expect(rows).toHaveLength(8);
      for (const r of rows) {
        expect(r.prosecdef, r.proname).toBe(true);
        expect(r.proconfig, r.proname).toContain('search_path=public, pg_temp');
      }
    });

    it.each(['bizum_settings', 'payment_fx_rates'])('%s: RLS on, no policies, no client privileges, service_role keeps access', async (table) => {
      const t = `public.${table}`;
      const { rows } = await admin.query(
        `SELECT (SELECT relrowsecurity FROM pg_class WHERE oid = $1::regclass) AS rls,
                (SELECT count(*)::int FROM pg_policies WHERE schemaname = 'public' AND tablename = $2) AS policies,
                has_table_privilege('service_role', $1, 'SELECT, INSERT') AS service_ok`,
        [t, table]
      );
      expect(rows[0]).toEqual({ rls: true, policies: 0, service_ok: true });
      for (const role of ['anon', 'authenticated']) {
        for (const priv of ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) {
          const r = await admin.query(`SELECT has_table_privilege($1, $2, $3) AS ok`, [role, t, priv]);
          expect(r.rows[0].ok, `${role} ${priv} on ${table}`).toBe(false);
        }
      }
    });

    it('a customer and anon cannot read or write the new tables directly', async () => {
      const customer = await asCustomer();
      const anon = await asAnon();
      for (const client of [customer, anon]) {
        expect((await failure(client.query(`SELECT * FROM public.bizum_settings`))).code).toBe('42501');
        expect((await failure(client.query(`SELECT * FROM public.payment_fx_rates`))).code).toBe('42501');
        expect((await failure(client.query(`UPDATE public.bizum_settings SET fx_warn_hours = 1`))).code).toBe('42501');
      }
    });
  });

  // --------------------------------------------------------------------------------------------
  describe('bizum_settings table (single row, typed, range-checked)', () => {
    it('is seeded with exactly one row holding the recommended defaults', async () => {
      const { rows } = await admin.query(`SELECT count(*)::int AS n FROM public.bizum_settings`);
      expect(rows[0].n).toBe(1);
      const row = await readSettings();
      expect({ ...row, updated_by: undefined }).toEqual({ ...SETTINGS_DEFAULTS, updated_by: undefined });
    });

    it('the column DEFAULTs equal the recommended values', async () => {
      await admin.query(`UPDATE public.bizum_settings SET fx_warn_hours = 2, default_spread_pct = 3`);
      await resetSettings();
      const row = await readSettings();
      expect({ ...row, updated_by: undefined }).toEqual({ ...SETTINGS_DEFAULTS, updated_by: undefined });
    });

    it('a second row is impossible (boolean PK pinned to true)', async () => {
      const dup = await failure(admin.query(`INSERT INTO public.bizum_settings (id) VALUES (true)`));
      expect(dup.code).toBe('23505');
      const other = await failure(admin.query(`INSERT INTO public.bizum_settings (id) VALUES (false)`));
      expect(other.code).toBe('23514');
    });

    it.each(OUT_OF_RANGE)('CHECK rejects %s = %s', async (key, value) => {
      const err = await failure(admin.query(`UPDATE public.bizum_settings SET ${key} = $1`, [value]));
      expect(err.code).toBe('23514');
    });

    it.each(IN_RANGE_EDGES)('CHECK accepts the boundary %s = %s', async (key, value) => {
      await admin.query(`UPDATE public.bizum_settings SET ${key} = $1`, [value]);
    });

    it('fx_warn_hours must stay below fx_block_hours (both directions)', async () => {
      expect((await failure(admin.query(`UPDATE public.bizum_settings SET fx_warn_hours = 96`))).code).toBe('23514');
      expect((await failure(admin.query(`UPDATE public.bizum_settings SET fx_block_hours = 24`))).code).toBe('23514');
      await admin.query(`UPDATE public.bizum_settings SET fx_warn_hours = 95`);
    });

    it('remittance_warn_hours must stay below remittance_expire_hours (both directions)', async () => {
      expect((await failure(admin.query(`UPDATE public.bizum_settings SET remittance_warn_hours = 72`))).code).toBe('23514');
      expect((await failure(admin.query(`UPDATE public.bizum_settings SET remittance_expire_hours = 48`))).code).toBe('23514');
      await admin.query(`UPDATE public.bizum_settings SET remittance_warn_hours = 71`);
    });

    it('rejects NULL in every configurable column', async () => {
      for (const key of SETTING_KEYS) {
        const err = await failure(admin.query(`UPDATE public.bizum_settings SET ${key} = NULL`));
        expect(err.code, key).toBe('23502');
      }
    });

    it('_bizum_setting reads one value and refuses unknown keys', async () => {
      const read = async (k) => (await admin.query(`SELECT public._bizum_setting($1) AS v`, [k])).rows[0].v;
      expect(Number(await read('fx_warn_hours'))).toBe(24);
      expect(Number(await read('default_spread_pct'))).toBe(1.5);
      await admin.query(`UPDATE public.bizum_settings SET fx_warn_hours = 10`);
      expect(Number(await read('fx_warn_hours'))).toBe(10);
      const err = await failure(admin.query(`SELECT public._bizum_setting('updated_by')`));
      expect(err.message).toBe('bizum_settings_unknown_key');
      const err2 = await failure(admin.query(`SELECT public._bizum_setting('nope')`));
      expect(err2.message).toBe('bizum_settings_unknown_key');
    });
  });

  // --------------------------------------------------------------------------------------------
  describe('get_bizum_settings / set_bizum_settings', () => {
    it('get_bizum_settings returns the row to an admin', async () => {
      const a = await asAdmin();
      const { rows } = await a.query(`SELECT public.get_bizum_settings() AS r`);
      expect(rows[0].r.fx_warn_hours).toBe(24);
      expect(Number(rows[0].r.default_spread_pct)).toBe(1.5);
      expect(Object.keys(rows[0].r)).toEqual(expect.arrayContaining(SETTING_KEYS));
    });

    it('a super_admin may read and write too', async () => {
      await admin.query(`UPDATE public.user_profiles SET role = 'super_admin' WHERE id = $1`, [actors.adminId]);
      const a = await asAdmin();
      await patch(a, { fx_warn_hours: 12 });
      expect((await readSettings()).fx_warn_hours).toBe(12);
    });

    it('a customer, a disabled admin and anon are rejected by both settings RPCs', async () => {
      const customer = await asCustomer();
      for (const sql of [`SELECT public.get_bizum_settings()`, `SELECT public.set_bizum_settings('{"fx_warn_hours":12}'::jsonb)`]) {
        const err = await failure(customer.query(sql));
        expect(err.message).toBe('bizum_settings_forbidden');
        expect(err.code).toBe('42501');
      }
      await admin.query(`UPDATE public.user_profiles SET is_enabled = false WHERE id = $1`, [actors.adminId]);
      const disabled = await asAdmin();
      expect((await failure(disabled.query(`SELECT public.get_bizum_settings()`))).message).toBe('bizum_settings_forbidden');
      const anon = await asAnon();
      expect((await failure(anon.query(`SELECT public.get_bizum_settings()`))).code).toBe('42501');
      expect((await failure(anon.query(`SELECT public.set_bizum_settings('{}'::jsonb)`))).code).toBe('42501');
      expect((await readSettings()).fx_warn_hours).toBe(24);
    });

    it('a partial patch touches only the named columns and stamps updated_at / updated_by', async () => {
      const a = await asAdmin();
      const before = (await admin.query(`SELECT updated_at FROM public.bizum_settings`)).rows[0].updated_at;
      const { rows } = await patch(a, { fx_warn_hours: 12, default_spread_pct: 2.25 });
      expect(rows[0].r.fx_warn_hours).toBe(12);
      const after = await readSettings();
      expect(after).toEqual({ ...SETTINGS_DEFAULTS, fx_warn_hours: 12, default_spread_pct: '2.25', updated_by: actors.adminId });
      const stamp = (await admin.query(`SELECT updated_at FROM public.bizum_settings`)).rows[0].updated_at;
      expect(stamp.getTime()).toBeGreaterThan(before.getTime());
    });

    it('rejects unknown keys with a uniform error and applies nothing from the same patch', async () => {
      const a = await asAdmin();
      for (const obj of [{ nope: 1 }, { fx_warn_hours: 12, nope: 1 }, { updated_by: actors.adminId }, { id: false }, { updated_at: 'x' }]) {
        const err = await failure(patch(a, obj));
        expect(err.message).toBe('bizum_settings_unknown_key');
        expect(err.code).toBe('P0001');
      }
      expect((await readSettings()).fx_warn_hours).toBe(24);
    });

    it.each(OUT_OF_RANGE)('RPC rejects %s = %s as out of range and names the key', async (key, value) => {
      const a = await asAdmin();
      const err = await failure(patch(a, { [key]: value }));
      expect(err.message).toBe('bizum_settings_out_of_range');
      expect(err.code).toBe('P0001');
      expect(err.detail).toContain(key);
      expect(await readSettings()).toEqual({ ...SETTINGS_DEFAULTS, updated_by: null });
    });

    it.each(IN_RANGE_EDGES)('RPC accepts the boundary %s = %s', async (key, value) => {
      const a = await asAdmin();
      await patch(a, { [key]: value });
      expect(Number((await readSettings())[key])).toBe(value);
    });

    it('rejects non-numeric, null, boolean, fractional-integer and over-precise values', async () => {
      const a = await asAdmin();
      for (const [key, value] of [
        ['fx_warn_hours', 'abc'], ['fx_warn_hours', null], ['fx_warn_hours', true], ['fx_warn_hours', [1]],
        ['fx_warn_hours', 12.5], ['default_spread_pct', 1.555], ['default_per_operation_limit', 10.005],
        ['fx_max_change_pct', '5']
      ]) {
        const err = await failure(patch(a, { [key]: value }));
        expect(err.message, `${key}=${JSON.stringify(value)}`).toBe('bizum_settings_out_of_range');
        expect(err.detail).toContain(key);
      }
    });

    it('accepts integers written as 12.0 and stores 12; 12.5 stays out of range', async () => {
      const a = await asAdmin();
      await a.query(`SELECT public.set_bizum_settings($1::jsonb)`, ['{"fx_warn_hours":12.0,"quote_grace_hours":3.00}']);
      const row = await readSettings();
      expect([row.fx_warn_hours, row.quote_grace_hours]).toEqual([12, 3]);
      const err = await failure(a.query(`SELECT public.set_bizum_settings($1::jsonb)`, ['{"fx_warn_hours":12.5}']));
      expect(err.message).toBe('bizum_settings_out_of_range');
      const logs = await logsFor('bizum_settings_updated');
      expect(logs[0].metadata.changes.fx_warn_hours).toEqual({ before: 24, after: 12 });
    });

    it.each([['fx_warn_hours', 1e12], ['quote_validity_minutes', 2147483648], ['default_spread_pct', 1e12], ['fx_max_change_pct', 1000], ['default_per_operation_limit', 1e12]])(
      'overflow cap: %s = %s is out of range (not a raw numeric/int overflow)', async (key, value) => {
        const a = await asAdmin();
        const err = await failure(patch(a, { [key]: value }));
        expect(err.message).toBe('bizum_settings_out_of_range');
        expect(err.code).toBe('P0001');
        expect(err.detail).toContain(key);
      }
    );

    it('two admins patching DIFFERENT keys at the same time both survive (no lost update)', async () => {
      const keys = [['fx_warn_hours', 'quote_grace_hours'], ['max_quotes_per_hour', 'proof_retention_years'], ['fx_max_change_pct', 'max_unpaid_ops_per_user']];
      for (let round = 0; round < 8; round++) {
        const [k1, k2] = keys[round % keys.length];
        const v1 = round % 2 ? 11 : 12;
        const v2 = round % 2 ? 6 : 7;
        const c1 = await asAdmin();
        const c2 = await asAdmin();
        const results = await fireTogether([
          { client: c1, sql: `public.set_bizum_settings($1::jsonb)`, params: [JSON.stringify({ [k1]: v1 })] },
          { client: c2, sql: `public.set_bizum_settings($1::jsonb)`, params: [JSON.stringify({ [k2]: v2 })] }
        ]);
        expect(results.map((r) => r.error?.message)).toEqual([undefined, undefined]);
        const row = await readSettings();
        expect(Number(row[k1]), `round ${round} ${k1}`).toBe(v1);
        expect(Number(row[k2]), `round ${round} ${k2}`).toBe(v2);
        await resetSettings();
      }
    });

    it('the single settings row cannot be deleted or truncated by anyone', async () => {
      const service = await asService();
      const a = await asAdmin();
      for (const client of [admin, service]) {
        expect((await failure(client.query(`DELETE FROM public.bizum_settings`))).message).toBe('bizum_settings_no_delete');
      }
      expect((await failure(a.query(`DELETE FROM public.bizum_settings`))).code).toBe('42501');
      expect((await failure(admin.query(`TRUNCATE public.bizum_settings`))).message).toBe('bizum_settings_no_delete');
      expect((await admin.query(`SELECT count(*)::int AS n FROM public.bizum_settings`)).rows[0].n).toBe(1);
    });

    it('fails closed when the settings row is missing (no silent NULL / zero rows)', async () => {
      const a = await asAdmin();
      await ownerBypass(`DELETE FROM public.bizum_settings`);
      const viaAdmin = [
        `SELECT public.get_bizum_settings()`,
        `SELECT public.set_bizum_settings('{"fx_warn_hours":12}'::jsonb)`,
        `SELECT public.get_payment_fx_status()`
      ];
      for (const sql of viaAdmin) {
        const err = await failure(a.query(sql));
        expect(err.message, sql).toBe('bizum_settings_missing');
        expect(err.code).toBe('P0001');
      }
      for (const sql of [`SELECT public._bizum_setting('fx_warn_hours')`, `SELECT * FROM public._payment_fx_latest()`, `SELECT * FROM public._current_payment_fx()`]) {
        expect((await failure(admin.query(sql))).message, sql).toBe('bizum_settings_missing');
      }
    });

    it('rejects a non-object patch', async () => {
      const a = await asAdmin();
      for (const bad of ['[]', '"x"', '1', 'null']) {
        const err = await failure(a.query(`SELECT public.set_bizum_settings($1::jsonb)`, [bad]));
        expect(err.message, bad).toBe('bizum_settings_invalid_patch');
      }
      const nul = await failure(a.query(`SELECT public.set_bizum_settings(NULL::jsonb)`));
      expect(nul.message).toBe('bizum_settings_invalid_patch');
    });

    it('validates the MERGED row for the cross-field rules', async () => {
      const a = await asAdmin();
      const warnTooHigh = await failure(patch(a, { fx_warn_hours: 100 }));
      expect(warnTooHigh.message).toBe('bizum_settings_out_of_range');
      expect(warnTooHigh.detail).toContain('fx_warn_hours');
      const blockTooLow = await failure(patch(a, { fx_block_hours: 20 }));
      expect(blockTooLow.message).toBe('bizum_settings_out_of_range');
      expect(blockTooLow.detail).toContain('fx_block_hours');
      const expireTooLow = await failure(patch(a, { remittance_expire_hours: 48 }));
      expect(expireTooLow.message).toBe('bizum_settings_out_of_range');
      const warnTooHighR = await failure(patch(a, { remittance_warn_hours: 72 }));
      expect(warnTooHighR.message).toBe('bizum_settings_out_of_range');
      await patch(a, { fx_warn_hours: 100, fx_block_hours: 200 });
      const row = await readSettings();
      expect([row.fx_warn_hours, row.fx_block_hours]).toEqual([100, 200]);
    });

    it('writes an audit row with the numeric before/after diff and no PII', async () => {
      const a = await asAdmin();
      await patch(a, { fx_warn_hours: 12, default_spread_pct: 2 });
      const logs = await logsFor('bizum_settings_updated');
      expect(logs).toHaveLength(1);
      expect(logs[0].entity_type).toBe('bizum_settings');
      expect(logs[0].performed_by).toBe(actors.adminId);
      expect(logs[0].metadata.changes).toEqual({
        fx_warn_hours: { before: 24, after: 12 },
        default_spread_pct: { before: 1.5, after: 2 }
      });
    });

    it('a patch that changes nothing writes neither the row nor an audit entry', async () => {
      const a = await asAdmin();
      await patch(a, { fx_warn_hours: 24, default_spread_pct: 1.5 });
      expect(await logsFor('bizum_settings_updated')).toHaveLength(0);
      expect((await readSettings()).updated_by).toBeNull();
      await patch(a, {});
      expect(await logsFor('bizum_settings_updated')).toHaveLength(0);
    });

    it('a rejected patch leaves no audit entry', async () => {
      const a = await asAdmin();
      expect((await failure(patch(a, { fx_warn_hours: 0 }))).message).toBe('bizum_settings_out_of_range');
      expect(await logsFor('bizum_settings_updated')).toHaveLength(0);
    });
  });

  // --------------------------------------------------------------------------------------------
  describe('payment_fx_rates table (append-only ledger)', () => {
    const insertRate = (client, mid = 0.92, spread = 1.5) =>
      client.query(
        `INSERT INTO public.payment_fx_rates (to_currency, mid_rate, spread_pct, source) VALUES ('EUR', $1, $2, 'manual') RETURNING *`,
        [mid, spread]
      );

    it('CHECKs: currency EUR only, mid 0.5..1.5, spread 0..10, source manual|ecb_prefill, note <= 500', async () => {
      const bad = [
        [`'USD'`, 0.92, 1.5, `'manual'`, 'NULL'],
        [`'EUR'`, 0.4999, 1.5, `'manual'`, 'NULL'],
        [`'EUR'`, 1.5001, 1.5, `'manual'`, 'NULL'],
        [`'EUR'`, 0.92, -0.01, `'manual'`, 'NULL'],
        [`'EUR'`, 0.92, 10.01, `'manual'`, 'NULL'],
        [`'EUR'`, 0.92, 1.5, `'scraped'`, 'NULL'],
        [`'EUR'`, 0.92, 1.5, `'manual'`, `repeat('x', 501)`]
      ];
      for (const [cur, mid, spread, src, note] of bad) {
        const err = await failure(
          admin.query(
            `INSERT INTO public.payment_fx_rates (to_currency, mid_rate, spread_pct, source, note)
             VALUES (${cur}, $1, $2, ${src}, ${note})`,
            [mid, spread]
          )
        );
        expect(err.code, `${cur} ${mid} ${spread} ${src}`).toBe('23514');
      }
      for (const [mid, spread] of [[0.5, 0], [1.5, 10]]) {
        await insertRate(admin, mid, spread);
        await ownerBypass(`DELETE FROM public.payment_fx_rates`);
      }
    });

    it('effective_rate is generated: round(mid * (1 + spread/100), 6) and cannot be written', async () => {
      const { rows } = await insertRate(admin, 0.923457, 1.5);
      expect(rows[0].effective_rate).toBe('0.937309');
      const direct = await failure(
        admin.query(`INSERT INTO public.payment_fx_rates (to_currency, mid_rate, spread_pct, source, effective_rate) VALUES ('EUR', 0.9, 1, 'manual', 1)`)
      );
      expect(direct.code).toBe('428C9');
    });

    it('gets an id and created_at by default', async () => {
      const { rows } = await insertRate(admin);
      expect(rows[0].id).toMatch(/^[0-9a-f-]{36}$/);
      expect(rows[0].created_at).toBeInstanceOf(Date);
    });

    it('UPDATE and DELETE are refused for the owner, service_role and everyone else', async () => {
      await insertRate(admin);
      const service = await asService();
      for (const client of [admin, service]) {
        const upd = await failure(client.query(`UPDATE public.payment_fx_rates SET note = 'x'`));
        expect(upd.message).toBe('payment_fx_rates_append_only');
        const del = await failure(client.query(`DELETE FROM public.payment_fx_rates`));
        expect(del.message).toBe('payment_fx_rates_append_only');
      }
      const trunc = await failure(admin.query(`TRUNCATE public.payment_fx_rates`));
      // Either the append-only trigger or (if a foreign key still points at the table) Postgres itself refuses it.
      expect(trunc.message).toMatch(/^(payment_fx_rates_append_only|cannot truncate a table referenced in a foreign key constraint)$/);
      expect(await fxRowCount()).toBe(1);
    });
  });

  // --------------------------------------------------------------------------------------------
  describe('set_payment_fx_rate (deprecated: the USD->EUR rate is managed in exchange_rates)', () => {
    it('keeps its admin gate: customer, disabled admin and anon are rejected as before', async () => {
      const customer = await asCustomer();
      const err = await failure(setRate(customer, 0.92));
      expect(err.message).toBe('payment_fx_forbidden');
      expect(err.code).toBe('42501');
      await admin.query(`UPDATE public.user_profiles SET is_enabled = false WHERE id = $1`, [actors.adminId]);
      const disabled = await asAdmin();
      expect((await failure(setRate(disabled, 0.92))).message).toBe('payment_fx_forbidden');
      const anon = await asAnon();
      expect((await failure(setRate(anon, 0.92))).code).toBe('42501');
    });

    it('an admin gets payment_fx_managed_centrally and nothing is written anywhere', async () => {
      const a = await asAdmin();
      const err = await failure(setRate(a, 0.92));
      expect(err.message).toBe('payment_fx_managed_centrally');
      expect(err.code).toBe('P0001');
      expect(await fxRowCount()).toBe(0);
      expect(await centralRows()).toHaveLength(0);
      expect(await logsFor('payment_fx_rate_set')).toHaveLength(0);
      expect(await currentFxRows()).toHaveLength(0);
    });

    it('the legacy ledger can no longer feed the quoted rate: a ledger row is ignored', async () => {
      await admin.query(
        `INSERT INTO public.payment_fx_rates (to_currency, mid_rate, spread_pct, source) VALUES ('EUR', 0.92, 1.5, 'manual')`
      );
      expect(await currentFxRows()).toHaveLength(0);
      expect((await admin.query(`SELECT state FROM public._payment_fx_latest()`)).rows[0].state).toBe('none');
    });
  });

  // --------------------------------------------------------------------------------------------
  describe('audit rows never carry a phone number', () => {
    it('a phone typed in the settings flow or an account never reaches activity_logs', async () => {
      const phone = '+34600123456';
      const started = (await admin.query(`SELECT clock_timestamp() AS t`)).rows[0].t;
      const a = await asAdmin();
      await a.query(
        `INSERT INTO public.bizum_accounts (account_name, holder_name, phone, per_operation_limit) VALUES ('pii', 'h', $1, 0)`,
        [phone]
      );
      await patch(a, { fx_warn_hours: 12 });
      const { rows } = await admin.query(`SELECT * FROM public.activity_logs WHERE created_at >= $1`, [started]);
      expect(rows.length).toBeGreaterThanOrEqual(1);
      const blob = JSON.stringify(rows);
      expect(blob).not.toContain('600123456');
      expect(blob).not.toContain('34600');
    });
  });

  // --------------------------------------------------------------------------------------------
  describe('get_payment_fx_status / _current_payment_fx (central rate from exchange_rates)', () => {
    it('rejects customer, disabled admin and anon', async () => {
      const customer = await asCustomer();
      const err = await failure(fxStatus(customer));
      expect(err.message).toBe('payment_fx_forbidden');
      expect(err.code).toBe('42501');
      await admin.query(`UPDATE public.user_profiles SET is_enabled = false WHERE id = $1`, [actors.adminId]);
      const disabled = await asAdmin();
      expect((await failure(fxStatus(disabled))).message).toBe('payment_fx_forbidden');
      const anon = await asAnon();
      expect((await failure(fxStatus(anon))).code).toBe('42501');
    });

    it("state 'none' without a USD->EUR pair, with the thresholds from the settings", async () => {
      const a = await asAdmin();
      const s = await fxStatus(a);
      expect(s).toMatchObject({ state: 'none', fx_warn_hours: 24, fx_block_hours: 96 });
      expect(s.mid_rate ?? null).toBeNull();
      expect(await currentFxRows()).toHaveLength(0);
    });

    it('reports the central rate: mid = exchange_rates.rate, spread = bizum_settings.default_spread_pct', async () => {
      const a = await asAdmin();
      const row = await setCentralRate(a, 0.93);
      const s = await fxStatus(a);
      expect(s.id).toBe(row.id);
      expect(Number(s.mid_rate)).toBe(0.93);
      expect(Number(s.spread_pct)).toBe(1.5);
      expect(Number(s.effective_rate)).toBe(0.94395);
      expect(s.source).toBe('exchange_rates');
      expect(s.created_by ?? null).toBeNull();
      expect(s.age_hours).toBeGreaterThanOrEqual(0); // hours since 00:00 UTC of the effective date
      expect(s.age_hours).toBeLessThan(24);
      expect(s.state).toBe('ok');
    });

    it('a modified default_spread_pct moves the live effective rate at once (0 and 10 are the extremes)', async () => {
      const a = await asAdmin();
      await setCentralRate(a, 0.92);
      for (const [spread, effective] of [[0, 0.92], [2, 0.9384], [10, 1.012]]) {
        await patch(a, { default_spread_pct: spread });
        const [row] = await currentFxRows();
        expect(Number(row.spread_pct)).toBe(spread);
        expect(Number(row.effective_rate)).toBe(effective);
      }
    });

    it('editing the central row in place (what Financial Settings does) changes the live rate at once', async () => {
      const a = await asAdmin();
      const row = await setCentralRate(a, 0.92);
      await a.query(`UPDATE public.exchange_rates SET rate = 0.95 WHERE id = $1`, [row.id]);
      const [now] = await currentFxRows();
      expect(now.id).toBe(row.id);
      expect(Number(now.mid_rate)).toBe(0.95);
      expect(Number(now.effective_rate)).toBe(0.96425);
    });

    // Age is measured from the EFFECTIVE DATE (midnight UTC of that day), so it moves in day steps:
    // a row dated N days ago is between 24*N and 24*N+24 hours old.
    it.each([
      [0, 'ok'], [1, 'warn'], [3, 'warn'], [4, 'blocked'], [20, 'blocked']
    ])('default thresholds, measured on exchange_rates.effective_date: dated %s day(s) ago => %s', async (days, state) => {
      const a = await asAdmin();
      await setCentralRate(a, 0.92);
      await backdateCentral(days);
      const s = await fxStatus(a);
      expect(s.state).toBe(state);
      expect(s.age_hours).toBeGreaterThanOrEqual(days * 24);
      expect(s.age_hours).toBeLessThan(days * 24 + 24);
      const usable = await currentFxRows();
      expect(usable).toHaveLength(state === 'blocked' ? 0 : 1);
      if (usable[0]) expect(usable[0].state).toBe(state);
    });

    it.each([
      [0, 'ok'], [1, 'ok'], [2, 'warn'], [3, 'warn'], [4, 'blocked'], [30, 'blocked']
    ])('exact day boundaries with warn 48 h / block 96 h: dated %s day(s) ago => %s', async (days, state) => {
      const a = await asAdmin();
      await patch(a, { fx_warn_hours: 48, fx_block_hours: 96 });
      await setCentralRate(a, 0.92);
      await backdateCentral(days);
      const s = await fxStatus(a);
      expect(s).toMatchObject({ state, fx_warn_hours: 48, fx_block_hours: 96 });
      expect(await currentFxRows()).toHaveLength(state === 'blocked' ? 0 : 1);
    });

    it('re-saving today (effective_date = today) refreshes the age', async () => {
      const a = await asAdmin();
      const row = await setCentralRate(a, 0.92);
      await backdateCentral(10);
      expect((await fxStatus(a)).state).toBe('blocked');
      await a.query(`UPDATE public.exchange_rates SET rate = 0.921, effective_date = CURRENT_DATE WHERE id = $1`, [row.id]);
      expect((await fxStatus(a)).state).toBe('ok');
    });

    it('touching an old row does NOT refresh it: updated_at / created_at / is_active are not the age basis', async () => {
      const a = await asAdmin();
      const row = await setCentralRate(a, 0.92);
      await backdateCentral(10);
      await touchCentral(row.id);
      expect((await fxStatus(a)).state).toBe('blocked');
      await a.query(`UPDATE public.exchange_rates SET rate = 0.921 WHERE id = $1`, [row.id]); // trigger stamps updated_at
      expect((await fxStatus(a)).state).toBe('blocked');
      expect(await currentFxRows()).toHaveLength(0);
    });

    it('reactivating an old inactive row (toggle is_active) leaves it blocked or warn, never ok', async () => {
      const a = await asAdmin();
      const oldRow = await setCentralRate(a, 0.92, { daysAgo: 10, active: false });
      expect((await fxStatus(a)).state).toBe('none');
      await a.query(`UPDATE public.exchange_rates SET is_active = true WHERE id = $1`, [oldRow.id]);
      expect((await fxStatus(a)).state).toBe('blocked');
      expect(await currentFxRows()).toHaveLength(0);
      await backdateCentral(2);
      expect((await fxStatus(a)).state).toBe('warn');
      await a.query(`UPDATE public.exchange_rates SET is_active = false WHERE id = $1`, [oldRow.id]);
      await a.query(`UPDATE public.exchange_rates SET is_active = true WHERE id = $1`, [oldRow.id]);
      expect((await fxStatus(a)).state).toBe('warn');
    });

    it('does not depend on an updated_at trigger: a row without any timestamp still ages by its effective date', async () => {
      const a = await asAdmin();
      const row = await setCentralRate(a, 0.92);
      await ownerBypass(`UPDATE public.exchange_rates SET updated_at = NULL, created_at = NULL WHERE id = $1`, [row.id]);
      expect((await fxStatus(a)).state).toBe('ok');
      await backdateCentral(10);
      expect((await fxStatus(a)).state).toBe('blocked');
    });

    it('a row dated tomorrow is treated as "now": age 0, ok, never negative', async () => {
      const a = await asAdmin();
      await setCentralRate(a, 0.92, { daysAgo: -1 });
      const s = await fxStatus(a);
      expect(s.state).toBe('ok');
      expect(Number(s.age_hours)).toBe(0);
    });

    it('a row dated more than one day ahead is ignored (and never masks a valid older one)', async () => {
      const a = await asAdmin();
      const far = await setCentralRate(a, 0.8, { daysAgo: -3 });
      expect((await fxStatus(a)).state).toBe('none');
      // At most one ACTIVE row per pair (exchange_rates_one_active_per_pair): the admin fixes the date in place,
      // which is what updateExchangeRatePair does.
      await a.query(`UPDATE public.exchange_rates SET rate = 0.92, effective_date = CURRENT_DATE - 1 WHERE id = $1`, [far.id]);
      const [row] = await currentFxRows();
      expect(row.id).toBe(far.id);
    });

    it("tomorrow's date is accepted: a client in a timezone ahead of the server may stamp it", async () => {
      const a = await asAdmin();
      const row = await setCentralRate(a, 0.92, { daysAgo: -1 });
      expect((await currentFxRows())[0].id).toBe(row.id);
    });

    it('an inactive pair is ignored: no usable rate', async () => {
      const a = await asAdmin();
      await setCentralRate(a, 0.92, { active: false });
      expect((await fxStatus(a)).state).toBe('none');
      expect(await currentFxRows()).toHaveLength(0);
    });

    it('an inactive NEWER row does not mask the older active one', async () => {
      const a = await asAdmin();
      const older = await setCentralRate(a, 0.92, { daysAgo: 1 });
      await setCentralRate(a, 0.8, { daysAgo: 0, active: false });
      const [row] = await currentFxRows();
      expect(row.id).toBe(older.id);
      expect(Number(row.mid_rate)).toBe(0.92);
    });

    it('a rate <= 0 is never used (rejected by a CHECK when the table has one, otherwise ignored)', async () => {
      const a = await asAdmin();
      const valid = await setCentralRate(a, 0.92, { daysAgo: 1 });
      const checks = (await admin.query(
        `SELECT 1 FROM pg_constraint WHERE conrelid = 'public.exchange_rates'::regclass AND contype = 'c'
            AND pg_get_constraintdef(oid) ~* 'rate > \\(?0'`
      )).rows;
      for (const bad of [0, -0.92]) {
        let accepted = true;
        try {
          await setCentralRate(a, bad, { daysAgo: 0 });
        } catch (error) {
          accepted = false;
          expect(error.code).toBe('23514');
        }
        expect(accepted).toBe(checks.length === 0);
        const [row] = await currentFxRows();
        expect(row.id, String(bad)).toBe(valid.id);
        await admin.query(`DELETE FROM public.exchange_rates WHERE effective_date = CURRENT_DATE AND from_currency_id = $1 AND to_currency_id = $2`, [ids.usd, ids.eur]);
      }
    });

    it('a second ACTIVE row for the pair is rejected, so the choice is never ambiguous; inactive history is ignored', async () => {
      const a = await asAdmin();
      const only = await setCentralRate(a, 0.95, { daysAgo: 0 });
      await setCentralRate(a, 0.9, { daysAgo: 2, active: false });
      await setCentralRate(a, 0.91, { daysAgo: 3, active: false });
      let duplicate;
      try {
        await setCentralRate(a, 0.9, { daysAgo: 1 });
      } catch (error) {
        duplicate = error;
      }
      expect(duplicate?.code).toBe('23505');
      expect(duplicate?.constraint).toBe('exchange_rates_one_active_per_pair');
      // repeated reads are stable (deterministic choice)
      for (let i = 0; i < 3; i++) expect((await currentFxRows())[0].id).toBe(only.id);
    });

    it('only the DIRECT USD->EUR pair counts: the inverse EUR->USD and other pairs give no rate', async () => {
      const a = await asAdmin();
      const insertPair = (from, to, rate) =>
        a.query(`INSERT INTO public.exchange_rates (from_currency_id, to_currency_id, rate) VALUES ($1, $2, $3)`, [from, to, rate]);
      await insertPair(ids.eur, ids.usd, 1.087); // the inverse
      await insertPair(ids.usd, ids.cup, 120); // another destination
      expect((await fxStatus(a)).state).toBe('none');
      expect(await currentFxRows()).toHaveLength(0);
    });

    it.each([0.4999, 1.5001, 92, 920])('a mid outside the 0.5..1.5 sanity band (%s) is blocked, so a typo cannot be quoted', async (mid) => {
      const a = await asAdmin();
      await setCentralRate(a, mid);
      expect((await fxStatus(a)).state).toBe('blocked');
      expect(await currentFxRows()).toHaveLength(0);
    });

    it.each([0.5, 1.5])('the sanity band is inclusive: %s is usable', async (mid) => {
      const a = await asAdmin();
      await setCentralRate(a, mid);
      expect(await currentFxRows()).toHaveLength(1);
    });

    it('_current_payment_fx exposes id, mid, spread and the effective rate of the central row', async () => {
      const a = await asAdmin();
      const r = await setCentralRate(a, 0.92);
      const [row] = await currentFxRows();
      expect(row.id).toBe(r.id);
      expect([row.mid_rate, row.spread_pct, row.effective_rate]).toEqual(['0.920000', '1.50', '0.933800']);
    });

    it('end to end with the design example: 100.00 USD at mid 0.92 and spread 1.5 % is 93.38 EUR', async () => {
      const a = await asAdmin();
      await setCentralRate(a, 0.92);
      const { rows } = await admin.query(
        `SELECT public._bizum_amount(100.00, (SELECT effective_rate FROM public._current_payment_fx())) AS eur`
      );
      expect(rows[0].eur).toBe('93.38');
    });

    it('access: a customer and anon cannot write exchange_rates, so they cannot move the Bizum rate', async () => {
      const a = await asAdmin();
      const row = await setCentralRate(a, 0.92);
      const customer = await asCustomer();
      const anon = await asAnon();
      const insert = `INSERT INTO public.exchange_rates (from_currency_id, to_currency_id, rate, effective_date)
                      VALUES ($1, $2, 1.4, CURRENT_DATE - 30)`;
      expect((await failure(customer.query(insert, [ids.usd, ids.eur]))).code).toBe('42501'); // RLS WITH CHECK
      expect((await failure(anon.query(insert, [ids.usd, ids.eur]))).code).toBe('42501'); // no privilege
      // RLS hides the row from UPDATE / DELETE: no error, zero rows touched
      expect((await customer.query(`UPDATE public.exchange_rates SET rate = 1.4 WHERE id = $1`, [row.id])).rowCount).toBe(0);
      expect((await customer.query(`DELETE FROM public.exchange_rates WHERE id = $1`, [row.id])).rowCount).toBe(0);
      expect((await failure(anon.query(`UPDATE public.exchange_rates SET rate = 1.4 WHERE id = $1`, [row.id]))).code).toBe('42501');
      expect(Number((await currentFxRows())[0].mid_rate)).toBe(0.92);
      // positive control: an admin can, through the existing policy
      await a.query(`UPDATE public.exchange_rates SET rate = 0.93 WHERE id = $1`, [row.id]);
      expect(Number((await currentFxRows())[0].mid_rate)).toBe(0.93);
    });

    it('access: the internal readers are not callable by clients', async () => {
      const customer = await asCustomer();
      const anon = await asAnon();
      for (const client of [customer, anon]) {
        for (const sql of [`SELECT * FROM public._current_payment_fx()`, `SELECT * FROM public._payment_fx_latest()`]) {
          expect((await failure(client.query(sql))).code, sql).toBe('42501');
        }
      }
    });
  });

  // --------------------------------------------------------------------------------------------
  describe('_bizum_amount (shared rounding)', () => {
    const amount = async (usd, rate) =>
      (await admin.query(`SELECT public._bizum_amount($1::numeric, $2::numeric) AS v`, [usd, rate])).rows[0].v;

    it('design example: 100.00 * 0.933800 = 93.38', async () => {
      expect(await amount('100.00', '0.933800')).toBe('93.38');
    });

    it('rounds half up on exact decimals', async () => {
      expect(await amount('0.005', '1')).toBe('0.01');
      expect(await amount('2.675', '1')).toBe('2.68');
      expect(await amount('1.005', '1')).toBe('1.01');
      expect(await amount('0.004', '1')).toBe('0.00');
      expect(await amount('10', '0.935')).toBe('9.35');
      expect(await amount('0.50', '0.9338')).toBe('0.47'); // 0.4669
      expect(await amount('33.33', '0.933800')).toBe('31.12'); // 31.1229...
    });

    it('is exact numeric arithmetic, not float8 (this case differs between the two)', async () => {
      const float = await admin.query(`SELECT round((9999999.995::float8 * 1.000001::float8)::numeric, 2) AS v`);
      expect(float.rows[0].v).toBe('10000010.00'); // what a float8 implementation would return
      expect(await amount('9999999.995', '1.000001')).toBe('10000009.99');
    });

    it('returns NULL for NaN / Infinity and above the sanity caps (usd <= 99999999.99, |rate| <= 99999999.999999)', async () => {
      for (const bad of ['NaN', 'Infinity', '-Infinity']) {
        expect(await amount(bad, '0.9338'), `usd ${bad}`).toBeNull();
        expect(await amount('10', bad), `rate ${bad}`).toBeNull();
      }
      expect(await amount('99999999.99', '1')).toBe('99999999.99');
      expect(await amount('100000000', '1')).toBeNull();
      expect(await amount('-100000000', '1')).toBeNull();
      expect(await amount('1', '100000000')).toBeNull();
      expect(await amount('10', '0.9338')).toBe('9.34');
    });

    it('is IMMUTABLE, NULL-propagating and rounds negatives away from zero', async () => {
      const { rows } = await admin.query(`SELECT provolatile FROM pg_proc WHERE oid = 'public._bizum_amount(numeric, numeric)'::regprocedure`);
      expect(rows[0].provolatile).toBe('i');
      expect(await amount(null, '0.9338')).toBeNull();
      expect(await amount('10', null)).toBeNull();
      expect(await amount('-0.005', '1')).toBe('-0.01');
    });
  });

  // --------------------------------------------------------------------------------------------
  describe('re-applying the migrations (production path: rows already exist)', () => {
    it('is idempotent, sets bizum to EUR on an existing row and keeps admin-changed settings', async () => {
      const root = new URL('../../../supabase/migrations/', import.meta.url);
      const files = [
        '20261015120000_bizum_s3_currency_settings_fx_rates.sql',
        '20261015130000_bizum_s4_accounts.sql',
        '20261016120000_bizum_central_fx_rate.sql'
      ];
      const sources = files.map((f) => readFileSync(new URL(f, root), 'utf8'));
      await admin.query('BEGIN');
      try {
        // Production state before the migration: the bizum row exists with the column default.
        await admin.query(`UPDATE public.payment_methods SET currency = 'USD' WHERE code = 'bizum'`);
        await admin.query(`UPDATE public.bizum_settings SET fx_warn_hours = 7`);
        for (let pass = 0; pass < 2; pass++) {
          for (const sql of sources) await admin.query(sql);
        }
        const { rows } = await admin.query(`SELECT code, currency FROM public.payment_methods ORDER BY code`);
        expect(rows).toEqual([
          { code: 'bizum', currency: 'EUR' },
          { code: 'zelle', currency: 'USD' }
        ]);
        expect((await readSettings()).fx_warn_hours).toBe(7);
        expect((await admin.query(`SELECT count(*)::int AS n FROM public.bizum_settings`)).rows[0].n).toBe(1);
      } finally {
        await admin.query('ROLLBACK');
      }
    });
  });

  // --------------------------------------------------------------------------------------------
  describe('bizum_accounts table (S4)', () => {
    it('column defaults: active, both flows, priority 0; the limit has NO default', async () => {
      const ins = await admin.query(
        `INSERT INTO public.bizum_accounts (account_name, holder_name, phone, per_operation_limit)
         VALUES ('d', 'h', '+34600000001', 0) RETURNING *`
      );
      accountIds.push(ins.rows[0].id);
      expect(ins.rows[0]).toMatchObject({ is_active: true, for_products: true, for_remittances: true, priority_order: 0, bank_name: null, notes: null });
      const noLimit = await failure(
        admin.query(`INSERT INTO public.bizum_accounts (account_name, holder_name, phone) VALUES ('d2', 'h', '+34600000002')`)
      );
      expect(noLimit.code).toBe('23502');
    });

    it('phone must be E.164 (+ then 8 to 15 digits, no leading zero)', async () => {
      for (const phone of ['123', '600000000', '+0123456789', '+1234567', '+1234567890123456', '+34 600000000', '+34-600000000', '+34abc00000', '']) {
        const err = await failure(
          admin.query(`INSERT INTO public.bizum_accounts (account_name, holder_name, phone, per_operation_limit) VALUES ('p', 'h', $1, 0)`, [phone])
        );
        expect(err.code, phone).toBe('23514');
      }
      for (const phone of ['+12345678', '+34600123456', '+123456789012345']) {
        const ok = await admin.query(
          `INSERT INTO public.bizum_accounts (account_name, holder_name, phone, per_operation_limit) VALUES ('p', 'h', $1, 0) RETURNING id`, [phone]
        );
        accountIds.push(ok.rows[0].id);
      }
    });

    it('phone is unique', async () => {
      const a = await seedAccount({ phone: '+34611111111' });
      const err = await failure(seedAccount({ phone: a.phone }));
      expect(err.code).toBe('23505');
    });

    it('per_operation_limit >= 0 (0 = no cap) and notes <= 500', async () => {
      const neg = await failure(seedAccount({ limit: -1 }));
      expect(neg.code).toBe('23514');
      await seedAccount({ limit: 0 });
      const long = await failure(
        admin.query(`INSERT INTO public.bizum_accounts (account_name, holder_name, phone, per_operation_limit, notes) VALUES ('n', 'h', '+34622222222', 1, repeat('x', 501))`)
      );
      expect(long.code).toBe('23514');
    });

    it('created_by / created_at cannot be forged on insert', async () => {
      const a = await asAdmin();
      const { rows } = await a.query(
        `INSERT INTO public.bizum_accounts (account_name, holder_name, phone, per_operation_limit, created_by, created_at)
         VALUES ('f', 'h', '+34699999999', 0, $1, '2000-01-01') RETURNING id, created_by, created_at`,
        [actors.customerId]
      );
      accountIds.push(rows[0].id);
      expect(rows[0].created_by).toBe(actors.adminId);
      expect(rows[0].created_at.getFullYear()).toBeGreaterThan(2020);
      const own = await admin.query(
        `INSERT INTO public.bizum_accounts (account_name, holder_name, phone, per_operation_limit, created_by)
         VALUES ('f2', 'h', '+34699999998', 0, $1) RETURNING id, created_by`,
        [actors.customerId]
      );
      accountIds.push(own.rows[0].id);
      expect(own.rows[0].created_by).toBeNull(); // no JWT => auth.uid() is NULL: still not caller-controlled
    });

    it('id, created_by and created_at are immutable on update', async () => {
      const a = await asAdmin();
      const acc = await seedAccount({ phone: '+34698888888' });
      for (const set of [`id = gen_random_uuid()`, `created_by = '${actors.customerId}'`, `created_at = '2000-01-01'`]) {
        const err = await failure(a.query(`UPDATE public.bizum_accounts SET ${set} WHERE id = $1`, [acc.id]));
        expect(err.message, set).toBe('bizum_accounts_immutable_columns');
      }
      await a.query(`UPDATE public.bizum_accounts SET holder_name = 'Other' WHERE id = $1`, [acc.id]);
    });

    it('requires non-empty text where it matters', async () => {
      for (const [name, holder] of [[null, 'h'], ['n', null]]) {
        const err = await failure(
          admin.query(`INSERT INTO public.bizum_accounts (account_name, holder_name, phone, per_operation_limit) VALUES ($1, $2, '+34633333333', 0)`, [name, holder])
        );
        expect(err.code).toBe('23502');
      }
      for (const [name, holder] of [['', 'h'], ['   ', 'h'], ['n', ''], ['x'.repeat(121), 'h']]) {
        const err = await failure(
          admin.query(`INSERT INTO public.bizum_accounts (account_name, holder_name, phone, per_operation_limit) VALUES ($1, $2, '+34633333333', 0)`, [name, holder])
        );
        expect(err.code).toBe('23514');
      }
    });

    it('there is no physical delete: owner, service_role and admin are all refused', async () => {
      const a = await seedAccount();
      const err = await failure(admin.query(`DELETE FROM public.bizum_accounts WHERE id = $1`, [a.id]));
      expect(err.message).toBe('bizum_accounts_no_delete');
      const service = await asService();
      expect((await failure(service.query(`DELETE FROM public.bizum_accounts WHERE id = $1`, [a.id]))).message).toBe('bizum_accounts_no_delete');
      const adminClient = await asAdmin();
      expect((await failure(adminClient.query(`DELETE FROM public.bizum_accounts WHERE id = $1`, [a.id]))).code).toBe('42501');
      // Since S5a orders / payment_quotes reference bizum_accounts: the FK check refuses TRUNCATE before the trigger.
      expect((await failure(admin.query(`TRUNCATE public.bizum_accounts`))).message).toMatch(
        /^(bizum_accounts_no_delete|cannot truncate a table referenced in a foreign key constraint)$/
      );
      expect((await admin.query(`SELECT count(*)::int AS n FROM public.bizum_accounts WHERE id = $1`, [a.id])).rows[0].n).toBe(1);
    });

    it('privileges: no anon, no PUBLIC, authenticated has SELECT/INSERT/UPDATE but not DELETE; RLS is on with one admin policy', async () => {
      const t = 'public.bizum_accounts';
      const { rows } = await admin.query(
        `SELECT has_table_privilege('anon', $1, 'SELECT') AS anon_select,
                has_table_privilege('anon', $1, 'INSERT') AS anon_insert,
                has_table_privilege('authenticated', $1, 'SELECT') AS auth_select,
                has_table_privilege('authenticated', $1, 'INSERT') AS auth_insert,
                has_table_privilege('authenticated', $1, 'UPDATE') AS auth_update,
                has_table_privilege('authenticated', $1, 'DELETE') AS auth_delete,
                has_table_privilege('authenticated', $1, 'TRUNCATE') AS auth_truncate,
                has_table_privilege('service_role', $1, 'DELETE') AS service_delete,
                (SELECT relrowsecurity FROM pg_class WHERE oid = $1::regclass) AS rls,
                (SELECT count(*)::int FROM pg_policies WHERE schemaname = 'public' AND tablename = 'bizum_accounts') AS policies,
                (SELECT count(*)::int FROM pg_publication_tables WHERE tablename = 'bizum_accounts') AS in_publication`,
        [t]
      );
      expect(rows[0]).toEqual({
        anon_select: false, anon_insert: false, auth_select: true, auth_insert: true, auth_update: true,
        auth_delete: false, auth_truncate: false, service_delete: true, rls: true, policies: 1, in_publication: 0
      });
      const policy = await admin.query(`SELECT roles, cmd FROM pg_policies WHERE tablename = 'bizum_accounts'`);
      expect(policy.rows[0]).toEqual({ roles: '{authenticated}', cmd: 'ALL' });
    });

    it('an admin can insert, read and update; created_by and updated_at are maintained', async () => {
      const a = await asAdmin();
      const ins = await a.query(
        `INSERT INTO public.bizum_accounts (account_name, holder_name, phone, bank_name, per_operation_limit)
         VALUES ('Main', 'Holder', '+34644444444', 'Bank', 1000) RETURNING id, created_by, created_at, updated_at`
      );
      accountIds.push(ins.rows[0].id);
      expect(ins.rows[0].created_by).toBe(actors.adminId);
      const upd = await a.query(
        `UPDATE public.bizum_accounts SET is_active = false WHERE id = $1 RETURNING updated_at`, [ins.rows[0].id]
      );
      expect(upd.rows[0].updated_at.getTime()).toBeGreaterThan(ins.rows[0].updated_at.getTime());
      const read = await a.query(`SELECT is_active FROM public.bizum_accounts WHERE id = $1`, [ins.rows[0].id]);
      expect(read.rows[0].is_active).toBe(false);
    });

    it('a non-admin authenticated user sees 0 rows, cannot insert and updates nothing', async () => {
      const acc = await seedAccount({ phone: '+34655555555' });
      const customer = await asCustomer();
      expect((await customer.query(`SELECT * FROM public.bizum_accounts`)).rows).toHaveLength(0);
      const ins = await failure(
        customer.query(`INSERT INTO public.bizum_accounts (account_name, holder_name, phone, per_operation_limit) VALUES ('x', 'h', '+34666666666', 0)`)
      );
      expect(ins.code).toBe('42501');
      const upd = await customer.query(`UPDATE public.bizum_accounts SET is_active = false WHERE id = $1`, [acc.id]);
      expect(upd.rowCount).toBe(0);
      expect((await admin.query(`SELECT is_active FROM public.bizum_accounts WHERE id = $1`, [acc.id])).rows[0].is_active).toBe(true);
    });

    it('a disabled admin is treated as a non-admin', async () => {
      await seedAccount({ phone: '+34677777777' });
      await admin.query(`UPDATE public.user_profiles SET is_enabled = false WHERE id = $1`, [actors.adminId]);
      const a = await asAdmin();
      expect((await a.query(`SELECT * FROM public.bizum_accounts`)).rows).toHaveLength(0);
    });

    it('anon has no access at all', async () => {
      const anon = await asAnon();
      expect((await failure(anon.query(`SELECT * FROM public.bizum_accounts`))).code).toBe('42501');
      expect((await failure(anon.query(`INSERT INTO public.bizum_accounts (account_name, holder_name, phone, per_operation_limit) VALUES ('x','h','+34688888888',0)`))).code).toBe('42501');
    });
  });

  // --------------------------------------------------------------------------------------------
  describe('_pick_bizum_account', () => {
    it('returns NULL when there are no accounts', async () => {
      expect(await pick('products', 10)).toBeNull();
      expect(await pick('remittances', 10)).toBeNull();
    });

    it('rejects an unknown flow instead of silently returning NULL', async () => {
      const err = await failure(pick('orders', 10));
      expect(err.message).toBe('bizum_invalid_flow');
      expect((await failure(pick(null, 10))).message).toBe('bizum_invalid_flow');
    });

    it('filters by flow', async () => {
      const p = await seedAccount({ forProducts: true, forRemittances: false });
      const r = await seedAccount({ forProducts: false, forRemittances: true });
      expect(await pick('products', 10)).toBe(p.id);
      expect(await pick('remittances', 10)).toBe(r.id);
    });

    it('skips inactive accounts', async () => {
      const off = await seedAccount({ isActive: false, priority: 0 });
      expect(await pick('products', 10)).toBeNull();
      const on = await seedAccount({ priority: 5 });
      expect(await pick('products', 10)).toBe(on.id);
      expect(off.id).not.toBe(on.id);
    });

    it('applies the per-operation limit: >= amount passes, 0 means no cap', async () => {
      const capped = await seedAccount({ limit: 50, priority: 0 });
      expect(await pick('products', 50)).toBe(capped.id);
      expect(await pick('products', 50.01)).toBeNull();
      const open = await seedAccount({ limit: 0, priority: 9 });
      expect(await pick('products', 50.01)).toBe(open.id);
      expect(await pick('products', 100000)).toBe(open.id);
    });

    it('orders by priority_order ascending, then a stable tie-break on id', async () => {
      const low = await seedAccount({ priority: 7 });
      const high = await seedAccount({ priority: 1 });
      expect(await pick('products', 10)).toBe(high.id);
      expect(low.id).not.toBe(high.id);
    });

    it('breaks priority ties by the LOWEST id regardless of insertion order', async () => {
      const id = (n) => `00000000-0000-4000-8000-00000000000${n}`;
      await seedAccount({ priority: 3, id: id(3) });
      await seedAccount({ priority: 3, id: id(1) });
      await seedAccount({ priority: 3, id: id(2) });
      expect(await pick('products', 10)).toBe(id(1));
      expect(await pick('remittances', 10)).toBe(id(1));
    });

    it('returns NULL for a NULL, non-positive, NaN or infinite amount', async () => {
      await seedAccount();
      expect(await pick('products', null)).toBeNull();
      expect(await pick('products', 0)).toBeNull();
      expect(await pick('products', -5)).toBeNull();
      expect(await pick('products', 'NaN')).toBeNull();
      expect(await pick('products', 'Infinity')).toBeNull();
      expect(await pick('products', '-Infinity')).toBeNull();
    });
  });
});
