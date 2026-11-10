/**
 * Real PostgreSQL contract for production's drifted Zelle schema and the repo schema.
 * Normally uses the guarded local pg harness. In socket-restricted sandboxes, run with
 * ZELLE_TEST_PG_BIN=/path/to/postgresql/bin to use an isolated, disposable standalone
 * backend instead. No remote connections or installed database schemas are modified.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { connectAdmin, dbSuiteSkipReason } from './db';

const pgBin = process.env.ZELLE_TEST_PG_BIN;
const skipReason = pgBin ? null : await dbSuiteSkipReason();
const describeDb = skipReason ? describe.skip : describe;
const schema = 'zelle_phone_first_test';
const backup = `${schema}.zelle_accounts_visibility_backup_20261107`;
const accounts = `${schema}.zelle_accounts`;
const migration = (direction) => readFileSync(resolve(process.cwd(), direction === 'up'
  ? 'supabase/migrations/20261107100000_zelle_accounts_phone_first_visibility.sql'
  : 'supabase/rollbacks/20261107100000_zelle_accounts_phone_first_visibility_down.sql'), 'utf8')
  // Keep the migration's logic intact; isolate its objects from shared scratch fixtures.
  .replaceAll('public', schema).replace(/^\s*(BEGIN|COMMIT);\s*$/gm, '');
const assertSql = (condition, message) => `DO $assert$ BEGIN
  IF NOT COALESCE((${condition}), false) THEN RAISE EXCEPTION '${message}'; END IF;
END $assert$;`;

const setup = (withContactType = true) => `
  CREATE SCHEMA ${schema};
  CREATE TABLE ${accounts} (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email text NULL, phone text NULL,
    show_email boolean NOT NULL, show_phone boolean NOT NULL,
    account_name text NOT NULL DEFAULT 'Preserve this name',
    ${withContactType ? `contact_type text NULL DEFAULT 'email',
      CONSTRAINT contact_type_has_value CHECK (
        (contact_type = 'email' AND email IS NOT NULL AND btrim(email) <> '') OR
        (contact_type = 'phone' AND phone IS NOT NULL AND btrim(phone) <> '')),
      CONSTRAINT zelle_accounts_contact_type_check CHECK (contact_type IN ('email', 'phone')),` : ''}
    CONSTRAINT at_least_one_contact CHECK (
      (email IS NOT NULL AND btrim(email) <> '') OR (phone IS NOT NULL AND btrim(phone) <> '')),
    CONSTRAINT zelle_accounts_at_least_one_contact_visible CHECK (show_email OR show_phone)
  );
  INSERT INTO ${accounts} (id, email, phone, show_email, show_phone)
  SELECT ('00000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid,
    'account' || n || '@example.com', '+1555123456' || n, true, true FROM generate_series(1,6) n;
  INSERT INTO ${accounts} (email, phone, show_email, show_phone) VALUES
    ('blank@example.com', '   ', true, false), ('dash@example.com', '-', true, false),
    ('space@example.com', E'\t\n ', true, false), ('null@example.com', NULL, true, false),
    ('already-phone@example.com', '+15557654321', false, true);
  CREATE TEMP TABLE originals ON COMMIT DROP AS SELECT * FROM ${accounts};
`;

const id = (n) => `'00000000-0000-0000-0000-${String(n).padStart(12, '0')}'`;

// SQL assertions run unchanged through either real PostgreSQL execution path.
describeDb('Zelle phone-first migration against real PostgreSQL', () => {
  let client;
  let dataDir;
  // A regular file avoids PostgreSQL's standalone reader spinning on Node's
  // nonblocking stdin pipe after EOF. This backend never opens a socket.
  const executeStandalone = (sql, database = 'papuenvios_test_zelle') => {
    const inputFile = join(dataDir, 'scenario.sql');
    // -j terminates input on an empty line, even inside a dollar-quoted body.
    writeFileSync(inputFile, `${sql.split('\n').filter((line) => line.trim()).join('\n')}\n\n`);
    const fd = openSync(inputFile, 'r');
    try {
      return spawnSync(join(pgBin, 'postgres'), ['--single', '-j', '-D', dataDir, database], {
        stdio: [fd, 'pipe', 'pipe'], encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout: 15000,
        env: { ...process.env, LC_ALL: 'C' }
      });
    } finally { closeSync(fd); }
  };
  const standalone = (sql, database) => {
    const result = executeStandalone(sql, database);
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).not.toMatch(/(?:ERROR|FATAL|PANIC):/);
  };
  const run = async (sql) => {
    const transaction = `BEGIN;\n${sql}\nROLLBACK;`;
    if (pgBin) standalone(transaction);
    else {
      try { await client.query(transaction); }
      finally { await client.query('ROLLBACK'); }
    }
  };

  beforeAll(async () => {
    if (!pgBin) { client = await connectAdmin(); return; }
    dataDir = mkdtempSync(join(tmpdir(), 'papuenvios-zelle-sql-'));
    const init = spawnSync(join(pgBin, 'initdb'), ['-D', dataDir, '-U', 'postgres', '-A', 'trust', '--no-locale'], { encoding: 'utf8' });
    expect(init.status, init.stderr).toBe(0);
    standalone('CREATE DATABASE papuenvios_test_zelle;', 'postgres');
    standalone('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;');
  });
  afterAll(async () => {
    if (client) await client.end();
    if (dataDir) rmSync(dataDir, { recursive: true, force: true });
  });

  it('backs up every row, converts six production accounts without changing contacts or other columns, and enforces all CHECKs', async () => {
    await run(`${setup()}
      ${migration('up')}
      ${assertSql(`SELECT count(*) = 6 FROM ${accounts} WHERE id IN (${[1,2,3,4,5,6].map(id)}) AND NOT show_email AND show_phone AND contact_type = 'phone'`, 'Production accounts must become phone-only')}
      ${assertSql(`SELECT count(*) = 11 FROM ${backup}`, 'Every account must be backed up')}
      ${assertSql(`NOT EXISTS (SELECT 1 FROM ${accounts} a JOIN originals o USING(id)
        WHERE (to_jsonb(a) - 'show_email' - 'show_phone' - 'contact_type') IS DISTINCT FROM
              (to_jsonb(o) - 'show_email' - 'show_phone' - 'contact_type'))`, 'Contacts and unrelated columns must remain intact')}
      ${assertSql(`NOT EXISTS (SELECT 1 FROM ${backup} b JOIN originals o ON o.id = b.account_id
        WHERE (b.show_email, b.show_phone, b.contact_type) IS DISTINCT FROM (o.show_email, o.show_phone, o.contact_type))`, 'Original flags and type must be backed up')}
      ${assertSql(`SELECT count(*) = 4 FROM ${accounts} WHERE email IN ('blank@example.com','dash@example.com','space@example.com','null@example.com') AND show_email AND NOT show_phone AND contact_type = 'email'`, 'Unusable phones must be untouched')}
      UPDATE ${accounts} SET account_name = account_name;
      ${assertSql(`SELECT count(*) = 4 AND bool_and(convalidated) FROM pg_constraint WHERE conrelid = '${accounts}'::regclass AND contype = 'c'`, 'All production CHECKs must remain validated')}
      ${assertSql(`SELECT relrowsecurity FROM pg_class WHERE oid = '${backup}'::regclass`, 'Backup requires RLS')}
      ${assertSql(`NOT has_table_privilege('anon', '${backup}', 'SELECT') AND NOT has_table_privilege('authenticated', '${backup}', 'SELECT') AND has_table_privilege('service_role', '${backup}', 'SELECT,INSERT,UPDATE,DELETE')`, 'Backup access must be restricted')}
    `);
  });

  it('reruns do not overwrite admin edits or the original backup; rollback preserves later flag/type edits', async () => {
    await run(`${setup()}
      ${migration('up')}
      UPDATE ${accounts} SET show_email = true, show_phone = false, contact_type = 'email' WHERE id = ${id(1)};
      UPDATE ${accounts} SET contact_type = 'email' WHERE id = ${id(2)};
      UPDATE ${accounts} SET show_email = true WHERE id = ${id(3)};
      CREATE TEMP TABLE after_admin ON COMMIT DROP AS SELECT * FROM ${accounts};
      CREATE TEMP TABLE first_backup ON COMMIT DROP AS SELECT * FROM ${backup};
      ${migration('up')}
      ${assertSql(`NOT EXISTS (SELECT * FROM ${accounts} EXCEPT SELECT * FROM after_admin)`, 'Rerun must not change admin decisions')}
      ${assertSql(`NOT EXISTS (SELECT * FROM ${backup} EXCEPT SELECT * FROM first_backup)`, 'Rerun must preserve the first backup')}
      ${migration('down')}
      ${assertSql(`NOT EXISTS (SELECT * FROM ${accounts} WHERE id IN (${id(1)},${id(2)},${id(3)}) EXCEPT SELECT * FROM after_admin WHERE id IN (${id(1)},${id(2)},${id(3)}))`, 'Rollback must preserve later flag or type edits')}
      ${assertSql(`NOT EXISTS (SELECT * FROM ${accounts} WHERE id NOT IN (${id(1)},${id(2)},${id(3)}) EXCEPT SELECT * FROM originals WHERE id NOT IN (${id(1)},${id(2)},${id(3)}))`, 'Rollback must restore untouched migrated accounts')}
      ${assertSql(`to_regclass('${backup}') IS NULL`, 'Rollback must drop backup')}
    `);
  });

  it('rollback never restores an account the migration did not modify, or a newly created account', async () => {
    await run(`${setup()}
      ${migration('up')}
      UPDATE ${accounts} SET show_email = false, show_phone = true, contact_type = 'phone' WHERE email = 'dash@example.com';
      INSERT INTO ${accounts} (email,phone,show_email,show_phone,contact_type) VALUES (NULL,'1234567',false,true,'phone');
      ${migration('down')}
      ${assertSql(`SELECT NOT show_email AND show_phone AND contact_type = 'phone' FROM ${accounts} WHERE email = 'dash@example.com'`, 'Unmigrated admin edit must survive')}
      ${assertSql(`SELECT count(*) = 1 FROM ${accounts} WHERE email IS NULL AND phone = '1234567' AND contact_type = 'phone'`, 'New accounts must survive')}
    `);
  });

  it('runs and rolls back without contact_type in the repo/CI schema', async () => {
    await run(`${setup(false)}
      ${migration('up')}
      ${assertSql(`SELECT count(*) = 7 FROM ${accounts} WHERE NOT show_email AND show_phone`, 'Repo accounts must become phone-only')}
      UPDATE ${accounts} SET show_email = true, show_phone = false WHERE id = ${id(1)};
      ${migration('up')}
      ${assertSql(`SELECT show_email AND NOT show_phone FROM ${accounts} WHERE id = ${id(1)}`, 'Repo rerun must preserve admin edit')}
      ${migration('down')}
      ${assertSql(`NOT EXISTS (SELECT * FROM ${accounts} WHERE id <> ${id(1)} EXCEPT SELECT * FROM originals WHERE id <> ${id(1)})`, 'Repo rollback must restore original flags')}
      ${assertSql(`SELECT show_email AND NOT show_phone FROM ${accounts} WHERE id = ${id(1)}`, 'Repo rollback must preserve admin edit')}
    `);
  });

  it('accepts a phone-only NULL-email insert only with the matching contact_type', async () => {
    await run(`${setup()}
      INSERT INTO ${accounts} (phone,email,show_phone,show_email,contact_type) VALUES ('1234567',NULL,true,false,'phone');
      DO $insert$ BEGIN
        BEGIN
          INSERT INTO ${accounts} (phone,email,show_phone,show_email,contact_type) VALUES ('1234567',NULL,true,false,'email');
          RAISE EXCEPTION 'Expected contact_type_has_value to reject email type with NULL email';
        EXCEPTION WHEN check_violation THEN
          IF SQLERRM NOT LIKE '%contact_type_has_value%' THEN RAISE; END IF;
        END;
      END $insert$;
    `);
  });

  it('aborts rollback safely when the backup is missing', async () => {
    const sql = `${setup()} ${migration('down')}`;
    if (pgBin) {
      const result = executeStandalone(`BEGIN; ${sql}\n\nROLLBACK;`);
      expect(result.stderr).toMatch(/ERROR:.*backup.*missing/i);
    } else {
      await expect(run(sql)).rejects.toThrow(/backup.*missing/i);
    }
  });
});
