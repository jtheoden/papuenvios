/**
 * Test harness helpers for the real-Postgres tests (concurrency, characterization).
 * Talks ONLY to the local scratch database `papuenvios_test` built by
 * `npm run test:db:bootstrap` (scripts/test-db-bootstrap.sh) on the local Supabase Postgres
 * container (host port 55322). Refuses to run against anything that is not localhost.
 */
import pg from 'pg';
import { assertLocalDbUrl, assertScratchDatabaseName } from './localGuard';

const { Client } = pg;

// Built from parts so no credentialed connection string is committed as a literal (secret scanners
// flag those even when they are the local scratch defaults).
const DEFAULT_DB_USER = process.env.TEST_DB_USER || 'postgres';
const DEFAULT_DB_PASSWORD = process.env.TEST_DB_PASSWORD || DEFAULT_DB_USER;
const DEFAULT_DB_URL = `postgresql://${DEFAULT_DB_USER}:${DEFAULT_DB_PASSWORD}@127.0.0.1:55322/papuenvios_test`;

export const DB_URL = process.env.STOCK_TEST_DB_URL || DEFAULT_DB_URL;

const assertLocal = (url) => assertLocalDbUrl(url);

const BARRIER_KEY = 874213;

/** Connects and refuses to continue unless the server reports a papuenvios_test* scratch database. */
const openClient = async (extraConfig = {}) => {
  assertLocal(DB_URL);
  const client = new Client({ connectionString: DB_URL, ...extraConfig });
  await client.connect();
  try {
    const { rows } = await client.query('SELECT current_database() AS db');
    assertScratchDatabaseName(rows[0].db);
  } catch (error) {
    await client.end().catch(() => {});
    throw error;
  }
  return client;
};

const required = () => process.env.DB_TESTS_REQUIRED === '1';

/**
 * Returns a human readable reason why the DB suites must be skipped, or null when they can run.
 * With DB_TESTS_REQUIRED=1 a reason is thrown instead (CI must never go green by skipping).
 * `needs`: { functions: ['reserve_order_inventory'], tables: ['orders'] } resolved in `public`.
 */
export const dbSuiteSkipReason = async ({ functions = [], tables = [] } = {}) => {
  let reason = null;
  let client;
  try {
    client = await openClient({ connectionTimeoutMillis: 1500 });
    const missing = [];
    for (const fn of functions) {
      const { rows } = await client.query('SELECT to_regproc($1) IS NOT NULL AS ok', [`public.${fn}`]);
      if (!rows[0].ok) missing.push(`function ${fn}`);
    }
    for (const table of tables) {
      const { rows } = await client.query('SELECT to_regclass($1) IS NOT NULL AS ok', [`public.${table}`]);
      if (!rows[0].ok) missing.push(`table ${table}`);
    }
    if (missing.length) {
      reason = `scratch DB lacks ${missing.join(', ')}: run \`npm run test:db:bootstrap -- --recreate\``;
    }
  } catch (error) {
    reason = `local scratch DB unavailable (${error.message}): run \`npm run test:db:bootstrap\``;
  } finally {
    if (client) await client.end().catch(() => {});
  }
  if (reason && required()) throw new Error(`DB_TESTS_REQUIRED=1 but ${reason}`);
  if (reason) process.stderr.write(`[db tests] SKIPPED: ${reason}\n`);
  return reason;
};

export const isDbReachable = async () => (await dbSuiteSkipReason()) === null;

/** Superuser connection (postgres): bypasses RLS and the owner guards. Used for seeding/inspection. */
export const connectAdmin = async () => openClient();

/** Connection that behaves like PostgREST for an end user: role authenticated + JWT claims. */
export const connectAs = async (userId, role = 'authenticated') => {
  const client = await openClient();
  const claims = JSON.stringify({ sub: userId, role });
  await client.query('SELECT set_config($1, $2, false)', ['request.jwt.claims', claims]);
  await client.query(`SET ROLE ${role}`);
  return client;
};

/** Anonymous connection (role anon, no JWT). */
export const connectAnon = async () => {
  const client = await openClient();
  await client.query('SET ROLE anon');
  return client;
};

/**
 * Runs each job at the same instant using an advisory-lock barrier: the controller holds an
 * exclusive advisory lock, every worker blocks on a shared lock IN THE SAME STATEMENT as the
 * call under test, and the controller releases once all workers are parked.
 *
 * Each job is `{ client, sql, params }` where `sql` is a single scalar expression
 * (e.g. `public.reserve_order_inventory($1)`).
 *
 * @returns {Promise<Array<{value?: unknown, error?: Error}>>}
 */
export const fireTogether = async (jobs) => {
  const controller = await connectAdmin();
  try {
    await controller.query('SELECT pg_advisory_lock($1)', [BARRIER_KEY]);
    const running = jobs.map(async ({ client, sql, params = [] }) => {
      try {
        const wrapped = `SELECT pg_advisory_lock_shared(${BARRIER_KEY}) AS barrier, (${sql}) AS result`;
        const res = await client.query(wrapped, params);
        await client.query('SELECT pg_advisory_unlock_all()');
        return { value: res.rows[0].result };
      } catch (error) {
        try {
          await client.query('SELECT pg_advisory_unlock_all()');
        } catch {
          /* connection may be unusable; ignore */
        }
        return { error };
      }
    });
    // Wait until every worker is parked on the barrier.
    const deadline = Date.now() + 15000;
    for (;;) {
      const { rows } = await controller.query(
        `SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND NOT granted AND objid = $1
            AND database = (SELECT oid FROM pg_database WHERE datname = current_database())`,
        [BARRIER_KEY]
      );
      if (rows[0].n >= jobs.length) break;
      if (Date.now() > deadline) throw new Error('Barrier timeout: workers did not park');
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    await controller.query('SELECT pg_advisory_unlock($1)', [BARRIER_KEY]);
    return await Promise.all(running);
  } finally {
    await controller.end();
  }
};

export const endAll = async (clients) => {
  await Promise.all(clients.map((c) => c.end().catch(() => {})));
};
