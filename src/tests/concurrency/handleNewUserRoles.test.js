/**
 * handle_new_user() must grant a privileged role ONLY to the owner's emails
 * (supabase/migrations/20261103120000_handle_new_user_remove_test_email_roles.sql). Local Postgres only.
 * Unlike other fixtures, users here are inserted WITHOUT session_replication_role = replica so the
 * on_auth_user_created trigger really fires.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { dbSuiteSkipReason, connectAdmin, endAll } from './db';

const skipReason = await dbSuiteSkipReason({ functions: ['handle_new_user'], tables: ['user_profiles'] });
const describeDb = skipReason ? describe.skip : describe;

const MIGRATION = 'supabase/migrations/20261103120000_handle_new_user_remove_test_email_roles.sql';
const ROLLBACK = 'supabase/rollbacks/20261103120000_handle_new_user_remove_test_email_roles_down.sql';

describe('handle_new_user test-email roles migration (static)', () => {
  const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');

  it('keeps the function hardened and drops the two @test.com rules', () => {
    const sql = read(MIGRATION);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.handle_new_user\(\)/);
    expect(sql).toMatch(/SECURITY DEFINER/);
    expect(sql).toMatch(/SET search_path TO 'public'/);
    expect(sql).toMatch(/'jtheoden@gmail\.com', 'jtheoden@googlemail\.com'/);
    // Only comments may mention the removed emails.
    const code = sql.replace(/^\s*--.*$/gm, '');
    expect(code).not.toMatch(/@test\.com/);
    expect(code).not.toMatch(/ELSIF/);
  });

  it('ships a rollback that restores the previous rules', () => {
    const sql = read(ROLLBACK);
    expect(sql).toMatch(/'superadmin@test\.com'/);
    expect(sql).toMatch(/ELSIF NEW\.email = 'admin@test\.com'/);
  });
});

describeDb('handle_new_user role assignment (local Postgres)', () => {
  let admin;
  const created = [];

  const signUp = async (email, meta = '{}') => {
    const id = randomUUID();
    await admin.query(
      `INSERT INTO auth.users (instance_id, id, aud, role, email, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
       VALUES ('00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated', $2, now(), now(), '{}', $3::jsonb)`,
      [id, email, meta]
    );
    created.push(id);
    return id;
  };

  const roleOf = async (id) =>
    (await admin.query('SELECT role, is_enabled, full_name FROM public.user_profiles WHERE id = $1', [id])).rows[0];

  // Emails are unique per auth.users; the owner/test emails may already exist in a developer DB,
  // so each case frees its email first (scratch DB only, rows created by this file are tracked below).
  const freeEmail = async (email) => {
    const { rows } = await admin.query('SELECT id FROM auth.users WHERE email = $1', [email]);
    if (rows.length) throw new Error(`fixture email ${email} already present in the scratch DB`);
  };

  beforeAll(async () => {
    admin = await connectAdmin();
  });

  afterAll(async () => {
    if (admin && created.length) {
      await admin.query('DELETE FROM public.user_profiles WHERE id = ANY($1::uuid[])', [created]);
      await admin.query('DELETE FROM auth.users WHERE id = ANY($1::uuid[])', [created]);
    }
    await endAll([admin]);
  });

  it.each(['jtheoden@gmail.com', 'jtheoden@googlemail.com'])('owner email %s gets super_admin', async (email) => {
    await freeEmail(email);
    expect((await roleOf(await signUp(email))).role).toBe('super_admin');
  });

  it.each(['superadmin@test.com', 'admin@test.com'])('%s is a plain user', async (email) => {
    await freeEmail(email);
    expect((await roleOf(await signUp(email))).role).toBe('user');
  });

  it('a random email gets user, enabled, with the derived full_name', async () => {
    const id = await signUp(`rnd.${randomUUID().slice(0, 8)}@example.test`);
    const row = await roleOf(id);
    expect(row.role).toBe('user');
    expect(row.is_enabled).toBe(true);
    expect(row.full_name).toMatch(/^rnd\./);
  });

  it('ON CONFLICT path still works: an existing profile row is upserted, never duplicated', async () => {
    // user_profiles.user_id has an FK to auth.users, so the conflict is provoked by re-firing the function
    // from a throwaway AFTER UPDATE trigger; the whole scenario is rolled back.
    const id = randomUUID();
    const email = `conflict.${id.slice(0, 8)}@example.test`;
    try {
      await admin.query('BEGIN');
      await admin.query(
        `INSERT INTO auth.users (instance_id, id, aud, role, email, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
         VALUES ('00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated', $2, now(), now(), '{}', '{}')`,
        [id, email]
      );
      await admin.query("UPDATE public.user_profiles SET role = 'admin', full_name = 'Old Name' WHERE id = $1", [id]);
      await admin.query(
        'CREATE TRIGGER zz_refire_handle_new_user AFTER UPDATE ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user()'
      );
      await admin.query(`UPDATE auth.users SET raw_user_meta_data = '{"full_name":"New Name"}' WHERE id = $1`, [id]);
      const { rows } = await admin.query('SELECT role, full_name FROM public.user_profiles WHERE id = $1', [id]);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toEqual({ role: 'user', full_name: 'New Name' });
    } finally {
      await admin.query('ROLLBACK');
    }
  });

  it('applying the migration leaves every existing user_profiles row untouched', async () => {
    const snapshot = async () =>
      (await admin.query(
        `SELECT count(*)::int AS n,
                md5(coalesce(string_agg(t::text, '|' ORDER BY t.id), '')) AS sum
           FROM public.user_profiles t`
      )).rows[0];
    const before = await snapshot();
    // The file carries its own BEGIN/COMMIT; the simple-query protocol runs it as one script.
    await admin.query(readFileSync(resolve(process.cwd(), MIGRATION), 'utf8'));
    const after = await snapshot();
    expect(before.n).toBeGreaterThan(0);
    expect(after).toEqual(before);
  });
});
