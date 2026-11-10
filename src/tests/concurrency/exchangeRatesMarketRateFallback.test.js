/**
 * Real PostgreSQL contract for the exchange_rates.market_rate fallback trigger (production schema drift:
 * market_rate NOT NULL without default, not in the repo chain). Uses the guarded local pg harness, or
 * EXRATE_TEST_PG_BIN=/path/to/postgresql/bin for an isolated, disposable standalone backend (no sockets,
 * no remote connections).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { connectAdmin, dbSuiteSkipReason } from './db';

const pgBin = process.env.EXRATE_TEST_PG_BIN;
const skipReason = pgBin ? null : await dbSuiteSkipReason();
const describeDb = skipReason ? describe.skip : describe;
const schema = 'exrate_fallback_test';
const rates = `${schema}.exchange_rates`;
const migration = (direction) => readFileSync(resolve(process.cwd(), direction === 'up'
  ? 'supabase/migrations/20261109120000_exchange_rates_market_rate_fallback.sql'
  : 'supabase/rollbacks/20261109120000_exchange_rates_market_rate_fallback_down.sql'), 'utf8')
  .replaceAll('public', schema).replace(/^\s*(BEGIN|COMMIT);\s*$/gm, '');
const assertSql = (condition, message) => `DO $assert$ BEGIN
  IF NOT COALESCE((${condition}), false) THEN RAISE EXCEPTION '${message}'; END IF;
END $assert$;`;

const A = "'00000000-0000-0000-0000-00000000000a'";
const B = "'00000000-0000-0000-0000-00000000000b'";
const setup = (withMarketRate = true) => `
  CREATE SCHEMA ${schema};
  CREATE TABLE ${rates} (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    from_currency_id uuid NOT NULL, to_currency_id uuid NOT NULL,
    rate numeric NOT NULL,
    ${withMarketRate ? 'market_rate numeric NOT NULL,' : ''}
    effective_date date NOT NULL DEFAULT CURRENT_DATE,
    is_active boolean NOT NULL DEFAULT true,
    UNIQUE (from_currency_id, to_currency_id, effective_date)
  );
`;
const upsert = (rate) => `INSERT INTO ${rates} (from_currency_id, to_currency_id, rate, effective_date, is_active)
  VALUES (${A}, ${B}, ${rate}, '2026-11-09', true)
  ON CONFLICT (from_currency_id, to_currency_id, effective_date)
  DO UPDATE SET rate = EXCLUDED.rate, is_active = true`;
const objectCount = `(SELECT count(*) FROM pg_trigger WHERE tgrelid = '${rates}'::regclass AND NOT tgisinternal)`;
const functionCount = `(SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = '${schema}')`;

describeDb('exchange_rates market_rate fallback against real PostgreSQL', () => {
  let client;
  let dataDir;
  const executeStandalone = (sql, database = 'papuenvios_test_exrate') => {
    const inputFile = join(dataDir, 'scenario.sql');
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
    dataDir = mkdtempSync(join(tmpdir(), 'papuenvios-exrate-sql-'));
    const init = spawnSync(join(pgBin, 'initdb'), ['-D', dataDir, '-U', 'postgres', '-A', 'trust', '--no-locale'], { encoding: 'utf8' });
    expect(init.status, init.stderr).toBe(0);
    standalone('CREATE DATABASE papuenvios_test_exrate;', 'postgres');
  });
  afterAll(async () => {
    if (client) await client.end();
    if (dataDir) rmSync(dataDir, { recursive: true, force: true });
  });

  it('insert without market_rate succeeds and copies rate; explicit market_rate is preserved', async () => {
    await run(`${setup()}
      ${migration('up')}
      INSERT INTO ${rates} (from_currency_id, to_currency_id, rate, effective_date) VALUES (${A}, ${B}, 915, '2026-11-08');
      INSERT INTO ${rates} (from_currency_id, to_currency_id, rate, market_rate, effective_date) VALUES (${B}, ${A}, 0.5, 0.4, '2026-11-08');
      ${assertSql(`SELECT market_rate = 915 FROM ${rates} WHERE from_currency_id = ${A}`, 'market_rate must default to rate')}
      ${assertSql(`SELECT market_rate = 0.4 FROM ${rates} WHERE from_currency_id = ${B}`, 'explicit market_rate must be preserved')}
    `);
  });

  it('same-day upsert keeps the stored market_rate and a fresh upsert gets the fallback', async () => {
    await run(`${setup()}
      ${migration('up')}
      INSERT INTO ${rates} (from_currency_id, to_currency_id, rate, market_rate, effective_date) VALUES (${A}, ${B}, 915, 900, '2026-11-09');
      ${upsert(930)};
      ${assertSql(`SELECT rate = 930 AND market_rate = 900 FROM ${rates}`, 'upsert must keep the owner reference rate')}
      DELETE FROM ${rates};
      ${upsert(915)};
      ${assertSql(`SELECT market_rate = 915 FROM ${rates}`, 'fresh upsert must fall back to rate')}
    `);
  });

  it('is idempotent and a no-op when the column does not exist (repo/CI schema)', async () => {
    await run(`${setup()}
      ${migration('up')}
      ${migration('up')}
      ${assertSql(`${objectCount} = 1`, 'rerun must not duplicate the trigger')}
    `);
    await run(`${setup(false)}
      ${migration('up')}
      ${assertSql(`${objectCount} = 0`, 'no trigger without the column')}
      ${assertSql(`${functionCount} = 0`, 'no function without the column')}
      ${migration('down')}
    `);
  });

  it('rollback removes trigger and function, and inserts without market_rate fail again', async () => {
    await run(`${setup()}
      ${migration('up')}
      ${migration('down')}
      ${assertSql(`${objectCount} = 0`, 'trigger must be gone')}
      ${assertSql(`${functionCount} = 0`, 'function must be gone')}
      DO $insert$ BEGIN
        BEGIN
          INSERT INTO ${rates} (from_currency_id, to_currency_id, rate) VALUES (${A}, ${B}, 1);
          RAISE EXCEPTION 'Expected not_null_violation after rollback';
        EXCEPTION WHEN not_null_violation THEN NULL;
        END;
      END $insert$;
    `);
  });
});
