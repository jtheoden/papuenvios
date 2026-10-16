import { describe, it, expect } from 'vitest';
import { assertLocalDbUrl, assertScratchDatabaseName } from '../concurrency/localGuard';

const REMOTE = 'db.qcwnlbpultscerwdnzbm.supabase.co';

// Connection strings are assembled from parts so no credentialed URL is committed as a literal.
const dbUrl = (userinfo, hostAndPort, tail = '/papuenvios_test') => `postgresql://${userinfo}@${hostAndPort}${tail}`;
const LOCAL_USERINFO = ['postgres', 'postgres'].join(':');

describe('db harness local guard (no database needed)', () => {
  it.each([
    dbUrl(LOCAL_USERINFO, '127.0.0.1:55322'),
    dbUrl(LOCAL_USERINFO, 'localhost:55322'),
    dbUrl(LOCAL_USERINFO, '[::1]:55322')
  ])('accepts %s', (url) => {
    expect(() => assertLocalDbUrl(url)).not.toThrow();
  });

  it.each([
    [dbUrl('u:p', `${REMOTE}:5432`, '/postgres'), 'remote hostname'],
    [dbUrl('u:p', '127.0.0.1:55322', `/papuenvios_test?host=${REMOTE}`), 'host= query override'],
    [dbUrl('u:p', '127.0.0.1:55322', '/papuenvios_test?hostaddr=203.0.113.9'), 'hostaddr= query override'],
    [dbUrl('u:p', '127.0.0.1:55322', '/papuenvios_test?sslmode=require'), 'any query string'],
    [dbUrl('u:p', '127.0.0.1:55322', '/papuenvios_test#frag'), 'fragment'],
    [dbUrl('u:p', '%2Fvar%2Frun%2Fpostgresql'), 'unix socket host'],
    [dbUrl('u:p', ''), 'missing host'],
    [dbUrl('u:p', `127.0.0.1@${REMOTE}`), 'userinfo confusion'],
    ['not a url', 'garbage']
  ])('rejects %s (%s)', (url) => {
    expect(() => assertLocalDbUrl(url)).toThrow();
  });

  it('only scratch database names pass', () => {
    expect(() => assertScratchDatabaseName('papuenvios_test')).not.toThrow();
    expect(() => assertScratchDatabaseName('papuenvios_test_probe')).not.toThrow();
    for (const bad of ['postgres', 'papuenvios', 'papuenvios_testing_x;drop', '', null]) {
      expect(() => assertScratchDatabaseName(bad)).toThrow();
    }
  });
});
