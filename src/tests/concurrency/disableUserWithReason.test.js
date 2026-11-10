/**
 * set_user_enabled() + the restrictive "disabled user" RLS policies
 * (supabase/migrations/20261019130000_disable_user_with_reason.sql). Local Postgres only.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { dbSuiteSkipReason, connectAdmin, connectAs, endAll, fireTogether } from './db';
import { loadActors } from './fixtures';

const skipReason = await dbSuiteSkipReason({ tables: ['orders', 'user_profiles', 'activity_logs'] });
const describeDb = skipReason ? describe.skip : describe;

const MIGRATION = 'supabase/migrations/20261019130000_disable_user_with_reason.sql';

describe('disable_user_with_reason migration (static)', () => {
  const sql = readFileSync(resolve(process.cwd(), MIGRATION), 'utf8');

  it('defines a hardened super_admin-only RPC', () => {
    expect(sql).toMatch(/FUNCTION public\.set_user_enabled\(/);
    expect(sql).toMatch(/SECURITY DEFINER/);
    expect(sql).toMatch(/SET search_path = public, pg_temp/);
    expect(sql).toMatch(/is_super_admin\(\)/);
    expect(sql).toMatch(/pg_advisory_xact_lock\(hashtext\('user_enabled'\)\)/);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.set_user_enabled\(uuid, boolean, text\) FROM PUBLIC, anon/);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.set_user_enabled\(uuid, boolean, text\) TO authenticated, service_role/);
  });

  it('documents an exact rollback', () => {
    expect(sql).toMatch(/ROLLBACK/);
    expect(sql).toMatch(/DROP FUNCTION IF EXISTS public\.set_user_enabled/);
    expect(sql).toMatch(/DROP COLUMN IF EXISTS disabled_reason/);
  });
});

describeDb('set_user_enabled and disabled-user policies (local Postgres)', () => {
  let admin;
  let actors;
  const clients = [];
  const created = [];
  const orders = [];

  const as = async (userId) => {
    const c = await connectAs(userId);
    clients.push(c);
    return c;
  };

  // Fixture users bypass triggers (replica role) like scripts/test-db-seed.sql does.
  const makeUser = async (role = 'user', { withProfile = true, enabled = true } = {}) => {
    const id = randomUUID();
    const email = `disuser.${id.slice(0, 8)}@example.test`;
    const c = await connectAdmin();
    try {
      await c.query('BEGIN');
      await c.query('SET LOCAL session_replication_role = replica');
      await c.query(
        `INSERT INTO auth.users (instance_id, id, aud, role, email, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
         VALUES ('00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated', $2, now(), now(), '{}', '{}')`,
        [id, email]
      );
      if (withProfile) {
        await c.query(
          `INSERT INTO public.user_profiles (id, user_id, email, role, full_name, is_enabled) VALUES ($1, $1, $2, $3, 'Dis User', $4)`,
          [id, email, role, enabled]
        );
      }
      await c.query('COMMIT');
    } finally {
      await c.end();
    }
    created.push(id);
    return id;
  };

  const profile = async (id) =>
    (await admin.query(
      'SELECT is_enabled, disabled_reason, disabled_at, disabled_by FROM public.user_profiles WHERE id = $1',
      [id]
    )).rows[0];

  const call = (c, target, enabled, reason) =>
    c.query('SELECT public.set_user_enabled($1, $2, $3) AS r', [target, enabled, reason]);

  const insertOrder = (c, userId) =>
    c.query(
      `INSERT INTO public.orders (user_id, order_type, subtotal, discount_amount, shipping_cost, tax_amount, total_amount, currency_id, payment_method, status)
       VALUES ($1, 'product', 10, 0, 0, 0, 10, $2, 'zelle', 'pending') RETURNING id`,
      [userId, actors.currencyId]
    );

  let superId;
  let superB;

  beforeAll(async () => {
    admin = await connectAdmin();
    actors = await loadActors(admin);
    superId = await makeUser('super_admin');
    superB = await makeUser('super_admin');
  });

  afterAll(async () => {
    if (orders.length) await admin.query('DELETE FROM public.orders WHERE id = ANY($1)', [orders]);
    if (created.length) {
      await admin.query(`DELETE FROM public.activity_logs WHERE entity_id = ANY($1) OR performed_by = ANY($2)`, [
        created,
        created
      ]);
      await admin.query('DELETE FROM public.user_profiles WHERE id = ANY($1)', [created]);
      await admin.query('DELETE FROM auth.users WHERE id = ANY($1)', [created]);
    }
    await endAll([...clients, admin]);
  });

  describe('permissions', () => {
    it('rejects a customer and an admin with 42501, super_admin succeeds', async () => {
      const target = await makeUser();
      for (const actor of [actors.customerId, actors.adminId]) {
        const c = await as(actor);
        await expect(call(c, target, false, 'fraud suspicion')).rejects.toMatchObject({ code: '42501' });
      }
      expect((await profile(target)).is_enabled).toBe(true);
      const s = await as(superId);
      const { rows } = await call(s, target, false, 'fraud suspicion');
      expect(rows[0].r.changed).toBe(true);
    });

    it('is not executable by anon', async () => {
      const { rows } = await admin.query(
        `SELECT has_function_privilege('anon', 'public.set_user_enabled(uuid, boolean, text)', 'EXECUTE') AS a`
      );
      expect(rows[0].a).toBe(false);
    });
  });

  describe('rules', () => {
    it('requires a reason of 3..500 characters (trimmed) to disable', async () => {
      const target = await makeUser();
      const s = await as(superId);
      await expect(call(s, target, false, null)).rejects.toThrow(/user_disable_reason_required/);
      await expect(call(s, target, false, '   ab  ')).rejects.toThrow(/user_disable_reason_required/);
      await expect(call(s, target, false, 'x'.repeat(501))).rejects.toThrow(/user_disable_reason_too_long/);
      expect((await profile(target)).is_enabled).toBe(true);
      await call(s, target, false, '  abc  ');
      expect((await profile(target)).disabled_reason).toBe('abc');
      const ok = await makeUser();
      await call(s, ok, false, 'y'.repeat(500));
      expect((await profile(ok)).disabled_reason).toHaveLength(500);
    });

    it('does not let a super_admin disable themselves', async () => {
      const s = await as(superId);
      await expect(call(s, superId, false, 'testing self')).rejects.toThrow(/user_disable_self/);
      expect((await profile(superId)).is_enabled).toBe(true);
    });

    it('reports a missing user clearly', async () => {
      const s = await as(superId);
      await expect(call(s, randomUUID(), false, 'whatever')).rejects.toThrow(/user_not_found/);
    });

    it('stores reason, timestamp and actor, and clears them on enable', async () => {
      const target = await makeUser();
      const s = await as(superId);
      await call(s, target, false, 'chargeback abuse');
      const p = await profile(target);
      expect(p).toMatchObject({ is_enabled: false, disabled_reason: 'chargeback abuse', disabled_by: superId });
      expect(p.disabled_at).toBeInstanceOf(Date);
      const { rows } = await call(s, target, true, null);
      expect(rows[0].r).toMatchObject({ is_enabled: true, changed: true });
      expect(await profile(target)).toEqual({ is_enabled: true, disabled_reason: null, disabled_at: null, disabled_by: null });
    });

    it('is idempotent: repeating a transition changes nothing and logs once', async () => {
      const target = await makeUser();
      const s = await as(superId);
      await call(s, target, false, 'first reason');
      const before = await profile(target);
      const again = await call(s, target, false, 'second reason');
      expect(again.rows[0].r.changed).toBe(false);
      expect(await profile(target)).toEqual(before);
      const enabledTwice = await makeUser();
      expect((await call(s, enabledTwice, true, null)).rows[0].r.changed).toBe(false);
      const { rows } = await admin.query(
        `SELECT count(*)::int AS n FROM public.activity_logs WHERE entity_id = $1 AND action = 'user_disabled'`,
        [target]
      );
      expect(rows[0].n).toBe(1);
    });

    it('serializes two super_admins disabling each other: exactly one wins, one stays enabled', async () => {
      const a = await as(superId);
      const b = await as(superB);
      const results = await fireTogether([
        { client: a, sql: `public.set_user_enabled($1, false, 'mutual race')`, params: [superB] },
        { client: b, sql: `public.set_user_enabled($1, false, 'mutual race')`, params: [superId] }
      ]);
      expect(results.filter((r) => r.error)).toHaveLength(1);
      const { rows } = await admin.query(
        `SELECT count(*)::int AS n FROM public.user_profiles WHERE id = ANY($1) AND is_enabled`,
        [[superId, superB]]
      );
      expect(rows[0].n).toBe(1);
      // restore for the remaining tests
      await admin.query(
        `UPDATE public.user_profiles SET is_enabled = true, disabled_reason = NULL, disabled_at = NULL, disabled_by = NULL WHERE id = ANY($1)`,
        [[superId, superB]]
      );
    });
  });

  describe('audit', () => {
    it('writes user_disabled / user_enabled rows with actor, target and reason', async () => {
      const target = await makeUser();
      const s = await as(superId);
      await call(s, target, false, 'audit me');
      await call(s, target, true, null);
      const { rows } = await admin.query(
        `SELECT action, entity_type, performed_by, metadata FROM public.activity_logs WHERE entity_id = $1 ORDER BY created_at`,
        [target]
      );
      expect(rows.map((r) => r.action)).toEqual(['user_disabled', 'user_enabled']);
      expect(rows[0]).toMatchObject({ entity_type: 'user_profile', performed_by: superId });
      expect(rows[0].metadata).toMatchObject({ reason: 'audit me', target_user_id: target, actor_user_id: superId });
    });
  });

  describe('profile guard', () => {
    it('does not let a user write disabled_* on their own profile', async () => {
      const u = await makeUser();
      const c = await as(u);
      await expect(
        c.query(`UPDATE public.user_profiles SET disabled_reason = 'self written' WHERE id = $1`, [u])
      ).rejects.toMatchObject({ code: '42501' });
    });
  });

  describe('database-level enforcement for a disabled user', () => {
    it('blocks writes on business tables but still lets the user read their own profile', async () => {
      const u = await makeUser();
      const uc = await as(u);
      const { rows: first } = await insertOrder(uc, u);
      orders.push(first[0].id);

      await call(await as(superId), u, false, 'enforcement check');

      await expect(insertOrder(uc, u)).rejects.toMatchObject({ code: '42501' });
      const upd = await uc.query(`UPDATE public.orders SET notes = 'x' WHERE id = $1`, [first[0].id]);
      expect(upd.rowCount).toBe(0);
      const sel = await uc.query('SELECT id FROM public.orders WHERE id = $1', [first[0].id]);
      expect(sel.rowCount).toBe(0);
      await expect(
        uc.query(`INSERT INTO public.shopping_carts (user_id) VALUES ($1)`, [u])
      ).rejects.toMatchObject({ code: '42501' });
      await expect(
        uc.query(`INSERT INTO public.recipients (user_id, full_name) VALUES ($1, 'R')`, [u])
      ).rejects.toMatchObject({ code: '42501' });

      const me = await uc.query('SELECT is_enabled, disabled_reason FROM public.user_profiles WHERE id = $1', [u]);
      expect(me.rows[0]).toMatchObject({ is_enabled: false, disabled_reason: 'enforcement check' });
    });

    it('lets staff still process the disabled user\'s order, and resumes after re-enabling', async () => {
      const u = await makeUser();
      const uc = await as(u);
      const { rows } = await insertOrder(uc, u);
      orders.push(rows[0].id);
      const s = await as(superId);
      await call(s, u, false, 'pending review');

      const ac = await as(actors.adminId);
      const seen = await ac.query('SELECT id FROM public.orders WHERE id = $1', [rows[0].id]);
      expect(seen.rowCount).toBe(1);
      const upd = await ac.query(`UPDATE public.orders SET notes = 'staff note' WHERE id = $1`, [rows[0].id]);
      expect(upd.rowCount).toBe(1);

      await call(s, u, true, null);
      const again = await insertOrder(uc, u);
      orders.push(again.rows[0].id);
      expect(again.rowCount).toBe(1);
    });

    it('keeps enabled customers and admins operating', async () => {
      const cc = await as(actors.customerId);
      const { rows } = await insertOrder(cc, actors.customerId);
      orders.push(rows[0].id);
      expect(rows).toHaveLength(1);
      const ac = await as(actors.adminId);
      expect((await ac.query('SELECT id FROM public.orders WHERE id = $1', [rows[0].id])).rowCount).toBe(1);
    });

    it('does not block a brand-new user whose profile row does not exist yet', async () => {
      const u = await makeUser('user', { withProfile: false });
      const uc = await as(u);
      const { rows } = await insertOrder(uc, u);
      orders.push(rows[0].id);
      expect(rows).toHaveLength(1);
    });

    it('protects every selected table with a restrictive policy', async () => {
      const tables = [
        'orders', 'order_items', 'order_status_history', 'remittances', 'remittance_status_history',
        'recipients', 'recipient_addresses', 'recipient_bank_accounts', 'shopping_carts', 'cart_items',
        'user_alerts', 'testimonials'
      ];
      const { rows } = await admin.query(
        `SELECT tablename FROM pg_policies WHERE schemaname = 'public' AND permissive = 'RESTRICTIVE'
           AND policyname = tablename || '_block_disabled_user' AND tablename = ANY($1)`,
        [tables]
      );
      expect(rows.map((r) => r.tablename).sort()).toEqual([...tables].sort());
    });
  });
});
