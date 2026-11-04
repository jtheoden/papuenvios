/**
 * RLS-01: is_admin_user() / is_super_admin() must require user_profiles.is_enabled = true.
 *
 * Migration under test: supabase/migrations/20261104130000_restore_is_enabled_in_rls_helpers.sql
 * (rollback: supabase/rollbacks/20261104130000_restore_is_enabled_in_rls_helpers_down.sql).
 *
 * Production drifted from the repo: 20261101180000_fix_rls_functions_security_definer.sql (removed from the repo by the
 * e2e PR #144 but applied in prod) redefined both helpers as `LANGUAGE sql` WITHOUT the is_enabled check. A scratch DB
 * rebuilt from the repo already has the plpgsql variants WITH the check, so this suite first installs the LIVE
 * variants (the production state), records what they allow, and only then applies the migration file.
 *
 * RED phase: run with RLS01_SKIP_MIGRATION=1 (the migration is not applied -> every "disabled" assertion fails).
 * GREEN phase: run without it. Shared scratch objects (both functions, the two *_block_disabled_user policies) are
 * restored to their pre-suite definitions in afterAll.
 *
 * Also pins (item 5) that the *_block_disabled_user policies only block when they are RESTRICTIVE: a PERMISSIVE
 * twin (what production is reported to have) is OR-ed with orders_select/orders_update and blocks nothing.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { dbSuiteSkipReason, connectAdmin, connectAs, connectAnon, endAll } from './db';
import { loadActors, createTracker, seedOrder, cleanup } from './fixtures';

const MIGRATION = 'supabase/migrations/20261104130000_restore_is_enabled_in_rls_helpers.sql';
const ROLLBACK = 'supabase/rollbacks/20261104130000_restore_is_enabled_in_rls_helpers_down.sql';
const sqlOf = (path) => readFileSync(resolve(process.cwd(), path), 'utf8');

// LIVE production definitions (read-only verified 2026-11-04).
const LIVE_SQL = `
CREATE OR REPLACE FUNCTION public.is_admin_user() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$ SELECT COALESCE(role IN ('admin', 'super_admin'), false) FROM public.user_profiles WHERE id = auth.uid() LIMIT 1; $$;
CREATE OR REPLACE FUNCTION public.is_super_admin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$ SELECT COALESCE(role = 'super_admin', false) FROM public.user_profiles WHERE id = auth.uid() LIMIT 1; $$;
CREATE OR REPLACE FUNCTION public.is_admin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$ SELECT COALESCE(role = 'admin', false) FROM public.user_profiles WHERE id = auth.uid() LIMIT 1; $$;
CREATE OR REPLACE FUNCTION public.is_manager() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$ SELECT COALESCE(role = 'manager', false) FROM public.user_profiles WHERE id = auth.uid() LIMIT 1; $$;
CREATE OR REPLACE FUNCTION public.current_user_role() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$ SELECT COALESCE(role, 'user') FROM public.user_profiles WHERE id = auth.uid() LIMIT 1; $$;`;
const FUNCTIONS = ['is_admin_user', 'is_super_admin', 'is_admin', 'is_manager', 'current_user_role'];

const skipReason = await dbSuiteSkipReason({
  functions: ['is_admin_user', 'is_super_admin', 'is_admin', 'is_manager', 'current_user_role', 'current_user_is_blocked'],
  tables: ['orders', 'user_profiles']
});
const describeDb = skipReason ? describe.skip : describe;

describe('RLS-01 migration files (static)', () => {
  it('migration keeps the live shape and only adds the is_enabled condition', () => {
    const sql = sqlOf(MIGRATION);
    const code = sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
    expect(code).toMatch(/CREATE OR REPLACE FUNCTION public\.is_admin_user\(\)/);
    expect(code).toMatch(/CREATE OR REPLACE FUNCTION public\.is_super_admin\(\)/);
    for (const fn of FUNCTIONS) expect(code).toMatch(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${fn}\\(\\)`));
    expect(code.match(/LANGUAGE sql/g)).toHaveLength(5);
    expect(code.match(/SECURITY DEFINER/g)).toHaveLength(5);
    expect(code.match(/SET search_path TO 'public'/g)).toHaveLength(5);
    expect(code.match(/is_enabled = true/g)).toHaveLength(5);
    expect(code).toMatch(/SET LOCAL lock_timeout = '5s'/);
    expect(code).not.toMatch(/\b(DROP|DELETE|TRUNCATE|INSERT|ALTER|GRANT|REVOKE)\b|\bUPDATE\s+\w/i);
    expect(sql).toMatch(/ROLLBACK/);
  });

  it('rollback restores the live definitions without is_enabled', () => {
    const sql = sqlOf(ROLLBACK).split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
    expect(sql).toMatch(/COALESCE\(role IN \('admin', 'super_admin'\), false\)/);
    expect(sql).toMatch(/COALESCE\(role = 'super_admin', false\)/);
    expect(sql).toMatch(/COALESCE\(role = 'admin', false\)/);
    expect(sql).toMatch(/COALESCE\(role = 'manager', false\)/);
    expect(sql).toMatch(/SELECT COALESCE\(role, 'user'\)/);
    for (const fn of FUNCTIONS) expect(sql).toMatch(new RegExp(`FUNCTION public\\.${fn}\\(\\)`));
    expect(sql).not.toMatch(/is_enabled/);
  });
});

describeDb('is_admin_user / is_super_admin require is_enabled (local Postgres)', () => {
  let admin;
  let actors;
  let prodStateAllowedDisabled; // what the LIVE definitions answered for a disabled admin / super_admin
  const tracker = createTracker();
  const clients = [];
  const saved = { functions: [], policies: [], acl: {} };

  const as = async (userId) => {
    const c = await connectAs(userId);
    clients.push(c);
    return c;
  };
  const profile = (id, role, enabled) =>
    admin.query('UPDATE public.user_profiles SET role = $2, is_enabled = $3 WHERE id = $1', [id, role, enabled]);
  const helpers = async (client) => {
    const { rows } = await client.query('SELECT public.is_admin_user() AS a, public.is_super_admin() AS s');
    return rows[0];
  };
  const others = async (client) => {
    const { rows } = await client.query(
      'SELECT public.is_admin() AS adm, public.is_manager() AS mgr, public.current_user_role() AS role');
    return rows[0];
  };
  // Production reportedly has the two *_block_disabled_user policies PERMISSIVE; the repo makes them RESTRICTIVE.
  const setBlockMode = async (mode) => {
    for (const t of ['orders', 'remittances']) {
      await admin.query(`DROP POLICY IF EXISTS ${t}_block_disabled_user ON public.${t}`);
      await admin.query(
        `CREATE POLICY ${t}_block_disabled_user ON public.${t} AS ${mode} FOR ALL TO authenticated
           USING ((SELECT NOT public.current_user_is_blocked())) WITH CHECK ((SELECT NOT public.current_user_is_blocked()))`);
    }
  };

  beforeAll(async () => {
    admin = await connectAdmin();
    actors = await loadActors(admin);
    for (const fn of FUNCTIONS) {
      const { rows } = await admin.query(
        `SELECT pg_get_functiondef(p.oid) AS def, p.proacl::text AS acl FROM pg_proc p
          WHERE p.pronamespace = 'public'::regnamespace AND p.proname = $1`, [fn]);
      saved.functions.push(rows[0].def);
      saved.acl[fn] = rows[0].acl;
    }
    // production state: LIVE `sql` helpers + PERMISSIVE block policies
    await admin.query(LIVE_SQL);
    await setBlockMode('PERMISSIVE');

    await profile(actors.adminId, 'admin', false);
    const a = await as(actors.adminId);
    const disabledAdmin = await helpers(a);
    await profile(actors.adminId, 'super_admin', false);
    const b = await as(actors.adminId);
    const disabledSuper = await helpers(b);
    prodStateAllowedDisabled = { disabledAdmin, disabledSuper };
    await endAll(clients.splice(0));
    await profile(actors.adminId, 'admin', true);

    if (process.env.RLS01_SKIP_MIGRATION !== '1') await admin.query(sqlOf(MIGRATION));
  });

  afterEach(async () => {
    await endAll(clients.splice(0));
    await profile(actors.adminId, 'admin', true);
    await profile(actors.customerId, 'user', true);
    await cleanup(admin, tracker);
  });

  afterAll(async () => {
    for (const def of saved.functions) await admin.query(def);
    for (const t of ['orders', 'remittances']) {
      await admin.query(`DROP POLICY IF EXISTS ${t}_block_disabled_user ON public.${t}`);
    }
    await setBlockMode('RESTRICTIVE');
    await admin.end();
  });

  it('documents the production state: the LIVE helpers accept a disabled admin and a disabled super_admin', () => {
    expect(prodStateAllowedDisabled.disabledAdmin).toEqual({ a: true, s: false });
    expect(prodStateAllowedDisabled.disabledSuper).toEqual({ a: true, s: true });
  });

  it('enabled admin: is_admin_user true, is_super_admin false', async () => {
    await profile(actors.adminId, 'admin', true);
    expect(await helpers(await as(actors.adminId))).toEqual({ a: true, s: false });
  });

  it('disabled admin: both false', async () => {
    await profile(actors.adminId, 'admin', false);
    expect(await helpers(await as(actors.adminId))).toEqual({ a: false, s: false });
  });

  it('enabled super_admin: both true', async () => {
    await profile(actors.adminId, 'super_admin', true);
    expect(await helpers(await as(actors.adminId))).toEqual({ a: true, s: true });
  });

  it('disabled super_admin: both false', async () => {
    await profile(actors.adminId, 'super_admin', false);
    expect(await helpers(await as(actors.adminId))).toEqual({ a: false, s: false });
  });

  it('plain user: both false', async () => {
    expect(await helpers(await as(actors.customerId))).toEqual({ a: false, s: false });
  });

  it('anon / NULL uid: both false (never NULL)', async () => {
    const c = await connectAnon();
    clients.push(c);
    const { rows } = await c.query('SELECT public.is_admin_user() AS a, public.is_super_admin() AS s');
    expect(rows[0]).toEqual({ a: false, s: false });
  });

  it('keeps signature, SECURITY DEFINER, STABLE, search_path, language sql and the original ACLs', async () => {
    const { rows } = await admin.query(
      `SELECT p.proname, l.lanname, p.prosecdef, p.provolatile, p.proconfig::text AS cfg, p.proacl::text AS acl,
              pg_get_function_identity_arguments(p.oid) AS args, p.prorettype::regtype::text AS ret
         FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
        WHERE p.pronamespace = 'public'::regnamespace AND p.proname = ANY($1) ORDER BY 1`, [FUNCTIONS]);
    expect(rows).toHaveLength(5);
    for (const r of rows) {
      expect(r).toMatchObject({ lanname: 'sql', prosecdef: true, provolatile: 's', args: '',
        ret: r.proname === 'current_user_role' ? 'text' : 'boolean' });
      expect(r.cfg).toMatch(/search_path=public/);
      expect(r.acl).toBe(saved.acl[r.proname]);
    }
  });

  describe('is_admin / is_manager / current_user_role', () => {
    it('enabled admin: is_admin true, is_manager false, role admin', async () => {
      expect(await others(await as(actors.adminId))).toEqual({ adm: true, mgr: false, role: 'admin' });
    });
    it('disabled admin: is_admin false and role downgraded to user', async () => {
      await profile(actors.adminId, 'admin', false);
      expect(await others(await as(actors.adminId))).toEqual({ adm: false, mgr: false, role: 'user' });
    });
    it('enabled manager: is_manager true, role manager', async () => {
      await profile(actors.adminId, 'manager', true);
      expect(await others(await as(actors.adminId))).toEqual({ adm: false, mgr: true, role: 'manager' });
    });
    it('disabled manager: is_manager false, role user', async () => {
      await profile(actors.adminId, 'manager', false);
      expect(await others(await as(actors.adminId))).toEqual({ adm: false, mgr: false, role: 'user' });
    });
    it('plain enabled user: false / false / user; anon keeps having no EXECUTE on these three (ACL unchanged)', async () => {
      expect(await others(await as(actors.customerId))).toEqual({ adm: false, mgr: false, role: 'user' });
      const c = await connectAnon();
      clients.push(c);
      for (const fn of ['is_admin', 'is_manager', 'current_user_role']) {
        await expect(c.query(`SELECT public.${fn}()`)).rejects.toMatchObject({ code: '42501' });
      }
    });
  });

  describe('end to end on orders (policies orders_select / orders_update use is_admin_user)', () => {
    it('disabled admin sees none of another user\'s orders and cannot update one', async () => {
      const id = await seedOrder(admin, actors, tracker, [], { stockManaged: false });
      await profile(actors.adminId, 'admin', false);
      const c = await as(actors.adminId);
      expect((await c.query('SELECT id FROM public.orders WHERE id = $1', [id])).rowCount).toBe(0);
      const upd = await c.query(`UPDATE public.orders SET updated_at = now() WHERE id = $1`, [id]);
      expect(upd.rowCount).toBe(0);
    });

    it('the same admin, re-enabled, can read and update it', async () => {
      const id = await seedOrder(admin, actors, tracker, [], { stockManaged: false });
      await profile(actors.adminId, 'admin', true);
      const c = await as(actors.adminId);
      expect((await c.query('SELECT id FROM public.orders WHERE id = $1', [id])).rowCount).toBe(1);
      const upd = await c.query(`UPDATE public.orders SET updated_at = now() WHERE id = $1`, [id]);
      expect(upd.rowCount).toBe(1);
    });
  });

  describe('item 5: *_block_disabled_user policies and current_user_is_blocked()', () => {
    it('current_user_is_blocked is true only for a disabled user', async () => {
      await profile(actors.customerId, 'user', false);
      expect((await (await as(actors.customerId)).query('SELECT public.current_user_is_blocked() AS b')).rows[0].b).toBe(true);
      await profile(actors.customerId, 'user', true);
      expect((await (await as(actors.customerId)).query('SELECT public.current_user_is_blocked() AS b')).rows[0].b).toBe(false);
    });

    it('PERMISSIVE twin (reported production state) blocks NOTHING: a disabled owner still reads and updates its order', async () => {
      await setBlockMode('PERMISSIVE');
      const id = await seedOrder(admin, actors, tracker, [], { stockManaged: false });
      await profile(actors.customerId, 'user', false);
      const c = await as(actors.customerId);
      expect((await c.query('SELECT id FROM public.orders WHERE id = $1', [id])).rowCount).toBe(1);
      expect((await c.query(`UPDATE public.orders SET updated_at = now() WHERE id = $1`, [id])).rowCount).toBe(1);
    });

    it('RESTRICTIVE policy (what the repo migration 20261019130000 creates) does block a disabled owner', async () => {
      await setBlockMode('RESTRICTIVE');
      try {
        const id = await seedOrder(admin, actors, tracker, [], { stockManaged: false });
        await profile(actors.customerId, 'user', false);
        const c = await as(actors.customerId);
        expect((await c.query('SELECT id FROM public.orders WHERE id = $1', [id])).rowCount).toBe(0);
        expect((await c.query(`UPDATE public.orders SET updated_at = now() WHERE id = $1`, [id])).rowCount).toBe(0);
      } finally {
        await setBlockMode('PERMISSIVE');
      }
    });
  });
});
