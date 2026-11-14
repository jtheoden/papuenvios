/**
 * Real PG17, disposable local clusters only; no sockets or connection URLs.
 * Uses the courier standalone harness pattern (regular-file stdin, --single -j).
 * COURIER_TEST_PG_BIN overrides the installed PG17 binaries. Single-user mode
 * cannot race sessions: the partial unique index is exercised with a duplicate.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { closeSync, existsSync, mkdtempSync, openSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readSql } from './courierTestKit';

const bin = process.env.COURIER_TEST_PG_BIN || '/usr/lib/postgresql/17/bin';
const available = ['initdb', 'postgres'].every((name) => existsSync(join(bin, name)));
if (!available) {
  const reason = `financial entries: standalone PG17 binaries missing in ${bin}; set COURIER_TEST_PG_BIN`;
  if (process.env.DB_TESTS_REQUIRED === '1') throw new Error(reason);
  process.stderr.write(`[db tests] SKIPPED: ${reason}\n`);
}
const up = readSql('supabase/migrations/20261113214007_financial_entries.sql');
const down = readSql('supabase/rollbacks/20261113214007_financial_entries_down.sql');
const database = 'papuenvios_test_financial_entries';
const table = 'public.financial_entries';
const addSignature = 'public.superadmin_add_financial_entry(text,numeric,date,text,text)';
const voidSignature = 'public.superadmin_void_financial_entry(uuid,text)';
const uid = "'00000000-0000-4000-8000-000000000001'::uuid";
const today = "(now() AT TIME ZONE 'America/New_York')::date";
const quote = (value) => `'${value.replaceAll("'", "''")}'`;
const assertSql = (condition, message) => `DO $assert$ BEGIN
  IF NOT COALESCE((${condition}), false) THEN RAISE EXCEPTION '%', ${quote(message)}; END IF;
END $assert$;`;
const errorSql = (statement, state, message) =>
  `SELECT public.test_expect_error(${quote(statement)}, '${state}', ${quote(message)});`;
const add = ({ kind = "'income'", amount = '12.34', date = today,
  category = "'operations'", reason = "'Test financial entry'" } = {}) =>
  `public.superadmin_add_financial_entry(${kind}, ${amount}, ${date}, ${category}, ${reason})`;
const voidEntry = (id = '(SELECT id FROM original)', reason = "'Test entry correction'") =>
  `public.superadmin_void_financial_entry(${id}, ${reason})`;
const setup = `
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
CREATE FUNCTION public.is_super_admin() RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT COALESCE(current_setting('test.super_admin', true) = 'on', false)
$$;
GRANT USAGE ON SCHEMA public, auth TO authenticated, anon;
CREATE FUNCTION public.test_expect_error(statement text, state text, message text)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE caught boolean := false;
BEGIN
  BEGIN
    EXECUTE statement;
  EXCEPTION WHEN OTHERS THEN
    caught := true;
    IF SQLSTATE <> state OR position(message IN SQLERRM) = 0 THEN
      RAISE EXCEPTION 'Unexpected error [%]: %; expected [%] %', SQLSTATE, SQLERRM, state, message;
    END IF;
  END;
  IF NOT caught THEN RAISE EXCEPTION 'Expected failure [%]: %', state, message; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub', ${uid}::text, false);
SET test.super_admin = 'on';
`;

(available ? describe : describe.skip)('financial entries on standalone real PostgreSQL 17', () => {
  let dir;
  // PostgreSQL --single may exit 0 after SQL errors: stderr must also be checked.
  const execute = (sql, db = database) => {
    const file = join(dir, 'scenario.sql');
    // -j treats blank lines as query delimiters, including inside function bodies.
    writeFileSync(file, `${sql.split('\n').filter((line) => line.trim()).join('\n')}\n\n`);
    const fd = openSync(file, 'r');
    try {
      const result = spawnSync(join(bin, 'postgres'), [
        '--single', '-j', '-D', dir, '-c', 'log_error_verbosity=verbose', db
      ], {
        stdio: [fd, 'pipe', 'pipe'], encoding: 'utf8', timeout: 30000,
        maxBuffer: 8 * 1024 * 1024, env: { ...process.env, LC_ALL: 'C' }
      });
      expect(result.error).toBeUndefined();
      expect(result.status, result.stderr).toBe(0);
      return result;
    } finally { closeSync(fd); }
  };
  const success = (sql, db) => {
    const result = execute(sql, db);
    expect(result.stderr).not.toMatch(/(?:ERROR|FATAL|PANIC):/);
    return result;
  };
  const run = (sql) => success(`BEGIN;\n${setup}\n${up}\n${sql}\nROLLBACK;`);

  beforeAll(() => {
    const version = spawnSync(join(bin, 'postgres'), ['--version'], { encoding: 'utf8' });
    expect(version.stdout).toMatch(/PostgreSQL\) 17\./);
    dir = mkdtempSync(join(tmpdir(), 'papuenvios-financial-entries-'));
    const init = spawnSync(join(bin, 'initdb'), [
      '-D', dir, '-U', 'postgres', '-A', 'trust', '--no-locale'
    ], { encoding: 'utf8', timeout: 30000 });
    expect(init.status, init.stderr).toBe(0);
    success(`CREATE DATABASE ${database};`, 'postgres');
    success('CREATE ROLE authenticated; CREATE ROLE anon;');
    // --single can keep allocating initdb-reserved OIDs (< FirstNormalObjectId),
    // which check_enable_rls treats as system relations and silently bypasses.
    // Consume and unlink scratch large objects until normal user OIDs are reached.
    success(`DO $$ DECLARE allocated oid; BEGIN LOOP
      allocated := lo_create(0); PERFORM lo_unlink(allocated);
      EXIT WHEN allocated >= 16384;
    END LOOP; END $$;`);
  });
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it('applies twice without changing rows; enables RLS, one super-admin SELECT policy, and SELECT-only ACLs', () => run(`
    CREATE TEMP TABLE original AS SELECT * FROM ${add()};
    ${up}
    ${assertSql(`(SELECT count(*) = 1 FROM ${table}) AND
      NOT EXISTS ((TABLE ${table} EXCEPT TABLE original) UNION ALL (TABLE original EXCEPT TABLE ${table}))`,
    'Rerunning the migration must preserve the ledger')}
    ${assertSql(`SELECT relrowsecurity FROM pg_class WHERE oid = '${table}'::regclass`, 'RLS must be enabled')}
    ${assertSql(`SELECT count(*) = 1 AND bool_and(policyname = 'financial_entries_select_super_admin'
      AND cmd = 'SELECT' AND roles = ARRAY['authenticated']::name[] AND qual LIKE '%is_super_admin()%'
      AND with_check IS NULL) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'financial_entries'`,
    'Only the authenticated super-admin SELECT policy may exist')}
    ${assertSql(`has_table_privilege('authenticated', '${table}', 'SELECT') AND NOT EXISTS (
      SELECT 1 FROM unnest(ARRAY['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) p
      WHERE has_table_privilege('authenticated', '${table}', p))`, 'Authenticated must have SELECT only')}
    ${assertSql(`NOT EXISTS (SELECT 1 FROM unnest(ARRAY[
      'SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) p
      WHERE has_table_privilege('anon', '${table}', p))`, 'Anon must have no table privileges')}
    ${[addSignature, voidSignature].map((signature) => assertSql(
    `has_function_privilege('authenticated', '${signature}', 'EXECUTE') AND
      NOT has_function_privilege('anon', '${signature}', 'EXECUTE')`, 'RPC execute privileges must be restricted'
  )).join('\n')}
  `));

  it.each([
    ['non-super-admin', "SET test.super_admin = 'off';"],
    // Keep the super-admin stub true to exercise the independent NULL-uid guard.
    ['anonymous NULL uid', "SET request.jwt.claim.sub = ''; SET test.super_admin = 'on';"]
  ])('add rejects %s with 42501', (_label, identity) => run(`
    ${identity}
    SET ROLE authenticated;
    ${errorSql(`SELECT ${add()}`, '42501', 'insufficient_privilege')}
    RESET ROLE;
    ${assertSql(`NOT EXISTS (SELECT 1 FROM ${table})`, 'Unauthorized calls must not insert')}
  `));

  it.each([
    ['invalid kind', { kind: "'refund'" }, 'invalid_kind'],
    ['NULL kind', { kind: 'NULL' }, 'invalid_kind'],
    ['zero amount', { amount: '0' }, 'invalid_amount'],
    ['negative amount', { amount: '-1' }, 'invalid_amount'],
    ['three decimal places', { amount: '1.001' }, 'invalid_amount'],
    ['NULL amount', { amount: 'NULL' }, 'invalid_amount'],
    ['short reason after trimming', { reason: "'   too short   '" }, 'invalid_reason'],
    ['long reason', { reason: "repeat('x', 501)" }, 'invalid_reason'],
    ['NULL reason', { reason: 'NULL' }, 'invalid_reason'],
    ['long category', { category: "repeat('c', 61)" }, 'invalid_category'],
    ['NULL date', { date: 'NULL' }, 'invalid_date']
  ])('add rejects %s with 22023 and no writes', (_label, args, message) => run(`
    SET ROLE authenticated;
    ${errorSql(`SELECT ${add(args)}`, '22023', message)}
    RESET ROLE;
    ${assertSql(`NOT EXISTS (SELECT 1 FROM ${table})`, 'Invalid calls must not insert')}
  `));

  it.each(['income', 'expense'])('add accepts and returns a valid %s', (kind) => run(`
    SET ROLE authenticated;
    CREATE TEMP TABLE returned AS SELECT * FROM ${add({ kind: quote(kind), category: "' operations '", reason: "'  Test financial entry  '" })};
    RESET ROLE;
    ${assertSql(`SELECT count(*) = 1 AND bool_and(id IS NOT NULL AND kind = '${kind}' AND amount = 12.34
      AND entry_date = ${today} AND category = 'operations' AND reason = 'Test financial entry'
      AND voids_entry_id IS NULL AND created_by = ${uid} AND created_at = now()) FROM returned`, 'RPC must return the complete normalized entry')}
    ${assertSql(`(SELECT count(*) = 1 FROM ${table}) AND
      NOT EXISTS ((TABLE returned EXCEPT TABLE ${table}) UNION ALL (TABLE ${table} EXCEPT TABLE returned))`,
    'Returned entry must equal the persisted row')}
  `));

  it.each(['2026-01-16T00:30:00Z', '2026-07-16T00:30:00Z'])(
    'uses New York today, not UTC, at %s (including void dates)', (instant) => run(`
      -- Override the built-in only in this disposable cluster's rolled-back transaction.
      -- The production SQL is unchanged; both RPCs still call the same now() OID.
      CREATE OR REPLACE FUNCTION pg_catalog.now() RETURNS timestamptz LANGUAGE sql STABLE
        AS $$ SELECT '${instant}'::timestamptz $$;
      SET TIME ZONE 'UTC';
      ${assertSql(`now() = '${instant}'::timestamptz AND (now() AT TIME ZONE 'UTC')::date = ${today} + 1`,
    'Fixture must place UTC one calendar day ahead of New York')}
      SET ROLE authenticated;
      CREATE TEMP TABLE original AS SELECT * FROM ${add({ date: `${today} - 3` })};
      CREATE TEMP TABLE business_today AS SELECT * FROM ${add()};
      ${errorSql(`SELECT ${add({ date: `${today} + 1` })}`, '22023', 'invalid_date')}
      CREATE TEMP TABLE counter AS SELECT * FROM ${voidEntry()};
      RESET ROLE;
      ${assertSql(`SELECT entry_date = '${instant.slice(0, 8)}15'::date FROM business_today`,
    'Business today must be accepted after UTC midnight')}
      ${assertSql(`SELECT entry_date = ${today} AND entry_date <> (now() AT TIME ZONE 'UTC')::date FROM counter`,
    'Counter-entry must use New York today rather than original or UTC date')}
      ${assertSql(`SELECT count(*) = 3 FROM ${table}`, 'Tomorrow rejection must not add a row')}
    `)
  );

  it.each(['income', 'expense'])('void creates an opposite entry for %s without altering the original', (kind) => run(`
    SET ROLE authenticated;
    CREATE TEMP TABLE original AS SELECT * FROM ${add({ kind: quote(kind), date: `${today} - 7` })};
    CREATE TEMP TABLE counter AS SELECT * FROM ${voidEntry()};
    RESET ROLE;
    ${assertSql(`SELECT c.id <> o.id AND c.kind = '${kind === 'income' ? 'expense' : 'income'}'
      AND c.amount = o.amount AND c.category = o.category AND c.voids_entry_id = o.id
      AND c.entry_date = ${today} AND c.reason = 'Test entry correction' AND c.created_by = ${uid}
      FROM counter c CROSS JOIN original o`, 'Void must return the opposite entry with copied amount/category')}
    ${assertSql(`(SELECT count(*) = 2 FROM ${table}) AND
      NOT EXISTS (TABLE original EXCEPT TABLE ${table}) AND NOT EXISTS (TABLE counter EXCEPT TABLE ${table})`,
    'Void must persist its return value and preserve the original')}
  `));

  it('void rejects repeats, counter-entries, unknown ids, invalid reasons and unauthorized callers', () => run(`
    CREATE TEMP TABLE original AS SELECT * FROM ${add()};
    CREATE TEMP TABLE counter AS SELECT * FROM ${voidEntry()};
    GRANT SELECT ON original, counter TO authenticated;
    SET ROLE authenticated;
    ${errorSql(`SELECT ${voidEntry()}`, '22023', 'already_voided')}
    ${errorSql(`SELECT ${voidEntry('(SELECT id FROM counter)')}`, '22023', 'cannot_void_a_void')}
    ${errorSql(`SELECT ${voidEntry("'00000000-0000-4000-8000-000000000099'::uuid")}`, 'P0002', 'entry_not_found')}
    ${["'short'", "repeat('x', 501)", 'NULL'].map((reason) =>
    errorSql(`SELECT ${voidEntry(undefined, reason)}`, '22023', 'invalid_reason')).join('\n')}
    SET test.super_admin = 'off';
    ${errorSql(`SELECT ${voidEntry()}`, '42501', 'insufficient_privilege')}
    SET test.super_admin = 'on';
    SET request.jwt.claim.sub = '';
    ${errorSql(`SELECT ${voidEntry()}`, '42501', 'insufficient_privilege')}
    RESET ROLE;
    ${assertSql(`SELECT count(*) = 2 FROM ${table}`, 'Rejected voids must not create rows')}
  `));

  it('enforces one counter-entry via the partial unique index (socketless race fallback)', () => run(`
    CREATE TEMP TABLE original AS SELECT * FROM ${add()};
    SELECT ${voidEntry()};
    ${assertSql(`EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
      JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
      WHERE i.indrelid = '${table}'::regclass AND c.relname = 'financial_entries_voids_uidx'
      AND i.indisunique AND i.indisvalid AND i.indnkeyatts = 1 AND a.attname = 'voids_entry_id'
      AND pg_get_expr(i.indpred, i.indrelid) = '(voids_entry_id IS NOT NULL)')`,
    'A valid partial unique index must protect each original')}
    ${errorSql(`INSERT INTO ${table} (kind, amount, entry_date, category, reason, voids_entry_id, created_by)
      SELECT kind, amount, entry_date, category, reason, voids_entry_id, created_by
      FROM ${table} WHERE voids_entry_id IS NOT NULL`, '23505', 'financial_entries_voids_uidx')}
    ${assertSql(`SELECT count(*) = 1 FROM ${table} WHERE voids_entry_id = (SELECT id FROM original)`,
    'Duplicate insertion must leave exactly one counter-entry')}
  `));

  it.each([
    ['INSERT', `INSERT INTO ${table} (kind,amount,entry_date,reason,created_by)
      VALUES ('income',1,${today},'Direct client insert',${uid})`],
    ['UPDATE', `UPDATE ${table} SET amount = 99`],
    ['DELETE', `DELETE FROM ${table}`]
  ])('authenticated direct %s fails with permission denied, even for a super-admin', (_label, statement) => run(`
    CREATE TEMP TABLE original AS SELECT * FROM ${add()};
    SET ROLE authenticated;
    ${errorSql(statement, '42501', 'permission denied for table financial_entries')}
    RESET ROLE;
    ${assertSql(`(SELECT count(*) = 1 FROM ${table}) AND
      NOT EXISTS ((TABLE ${table} EXCEPT TABLE original) UNION ALL (TABLE original EXCEPT TABLE ${table}))`,
    'Client writes must leave all rows unchanged')}
  `));

  it('RLS hides all rows from non-super-admins; super-admins see all; anon cannot SELECT or execute RPCs', () => run(`
    SELECT ${add()};
    SELECT ${add({ kind: "'expense'" })};
    SET ROLE authenticated;
    ${assertSql(`current_user = 'authenticated' AND row_security_active('${table}')`,
    'RLS must actually be active under the client role, not bypassed by the harness')}
    SET test.super_admin = 'off';
    ${assertSql(`SELECT count(*) = 0 FROM ${table}`, 'Non-super-admin must see no rows through RLS')}
    SET test.super_admin = 'on';
    ${assertSql(`SELECT count(*) = 2 FROM ${table}`, 'Super-admin must see every row through RLS')}
    RESET ROLE;
    SET ROLE anon;
    SET request.jwt.claim.sub = '';
    ${errorSql(`SELECT * FROM ${table}`, '42501', 'permission denied for table financial_entries')}
    ${errorSql(`SELECT ${add()}`, '42501', 'permission denied for function superadmin_add_financial_entry')}
    ${errorSql(`SELECT ${voidEntry(uid)}`, '42501', 'permission denied for function superadmin_void_financial_entry')}
    RESET ROLE;
  `));

  // Execute the COMPLETE rollback, including its transaction boundaries, against
  // committed fixtures in separate scratch DBs. An outer ROLLBACK would mask bugs.
  it.each([true, false])('rollback with populated=%s preserves or drops the ledger as appropriate', (populated) => {
    const db = `${database}_${populated ? 'populated' : 'empty'}`;
    success(`CREATE DATABASE ${db};`, 'postgres');
    try {
      success(`BEGIN; ${setup}\n${up}\n${populated ? `SELECT ${add()};` : ''}\nCOMMIT;`, db);
      const result = execute(down, db);
      if (populated) {
        expect(result.stderr).toMatch(/ERROR:\s+P0001:.*financial_entries holds entries; refusing to drop the ledger/);
        expect(result.stderr.match(/ERROR:/g)).toHaveLength(1);
        success(`
          ${assertSql(`to_regclass('${table}') IS NOT NULL AND
            to_regprocedure('${addSignature}') IS NOT NULL AND to_regprocedure('${voidSignature}') IS NOT NULL`,
        'Refused rollback must leave table and both functions intact')}
          ${assertSql(`SELECT count(*) = 1 FROM ${table}`, 'Refused rollback must preserve existing rows')}
          SELECT set_config('request.jwt.claim.sub', ${uid}::text, false);
          SET test.super_admin = 'on';
          SET ROLE authenticated;
          CREATE TEMP TABLE original AS SELECT * FROM ${add()};
          SELECT ${voidEntry()};
          ${assertSql(`SELECT count(*) = 3 FROM ${table}`, 'Both functions and SELECT policy must still work')}
        `, db);
      } else {
        expect(result.stderr).not.toMatch(/(?:ERROR|FATAL|PANIC):/);
        success(assertSql(`to_regclass('${table}') IS NULL AND
          to_regprocedure('${addSignature}') IS NULL AND to_regprocedure('${voidSignature}') IS NULL`,
        'Empty rollback must drop table and both functions'), db);
      }
    } finally { success(`DROP DATABASE ${db};`, 'postgres'); }
  });

  it('rejects dates before 2020-01-01 and amounts above numeric(12,2) with clear 22023 errors', () => run(`
    ${errorSql(`SELECT ${add({ date: "DATE '2019-12-31'" })}`, '22023', 'invalid_date')}
    ${errorSql(`SELECT ${add({ amount: '10000000000.00' })}`, '22023', 'invalid_amount')}
    SELECT ${add({ date: "DATE '2020-01-01'", amount: '9999999999.99' })};
  `));

  it('is append-only even for the table owner: UPDATE, DELETE and TRUNCATE raise 42501', () => run(`
    CREATE TEMP TABLE original AS SELECT * FROM ${add()};
    ${errorSql(`UPDATE ${table} SET amount = 1`, '42501', 'append-only')}
    ${errorSql(`DELETE FROM ${table}`, '42501', 'append-only')}
    ${errorSql(`TRUNCATE ${table}`, '42501', 'append-only')}
    ${assertSql(`SELECT count(*) = 1 FROM ${table}`, 'The ledger must be untouched')}
  `));
});
