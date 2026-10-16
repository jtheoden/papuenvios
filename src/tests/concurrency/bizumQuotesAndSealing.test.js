/**
 * Bizum slice S5a (design v2, sections 2.3, 3.1 M4-M6, 3.3, 3.13): payment quotes (pay-first) and the
 * server-side sealing of Bizum ORDERS. Remittances are slice S5b and are deliberately not covered here.
 *
 * Migrations under test:
 *   20261015150000_bizum_s5a_quotes_and_order_sealing.sql
 *   20261015150100_bizum_s5a_orders_checks.sql
 *
 * Runs against the LOCAL scratch database built by `npm run test:db:bootstrap`. The suite does NOT list
 * the new objects in `needs`: when the migrations are missing the tests must fail loudly (red phase).
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { dbSuiteSkipReason, connectAdmin, connectAs, connectAnon, endAll, fireTogether } from './db';
import { loadActors } from './fixtures';

const skipReason = await dbSuiteSkipReason({
  functions: ['is_admin_user', 'is_super_admin', 'payment_method_allowed', '_payment_fx_latest', '_bizum_amount',
    '_pick_bizum_account', '_current_payment_fx'],
  tables: ['payment_methods', 'orders', 'remittances', 'bizum_accounts', 'payment_fx_rates', 'bizum_settings',
    'activity_logs', 'user_profiles']
});
const describeDb = skipReason ? describe.skip : describe;

const MIGRATIONS_DIR = path.resolve(__dirname, '../../../supabase/migrations');
const MIGRATION_FILES = readdirSync(MIGRATIONS_DIR)
  .filter((f) => /^2026101515\d{4}_bizum_s5a_.*\.sql$/.test(f))
  .sort();

const SETTING_KEYS = [
  'default_spread_pct', 'quote_validity_minutes', 'quote_grace_hours', 'fx_warn_hours', 'fx_block_hours',
  'fx_max_change_pct', 'default_per_operation_limit', 'remittance_warn_hours', 'remittance_expire_hours',
  'max_unpaid_ops_per_user', 'max_open_quotes_per_user', 'max_quotes_per_hour', 'proof_retention_years'
];

const SEALED_COLUMNS = [
  ['payment_amount', '1.00'], ['payment_currency', `'USD'`], ['payment_fx_rate', '2'],
  ['payment_fx_rate_id', 'gen_random_uuid()'], ['payment_usd_reference', '1'],
  ['payment_quote_id', 'gen_random_uuid()'], ['payment_concept_code', `'VAAAAAAA'`],
  ['bizum_account_id', 'gen_random_uuid()'], ['payment_method', `'zelle'`]
];

const NEW_PUBLIC_RPCS = [
  'create_bizum_quote(numeric)',
  'attach_quote_proof(uuid, text)',
  'report_paid_quote_failure(uuid, text)',
  'get_order_by_quote(uuid)',
  'admin_list_orphan_quotes()',
  'get_payment_instructions(text, uuid)'
];
const NEW_INTERNAL_FUNCTIONS = [
  '_seal_bizum_payment(text, numeric)',
  '_bizum_new_concept_code(text)',
  '_bizum_proof_path_ok(uuid, uuid, text)',
  'seal_bizum_payment()',
  'guard_bizum_quote_immutable()'
];

const failure = async (promise) => {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected the statement to fail, but it succeeded');
};
const expectToken = async (promise, token, code = 'P0001') => {
  const error = await failure(promise);
  expect(error.message).toBe(token);
  expect(error.code).toBe(code);
};

describeDb('Bizum S5a: payment quotes and order sealing', () => {
  let admin;
  let actors;
  let usdId;
  let eurId;
  let otherUserId;
  const clients = [];
  const orders = [];
  const remittances = [];
  const remittanceTypes = [];

  const as = async (userId, role = 'authenticated') => {
    const c = await connectAs(userId, role);
    clients.push(c);
    return c;
  };
  const asCustomer = () => as(actors.customerId);
  const asOther = () => as(otherUserId);
  const asAdmin = () => as(actors.adminId);
  const asService = () => as(actors.adminId, 'service_role');
  const asAnon = async () => {
    const c = await connectAnon();
    clients.push(c);
    return c;
  };

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

  const setBizum = (on) =>
    admin.query(
      `UPDATE public.payment_methods SET available = $1, enabled_for_orders = $1, enabled_for_remittances = $1,
              disabled_reason = NULL WHERE code = 'bizum'`,
      [on]
    );
  const setSetting = (key, value) => admin.query(`UPDATE public.bizum_settings SET ${key} = $1`, [value]);
  const resetSettings = () =>
    admin.query(`UPDATE public.bizum_settings SET ${SETTING_KEYS.map((k) => `${k} = DEFAULT`).join(', ')}`);

  const seedAccount = async (overrides = {}) => {
    const a = {
      phone: `+34${Math.floor(600000000 + Math.random() * 99999999)}`,
      holder: 'Holder Test',
      limit: 0,
      isActive: true,
      forProducts: true,
      priority: 0,
      ...overrides
    };
    const { rows } = await admin.query(
      `INSERT INTO public.bizum_accounts (account_name, holder_name, phone, is_active, for_products,
                                          for_remittances, priority_order, per_operation_limit)
       VALUES ($1, $2, $3, $4, $5, true, $6, $7) RETURNING id`,
      [`s5a-${randomUUID().slice(0, 8)}`, a.holder, a.phone, a.isActive, a.forProducts, a.priority, a.limit]
    );
    return { ...a, id: rows[0].id };
  };
  /**
   * Writes the central USD->EUR pair the way Financial Settings does (an admin through RLS). One row per day:
   * calling it again edits the same row IN PLACE, exactly like updateExchangeRatePair. The spread comes from
   * bizum_settings.default_spread_pct (1.5 by default), so `spread` only exists for readability at call sites.
   */
  const setRate = async (mid = 0.92, { daysAgo = 0, active = true } = {}) => {
    const c = await asAdmin();
    return (await c.query(
      `INSERT INTO public.exchange_rates (from_currency_id, to_currency_id, rate, is_active, effective_date)
       VALUES ($1, $2, $3, $4, CURRENT_DATE - $5::int)
       ON CONFLICT (from_currency_id, to_currency_id, effective_date)
       DO UPDATE SET rate = EXCLUDED.rate, is_active = EXCLUDED.is_active
       RETURNING *`,
      [usdId, eurId, Number(mid.toFixed(6)), active, daysAgo]
    )).rows[0];
  };
  /** Bizum ON + one account + a fresh rate: the usual happy-path preconditions. */
  const ready = async (accountOverrides = {}) => {
    await setBizum(true);
    const account = await seedAccount(accountOverrides);
    const rate = await setRate();
    return { account, rate };
  };

  const quote = async (client, usd = 100) =>
    (await client.query(`SELECT public.create_bizum_quote($1::numeric) AS r`, [usd])).rows[0].r;
  const proofPath = (userId, quoteId, name = '1700000000.png') => `${userId}/quotes/${quoteId}/${name}`;

  const INSERT_ORDER = `
    INSERT INTO public.orders (user_id, order_type, subtotal, total_amount, currency_id, payment_method,
                               payment_quote_id, payment_proof_url, payer_phone`;
  /** Insert a Bizum order as `client`. `extra` = { column: value } client-forged columns. */
  const insertBizumOrder = async (client, userId, quoteId, { total = 100, currency = null, proof, extra = {} } = {}) => {
    const cols = Object.keys(extra);
    const sql = `${INSERT_ORDER}${cols.map((c) => `, ${c}`).join('')})
      VALUES ($1, 'product', $2, $2, $3, 'bizum', $4, $5, '+34600000000'${cols.map((_, i) => `, $${6 + i}`).join('')})
      RETURNING *`;
    const { rows } = await client.query(sql, [
      userId, total, currency ?? usdId, quoteId,
      proof === undefined ? proofPath(userId, quoteId) : proof,
      ...cols.map((c) => extra[c])
    ]);
    orders.push(rows[0].id);
    return rows[0];
  };
  const insertZelleOrder = async (client, extra = {}) => {
    const cols = Object.keys(extra);
    const { rows } = await client.query(
      `INSERT INTO public.orders (user_id, order_type, subtotal, total_amount, currency_id, payment_method${cols.map((c) => `, ${c}`).join('')})
       VALUES ($1, 'product', 10, 10, $2, 'zelle'${cols.map((_, i) => `, $${3 + i}`).join('')}) RETURNING *`,
      [actors.customerId, usdId, ...cols.map((c) => extra[c])]
    );
    orders.push(rows[0].id);
    return rows[0];
  };
  const quoteRow = async (id) =>
    (await admin.query(`SELECT * FROM public.payment_quotes WHERE id = $1`, [id])).rows[0];
  const reviewFor = async (orderId) =>
    (await admin.query(`SELECT * FROM public.payment_reviews WHERE order_id = $1`, [orderId])).rows[0];
  const ageQuote = (id, { expiredHoursAgo }) =>
    admin.query(
      `UPDATE public.payment_quotes
          SET created_at = now() - make_interval(hours => $2::int + 5),
              expires_at = now() - make_interval(hours => $2::int)
        WHERE id = $1`,
      [id, expiredHoursAgo]
    );
  const zelleFootprint = async () => {
    const r = await admin.query(
      `SELECT (SELECT count(*) FROM public.zelle_transaction_history)::int AS history,
              (SELECT count(*) FROM public.zelle_accounts)::int AS accounts,
              (SELECT coalesce(sum(current_daily_amount), 0) FROM public.zelle_accounts)::text AS daily`
    );
    return r.rows[0];
  };

  beforeAll(async () => {
    admin = await connectAdmin();
    actors = await loadActors(admin);
    usdId = (await admin.query(`SELECT id FROM public.currencies WHERE code = 'USD'`)).rows[0].id;
    eurId = (await admin.query(`SELECT id FROM public.currencies WHERE code = 'EUR'`)).rows[0].id;
    otherUserId = randomUUID();
    await admin.query(
      `INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                               raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
       VALUES ('00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated', $2,
               extensions.crypt('not-a-real-password', extensions.gen_salt('bf')), now(),
               '{"provider":"email","providers":["email"]}', '{"full_name":"S5a Other"}', now(), now())`,
      [otherUserId, `s5a.other.${otherUserId.slice(0, 8)}@example.test`]
    );
    // Test-only helpers (dropped in afterAll). The INSERT wrapper lets fireTogether race a real INSERT; the
    // SECURITY DEFINER one proves the immutability guard lets a definer RPC owned by the table owner through.
    await admin.query(`
      CREATE OR REPLACE FUNCTION public.__s5a_insert_bizum_order(p_user uuid, p_quote uuid, p_currency uuid)
      RETURNS uuid LANGUAGE plpgsql SET search_path = public AS $f$
      DECLARE v_id uuid;
      BEGIN
        INSERT INTO public.orders (user_id, order_type, subtotal, total_amount, currency_id, payment_method,
                                   payment_quote_id, payment_proof_url)
        VALUES (p_user, 'product', 100, 100, p_currency, 'bizum', p_quote,
                p_user::text || '/quotes/' || p_quote::text || '/1.png')
        RETURNING id INTO v_id;
        RETURN v_id;
      END $f$`);
    await admin.query(`
      CREATE OR REPLACE FUNCTION public.__s5a_definer_reseal(p_order uuid, p_amount numeric)
      RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f$
      BEGIN
        UPDATE public.orders SET payment_amount = p_amount WHERE id = p_order;
      END $f$`);
    await admin.query(`GRANT EXECUTE ON FUNCTION public.__s5a_insert_bizum_order(uuid, uuid, uuid), public.__s5a_definer_reseal(uuid, numeric) TO authenticated`);
    // The scratch clone gives service_role no rights on orders (hosted Supabase does through its default ACL).
    await admin.query(`GRANT SELECT, UPDATE ON public.orders TO service_role`);
    await setBizum(false);
  });

  afterEach(async () => {
    await endAll(clients.splice(0));
    await admin.query(`DELETE FROM public.orders WHERE payment_method = 'bizum' OR id = ANY($1)`, [orders.splice(0)]);
    if (remittances.length) await admin.query(`DELETE FROM public.remittances WHERE id = ANY($1)`, [remittances.splice(0)]);
    if (remittanceTypes.length) {
      await admin.query(`DELETE FROM public.remittance_types WHERE id = ANY($1)`, [remittanceTypes.splice(0)]);
    }
    await admin.query(`DELETE FROM public.payment_quotes`);
    await ownerBypass(`DELETE FROM public.bizum_accounts`);
    await admin.query(`DELETE FROM public.exchange_rates WHERE from_currency_id = $1 AND to_currency_id = $2`, [usdId, eurId]);
    await admin.query(`INSERT INTO public.bizum_settings (id) VALUES (true) ON CONFLICT DO NOTHING`);
    await resetSettings();
    await setBizum(false);
    await admin.query(`UPDATE public.user_profiles SET role = 'admin', is_enabled = true WHERE id = $1`, [actors.adminId]);
    await admin.query(`DELETE FROM public.activity_logs WHERE action IN ('payment_fx_rate_set', 'bizum_settings_updated')`);
  });

  afterAll(async () => {
    await admin.query(`REVOKE SELECT, UPDATE ON public.orders FROM service_role`);
    await admin.query(`DROP FUNCTION IF EXISTS public.__s5a_insert_bizum_order(uuid, uuid, uuid)`);
    await admin.query(`DROP FUNCTION IF EXISTS public.__s5a_definer_reseal(uuid, numeric)`);
    await ownerBypass(`DELETE FROM public.user_profiles WHERE id = $1`, [otherUserId]);
    await ownerBypass(`DELETE FROM auth.users WHERE id = $1`, [otherUserId]);
    await admin.end();
  });

  // --------------------------------------------------------------------------------------------
  describe('privileges (C14: the default ACL hands EXECUTE / table rights to anon and authenticated)', () => {
    it.each(NEW_PUBLIC_RPCS)('%s: authenticated and service_role may execute, anon and PUBLIC may not', async (sig) => {
      const { rows } = await admin.query(
        `SELECT has_function_privilege('anon', $1, 'EXECUTE') AS anon,
                has_function_privilege('authenticated', $1, 'EXECUTE') AS authenticated,
                has_function_privilege('service_role', $1, 'EXECUTE') AS service_role,
                (SELECT coalesce(bool_or(a.grantee = 0), false)
                   FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                  WHERE p.oid = $1::regprocedure) AS public_grant`,
        [`public.${sig}`]
      );
      expect(rows[0]).toEqual({ anon: false, authenticated: true, service_role: true, public_grant: false });
    });

    it.each(NEW_INTERNAL_FUNCTIONS)('%s: not executable by anon / authenticated / PUBLIC', async (sig) => {
      const { rows } = await admin.query(
        `SELECT has_function_privilege('anon', $1, 'EXECUTE') AS anon,
                has_function_privilege('authenticated', $1, 'EXECUTE') AS authenticated,
                (SELECT coalesce(bool_or(a.grantee = 0), false)
                   FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                  WHERE p.oid = $1::regprocedure) AS public_grant`,
        [`public.${sig}`]
      );
      expect(rows[0]).toEqual({ anon: false, authenticated: false, public_grant: false });
    });

    it('every new SECURITY DEFINER function pins search_path to public, pg_temp', async () => {
      const defs = await admin.query(
        `SELECT p.oid::regprocedure::text AS sig, p.prosecdef, p.proconfig
           FROM pg_proc p
          WHERE p.pronamespace = 'public'::regnamespace
            AND p.proname = ANY($1)`,
        [[...NEW_PUBLIC_RPCS, ...NEW_INTERNAL_FUNCTIONS].map((s) => s.split('(')[0])]
      );
      expect(defs.rowCount).toBe(NEW_PUBLIC_RPCS.length + NEW_INTERNAL_FUNCTIONS.length);
      for (const d of defs.rows) {
        expect(d.proconfig, d.sig).toContain('search_path=public, pg_temp');
      }
    });

    it('payment_quotes: no rights for anon / authenticated, a direct SELECT is permission denied', async () => {
      const { rows } = await admin.query(
        `SELECT has_table_privilege('anon', 'public.payment_quotes', 'SELECT') AS anon_sel,
                has_table_privilege('authenticated', 'public.payment_quotes', 'SELECT') AS auth_sel,
                has_table_privilege('authenticated', 'public.payment_quotes', 'INSERT') AS auth_ins,
                has_table_privilege('authenticated', 'public.payment_quotes', 'UPDATE') AS auth_upd,
                has_table_privilege('authenticated', 'public.payment_quotes', 'DELETE') AS auth_del,
                has_table_privilege('service_role', 'public.payment_quotes', 'SELECT') AS service_sel,
                (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.payment_quotes'::regclass) AS rls`
      );
      expect(rows[0]).toEqual({
        anon_sel: false, auth_sel: false, auth_ins: false, auth_upd: false, auth_del: false, service_sel: true, rls: true
      });
      const customer = await asCustomer();
      const err = await failure(customer.query(`SELECT * FROM public.payment_quotes`));
      expect(err.code).toBe('42501');
    });

    it('payment_reviews: admin-only SELECT through RLS, nobody but service_role writes', async () => {
      const { rows } = await admin.query(
        `SELECT has_table_privilege('anon', 'public.payment_reviews', 'SELECT') AS anon_sel,
                has_table_privilege('authenticated', 'public.payment_reviews', 'SELECT') AS auth_sel,
                has_table_privilege('authenticated', 'public.payment_reviews', 'INSERT') AS auth_ins,
                has_table_privilege('authenticated', 'public.payment_reviews', 'UPDATE') AS auth_upd,
                has_table_privilege('authenticated', 'public.payment_reviews', 'DELETE') AS auth_del,
                (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.payment_reviews'::regclass) AS rls,
                (SELECT count(*)::int FROM pg_publication_tables
                  WHERE pubname = 'supabase_realtime' AND tablename IN ('payment_reviews', 'payment_quotes')) AS realtime`
      );
      expect(rows[0]).toEqual({
        anon_sel: false, auth_sel: true, auth_ins: false, auth_upd: false, auth_del: false, rls: true, realtime: 0
      });
    });

    it('anon cannot call a client RPC', async () => {
      const anon = await asAnon();
      const err = await failure(anon.query(`SELECT public.create_bizum_quote(100)`));
      expect(err.code).toBe('42501');
    });
  });

  // --------------------------------------------------------------------------------------------
  describe('create_bizum_quote (R-20, R-23, R-25, R-28)', () => {
    it('returns the quote: EUR amount from the shared _bizum_amount, server-assigned account', async () => {
      const { account, rate } = await ready();
      const customer = await asCustomer();
      const q = await quote(customer, 100);
      expect(Number(q.eur_amount)).toBe(93.38);
      expect(Number(q.rate)).toBe(0.9338);
      expect(q.concept_code).toMatch(/^V[2-9A-HJKMNP-Z]{7}$/);
      expect(q.phone).toBe(account.phone);
      expect(q.holder_name).toBe('Holder Test');
      expect(new Date(q.expires_at).getTime()).toBeGreaterThan(Date.now() + 3.9 * 3600 * 1000);
      expect(new Date(q.expires_at).getTime()).toBeLessThan(Date.now() + 4.1 * 3600 * 1000);
      const row = await quoteRow(q.quote_id);
      expect(row).toMatchObject({ user_id: actors.customerId, bizum_account_id: account.id, fx_rate_id: rate.id });
      expect(row.usd_amount).toBe('100.00');
      expect(row.payment_amount).toBe('93.38');
      expect(row.consumed_at).toBeNull();
    });

    it('shares _bizum_amount with the sealing: 100 USD at 0.9338 = 93.38 EUR; half-up on the cent', async () => {
      const r = await admin.query(
        `SELECT public._bizum_amount(100, 0.9338)::text AS a, public._bizum_amount(10.05, 0.9338)::text AS b`
      );
      expect(r.rows[0]).toEqual({ a: '93.38', b: '9.38' });
      await ready();
      const customer = await asCustomer();
      const q = await quote(customer, 10.05);
      expect(Number(q.eur_amount)).toBe(9.38);
    });

    it('fails closed: Bizum off, no usable rate, no account, amount over the account limit', async () => {
      const customer = await asCustomer();
      await expectToken(quote(customer), 'bizum_unavailable'); // flag off

      await setBizum(true);
      await expectToken(quote(customer), 'payment_fx_unavailable'); // no rate

      await setRate();
      await expectToken(quote(customer), 'bizum_unavailable'); // no account

      await seedAccount({ limit: 50 });
      await expectToken(quote(customer, 100), 'bizum_amount_over_limit'); // 93.38 EUR > 50
      const small = await quote(customer, 10);
      expect(Number(small.eur_amount)).toBe(9.34);
    });

    it('an account that does not serve the products flow is "unavailable", not "over limit"', async () => {
      await setBizum(true);
      await setRate();
      await seedAccount({ forProducts: false });
      const customer = await asCustomer();
      await expectToken(quote(customer), 'bizum_unavailable');
    });

    it('rejects non-positive, NaN and sub-cent USD amounts', async () => {
      await ready();
      const customer = await asCustomer();
      for (const bad of [0, -5, 1.234, 'NaN', 'Infinity']) {
        await expectToken(quote(customer, bad), 'payment_quote_invalid_amount');
      }
    });

    it('caps open quotes per user (3), per hour, and unpaid Bizum operations (token bizum_limit_reached)', async () => {
      await ready();
      const customer = await asCustomer();
      await quote(customer);
      await quote(customer);
      await quote(customer);
      await expectToken(quote(customer), 'bizum_limit_reached');
      // another user is unaffected
      const other = await asOther();
      await quote(other);

      await admin.query(`DELETE FROM public.payment_quotes`);
      await setSetting('max_open_quotes_per_user', 20);
      await setSetting('max_quotes_per_hour', 2);
      await quote(customer);
      await quote(customer);
      await expectToken(quote(customer), 'bizum_limit_reached');

      await admin.query(`DELETE FROM public.payment_quotes`);
      await resetSettings();
      await setSetting('max_unpaid_ops_per_user', 1);
      const { rows: t } = await admin.query(
        `INSERT INTO public.remittance_types (name, currency_code, delivery_currency, exchange_rate, min_amount, delivery_method)
         VALUES ('s5a-type', 'USD', 'CUP', 300, 1, 'cash') RETURNING id`
      );
      remittanceTypes.push(t[0].id);
      const rid = randomUUID();
      await admin.query(
        `INSERT INTO public.remittances (id, user_id, remittance_type_id, amount_sent, exchange_rate,
           commission_percentage, commission_fixed, commission_total, amount_to_deliver, currency_sent,
           currency_delivered, recipient_name, recipient_phone, status, delivery_cost, payment_method)
         VALUES ($1,$2,$3,50,300,0,0,0,50,'USD','CUP','Rcpt','+5355550100','payment_pending',0,'bizum')`,
        [rid, actors.customerId, t[0].id]
      );
      remittances.push(rid);
      await expectToken(quote(customer), 'bizum_limit_reached');
    });

    it('serializes concurrent quote creation per user: exactly max_open_quotes_per_user succeed', async () => {
      await ready();
      const workers = [];
      for (let i = 0; i < 6; i += 1) workers.push(await asCustomer());
      const results = await fireTogether(
        workers.map((client) => ({ client, sql: 'public.create_bizum_quote($1::numeric)', params: [100] }))
      );
      expect(results.filter((r) => r.value).length).toBe(3);
      const failed = results.filter((r) => r.error);
      expect(failed.length).toBe(3);
      for (const f of failed) expect(f.error.message).toBe('bizum_limit_reached');
      const { rows } = await admin.query(`SELECT count(*)::int AS n FROM public.payment_quotes`);
      expect(rows[0].n).toBe(3);
    });
  });

  // --------------------------------------------------------------------------------------------
  describe('the quoted rate is the central USD->EUR rate (exchange_rates)', () => {
    it('(a) with an active USD->EUR pair the quote seals that rate: mid, default spread, row id', async () => {
      const row = await setRate(0.92);
      await setBizum(true);
      await seedAccount();
      const customer = await asCustomer();
      const q = await quote(customer, 100);
      expect(Number(q.rate)).toBe(0.9338); // 0.92 * (1 + 1.5 %)
      expect(Number(q.eur_amount)).toBe(93.38);
      expect((await quoteRow(q.quote_id)).fx_rate_id).toBe(row.id);
      expect((await quoteRow(q.quote_id)).effective_rate).toBe('0.933800');
    });

    it('(a) a changed default_spread_pct is applied to the next quote, and the sealed quote keeps its own rate', async () => {
      await ready();
      const customer = await asCustomer();
      const first = await quote(customer, 100);
      await setSetting('default_spread_pct', 3);
      const second = await quote(customer, 100);
      expect(Number(first.rate)).toBe(0.9338);
      expect(Number(second.rate)).toBe(0.9476);
      expect((await quoteRow(first.quote_id)).effective_rate).toBe('0.933800');
    });

    it('(b) fails closed with payment_fx_unavailable when there is no usable pair', async () => {
      await setBizum(true);
      await seedAccount();
      const customer = await asCustomer();
      await expectToken(quote(customer), 'payment_fx_unavailable'); // empty
      await setRate(0.92, { active: false });
      await expectToken(quote(customer), 'payment_fx_unavailable'); // only an inactive row (the production state)
      await admin.query(`DELETE FROM public.exchange_rates WHERE from_currency_id = $1 AND to_currency_id = $2`, [usdId, eurId]);
      await admin.query(
        `INSERT INTO public.exchange_rates (from_currency_id, to_currency_id, rate) VALUES ($1, $2, 1.087)`,
        [eurId, usdId]
      );
      await expectToken(quote(customer), 'payment_fx_unavailable'); // only the inverse pair: no silent inversion
      await admin.query(`DELETE FROM public.exchange_rates WHERE from_currency_id = $1 AND to_currency_id = $2`, [eurId, usdId]);
      expect(await admin.query(`SELECT count(*)::int AS n FROM public.payment_quotes`)).toMatchObject({ rows: [{ n: 0 }] });
    });

    it('(b) fails closed when the central row is stale (blocked) and recovers when an admin refreshes it', async () => {
      const row = await setRate(0.92);
      await setBizum(true);
      await seedAccount();
      await ownerBypass(`UPDATE public.exchange_rates SET updated_at = now() - interval '97 hours' WHERE id = $1`, [row.id]);
      const customer = await asCustomer();
      await expectToken(quote(customer), 'payment_fx_unavailable');
      await setRate(0.92); // an admin saves it again: the update trigger stamps updated_at
      expect(Number((await quote(customer)).rate)).toBe(0.9338);
    });

    it('(c) a rate outside the sanity band is never quoted (typo 92 instead of 0.92)', async () => {
      await setBizum(true);
      await seedAccount();
      const customer = await asCustomer();
      await setRate(92);
      await expectToken(quote(customer), 'payment_fx_unavailable');
    });

    it('(c) an invalid or inactive NEWER row never masks the older valid one', async () => {
      const valid = await setRate(0.92, { daysAgo: 1 });
      await setRate(0.5, { daysAgo: 0, active: false });
      await setBizum(true);
      await seedAccount();
      const customer = await asCustomer();
      const q = await quote(customer);
      expect((await quoteRow(q.quote_id)).fx_rate_id).toBe(valid.id);
      expect(Number(q.rate)).toBe(0.9338);
    });

    it('(c) a rate <= 0 is not used (a CHECK may reject it before it exists)', async () => {
      const valid = await setRate(0.92, { daysAgo: 1 });
      await setBizum(true);
      await seedAccount();
      for (const bad of [0, -1]) {
        await setRate(bad, { daysAgo: 0 }).catch((error) => expect(error.code).toBe('23514'));
        const customer = await asCustomer();
        const q = await quote(customer);
        expect((await quoteRow(q.quote_id)).fx_rate_id).toBe(valid.id);
        await admin.query(`DELETE FROM public.payment_quotes WHERE id = $1`, [q.quote_id]);
        await admin.query(`DELETE FROM public.exchange_rates WHERE effective_date = CURRENT_DATE AND from_currency_id = $1 AND to_currency_id = $2`, [usdId, eurId]);
      }
    });

    it('(d) editing the central rate in place by more than 2 % marks quote_rate_moved on a graced order; the sealed rate does not change', async () => {
      const row = await setRate(0.92);
      await setBizum(true);
      await seedAccount();
      const customer = await asCustomer();
      const q = await quote(customer);
      await ageQuote(q.quote_id, { expiredHoursAgo: 1 });
      await admin.query(`UPDATE public.exchange_rates SET rate = 0.95 WHERE id = $1`, [row.id]); // +3.26 %
      const order = await insertBizumOrder(customer, actors.customerId, q.quote_id);
      expect((await reviewFor(order.id)).flags).toEqual(['quote_expired', 'quote_rate_moved']);
      expect(order.payment_fx_rate).toBe('0.933800'); // sealed, not the live 0.96425
      expect(order.payment_amount).toBe('93.38');
    });

    it('(d) the central row going stale or inactive during the grace window counts as moved (fail closed)', async () => {
      const row = await setRate(0.92);
      await setBizum(true);
      await seedAccount();
      const customer = await asCustomer();
      const q = await quote(customer);
      await ageQuote(q.quote_id, { expiredHoursAgo: 1 });
      await admin.query(`UPDATE public.exchange_rates SET is_active = false WHERE id = $1`, [row.id]);
      const order = await insertBizumOrder(customer, actors.customerId, q.quote_id);
      expect((await reviewFor(order.id)).flags).toEqual(['quote_expired', 'quote_rate_moved']);
    });

    it('the row id is provenance only (no foreign key): an admin can delete the referenced row without touching sealed data', async () => {
      const row = await setRate(0.92);
      await setBizum(true);
      await seedAccount();
      const customer = await asCustomer();
      const q = await quote(customer);
      const order = await insertBizumOrder(customer, actors.customerId, q.quote_id);
      const admin2 = await asAdmin();
      const del = await admin2.query(`DELETE FROM public.exchange_rates WHERE id = $1`, [row.id]);
      expect(del.rowCount).toBe(1);
      const after = await admin.query(`SELECT payment_fx_rate, payment_fx_rate_id, payment_amount FROM public.orders WHERE id = $1`, [order.id]);
      expect(after.rows[0]).toEqual({ payment_fx_rate: '0.933800', payment_fx_rate_id: row.id, payment_amount: '93.38' });
      expect((await quoteRow(q.quote_id)).fx_rate_id).toBe(row.id);
    });

    it('no foreign key points from payment_quotes / orders to exchange_rates or to the deprecated ledger', async () => {
      const { rows } = await admin.query(
        `SELECT conrelid::regclass::text AS tbl, confrelid::regclass::text AS ref
           FROM pg_constraint
          WHERE contype = 'f' AND confrelid IN ('public.exchange_rates'::regclass, 'public.payment_fx_rates'::regclass)
            AND conrelid IN ('public.payment_quotes'::regclass, 'public.orders'::regclass)`
      );
      expect(rows).toEqual([]);
    });

    it('(e) a customer cannot change the quoted rate: exchange_rates writes are admin-only', async () => {
      const row = await setRate(0.92);
      await setBizum(true);
      await seedAccount();
      const customer = await asCustomer();
      const upd = await customer.query(`UPDATE public.exchange_rates SET rate = 0.5 WHERE id = $1`, [row.id]);
      expect(upd.rowCount).toBe(0);
      const ins = await failure(
        customer.query(
          `INSERT INTO public.exchange_rates (from_currency_id, to_currency_id, rate, effective_date) VALUES ($1, $2, 0.5, CURRENT_DATE - 9)`,
          [usdId, eurId]
        )
      );
      expect(ins.code).toBe('42501');
      expect(Number((await quote(customer)).rate)).toBe(0.9338);
    });
  });

  // --------------------------------------------------------------------------------------------
  describe('seal_bizum_payment on orders (R-21, R-22, R-26, C17)', () => {
    it('ignores every payment_* the client sends and copies the quote', async () => {
      const { account, rate } = await ready();
      const decoy = await seedAccount({ priority: 9 });
      const customer = await asCustomer();
      const q = await quote(customer, 100);
      const order = await insertBizumOrder(customer, actors.customerId, q.quote_id, {
        extra: {
          payment_amount: 0.01,
          payment_currency: 'USD',
          payment_fx_rate: 9,
          payment_usd_reference: 1,
          payment_concept_code: 'HACKED00',
          bizum_account_id: decoy.id,
          payment_fx_rate_id: rate.id
        }
      });
      expect(order).toMatchObject({
        payment_method: 'bizum',
        payment_currency: 'EUR',
        payment_amount: '93.38',
        payment_fx_rate: '0.933800',
        payment_fx_rate_id: rate.id,
        payment_usd_reference: '100.00',
        payment_quote_id: q.quote_id,
        payment_concept_code: q.concept_code,
        bizum_account_id: account.id,
        zelle_account_id: null
      });
      expect((await quoteRow(q.quote_id)).consumed_at).not.toBeNull();
      expect(await reviewFor(order.id)).toBeUndefined(); // fresh quote: nothing to review
    });

    it('a client-sent zelle_account_id on a Bizum order is dropped', async () => {
      await ready();
      const { rows: z } = await admin.query(
        `INSERT INTO public.zelle_accounts (account_name, email, phone, account_holder, bank_name, is_active,
                                            for_products, for_remittances)
         VALUES ('s5a-z', $1, '+1 555 0100', 'Holder', 'Bank', true, true, true) RETURNING id`,
        [`s5a-${randomUUID().slice(0, 8)}@example.test`]
      );
      const customer = await asCustomer();
      const q = await quote(customer);
      const order = await insertBizumOrder(customer, actors.customerId, q.quote_id, {
        extra: { zelle_account_id: z[0].id }
      });
      expect(order.zelle_account_id).toBeNull();
      await admin.query(`DELETE FROM public.orders WHERE id = $1`, [order.id]);
      await admin.query(`DELETE FROM public.zelle_accounts WHERE id = $1`, [z[0].id]);
    });

    it('rejects: missing / unknown / foreign quote with ONE uniform token (no enumeration oracle)', async () => {
      await ready();
      const customer = await asCustomer();
      const other = await asOther();
      const foreign = await quote(other, 100);
      await expectToken(insertBizumOrder(customer, actors.customerId, null, { proof: 'x' }), 'payment_quote_required');
      await expectToken(
        insertBizumOrder(customer, actors.customerId, randomUUID(), { proof: 'x' }), 'payment_quote_required'
      );
      await expectToken(
        insertBizumOrder(customer, actors.customerId, foreign.quote_id, {
          proof: proofPath(otherUserId, foreign.quote_id)
        }),
        'payment_quote_required'
      );
      expect((await quoteRow(foreign.quote_id)).consumed_at).toBeNull();
    });

    it('rejects a USD amount different from the quoted one, and a non-USD order currency', async () => {
      await ready();
      const customer = await asCustomer();
      const q = await quote(customer, 100);
      await expectToken(
        insertBizumOrder(customer, actors.customerId, q.quote_id, { total: 99.99 }), 'payment_quote_mismatch'
      );
      await expectToken(
        insertBizumOrder(customer, actors.customerId, q.quote_id, { currency: eurId }), 'payment_currency_unsupported'
      );
      expect((await quoteRow(q.quote_id)).consumed_at).toBeNull();
    });

    it('rejects a consumed quote and keeps ONE order per quote', async () => {
      await ready();
      const customer = await asCustomer();
      const q = await quote(customer);
      await insertBizumOrder(customer, actors.customerId, q.quote_id);
      await expectToken(insertBizumOrder(customer, actors.customerId, q.quote_id), 'payment_quote_consumed');
      const { rows } = await admin.query(`SELECT count(*)::int AS n FROM public.orders WHERE payment_quote_id = $1`, [q.quote_id]);
      expect(rows[0].n).toBe(1);
    });

    it('rejects a proof outside {uid}/quotes/{quote_id}/ (missing, other quote, other user, traversal, bare prefix)', async () => {
      await ready();
      const customer = await asCustomer();
      const q = await quote(customer);
      const q2 = await quote(customer);
      const prefix = `${actors.customerId}/quotes/${q.quote_id}/`;
      for (const proof of [
        null,
        proofPath(actors.customerId, q2.quote_id),
        proofPath(otherUserId, q.quote_id),
        `${actors.customerId}/${q.quote_id}/1.png`,
        `${prefix}../${q2.quote_id}/1.png`,
        prefix
      ]) {
        await expectToken(insertBizumOrder(customer, actors.customerId, q.quote_id, { proof }), 'payment_proof_invalid');
      }
      expect((await quoteRow(q.quote_id)).consumed_at).toBeNull();
      await insertBizumOrder(customer, actors.customerId, q.quote_id); // the right prefix passes
    });

    it('grace period: expired within 24 h is accepted with flag quote_expired and a pending review', async () => {
      const { rate } = await ready();
      const customer = await asCustomer();
      const q = await quote(customer);
      await ageQuote(q.quote_id, { expiredHoursAgo: 2 });
      const order = await insertBizumOrder(customer, actors.customerId, q.quote_id);
      expect(order.payment_amount).toBe('93.38'); // the QUOTED amount, not a re-priced one
      expect(order.payment_fx_rate_id).toBe(rate.id);
      const review = await reviewFor(order.id);
      expect(review).toMatchObject({ decision: 'pending', flags: ['quote_expired'], remittance_id: null });
      expect(review.expected_amount).toBe('93.38');
    });

    it('grace period: a rate that moved more than 2 % adds quote_rate_moved; 1 % does not', async () => {
      await ready();
      const customer = await asCustomer();
      const q1 = await quote(customer);
      await ageQuote(q1.quote_id, { expiredHoursAgo: 1 });
      await setRate(0.92 * 1.01); // +1 %, edited in place like Financial Settings does
      const a = await insertBizumOrder(customer, actors.customerId, q1.quote_id);
      expect((await reviewFor(a.id)).flags).toEqual(['quote_expired']);
    });

    it('grace period: +3 % effective rate => quote_expired + quote_rate_moved', async () => {
      await ready();
      const customer = await asCustomer();
      const q = await quote(customer);
      await ageQuote(q.quote_id, { expiredHoursAgo: 1 });
      await setRate(0.92 * 1.03);
      const order = await insertBizumOrder(customer, actors.customerId, q.quote_id);
      expect((await reviewFor(order.id)).flags).toEqual(['quote_expired', 'quote_rate_moved']);
      expect(order.payment_amount).toBe('93.38');
    });

    it('past the grace period: payment_quote_expired, quote stays unconsumed (proof is never lost)', async () => {
      await ready();
      const customer = await asCustomer();
      const q = await quote(customer);
      await ageQuote(q.quote_id, { expiredHoursAgo: 25 });
      await expectToken(insertBizumOrder(customer, actors.customerId, q.quote_id), 'payment_quote_expired');
      expect((await quoteRow(q.quote_id)).consumed_at).toBeNull();
      await setSetting('quote_grace_hours', 48); // the window is a setting, not a constant
      await insertBizumOrder(customer, actors.customerId, q.quote_id);
    });

    it('two simultaneous inserts with the same quote: exactly one order, the loser gets consumed / unique violation', async () => {
      await ready();
      const customer = await asCustomer();
      const q = await quote(customer);
      const workers = [await asCustomer(), await asCustomer()];
      const results = await fireTogether(
        workers.map((client) => ({
          client,
          sql: 'public.__s5a_insert_bizum_order($1::uuid, $2::uuid, $3::uuid)',
          params: [actors.customerId, q.quote_id, usdId]
        }))
      );
      expect(results.filter((r) => r.value).length).toBe(1);
      const loser = results.find((r) => r.error);
      expect(['payment_quote_consumed', undefined].includes(loser.error.message) || loser.error.code === '23505').toBe(true);
      const { rows } = await admin.query(`SELECT count(*)::int AS n FROM public.orders WHERE payment_quote_id = $1`, [q.quote_id]);
      expect(rows[0].n).toBe(1);
    });

    it('the partial UNIQUE indexes exist (quote and concept code) and are partial', async () => {
      const { rows } = await admin.query(
        `SELECT indexname, indexdef FROM pg_indexes
          WHERE schemaname = 'public' AND tablename = 'orders'
            AND indexdef ILIKE '%UNIQUE%' AND (indexdef ILIKE '%payment_quote_id%' OR indexdef ILIKE '%payment_concept_code%')`
      );
      expect(rows.length).toBe(2);
      for (const r of rows) expect(r.indexdef).toMatch(/WHERE/i);
    });
  });

  // --------------------------------------------------------------------------------------------
  describe('immutability of the sealed columns (R-26, C17)', () => {
    const sealedOrder = async () => {
      await ready();
      const customer = await asCustomer();
      const q = await quote(customer);
      const order = await insertBizumOrder(customer, actors.customerId, q.quote_id);
      return { customer, order, q };
    };

    it.each(SEALED_COLUMNS)('service_role cannot UPDATE %s (payment_quote_immutable)', async (column, expr) => {
      const { order } = await sealedOrder();
      const service = await asService();
      await expectToken(
        service.query(`UPDATE public.orders SET ${column} = ${expr} WHERE id = $1`, [order.id]),
        'payment_quote_immutable'
      );
    });

    it('the owner (authenticated) cannot UPDATE a sealed column either', async () => {
      const { customer, order } = await sealedOrder();
      await expectToken(
        customer.query(`UPDATE public.orders SET payment_amount = 1 WHERE id = $1`, [order.id]),
        'payment_quote_immutable'
      );
    });

    it('a SECURITY DEFINER RPC owned by the table owner may change it (S5b requote path)', async () => {
      const { customer, order } = await sealedOrder();
      await customer.query(`SELECT public.__s5a_definer_reseal($1, 90.00)`, [order.id]);
      const { rows } = await admin.query(`SELECT payment_amount FROM public.orders WHERE id = $1`, [order.id]);
      expect(rows[0].payment_amount).toBe('90.00');
    });

    it('cancelling and changing status / payment_status do NOT execute the guard function', async () => {
      const { customer, order } = await sealedOrder();
      await customer.query(
        `UPDATE public.orders SET status = 'cancelled', payment_status = 'rejected' WHERE id = $1`, [order.id]
      );
      const after = await admin.query(`SELECT status, payment_status, payment_amount FROM public.orders WHERE id = $1`, [order.id]);
      expect(after.rows[0]).toEqual({ status: 'cancelled', payment_status: 'rejected', payment_amount: '93.38' });

      // spy: the function is never called by a status-only UPDATE, and IS called when a sealed column changes
      await admin.query('BEGIN');
      try {
        await admin.query(`SET LOCAL track_functions = 'all'`);
        await admin.query(`UPDATE public.orders SET status = 'pending', payment_status = 'pending' WHERE id = $1`, [order.id]);
        const calls = async () =>
          (await admin.query(
            `SELECT coalesce(sum(calls), 0)::int AS n FROM pg_stat_xact_user_functions WHERE funcname = 'guard_bizum_quote_immutable'`
          )).rows[0].n;
        expect(await calls()).toBe(0);
        await admin.query(`UPDATE public.orders SET payment_amount = 91.00 WHERE id = $1`, [order.id]); // owner role: allowed
        expect(await calls()).toBe(1);
      } finally {
        await admin.query('ROLLBACK');
      }
    });

    it('the UPDATE trigger has a WHEN clause: Zelle rows never run it, and their error behavior is unchanged', async () => {
      const { rows } = await admin.query(
        `SELECT tgqual IS NOT NULL AS has_when, pg_get_triggerdef(oid) AS def FROM pg_trigger
          WHERE tgrelid = 'public.orders'::regclass AND tgname = 'guard_bizum_quote_immutable'`
      );
      expect(rows.length).toBe(1);
      expect(rows[0].has_when).toBe(true);
      expect(rows[0].def).toMatch(/BEFORE UPDATE/);
      const zelle = await insertZelleOrder(await asCustomer());
      const owner = await asCustomer();
      // owner: the legacy owner guard answers, exactly as before S5a
      await expect(owner.query(`UPDATE public.orders SET payment_method = 'bizum' WHERE id = $1`, [zelle.id])).rejects
        .toMatchObject({ code: '42501', message: 'orders_owner_update_forbidden: column payment_method' });
      // trusted role: an incomplete zelle -> bizum rewrite dies on the coherence CHECK
      const service = await asService();
      const err = await failure(service.query(`UPDATE public.orders SET payment_method = 'bizum' WHERE id = $1`, [zelle.id]));
      expect(err.code).toBe('23514');
      expect(err.message).toContain('orders_bizum_coherence');
    });
  });

  // --------------------------------------------------------------------------------------------
  describe('trigger wiring and live-table impact (Zelle untouched)', () => {
    it('BEFORE INSERT order: seal_bizum_payment fires after every guard_* and before every trigger_*', async () => {
      const { rows } = await admin.query(
        `SELECT tgname FROM pg_trigger
          WHERE tgrelid = 'public.orders'::regclass AND NOT tgisinternal
            AND (tgtype & 2) = 2 AND (tgtype & 4) = 4
          ORDER BY tgname COLLATE "C"`
      );
      const names = rows.map((r) => r.tgname);
      const seal = names.indexOf('seal_bizum_payment');
      expect(seal).toBeGreaterThan(-1);
      names.filter((n) => n.startsWith('guard_')).forEach((g) => expect(names.indexOf(g)).toBeLessThan(seal));
      names.filter((n) => n.startsWith('trigger_')).forEach((t) => expect(names.indexOf(t)).toBeGreaterThan(seal));
    });

    it('the sealing trigger is filtered by WHEN (payment_method = bizum) and never executes for Zelle inserts', async () => {
      const { rows } = await admin.query(
        `SELECT tgqual IS NOT NULL AS has_when FROM pg_trigger
          WHERE tgrelid = 'public.orders'::regclass AND tgname = 'seal_bizum_payment'`
      );
      expect(rows[0].has_when).toBe(true);
      await ready();
      const customer = await asCustomer();
      const q = await quote(customer);
      const calls = async () =>
        (await admin.query(
          `SELECT coalesce(sum(calls), 0)::int AS n FROM pg_stat_xact_user_functions WHERE funcname = 'seal_bizum_payment'`
        )).rows[0].n;
      await admin.query('BEGIN');
      try {
        await admin.query(`SET LOCAL track_functions = 'all'`);
        await admin.query(
          `INSERT INTO public.orders (user_id, order_type, subtotal, total_amount, currency_id, payment_method)
           VALUES ($1, 'product', 10, 10, $2, 'zelle')`, [actors.customerId, usdId]
        );
        expect(await calls()).toBe(0);
        await admin.query(
          `INSERT INTO public.orders (user_id, order_type, subtotal, total_amount, currency_id, payment_method,
                                      payment_quote_id, payment_proof_url)
           VALUES ($1, 'product', 100, 100, $2, 'bizum', $3, $4)`,
          [actors.customerId, usdId, q.quote_id, proofPath(actors.customerId, q.quote_id)]
        );
        expect(await calls()).toBe(1);
      } finally {
        await admin.query('ROLLBACK');
      }
    });

    it('a Zelle order insert is unchanged: every new column stays NULL, defaults and zelle fields intact', async () => {
      const customer = await asCustomer();
      const order = await insertZelleOrder(customer);
      expect(order).toMatchObject({
        payment_method: 'zelle', payment_status: 'pending', status: 'pending', zelle_account_id: null,
        bizum_account_id: null, payment_currency: null, payment_amount: null, payment_usd_reference: null,
        payment_fx_rate: null, payment_fx_rate_id: null, payment_quote_id: null, payment_concept_code: null
      });
      expect(order.order_number).toBeTruthy();
    });

    it('CHECKs close the Zelle hole: no payment_* on a non-bizum row, no unknown method (even as owner)', async () => {
      const customer = await asCustomer();
      const e1 = await failure(insertZelleOrder(customer, { payment_amount: 5 }));
      expect(e1).toMatchObject({ code: '23514' });
      expect(e1.message).toContain('orders_zelle_clean');
      const e2 = await failure(
        admin.query(
          `INSERT INTO public.orders (user_id, order_type, subtotal, total_amount, currency_id, payment_method)
           VALUES ($1, 'product', 10, 10, $2, 'paypal')`, [actors.customerId, usdId]
        )
      );
      expect(e2.message).toContain('orders_payment_method_chk');
      // Triggers off: the sealing trigger would stop this insert first; the CHECK is the last line of defence.
      const e3 = await failure(
        ownerBypass(
          `INSERT INTO public.orders (user_id, order_type, subtotal, total_amount, currency_id, payment_method, order_number)
           VALUES ($1, 'product', 10, 10, $2, 'bizum', 'S5A-NOCHECK')`, [actors.customerId, usdId]
        )
      );
      expect(e3.message).toMatch(/orders_bizum_coherence/);
    });

    it('the new CHECKs are validated, and the FKs exist', async () => {
      const { rows } = await admin.query(
        `SELECT conname, convalidated FROM pg_constraint
          WHERE conrelid = 'public.orders'::regclass AND contype = 'c'
            AND conname IN ('orders_payment_method_chk', 'orders_bizum_coherence', 'orders_zelle_clean', 'orders_bizum_proof_path')
          ORDER BY conname`
      );
      expect(rows).toEqual([
        { conname: 'orders_bizum_coherence', convalidated: true },
        { conname: 'orders_bizum_proof_path', convalidated: true },
        { conname: 'orders_payment_method_chk', convalidated: true },
        { conname: 'orders_zelle_clean', convalidated: true }
      ]);
      const fks = await admin.query(
        `SELECT a.attname, c.confrelid::regclass::text AS ref, c.confdeltype
           FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
          WHERE c.conrelid = 'public.orders'::regclass AND c.contype = 'f'
            AND a.attname IN ('bizum_account_id', 'payment_fx_rate_id', 'payment_quote_id')
          ORDER BY a.attname`
      );
      expect(fks.rows).toEqual([
        { attname: 'bizum_account_id', ref: 'bizum_accounts', confdeltype: 'r' },
        { attname: 'payment_quote_id', ref: 'payment_quotes', confdeltype: 'a' }
      ]);
    });

    it('Bizum never touches Zelle: quote + order leave zelle_* footprint unchanged', async () => {
      await ready();
      const before = await zelleFootprint();
      const customer = await asCustomer();
      const q = await quote(customer);
      await insertBizumOrder(customer, actors.customerId, q.quote_id);
      expect(await zelleFootprint()).toEqual(before);
    });

    it('with Bizum OFF a customer cannot create a Bizum order (existing guard still first)', async () => {
      await ready();
      const customer = await asCustomer();
      const q = await quote(customer);
      await setBizum(false);
      await expectToken(insertBizumOrder(customer, actors.customerId, q.quote_id), 'payment_method_disabled');
    });

    it('execute_platform_reset is unaffected: payment_reviews cascade with the orders, quotes need no change', async () => {
      await ready();
      const customer = await asCustomer();
      const q = await quote(customer);
      await ageQuote(q.quote_id, { expiredHoursAgo: 1 });
      await insertBizumOrder(customer, actors.customerId, q.quote_id); // creates a payment_reviews row
      const q2 = await quote(customer); // stays unconsumed: reset leaves it (documented decision)
      const fn = (await admin.query(`SELECT pg_get_functiondef('public.execute_platform_reset(text)'::regprocedure) AS d`)).rows[0].d;
      expect(fn).not.toMatch(/payment_quotes/);
      await admin.query('BEGIN');
      try {
        await admin.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: actors.adminId, role: 'authenticated' })]);
        await admin.query(`SET LOCAL session_replication_role = 'replica'`);
        await admin.query(`UPDATE public.user_profiles SET role = 'super_admin' WHERE id = $1`, [actors.adminId]);
        await admin.query(`SET LOCAL session_replication_role = 'origin'`);
        await admin.query(`INSERT INTO public.platform_reset_control (id, enabled) VALUES (1, true) ON CONFLICT (id) DO UPDATE SET enabled = true`);
        await admin.query(`SELECT public.execute_platform_reset('RESETEAR')`);
        expect((await admin.query(`SELECT count(*)::int AS n FROM public.orders`)).rows[0].n).toBe(0);
        expect((await admin.query(`SELECT count(*)::int AS n FROM public.payment_reviews`)).rows[0].n).toBe(0);
        expect((await admin.query(`SELECT count(*)::int AS n FROM public.payment_quotes WHERE id = $1`, [q2.quote_id])).rows[0].n).toBe(1);
      } finally {
        await admin.query('ROLLBACK');
      }
    });
  });

  // --------------------------------------------------------------------------------------------
  describe('attach_quote_proof / report_paid_quote_failure / get_order_by_quote / admin_list_orphan_quotes', () => {
    it('attach_quote_proof stores the proof path of the owner under the quote prefix only', async () => {
      await ready();
      const customer = await asCustomer();
      const other = await asOther();
      const q = await quote(customer);
      const good = proofPath(actors.customerId, q.quote_id);
      await customer.query(`SELECT public.attach_quote_proof($1, $2)`, [q.quote_id, good]);
      expect((await quoteRow(q.quote_id)).proof_path).toBe(good);
      await expectToken(
        customer.query(`SELECT public.attach_quote_proof($1, $2)`, [q.quote_id, proofPath(actors.customerId, randomUUID())]),
        'payment_proof_invalid'
      );
      await expectToken(
        other.query(`SELECT public.attach_quote_proof($1, $2)`, [q.quote_id, proofPath(otherUserId, q.quote_id)]),
        'payment_quote_required'
      );
      await expectToken(
        customer.query(`SELECT public.attach_quote_proof($1, $2)`, [randomUUID(), good]), 'payment_quote_required'
      );
    });

    it('attach_quote_proof refuses a consumed quote and one past the grace period', async () => {
      await ready();
      const customer = await asCustomer();
      const q = await quote(customer);
      await insertBizumOrder(customer, actors.customerId, q.quote_id);
      await expectToken(
        customer.query(`SELECT public.attach_quote_proof($1, $2)`, [q.quote_id, proofPath(actors.customerId, q.quote_id, '2.png')]),
        'payment_quote_consumed'
      );
      const q2 = await quote(customer);
      await ageQuote(q2.quote_id, { expiredHoursAgo: 30 });
      await expectToken(
        customer.query(`SELECT public.attach_quote_proof($1, $2)`, [q2.quote_id, proofPath(actors.customerId, q2.quote_id)]),
        'payment_quote_expired'
      );
    });

    it('report_paid_quote_failure needs a proof, records a bounded token, and feeds the admin orphan queue', async () => {
      await ready();
      const customer = await asCustomer();
      const q = await quote(customer);
      await expectToken(
        customer.query(`SELECT public.report_paid_quote_failure($1, 'too_many_open_reservations')`, [q.quote_id]),
        'payment_proof_invalid'
      );
      await customer.query(`SELECT public.attach_quote_proof($1, $2)`, [q.quote_id, proofPath(actors.customerId, q.quote_id)]);
      await expectToken(
        customer.query(`SELECT public.report_paid_quote_failure($1, 'Not A Token!')`, [q.quote_id]), 'payment_quote_invalid_reason'
      );
      await customer.query(`SELECT public.report_paid_quote_failure($1, 'too_many_open_reservations')`, [q.quote_id]);
      expect((await quoteRow(q.quote_id)).failure_reason).toBe('too_many_open_reservations');

      const adminClient = await asAdmin();
      const { rows } = await adminClient.query(`SELECT * FROM public.admin_list_orphan_quotes()`);
      expect(rows.map((r) => r.quote_id)).toEqual([q.quote_id]);
      expect(rows[0]).toMatchObject({ user_id: actors.customerId, failure_reason: 'too_many_open_reservations' });
      expect(Object.keys(rows[0])).not.toContain('phone'); // no PII in the queue

      await expectToken(customer.query(`SELECT * FROM public.admin_list_orphan_quotes()`), 'bizum_forbidden', '42501');
      const other = await asOther();
      await expectToken(
        other.query(`SELECT public.report_paid_quote_failure($1, 'other')`, [q.quote_id]), 'payment_quote_required'
      );
    });

    it('the orphan queue also lists a paid quote left unconsumed past the grace period, never a consumed one', async () => {
      await ready();
      const customer = await asCustomer();
      const q = await quote(customer);
      await customer.query(`SELECT public.attach_quote_proof($1, $2)`, [q.quote_id, proofPath(actors.customerId, q.quote_id)]);
      const adminClient = await asAdmin();
      expect((await adminClient.query(`SELECT * FROM public.admin_list_orphan_quotes()`)).rowCount).toBe(0);
      await ageQuote(q.quote_id, { expiredHoursAgo: 26 });
      expect((await adminClient.query(`SELECT * FROM public.admin_list_orphan_quotes()`)).rowCount).toBe(1);
      await admin.query(`UPDATE public.payment_quotes SET consumed_at = now() WHERE id = $1`, [q.quote_id]);
      expect((await adminClient.query(`SELECT * FROM public.admin_list_orphan_quotes()`)).rowCount).toBe(0);
    });

    it('get_order_by_quote is idempotent for the owner and silent for everyone else', async () => {
      await ready();
      const customer = await asCustomer();
      const other = await asOther();
      const q = await quote(customer);
      const get = async (client) =>
        (await client.query(`SELECT public.get_order_by_quote($1) AS r`, [q.quote_id])).rows[0].r;
      expect(await get(customer)).toBeNull(); // not consumed yet
      const order = await insertBizumOrder(customer, actors.customerId, q.quote_id);
      const first = await get(customer);
      expect(first.order_id).toBe(order.id);
      expect(first.order_number).toBe(order.order_number);
      expect(await get(customer)).toEqual(first); // repeat call, same answer
      expect(await get(other)).toBeNull();
    });
  });

  // --------------------------------------------------------------------------------------------
  describe('get_payment_instructions (owner or admin; tolerates an inactive account)', () => {
    it('returns phone, holder, amount, concept and rate to the owner and to an admin', async () => {
      const { account } = await ready();
      const customer = await asCustomer();
      const q = await quote(customer);
      const order = await insertBizumOrder(customer, actors.customerId, q.quote_id);
      const expected = {
        phone: account.phone, holder_name: 'Holder Test', amount: 93.38, currency: 'EUR',
        concept_code: q.concept_code
      };
      const own = (await customer.query(`SELECT public.get_payment_instructions('order', $1) AS r`, [order.id])).rows[0].r;
      expect(own).toMatchObject(expected);
      expect(Number(own.fx_rate)).toBe(0.9338);
      const adm = await asAdmin();
      const viaAdmin = (await adm.query(`SELECT public.get_payment_instructions('order', $1) AS r`, [order.id])).rows[0].r;
      expect(viaAdmin).toMatchObject(expected);
      await admin.query(`UPDATE public.bizum_accounts SET is_active = false WHERE id = $1`, [account.id]);
      const inactive = (await customer.query(`SELECT public.get_payment_instructions('order', $1) AS r`, [order.id])).rows[0].r;
      expect(inactive).toMatchObject(expected);
    });

    it('is uniform for foreign orders, Zelle orders and unknown ids; remittances are S5b (fail closed)', async () => {
      await ready();
      const customer = await asCustomer();
      const other = await asOther();
      const q = await quote(customer);
      const order = await insertBizumOrder(customer, actors.customerId, q.quote_id);
      const zelle = await insertZelleOrder(customer);
      const call = (client, type, id) => client.query(`SELECT public.get_payment_instructions($1, $2)`, [type, id]);
      await expectToken(call(other, 'order', order.id), 'payment_source_not_found');
      await expectToken(call(customer, 'order', zelle.id), 'payment_source_not_found');
      await expectToken(call(customer, 'order', randomUUID()), 'payment_source_not_found');
      await expectToken(call(customer, 'remittance', randomUUID()), 'payment_source_unsupported');
      await expectToken(call(customer, 'banana', order.id), 'payment_source_unsupported');
    });
  });

  // --------------------------------------------------------------------------------------------
  describe('payment_reviews (M6 partial: flags)', () => {
    it('is admin-readable through RLS only and cascades with the order', async () => {
      await ready();
      const customer = await asCustomer();
      const q = await quote(customer);
      await ageQuote(q.quote_id, { expiredHoursAgo: 1 });
      const order = await insertBizumOrder(customer, actors.customerId, q.quote_id);
      const mine = await customer.query(`SELECT * FROM public.payment_reviews`);
      expect(mine.rowCount).toBe(0);
      const adm = await asAdmin();
      expect((await adm.query(`SELECT * FROM public.payment_reviews WHERE order_id = $1`, [order.id])).rowCount).toBe(1);
      const err = await failure(customer.query(`UPDATE public.payment_reviews SET decision = 'validated'`));
      expect(err.code).toBe('42501');
      await admin.query(`DELETE FROM public.orders WHERE id = $1`, [order.id]);
      expect((await reviewFor(order.id))).toBeUndefined();
    });

    it('requires exactly one of order_id / remittance_id and one review per source', async () => {
      await ready();
      const customer = await asCustomer();
      const q = await quote(customer);
      await ageQuote(q.quote_id, { expiredHoursAgo: 1 });
      const order = await insertBizumOrder(customer, actors.customerId, q.quote_id);
      expect((await failure(admin.query(`INSERT INTO public.payment_reviews (decision) VALUES ('pending')`))).code).toBe('23514');
      expect((await failure(admin.query(`INSERT INTO public.payment_reviews (order_id) VALUES ($1)`, [order.id]))).code).toBe('23505');
    });
  });

  // --------------------------------------------------------------------------------------------
  describe('migration hygiene', () => {
    it('ships the main migration with the deployment header', () => {
      expect(MIGRATION_FILES.length).toBeGreaterThanOrEqual(1);
      const main = readFileSync(path.join(MIGRATIONS_DIR, MIGRATION_FILES[0]), 'utf8');
      expect(main).toMatch(/PREPARED, NOT APPLIED/);
      expect(main).toMatch(/ROLLBACK/);
      expect(main).not.toMatch(/console\.log|TODO|FIXME/);
    });

    it('is idempotent: re-applying every file in order succeeds and changes no data', async () => {
      await ready();
      const customer = await asCustomer();
      const q = await quote(customer);
      const order = await insertBizumOrder(customer, actors.customerId, q.quote_id);
      for (let pass = 0; pass < 2; pass += 1) {
        for (const f of MIGRATION_FILES) {
          await admin.query(readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8'));
        }
      }
      const { rows } = await admin.query(`SELECT payment_amount FROM public.orders WHERE id = $1`, [order.id]);
      expect(rows[0].payment_amount).toBe('93.38');
      expect((await quoteRow(q.quote_id)).consumed_at).not.toBeNull();
    });

    it('the documented ROLLBACK removes every object it created (verified inside a rolled-back transaction)', async () => {
      const statements = [];
      for (const f of [...MIGRATION_FILES].reverse()) {
        const text = readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8');
        const block = text.split('\n').filter((l) => /^-- (DROP|ALTER|DELETE) /.test(l)).map((l) => l.slice(3));
        statements.push(...block);
      }
      expect(statements.length).toBeGreaterThan(5);
      await admin.query('BEGIN');
      try {
        await admin.query(`SET LOCAL session_replication_role = 'replica'`);
        await admin.query(statements.join('\n'));
        const gone = await admin.query(
          `SELECT to_regclass('public.payment_quotes') AS quotes, to_regclass('public.payment_reviews') AS reviews,
                  to_regproc('public.create_bizum_quote') AS rpc, to_regproc('public.seal_bizum_payment') AS trg,
                  (SELECT count(*)::int FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = 'orders'
                      AND column_name IN ('bizum_account_id', 'payment_currency', 'payment_amount', 'payment_usd_reference',
                                          'payment_fx_rate', 'payment_fx_rate_id', 'payment_quote_id', 'payment_concept_code')) AS cols,
                  (SELECT count(*)::int FROM pg_trigger WHERE tgname IN ('seal_bizum_payment', 'guard_bizum_quote_immutable')) AS triggers,
                  (SELECT count(*)::int FROM pg_constraint WHERE conname LIKE 'orders\\_%' AND conname IN
                    ('orders_payment_method_chk', 'orders_bizum_coherence', 'orders_zelle_clean', 'orders_bizum_proof_path')) AS checks`
        );
        expect(gone.rows[0]).toEqual({ quotes: null, reviews: null, rpc: null, trg: null, cols: 0, triggers: 0, checks: 0 });
      } finally {
        await admin.query('ROLLBACK');
      }
      expect((await admin.query(`SELECT to_regclass('public.payment_quotes') AS q`)).rows[0].q).not.toBeNull();
    });
  });
});
