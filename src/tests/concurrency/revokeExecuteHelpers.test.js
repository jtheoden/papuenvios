/**
 * E2 (W5c): REVOKE EXECUTE on helpers, triggers and legacy functions.
 * Migration under test: 20261024100100_revoke_execute_helpers.sql
 *
 * Snapshot of who can execute what in `public`, plus the regressions that matter: the anonymous catalog, the checkout
 * (set_order_number -> generate_order_number), the remittance money guard (remittance_money_columns), the activity
 * log redaction (redact_pii_jsonb), service_role writers, and the sign-up path (handle_new_user / sync_user_email
 * fired by GoTrue as supabase_auth_admin, ND-6).
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { dbSuiteSkipReason, connectAdmin, connectAs, connectAnon, endAll, DB_URL } from './db';
import { assertLocalDbUrl } from './localGuard';
import { loadActors, createTracker, seedOrder, cleanup } from './fixtures';

const skipReason = await dbSuiteSkipReason({
  functions: ['is_admin_user', 'generate_order_number', 'remittance_money_columns', 'redact_pii_jsonb', 'handle_new_user'],
  tables: ['orders', 'remittances', 'activity_logs', 'products']
});
const describeDb = skipReason ? describe.skip : describe;

/** The only functions anon may execute (RLS policies and public screens use them). */
const ANON_ALLOWLIST = [
  'get_my_role',
  'get_public_landing_stats',
  'get_testimonial_author_profiles',
  'is_admin_user',
  'is_super_admin'
];

/** Trigger functions: nobody calls them directly; Postgres does not check EXECUTE when a trigger fires. */
const TRIGGER_FUNCTIONS = [
  'activity_logs_redact_pii',
  'generate_remittance_number',
  'guard_platform_reset_lock',
  'guard_remittance_owner_insert',
  'guard_remittance_owner_update',
  'guard_user_profiles_birth_date',
  'handle_new_user',
  'set_order_number',
  'sync_user_email',
  'update_business_visual_settings_timestamp',
  'update_publications_timestamp',
  'update_updated_at',
  'update_updated_at_column'
];

/** Legacy writers / unused SECURITY DEFINER: not callable by any API role. */
const NOBODY_FUNCTIONS = ['reserve_zelle_account', 'reset_daily_zelle_counters', 'reset_monthly_zelle_counters'];

/** Helpers that invoker code calls under the caller's rights: authenticated and service_role keep EXECUTE, anon does not. */
const HELPERS = ['current_user_id', 'generate_order_number', 'redact_pii_jsonb', 'remittance_money_columns'];

/** Unused invoker read functions: authenticated keeps EXECUTE (YAGNI to drop), anon loses it. */
const AUTH_ONLY_READERS = [
  'calculate_order_total',
  'count_user_interactions',
  'current_user_is_enabled',
  'current_user_role',
  'get_category_from_interactions',
  'get_shipping_cost_for_location',
  'is_admin',
  'is_manager',
  'upsert_my_profile'
];

const failure = async (promise) => {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected the statement to fail, but it succeeded');
};

describeDb('EXECUTE privileges of public functions', () => {
  let admin;
  let actors;
  const tracker = createTracker();
  const clients = [];
  const remittances = [];
  const types = [];

  const as = async (userId, role = 'authenticated') => {
    const c = await connectAs(userId, role);
    clients.push(c);
    return c;
  };

  const can = async (role, fn) => {
    const { rows } = await admin.query(
      `SELECT bool_or(has_function_privilege($1, p.oid, 'EXECUTE')) AS ok
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = $2`,
      [role, fn]
    );
    return rows[0].ok;
  };

  beforeAll(async () => {
    admin = await connectAdmin();
    actors = await loadActors(admin);
  });
  afterEach(async () => {
    await endAll(clients.splice(0));
    await cleanup(admin, tracker);
    if (remittances.length) await admin.query('DELETE FROM public.remittances WHERE id = ANY($1)', [remittances.splice(0)]);
    if (types.length) await admin.query('DELETE FROM public.remittance_types WHERE id = ANY($1)', [types.splice(0)]);
  });
  afterAll(async () => {
    await admin.end();
  });

  describe('snapshot', () => {
    it('anon can execute exactly the 5 allowlisted functions of public', async () => {
      const { rows } = await admin.query(
        `SELECT DISTINCT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'public' AND p.prokind = 'f' AND has_function_privilege('anon', p.oid, 'EXECUTE')
          ORDER BY 1`
      );
      expect(rows.map((r) => r.proname)).toEqual(ANON_ALLOWLIST);
    });

    it.each(TRIGGER_FUNCTIONS)('trigger function %s is not executable by anon or authenticated', async (fn) => {
      expect(await can('anon', fn)).toBe(false);
      expect(await can('authenticated', fn)).toBe(false);
    });

    it.each(NOBODY_FUNCTIONS)('legacy writer %s is not executable by anon or authenticated', async (fn) => {
      expect(await can('anon', fn)).toBe(false);
      expect(await can('authenticated', fn)).toBe(false);
    });

    it('get_low_stock_count is not executable by anon or authenticated', async () => {
      expect(await can('anon', 'get_low_stock_count')).toBe(false);
      expect(await can('authenticated', 'get_low_stock_count')).toBe(false);
    });

    it.each(HELPERS)('helper %s: authenticated and service_role keep EXECUTE, anon does not', async (fn) => {
      expect(await can('anon', fn)).toBe(false);
      expect(await can('authenticated', fn)).toBe(true);
      expect(await can('service_role', fn)).toBe(true);
    });

    it.each(AUTH_ONLY_READERS)('reader %s: anon lost EXECUTE, authenticated kept it', async (fn) => {
      expect(await can('anon', fn)).toBe(false);
      expect(await can('authenticated', fn)).toBe(true);
    });

    it.each(ANON_ALLOWLIST)('allowlisted %s keeps EXECUTE for anon and authenticated', async (fn) => {
      expect(await can('anon', fn)).toBe(true);
      expect(await can('authenticated', fn)).toBe(true);
    });
  });

  describe('regressions that must stay green', () => {
    it('anon still reads the public catalog and the anonymous RPCs', async () => {
      const anon = await connectAnon();
      clients.push(anon);
      await anon.query('SELECT id FROM public.products LIMIT 1');
      await anon.query('SELECT id FROM public.product_categories LIMIT 1');
      await anon.query('SELECT id FROM public.offers LIMIT 1');
      await anon.query('SELECT public.get_public_landing_stats()');
      await anon.query('SELECT * FROM public.get_testimonial_author_profiles($1::uuid[])', [[actors.customerId]]);
    });

    it('anon cannot call a revoked helper', async () => {
      const anon = await connectAnon();
      clients.push(anon);
      const err = await failure(anon.query('SELECT public.generate_order_number()'));
      expect(err.code).toBe('42501');
    });

    it('checkout: an owner INSERT without order_number gets one (set_order_number -> generate_order_number)', async () => {
      const owner = await as(actors.customerId);
      const { rows } = await owner.query(
        `INSERT INTO public.orders (user_id, order_type, subtotal, total_amount, currency_id, payment_method)
         VALUES ($1, 'product', 10, 10, $2, 'zelle') RETURNING id, order_number`,
        [actors.customerId, actors.currencyId]
      );
      tracker.orders.push(rows[0].id);
      expect(rows[0].order_number).toMatch(/^ORD-\d{8}-\d+$/);
    });

    it('an admin UPDATE of a non-money remittance column still passes the money guard', async () => {
      const t = await admin.query(
        `INSERT INTO public.remittance_types (name, currency_code, delivery_currency, exchange_rate,
           commission_percentage, commission_fixed, min_amount, delivery_method)
         VALUES ($1,'USD','CUP',800,2.5,0,0.01,'transfer') RETURNING id`,
        [`ex-${randomUUID().slice(0, 8)}`]
      );
      types.push(t.rows[0].id);
      const id = randomUUID();
      await admin.query(
        `INSERT INTO public.remittances (id, user_id, remittance_type_id, amount_sent, exchange_rate,
           commission_percentage, commission_fixed, commission_total, amount_to_deliver, currency_sent,
           currency_delivered, recipient_name, recipient_phone)
         VALUES ($1,$2,$3,100,800,2.5,0,2.5,78000,'USD','CUP','R','+5355550100')`,
        [id, actors.customerId, t.rows[0].id]
      );
      remittances.push(id);
      const adm = await as(actors.adminId);
      await adm.query(`UPDATE public.remittances SET recipient_name = 'Renamed' WHERE id = $1`, [id]);
      expect((await admin.query('SELECT recipient_name FROM public.remittances WHERE id = $1', [id])).rows[0].recipient_name).toBe('Renamed');
    });

    it('an authenticated INSERT into activity_logs still goes through the PII redaction trigger', async () => {
      const owner = await as(actors.customerId);
      const marker = `w5-${randomUUID().slice(0, 8)}`;
      await owner.query(
        `INSERT INTO public.activity_logs (performed_by, action, entity_type, metadata) VALUES ($1, $2, 'test', $3::jsonb)`,
        [actors.customerId, marker, JSON.stringify({ email: 'someone@example.com', ok: 1 })]
      );
      const { rows } = await admin.query('SELECT metadata FROM public.activity_logs WHERE action = $1', [marker]);
      await admin.query('DELETE FROM public.activity_logs WHERE action = $1', [marker]);
      expect(rows[0].metadata).toEqual({ email: '[REDACTED_EMAIL]', ok: 1 });
    });

    it('service_role runs the helpers (its EXECUTE used to come only from PUBLIC)', async () => {
      const svc = await as(actors.adminId, 'service_role');
      for (const sql of [
        'public.generate_order_number()',
        `public.redact_pii_jsonb('{"a":"x@y.co"}'::jsonb)`,
        'public.remittance_money_columns()',
        'public.current_user_id()'
      ]) {
        await svc.query(`SELECT ${sql}`);
      }
    });

    // The scratch clone gives service_role no table grants (production has them through Supabase's default
    // privileges), so the DML below is emulated inside a transaction that grants them and is rolled back.
    it('service_role: inserting an order without a number and updating a remittance still work', async () => {
      const c = await connectAdmin();
      clients.push(c);
      try {
        await c.query('BEGIN');
        await c.query('GRANT SELECT, INSERT ON public.orders TO service_role');
        await c.query('GRANT SELECT, UPDATE ON public.remittances TO service_role');
        await c.query('SET LOCAL ROLE service_role');
        const { rows } = await c.query(
          `INSERT INTO public.orders (user_id, order_type, subtotal, total_amount, currency_id, payment_method)
           VALUES ($1, 'product', 10, 10, $2, 'zelle') RETURNING order_number`,
          [actors.customerId, actors.currencyId]
        );
        expect(rows[0].order_number).toMatch(/^ORD-\d{8}-\d+$/);
        await c.query(`UPDATE public.remittances SET recipient_name = recipient_name WHERE false`);
      } finally {
        await c.query('ROLLBACK').catch(() => {});
      }
    });

    it('other orders flows keep working for the admin (seeded order is readable)', async () => {
      const id = await seedOrder(admin, actors, tracker, []);
      const adm = await as(actors.adminId);
      const { rows } = await adm.query('SELECT id FROM public.orders WHERE id = $1', [id]);
      expect(rows).toHaveLength(1);
    });
  });

  describe('sign-up (ND-6): GoTrue fires handle_new_user / sync_user_email as supabase_auth_admin', () => {
    const SIGNUP_EMAIL = () => `w5.signup.${randomUUID().slice(0, 8)}@example.test`;
    const createdUsers = [];

    /** A real login as supabase_auth_admin (what GoTrue uses), not a SET ROLE from the test superuser. */
    const connectAuthAdmin = async () => {
      const url = new URL(DB_URL);
      url.username = 'supabase_auth_admin';
      assertLocalDbUrl(url.toString());
      const c = new pg.Client({ connectionString: url.toString() });
      await c.connect();
      clients.push(c);
      return c;
    };

    beforeAll(async () => {
      // The scratch clone is owned by postgres; grant supabase_auth_admin only what GoTrue owns in production.
      // EXECUTE on the trigger functions is deliberately NOT granted: the tests prove it is not needed.
      await admin.query('GRANT USAGE ON SCHEMA auth TO supabase_auth_admin');
      await admin.query('GRANT SELECT, INSERT, UPDATE ON auth.users TO supabase_auth_admin');
      // In production supabase_auth_admin OWNS auth.users, so RLS does not apply to it; the clone is owned by postgres.
      await admin.query('DROP POLICY IF EXISTS w5_auth_admin_all ON auth.users');
      await admin.query('CREATE POLICY w5_auth_admin_all ON auth.users TO supabase_auth_admin USING (true) WITH CHECK (true)');
    });
    afterEach(async () => {
      if (createdUsers.length) {
        await admin.query('DELETE FROM public.user_profiles WHERE id = ANY($1)', [createdUsers]);
        await admin.query('DELETE FROM auth.users WHERE id = ANY($1)', [createdUsers.splice(0)]);
      }
    });
    afterAll(async () => {
      await admin.query('DROP POLICY IF EXISTS w5_auth_admin_all ON auth.users');
      await admin.query('REVOKE SELECT, INSERT, UPDATE ON auth.users FROM supabase_auth_admin');
      await admin.query('REVOKE USAGE ON SCHEMA auth FROM supabase_auth_admin');
    });

    const insertAuthUser = async (c, id, email, meta = '{}') => {
      createdUsers.push(id);
      await c.query(
        `INSERT INTO auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
         VALUES ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, $3::jsonb, now(), now())`,
        [id, email, meta]
      );
    };

    it('supabase_auth_admin has no EXECUTE on the two trigger functions', async () => {
      expect(await can('supabase_auth_admin', 'handle_new_user')).toBe(false);
      expect(await can('supabase_auth_admin', 'sync_user_email')).toBe(false);
    });

    it('creating an auth user still creates the profile (handle_new_user)', async () => {
      const email = SIGNUP_EMAIL();
      const id = randomUUID();
      const c = await connectAuthAdmin();
      await insertAuthUser(c, id, email, '{"full_name":"W5 Signup"}');
      const { rows } = await admin.query('SELECT email, role, full_name, is_enabled FROM public.user_profiles WHERE id = $1', [id]);
      expect(rows[0]).toEqual({ email, role: 'user', full_name: 'W5 Signup', is_enabled: true });
    });

    it('changing the auth email still syncs the profile (sync_user_email)', async () => {
      const id = randomUUID();
      const next = SIGNUP_EMAIL();
      const c = await connectAuthAdmin();
      await insertAuthUser(c, id, SIGNUP_EMAIL());
      await c.query('UPDATE auth.users SET email = $2 WHERE id = $1', [id, next]);
      const { rows } = await admin.query('SELECT email FROM public.user_profiles WHERE id = $1', [id]);
      expect(rows[0].email).toBe(next);
    });
  });
});
