// @vitest-environment node
/**
 * Unit tests for scripts/probe-postgrest-contract.mjs (the HTTP probe for Phase 0b contract B).
 * No network: every request goes through an injected fetch. What is pinned here:
 *   - safety guards (target allow-list, production = read-only, hard refusal inside the executor),
 *   - the case matrix (all 9 hidden columns, 5 tables, 2 closed relations, every request shape),
 *   - the evaluator (a denial means HTTP 401/403 AND code 42501, never "any non-2xx"),
 *   - the runner wiring, using an oracle world that answers exactly what each phase expects.
 */
import { describe, it, expect, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import {
  HIDDEN_COLUMNS,
  CLOSED_RELATIONS,
  ADMIN_RPCS,
  ProbeGuardError,
  assertSafeTarget,
  assertRequestAllowed,
  buildCases,
  evaluate,
  executeCase,
  discoverIds,
  runProbe,
  parseArgs,
  readConfig,
  mintJwt,
  formatReport,
  synthesizeResponse
} from '../../../scripts/probe-postgrest-contract.mjs';

const SIGNING_SECRET = 'k'.repeat(43);
const KEYS = { anon: 'ANON-SECRET-KEY', customer: 'CUSTOMER-SECRET-JWT', admin: 'ADMIN-SECRET-JWT' };
const IDS = { product: 'p1', combo: 'c1', category: 'k1', inventory: 'i1', zone: 'z1' };
const ALL_HIDDEN = Object.values(HIDDEN_COLUMNS).flat();

describe('assertSafeTarget', () => {
  it.each([
    'http://localhost:54701',
    'http://127.0.0.1:54701',
    'http://[::1]:54701',
    'http://LOCALHOST:54701'
  ])('accepts the local target %s as mode local', (url) => {
    expect(assertSafeTarget(url, {}).mode).toBe('local');
  });

  it.each([
    'https://qcwnlbpultscerwdnzbm.supabase.co',
    'http://localhost.evil.com',
    'http://127.0.0.1.nip.io',
    'http://localhost.:54701',
    'http://evil.com/localhost',
    'http://10.0.0.5:3000'
  ])('refuses %s without the production flag', (url) => {
    expect(() => assertSafeTarget(url, {})).toThrow(ProbeGuardError);
  });

  it('accepts a https production URL only with the explicit flag, as mode production', () => {
    const target = assertSafeTarget('https://qcwnlbpultscerwdnzbm.supabase.co/rest/v1', { allowProduction: true });
    expect(target.mode).toBe('production');
    expect(target.base).toBe('https://qcwnlbpultscerwdnzbm.supabase.co/rest/v1');
  });

  it('keeps mode local for a local URL even when the production flag is passed', () => {
    expect(assertSafeTarget('http://localhost:1', { allowProduction: true }).mode).toBe('local');
  });

  it.each([
    'http://qcwnlbpultscerwdnzbm.supabase.co',
    'https://user:pw@qcwnlbpultscerwdnzbm.supabase.co',
    'https://localhost@evil.com',
    'http://localhost:1@evil.com',
    'ftp://localhost',
    'not a url',
    ''
  ])('refuses %s even with the production flag', (url) => {
    expect(() => assertSafeTarget(url, { allowProduction: true })).toThrow(ProbeGuardError);
  });
});

describe('assertRequestAllowed', () => {
  const rpc = { method: 'POST', path: '/rpc/admin_list_product_costs' };

  it('allows reads and admin_list RPC calls in production', () => {
    expect(() => assertRequestAllowed({ method: 'GET', path: '/products?select=id' }, { production: true })).not.toThrow();
    expect(() => assertRequestAllowed({ method: 'HEAD', path: '/products?select=id' }, { production: true })).not.toThrow();
    for (const name of Object.keys(ADMIN_RPCS)) {
      expect(() => assertRequestAllowed({ method: 'POST', path: `/rpc/${name}` }, { production: true })).not.toThrow();
    }
  });

  it.each([
    { method: 'PATCH', path: '/products?id=eq.1' },
    { method: 'POST', path: '/products' },
    { method: 'POST', path: '/rpc/some_other_function' },
    { method: 'POST', path: '/rpc/admin_list_product_costs?x=1' },
    { method: 'POST', path: '/rpc/admin_list_product_costs/../products' },
    { method: 'POST', path: '/rpc/admin_list_' },
    { method: 'DELETE', path: '/products?id=eq.1' },
    { method: 'PUT', path: '/products' }
  ])('refuses %j in production', (request) => {
    expect(() => assertRequestAllowed(request, { production: true })).toThrow(ProbeGuardError);
  });

  it('allows writes against a local target but never DELETE or PUT', () => {
    expect(() => assertRequestAllowed({ method: 'PATCH', path: '/products?id=eq.1' }, { production: false })).not.toThrow();
    expect(() => assertRequestAllowed({ method: 'POST', path: '/product_categories' }, { production: false })).not.toThrow();
    expect(() => assertRequestAllowed(rpc, { production: false })).not.toThrow();
    expect(() => assertRequestAllowed({ method: 'DELETE', path: '/products' }, { production: false })).toThrow(ProbeGuardError);
    expect(() => assertRequestAllowed({ method: 'PUT', path: '/products' }, { production: false })).toThrow(ProbeGuardError);
  });

  it('refuses a path that is not relative to the base URL', () => {
    expect(() => assertRequestAllowed({ method: 'GET', path: 'https://evil.com/x' }, { production: false })).toThrow(ProbeGuardError);
    expect(() => assertRequestAllowed({ method: 'GET', path: '//evil.com/x' }, { production: false })).toThrow(ProbeGuardError);
  });
});

describe('buildCases: coverage of the contract', () => {
  const read = buildCases({ writes: false });
  const withWrites = buildCases({ writes: true, ids: IDS, suffix: 'abc123' });

  it('has unique, stable ids', () => {
    const ids = withWrites.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('declares exactly the 9 hidden columns of the contract across the 5 tables', () => {
    expect(Object.keys(HIDDEN_COLUMNS).sort()).toEqual(
      ['combo_products', 'inventory', 'product_categories', 'products', 'shipping_zones']
    );
    expect(ALL_HIDDEN.sort()).toEqual([
      'base_price', 'base_total_price', 'cost_per_unit', 'cost_price', 'profit_margin',
      'profit_margin', 'profit_margin', 'supplier_reference', 'transport_cost'
    ].sort());
    expect(CLOSED_RELATIONS).toEqual(['order_analytics', 'remittance_services']);
  });

  it.each(['anon', 'customer', 'admin'])('probes every hidden column directly, by order, by filter and by head count as %s', (role) => {
    for (const [table, columns] of Object.entries(HIDDEN_COLUMNS)) {
      for (const column of columns) {
        for (const kind of ['direct', 'order', 'filter', 'head-filter']) {
          const found = read.find((c) => c.role === role && c.table === table && c.kind === kind && c.column === column);
          expect(found, `${role} ${table}.${column} ${kind}`).toBeTruthy();
        }
      }
    }
  });

  it.each(['anon', 'customer', 'admin'])('probes select=*, implicit * and or() filters on every guarded table as %s', (role) => {
    for (const table of Object.keys(HIDDEN_COLUMNS)) {
      for (const kind of ['select-star', 'implicit-star', 'or-filter', 'head-count', 'public-columns', 'head-count-public']) {
        expect(read.find((c) => c.role === role && c.table === table && c.kind === kind), `${role} ${table} ${kind}`).toBeTruthy();
      }
    }
    for (const table of CLOSED_RELATIONS) {
      for (const kind of ['closed-star', 'closed-direct', 'closed-head']) {
        expect(read.find((c) => c.role === role && c.table === table && c.kind === kind), `${role} ${table} ${kind}`).toBeTruthy();
      }
    }
  });

  it('covers category, reverse, combo_items and inventory embeds plus a filter on an embedded hidden column', () => {
    const embeds = read.filter((c) => c.kind === 'embed' || c.kind === 'embed-filter');
    const paths = embeds.map((c) => decodeURIComponent(c.path));
    expect(paths.some((p) => p.includes('category:product_categories(id,profit_margin)'))).toBe(true);
    expect(paths.some((p) => p.includes('category:product_categories(*)'))).toBe(true);
    expect(paths.some((p) => p.startsWith('/product_categories') && p.includes('products(id,base_price)'))).toBe(true);
    expect(paths.some((p) => p.includes('combo_items(id,products(id,base_price))'))).toBe(true);
    expect(paths.some((p) => p.startsWith('/combo_items') && p.includes('products(*)'))).toBe(true);
    expect(paths.some((p) => p.includes('inventory(id,cost_per_unit)'))).toBe(true);
    expect(paths.some((p) => p.includes('category.profit_margin=gt.'))).toBe(true);
  });

  it('covers the public embeds the storefront uses (must stay readable after B)', () => {
    const publicEmbeds = read.filter((c) => c.kind === 'public-embed');
    expect(publicEmbeds.length).toBeGreaterThanOrEqual(2 * 3);
    for (const c of publicEmbeds) {
      expect(c.expect['after-b'].type).toBe('ok');
      expect(c.expect['before-b'].type).toBe('ok');
    }
  });

  it('calls the five admin_list_* RPCs as every role with admin the only one allowed', () => {
    for (const name of Object.keys(ADMIN_RPCS)) {
      for (const role of ['anon', 'customer', 'admin']) {
        const c = read.find((x) => x.kind === 'rpc' && x.rpc === name && x.role === role);
        expect(c, `${role} ${name}`).toBeTruthy();
        expect(c.method).toBe('POST');
        for (const phase of ['before-b', 'after-b']) {
          expect(c.expect[phase].type).toBe(role === 'admin' ? 'rpc-ok' : 'denied');
        }
      }
    }
  });

  it('expects every direct/order/filter/embed/star probe on a hidden column to leak before B and be denied after B, for every role', () => {
    for (const c of read.filter((x) => ['direct', 'select-star', 'implicit-star', 'embed'].includes(x.kind))) {
      expect(c.expect['before-b'].type, c.id).toBe('leak');
      expect(c.expect['after-b'].type, c.id).toBe('denied');
    }
    for (const c of read.filter((x) => ['order', 'filter', 'or-filter'].includes(x.kind))) {
      expect(c.expect['before-b'].type, c.id).toBe('ok');
      expect(c.expect['after-b'].type, c.id).toBe('denied');
    }
  });

  it('keeps public columns readable in both phases without exposing hidden keys', () => {
    for (const c of read.filter((x) => x.kind === 'public-columns')) {
      expect(c.expect['before-b']).toMatchObject({ type: 'ok' });
      expect(c.expect['after-b']).toMatchObject({ type: 'ok' });
      expect(c.expect['after-b'].forbidKeys.length).toBeGreaterThan(0);
      expect(c.path).not.toMatch(/select=\*/);
    }
  });

  it('only builds write cases when asked and never in the production set', () => {
    expect(read.every((c) => ['GET', 'HEAD'].includes(c.method) || c.kind === 'rpc')).toBe(true);
    const writes = withWrites.filter((c) => ['PATCH', 'POST'].includes(c.method) && c.kind !== 'rpc');
    expect(writes.length).toBeGreaterThan(10);
    expect(buildCases({ writes: false, production: true }).every((c) => !c.write)).toBe(true);
    expect(buildCases({ writes: true, ids: IDS, production: true }).every((c) => !c.write)).toBe(true);
  });

  it('covers PATCH and POST returning shapes: explicit select, RETURNING *, hidden select, minimal, as admin, customer and anon', () => {
    const w = withWrites.filter((c) => c.write);
    const kinds = new Set(w.map((c) => c.kind));
    for (const k of ['write-returning-public', 'write-returning-star', 'write-returning-hidden', 'write-minimal', 'write-single-object']) {
      expect(kinds.has(k), k).toBe(true);
    }
    const star = w.find((c) => c.kind === 'write-returning-star' && c.role === 'admin' && c.method === 'PATCH');
    expect(star.headers.Prefer).toBe('return=representation');
    expect(star.path).not.toMatch(/select=/);
    expect(star.expect['after-b'].type).toBe('denied');
    const pub = w.find((c) => c.kind === 'write-returning-public' && c.role === 'admin' && c.table === 'products');
    expect(pub.expect['after-b']).toMatchObject({ type: 'ok' });
    expect(w.some((c) => c.role === 'customer')).toBe(true);
    expect(w.some((c) => c.role === 'anon' && c.expect['after-b'].type === 'denied' && c.expect['before-b'].type === 'denied')).toBe(true);
    expect(w.some((c) => c.method === 'POST' && c.table === 'product_categories')).toBe(true);
    expect(w.some((c) => c.method === 'POST' && c.table === 'inventory')).toBe(true);
    expect(w.some((c) => c.method === 'PATCH' && c.table === 'shipping_zones')).toBe(true);
    expect(w.some((c) => c.method === 'PATCH' && c.table === 'combo_products')).toBe(true);
  });

  it('makes every write that must show a leaked value set that value itself (never depends on pre-existing data)', () => {
    for (const c of withWrites.filter((x) => x.write && x.expect['before-b'].type === 'leak')) {
      for (const column of c.expect['before-b'].columns) {
        expect(Object.keys(c.body ?? {}), `${c.id} must write ${column}`).toContain(column);
      }
    }
  });

  it('covers the supabase-js head count shape (select=* with HEAD) on every guarded table and role', () => {
    for (const role of ['anon', 'customer', 'admin']) {
      for (const table of Object.keys(HIDDEN_COLUMNS)) {
        const c = read.find((x) => x.role === role && x.table === table && x.kind === 'head-star');
        expect(c, `${role} ${table}`).toBeTruthy();
        expect(c.method).toBe('HEAD');
        expect(c.path).toBe(`/${table}?select=*`);
        expect(c.expect['before-b'].type).toBe('ok');
        expect(c.expect['after-b'].type).toBe('denied');
      }
    }
  });

  it('uses the real public column lists from src/lib, not copies', () => {
    const products = read.find((c) => c.kind === 'public-columns' && c.table === 'products');
    expect(decodeURIComponent(products.path)).toContain('image_url');
    expect(decodeURIComponent(products.path)).toContain('final_price');
    const zones = read.find((c) => c.kind === 'public-columns' && c.table === 'shipping_zones');
    expect(zones.path).toContain('delivery_days');
  });
});

describe('evaluate', () => {
  const denied = { type: 'denied' };
  const caseWith = (extra) => ({ id: 't', role: 'customer', method: 'GET', expect: {}, ...extra });
  const run = (c, response, phase = 'after-b') => evaluate({ ...c, expect: { 'before-b': c.expect, 'after-b': c.expect } }, response, phase);

  it('passes a denial only with 401/403 and code 42501', () => {
    expect(run(caseWith({ expect: denied }), { status: 403, body: { code: '42501', message: 'permission denied for table products' } }).pass).toBe(true);
    expect(run(caseWith({ role: 'anon', expect: denied }), { status: 401, body: { code: '42501' } }).pass).toBe(true);
  });

  it.each([
    [{ status: 400, body: { code: 'PGRST100', message: 'parse error' } }],
    [{ status: 400, body: { code: '42703', message: 'column does not exist' } }],
    [{ status: 404, body: { code: 'PGRST200', message: 'no relationship' } }],
    [{ status: 403, body: { code: 'PGRST301' } }],
    [{ status: 500, body: { code: 'XX000' } }],
    [{ status: 200, body: [{ base_price: 1 }] }],
    [{ status: 403, body: null }]
  ])('fails a denial that is not a genuine 42501: %j', (response) => {
    expect(run(caseWith({ expect: denied }), response).pass).toBe(false);
  });

  it('judges a HEAD denial by status alone (HEAD has no body)', () => {
    const c = caseWith({ method: 'HEAD', expect: denied });
    expect(run(c, { status: 403, body: null }).pass).toBe(true);
    expect(run(c, { status: 400, body: null }).pass).toBe(false);
    expect(run(c, { status: 200, body: null }).pass).toBe(false);
  });

  it('documents the leak: key present with a non-null value, also inside embeds', () => {
    const leak = { type: 'leak', columns: ['base_price'] };
    expect(run(caseWith({ expect: leak }), { status: 200, body: [{ id: 1, base_price: 5 }] }).pass).toBe(true);
    expect(run(caseWith({ expect: leak }), { status: 200, body: [{ id: 1, nested: [{ base_price: 5 }] }] }).pass).toBe(true);
    expect(run(caseWith({ expect: leak }), { status: 200, body: [] }).pass).toBe(false);
    expect(run(caseWith({ expect: leak }), { status: 200, body: [{ id: 1 }] }).pass).toBe(false);
    expect(run(caseWith({ expect: leak }), { status: 200, body: [{ id: 1, base_price: null }] }).pass).toBe(false);
    expect(run(caseWith({ expect: leak }), { status: 403, body: { code: '42501' } }).pass).toBe(false);
  });

  it('accepts a nullable hidden column (cost_price) as present-but-null, and empty result when rows are not required', () => {
    expect(run(caseWith({ expect: { type: 'leak', columns: ['cost_price'] } }), { status: 200, body: [{ cost_price: null }] }).pass).toBe(true);
    expect(run(caseWith({ expect: { type: 'leak', columns: ['x'], requireRows: false } }), { status: 200, body: [] }).pass).toBe(true);
  });

  it('checks that a public read stays readable and exposes no hidden key', () => {
    const ok = { type: 'ok', forbidKeys: ['base_price'] };
    expect(run(caseWith({ expect: ok }), { status: 200, body: [{ id: 1 }] }).pass).toBe(true);
    expect(run(caseWith({ expect: ok }), { status: 206, body: [{ id: 1 }] }).pass).toBe(true);
    expect(run(caseWith({ expect: ok }), { status: 200, body: [{ id: 1, e: { base_price: 2 } }] }).pass).toBe(false);
    expect(run(caseWith({ expect: ok }), { status: 403, body: { code: '42501' } }).pass).toBe(false);
  });

  it('accepts either outcome for the head/count shapes whose generated SQL is not known in advance, and says which', () => {
    const either = { type: 'either' };
    const c = caseWith({ method: 'HEAD', expect: either });
    expect(run(c, { status: 200, body: null }).pass).toBe(true);
    expect(run(c, { status: 403, body: null }).pass).toBe(true);
    expect(run(c, { status: 500, body: null }).pass).toBe(false);
    expect(run(c, { status: 200, body: null }).observed).toBe('allowed');
    expect(run(c, { status: 403, body: null }).observed).toBe('denied');
  });

  it('passes an admin RPC only with the cost keys present', () => {
    const rpc = { type: 'rpc-ok', keys: ['id', 'base_price'] };
    expect(run(caseWith({ role: 'admin', expect: rpc }), { status: 200, body: [{ id: 1, base_price: 2 }] }).pass).toBe(true);
    expect(run(caseWith({ role: 'admin', expect: rpc }), { status: 200, body: [{ id: 1 }] }).pass).toBe(false);
    expect(run(caseWith({ role: 'admin', expect: rpc }), { status: 403, body: { code: '42501' } }).pass).toBe(false);
  });

  it('never copies response values into the verdict (production prints only keys and counts)', () => {
    const verdict = run(caseWith({ expect: { type: 'ok', forbidKeys: ['base_price'] } }), { status: 200, body: [{ id: 1, base_price: 98765.4321, note: 'TOP-SECRET-COST' }] });
    expect(JSON.stringify(verdict)).not.toContain('98765');
    expect(JSON.stringify(verdict)).not.toContain('TOP-SECRET');
  });
});

describe('executeCase', () => {
  const target = (mode = 'local') => ({ base: 'http://localhost:9', mode });
  const okFetch = () => vi.fn(async () => new Response(JSON.stringify([{ id: 1 }]), { status: 200, headers: { 'content-type': 'application/json' } }));
  const c = (over) => ({ id: 'x', role: 'customer', method: 'GET', path: '/products?select=id', headers: {}, expect: {}, ...over });

  it('sends the role key as apikey and bearer, never follows redirects, and parses json', async () => {
    const fetchImpl = okFetch();
    const res = await executeCase(c({}), { target: target(), keys: KEYS, fetchImpl });
    expect(res).toMatchObject({ status: 200, body: [{ id: 1 }] });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('http://localhost:9/products?select=id');
    expect(init.redirect).toBe('manual');
    expect(init.headers.Authorization).toBe(`Bearer ${KEYS.customer}`);
    expect(init.headers.apikey).toBe(KEYS.anon);
  });

  it('uses the anon key as bearer for the anon role', async () => {
    const fetchImpl = okFetch();
    await executeCase(c({ role: 'anon' }), { target: target(), keys: KEYS, fetchImpl });
    expect(fetchImpl.mock.calls[0][1].headers.Authorization).toBe(`Bearer ${KEYS.anon}`);
  });

  it('serialises JSON bodies and merges case headers', async () => {
    const fetchImpl = okFetch();
    await executeCase(c({ method: 'PATCH', path: '/products?id=eq.1', headers: { Prefer: 'return=representation' }, body: { is_featured: false } }), { target: target(), keys: KEYS, fetchImpl });
    const init = fetchImpl.mock.calls[0][1];
    expect(init.body).toBe('{"is_featured":false}');
    expect(init.headers.Prefer).toBe('return=representation');
    expect(init.headers['Content-Type']).toBe('application/json');
  });

  it('REFUSES any non-read request in production before touching the network', async () => {
    const fetchImpl = okFetch();
    for (const bad of [
      c({ method: 'PATCH', path: '/products?id=eq.1', body: {} }),
      c({ method: 'POST', path: '/products', body: {} }),
      c({ method: 'POST', path: '/rpc/not_listed', body: {} })
    ]) {
      await expect(executeCase(bad, { target: target('production'), keys: KEYS, fetchImpl })).rejects.toThrow(ProbeGuardError);
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('turns a network failure into a status-0 response without leaking the credentials', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error(`boom ${KEYS.admin}`); });
    const res = await executeCase(c({ role: 'admin' }), { target: target(), keys: KEYS, fetchImpl });
    expect(res.status).toBe(0);
    expect(JSON.stringify(res)).not.toContain(KEYS.admin);
  });

  it('handles an empty or non-json body', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }));
    expect((await executeCase(c({}), { target: target(), keys: KEYS, fetchImpl })).body).toBeNull();
  });
});

describe('runProbe (oracle worlds)', () => {
  const cases = buildCases({ writes: true, ids: IDS, suffix: 'abc123' });

  /** A server that answers exactly what `worldPhase` expects for each case. */
  const worldFetch = (worldPhase, list) => vi.fn(async (url, init) => {
    const role = Object.entries(KEYS).find(([, key]) => init.headers.Authorization === `Bearer ${key}`)[0];
    const path = url.replace('http://localhost:9', '');
    const hit = list.find((x) => x.role === role && x.method === init.method && x.path === path
      && (x.headers.Prefer ?? '') === (init.headers.Prefer ?? '') && (x.headers.Accept ?? '') === (init.headers.Accept ?? ''));
    const { status, body } = synthesizeResponse(hit.expect[worldPhase], hit);
    return new Response(body === null ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  });

  const target = { base: 'http://localhost:9', mode: 'local' };

  it.each(['before-b', 'after-b'])('passes every case when the server behaves as %s expects', async (phase) => {
    const report = await runProbe({ target, keys: KEYS, phase, cases, fetchImpl: worldFetch(phase, cases) });
    expect(report.failed).toBe(0);
    expect(report.passed).toBe(cases.length);
  });

  it('reports exactly the denial cases as failures when after-b still behaves like before-b (the leak is open)', async () => {
    const report = await runProbe({ target, keys: KEYS, phase: 'after-b', cases, fetchImpl: worldFetch('before-b', cases) });
    expect(report.failed).toBeGreaterThan(50);
    const failedIds = new Set(report.results.filter((r) => !r.pass).map((r) => r.id));
    for (const c of cases) {
      const wantsDeny = c.expect['after-b'].type === 'denied' && c.expect['before-b'].type !== 'denied';
      expect(failedIds.has(c.id), c.id).toBe(wantsDeny);
    }
  });

  it('formats a report that never contains keys or response values', async () => {
    const report = await runProbe({ target, keys: KEYS, phase: 'before-b', cases, fetchImpl: worldFetch('before-b', cases) });
    const text = formatReport(report, { phase: 'before-b', target, keys: KEYS });
    expect(text).toContain('before-b');
    for (const secret of Object.values(KEYS)) expect(text).not.toContain(secret);
    expect(text).toMatch(/passed/i);
  });

  it('stops before the first request when production is combined with write cases', async () => {
    const fetchImpl = vi.fn();
    await expect(runProbe({ target: { base: 'https://x.supabase.co', mode: 'production' }, keys: KEYS, phase: 'after-b', cases, fetchImpl }))
      .rejects.toThrow(ProbeGuardError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('discoverIds', () => {
  const target = { base: 'http://localhost:9', mode: 'local' };
  const answer = (rows) => vi.fn(async () => new Response(JSON.stringify(rows), { status: 200, headers: { 'content-type': 'application/json' } }));

  it('reads one id per guarded table with the admin key and public columns only', async () => {
    const fetchImpl = answer([{ id: 'row-1' }]);
    const ids = await discoverIds({ target, keys: KEYS, fetchImpl });
    expect(ids).toEqual({ product: 'row-1', combo: 'row-1', category: 'row-1', inventory: 'row-1', zone: 'row-1' });
    for (const [url, init] of fetchImpl.mock.calls) {
      expect(url).toMatch(/\?select=id&order=id&limit=1$/);
      expect(init.headers.Authorization).toBe(`Bearer ${KEYS.admin}`);
    }
  });

  it('fails loudly when a table has no row to patch', async () => {
    await expect(discoverIds({ target, keys: KEYS, fetchImpl: answer([]) })).rejects.toThrow(/no row found in products/);
  });
});

describe('parseArgs / readConfig', () => {
  it('requires a valid phase', () => {
    expect(parseArgs(['--phase=before-b']).phase).toBe('before-b');
    expect(parseArgs(['--phase=after-b']).phase).toBe('after-b');
    expect(() => parseArgs([])).toThrow(/phase/);
    expect(() => parseArgs(['--phase=middle'])).toThrow(/phase/);
  });

  it('reads the production flag, json output and no-writes', () => {
    const a = parseArgs(['--phase=after-b', '--i-understand-this-hits-production', '--json', '--no-writes']);
    expect(a).toMatchObject({ allowProduction: true, json: true, writes: false });
    expect(parseArgs(['--phase=after-b'])).toMatchObject({ allowProduction: false, json: false, writes: true });
  });

  it('accepts --mint=<role> without a phase', () => {
    expect(parseArgs(['--mint=admin']).mint).toBe('admin');
    expect(() => parseArgs(['--mint=root'])).toThrow(/mint/);
  });

  it('rejects unknown flags', () => {
    expect(() => parseArgs(['--phase=after-b', '--force'])).toThrow(/unknown/i);
  });

  it('readConfig names the missing variables without echoing values', () => {
    expect(() => readConfig({ PROBE_BASE_URL: 'http://localhost:1' })).toThrow(/PROBE_ANON_KEY.*PROBE_CUSTOMER_JWT.*PROBE_ADMIN_JWT/s);
    const cfg = readConfig({ PROBE_BASE_URL: 'http://localhost:1', PROBE_ANON_KEY: 'a', PROBE_CUSTOMER_JWT: 'c', PROBE_ADMIN_JWT: 'd' });
    expect(cfg).toEqual({ baseUrl: 'http://localhost:1', keys: { anon: 'a', customer: 'c', admin: 'd' } });
  });
});

describe('mintJwt', () => {
  it('signs an HS256 token that verifies with the same secret', () => {
    const token = mintJwt({ secret: SIGNING_SECRET, role: 'authenticated', sub: 'user-1', now: 1_700_000_000, ttlSeconds: 600 });
    const [h, p, s] = token.split('.');
    expect(JSON.parse(Buffer.from(h, 'base64url').toString())).toEqual({ alg: 'HS256', typ: 'JWT' });
    expect(JSON.parse(Buffer.from(p, 'base64url').toString())).toEqual({ role: 'authenticated', aud: 'authenticated', sub: 'user-1', iat: 1_700_000_000, exp: 1_700_000_600 });
    expect(createHmac('sha256', SIGNING_SECRET).update(`${h}.${p}`).digest('base64url')).toBe(s);
  });

  it('omits sub for the anon role', () => {
    const token = mintJwt({ secret: 's'.repeat(40), role: 'anon', now: 1, ttlSeconds: 10 });
    expect(JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString())).toEqual({ role: 'anon', iat: 1, exp: 11 });
  });

  it('signs with the decoded symmetric key when the secret is a JWKS (the Supabase CLI stack uses {"keys":[{"kty":"oct","k":...}]})', () => {
    const raw = Buffer.from('jwks-symmetric-key-material-for-unit-tests');
    const jwks = JSON.stringify({ keys: [{ kty: 'oct', k: raw.toString('base64url') }] });
    const token = mintJwt({ secret: jwks, role: 'anon', now: 5, ttlSeconds: 5 });
    const [h, p, s] = token.split('.');
    expect(createHmac('sha256', raw).update(`${h}.${p}`).digest('base64url')).toBe(s);
  });

  it('rejects a JWKS without a symmetric key', () => {
    expect(() => mintJwt({ secret: JSON.stringify({ keys: [{ kty: 'EC', x: 'a', y: 'b' }] }), role: 'anon' })).toThrow(/symmetric/);
  });

  it('requires a secret', () => {
    expect(() => mintJwt({ secret: '', role: 'anon' })).toThrow(/secret/);
  });
});
