/**
 * Safety checks for the real-Postgres test harness. Pure functions (no database needed) so they can be
 * unit-tested. The connection string is parsed with the SAME parser node-postgres uses
 * (pg-connection-string): `new URL().hostname` does not see `?host=` / `?hostaddr=` overrides that
 * the driver honours.
 */
import { parse } from 'pg-connection-string';

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const SCRATCH_DB = /^papuenvios_test[a-z0-9_]*$/;

export const assertLocalDbUrl = (url) => {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('Refusing to run: the database URL is not a valid URL');
  }
  if (parsed.search || parsed.hash) {
    throw new Error('Refusing to run: the database URL must not carry a query string or fragment');
  }
  const config = parse(url);
  for (const key of ['host', 'hostaddr']) {
    const value = config[key];
    if (key === 'host' && !value) throw new Error('Refusing to run: the database URL needs an explicit local host');
    if (value && !LOCAL_HOSTS.has(String(value))) {
      throw new Error(`Refusing to run concurrency tests against non-local ${key}: ${value}`);
    }
  }
};

export const assertScratchDatabaseName = (name) => {
  if (typeof name !== 'string' || !SCRATCH_DB.test(name)) {
    throw new Error(`Refusing to run: connected database '${name}' is not a papuenvios_test* scratch database`);
  }
};
