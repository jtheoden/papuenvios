/**
 * Test harness helpers for the stock reservation concurrency tests.
 * Talks ONLY to the local Supabase Postgres (docker container supabase_db_e2e-supabase).
 * Refuses to run against anything that is not localhost.
 */
import pg from 'pg';

const { Client } = pg;

export const DB_URL =
  process.env.STOCK_TEST_DB_URL || 'postgresql://postgres:postgres@127.0.0.1:55322/postgres';

const assertLocal = (url) => {
  const host = new URL(url).hostname;
  if (!['127.0.0.1', 'localhost', '::1'].includes(host)) {
    throw new Error(`Refusing to run concurrency tests against non-local host: ${host}`);
  }
};

const BARRIER_KEY = 874213;

export const isDbReachable = async () => {
  try {
    assertLocal(DB_URL);
    const client = new Client({ connectionString: DB_URL, connectionTimeoutMillis: 1500 });
    await client.connect();
    await client.end();
    return true;
  } catch {
    return false;
  }
};

/** Superuser connection (postgres): bypasses RLS and the owner guards. Used for seeding/inspection. */
export const connectAdmin = async () => {
  assertLocal(DB_URL);
  const client = new Client({ connectionString: DB_URL });
  await client.connect();
  return client;
};

/** Connection that behaves like PostgREST for an end user: role authenticated + JWT claims. */
export const connectAs = async (userId, role = 'authenticated') => {
  assertLocal(DB_URL);
  const client = new Client({ connectionString: DB_URL });
  await client.connect();
  const claims = JSON.stringify({ sub: userId, role });
  await client.query('SELECT set_config($1, $2, false)', ['request.jwt.claims', claims]);
  await client.query(`SET ROLE ${role}`);
  return client;
};

/** Anonymous connection (role anon, no JWT). */
export const connectAnon = async () => {
  assertLocal(DB_URL);
  const client = new Client({ connectionString: DB_URL });
  await client.connect();
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
        `SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND NOT granted AND objid = $1`,
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
