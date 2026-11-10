#!/usr/bin/env node
/**
 * HTTP probe for the Phase 0b contract (B): what PostgREST really does with column-level SELECT grants.
 *
 * The SQL harness (src/tests/concurrency) proves the grants with SET ROLE; it cannot prove what PostgREST
 * generates (`select=*`, ordering/filtering by a hidden column, embeds, HEAD+count, PATCH/POST with
 * `Prefer: return=representation`). This probe sends those exact requests as anon / customer / admin and
 * asserts the expected outcome per phase:
 *
 *   --phase=before-b  contract NOT applied: the hidden columns ARE readable (documents the leak).
 *   --phase=after-b   contract applied: any touch of a hidden column is 401/403 with code 42501, public
 *                     columns stay readable, admin cost reads work only through the admin_list_* RPCs.
 *
 * Configuration (environment only, nothing is written anywhere):
 *   PROBE_BASE_URL, PROBE_ANON_KEY, PROBE_CUSTOMER_JWT, PROBE_ADMIN_JWT
 *
 * Safety:
 *   - refuses any target that is not localhost / 127.0.0.1 / ::1 unless --i-understand-this-hits-production;
 *   - against production it only ever sends GET, HEAD and POST /rpc/admin_list_* (all reads). The executor
 *     enforces this again, whatever the case list says;
 *   - redirects are never followed; keys and response values are never printed (names and counts only).
 *
 * See .claude/docs/runbook_phase0b_postgrest_probe.md.
 */
import { createHmac } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import {
  PUBLIC_READABLE_COLUMNS,
  PUBLIC_PRODUCT_COLUMNS,
  PUBLIC_COMBO_COLUMNS,
  PUBLIC_CATEGORY_COLUMNS,
  PUBLIC_INVENTORY_COLUMNS,
  PUBLIC_COMBO_ITEM_COLUMNS,
  PUBLIC_PRODUCT_CATEGORY_EMBED
} from '../src/lib/publicCatalogColumns.js';
import { ADMIN_SHIPPING_COLUMNS } from '../src/lib/adminCatalogColumns.js';

// ---------------------------------------------------------------------------------------------------------
// Contract definition (mirrors supabase/contract/20261016160100_phase0b_contract_revoke_cost_columns.sql)
// ---------------------------------------------------------------------------------------------------------

export const HIDDEN_COLUMNS = {
  products: ['base_price', 'cost_price', 'profit_margin'],
  combo_products: ['base_total_price', 'profit_margin'],
  product_categories: ['profit_margin'],
  inventory: ['cost_per_unit', 'supplier_reference'],
  shipping_zones: ['transport_cost']
};

/** Relations whose whole SELECT is revoked by B, with one sensitive column to probe by name. */
export const CLOSED_RELATIONS = ['order_analytics', 'remittance_services'];
const CLOSED_COLUMN = { order_analytics: 'transport_cost', remittance_services: 'profit_margin' };

/** Keys each admin_list_* RPC returns (migration 20261016160000). */
export const ADMIN_RPCS = {
  admin_list_product_costs: ['id', 'base_price', 'profit_margin'],
  admin_list_combo_costs: ['id', 'base_total_price', 'profit_margin'],
  admin_list_category_margins: ['id', 'profit_margin'],
  admin_list_inventory_costs: ['id', 'product_id', 'cost_per_unit', 'supplier_reference'],
  admin_list_shipping_zone_costs: ['id', 'transport_cost']
};

/** Hidden columns that are legitimately NULL in production rows (cost_price is NULL in all 53 products). */
const NULLABLE_HIDDEN = new Set(['cost_price']);
const ALL_HIDDEN = [...new Set(Object.values(HIDDEN_COLUMNS).flat())];
const ROLES = ['anon', 'customer', 'admin'];
const PHASES = ['before-b', 'after-b'];
const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]']);
const ADMIN_RPC_PATH = new RegExp(`^/rpc/(${Object.keys(ADMIN_RPCS).join('|')})$`);

export class ProbeGuardError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ProbeGuardError';
  }
}

// ---------------------------------------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------------------------------------

/**
 * Validates the target. Exact hostname match only (no suffix/prefix logic): `localhost.evil.com`,
 * `127.0.0.1.nip.io`, `localhost.` and `user@host` tricks all end up as "not local".
 */
export function assertSafeTarget(rawUrl, { allowProduction = false } = {}) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new ProbeGuardError('PROBE_BASE_URL is not a valid URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ProbeGuardError(`unsupported protocol ${url.protocol}`);
  }
  if (url.username || url.password) {
    throw new ProbeGuardError('credentials inside the URL are not accepted');
  }
  const base = `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
  if (LOCAL_HOSTNAMES.has(url.hostname)) return { base, mode: 'local', hostname: url.hostname };
  if (!allowProduction) {
    throw new ProbeGuardError(
      `refusing non-local target ${url.hostname}; pass --i-understand-this-hits-production to run the READ-ONLY probe against it`
    );
  }
  if (url.protocol !== 'https:') throw new ProbeGuardError('a non-local target must use https');
  return { base, mode: 'production', hostname: url.hostname };
}

/** Last line of defence, called by the executor for EVERY request, whatever built the case. */
export function assertRequestAllowed({ method, path }, { production }) {
  const verb = String(method).toUpperCase();
  if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//')) {
    throw new ProbeGuardError(`request path must be relative to the base URL (got ${String(path).slice(0, 40)})`);
  }
  if (verb === 'GET' || verb === 'HEAD') return;
  if (production) {
    if (verb === 'POST' && ADMIN_RPC_PATH.test(path)) return;
    throw new ProbeGuardError(`production mode is read-only: ${verb} ${path.split('?')[0]} refused`);
  }
  if (verb === 'POST' || verb === 'PATCH') return;
  throw new ProbeGuardError(`${verb} is never sent by this probe`);
}

// ---------------------------------------------------------------------------------------------------------
// Case matrix
// ---------------------------------------------------------------------------------------------------------

const compact = (list) => list.replace(/\s+/g, '');
const PREFER_COUNT = { Prefer: 'count=exact' };
const REPRESENTATION = { Prefer: 'return=representation' };

const publicColumnsOf = (table) => (
  table === 'shipping_zones' ? compact(ADMIN_SHIPPING_COLUMNS) : PUBLIC_READABLE_COLUMNS[table].join(',')
);

const leak = (columns, extra = {}) => ({ type: 'leak', columns, ...extra });
const denied = () => ({ type: 'denied' });
const okExpect = (extra = {}) => ({ type: 'ok', ...extra });
const both = (before, after) => ({ 'before-b': before, 'after-b': after });
const same = (expectation) => both(expectation, expectation);

function readCases() {
  const cases = [];
  const add = (role, table, kind, over) => cases.push({
    id: `${table}|${role}|${kind}${over.column ? `|${over.column}` : ''}${over.variant ? `|${over.variant}` : ''}`,
    group: kind,
    role,
    table,
    kind,
    method: 'GET',
    headers: {},
    ...over
  });

  for (const role of ROLES) {
    for (const [table, hidden] of Object.entries(HIDDEN_COLUMNS)) {
      add(role, table, 'select-star', { path: `/${table}?select=*&limit=1`, expect: both(leak(hidden), denied()) });
      add(role, table, 'implicit-star', { path: `/${table}?limit=1`, expect: both(leak(hidden), denied()) });
      for (const column of hidden) {
        add(role, table, 'direct', { column, path: `/${table}?select=id,${column}&limit=1`, expect: both(leak([column]), denied()) });
        add(role, table, 'order', { column, path: `/${table}?select=id&order=${column}.desc&limit=1`, expect: both(okExpect(), denied()) });
        add(role, table, 'filter', { column, path: `/${table}?select=id&${column}=not.is.null&limit=1`, expect: both(okExpect(), denied()) });
        add(role, table, 'head-filter', {
          column, method: 'HEAD', headers: PREFER_COUNT, path: `/${table}?select=id&${column}=not.is.null`, expect: both(okExpect(), denied())
        });
      }
      const first = hidden[0];
      add(role, table, 'or-filter', {
        column: first, path: `/${table}?select=id&or=(${first}.is.null,${first}.not.is.null)&limit=1`, expect: both(okExpect(), denied())
      });
      // No select on a bare HEAD: whether PostgREST emits table.* here is not known in advance, both
      // outcomes are non-leaky (a count carries no cost value); the report says which one happened.
      add(role, table, 'head-count', { method: 'HEAD', headers: PREFER_COUNT, path: `/${table}`, expect: same({ type: 'either' }) });
      add(role, table, 'public-columns', {
        path: `/${table}?select=${publicColumnsOf(table)}&limit=1`, expect: same(okExpect({ forbidKeys: hidden }))
      });
      // supabase-js `.select('*', { count: 'exact', head: true })`.
      add(role, table, 'head-star', { method: 'HEAD', headers: PREFER_COUNT, path: `/${table}?select=*`, expect: both(okExpect(), denied()) });
      add(role, table, 'head-count-public', { method: 'HEAD', headers: PREFER_COUNT, path: `/${table}?select=id`, expect: same(okExpect()) });
    }

    // Embeds: a hidden column reached through a relationship is still a hidden column.
    const embed = (variant, path, columns) => add(role, 'products', 'embed', { variant, path, expect: both(leak(columns), denied()) });
    embed('category-profit-margin', '/products?select=id,category:product_categories(id,profit_margin)', ['profit_margin']);
    embed('category-star', '/products?select=id,category:product_categories(*)', ['profit_margin']);
    embed('reverse-category-products', '/product_categories?select=id,products(id,base_price)', ['base_price']);
    embed('combo-items-products', '/combo_products?select=id,combo_items(id,products(id,base_price))', ['base_price']);
    embed('combo-items-star', '/combo_items?select=*,products(*)', ['base_price']);
    embed('inventory-cost', '/products?select=id,inventory(id,cost_per_unit)', ['cost_per_unit']);
    add(role, 'products', 'embed-filter', {
      variant: 'filter-on-embedded-hidden',
      path: '/products?select=id,category:product_categories!inner(id)&category.profit_margin=gt.0&limit=1',
      expect: both(okExpect(), denied())
    });

    // The public storefront shapes (src/lib/publicCatalogColumns.js) must keep working after B.
    const publicEmbed = (variant, path) => add(role, 'products', 'public-embed', { variant, path, expect: same(okExpect({ forbidKeys: ALL_HIDDEN })) });
    publicEmbed('combo-items', `/combo_items?select=${compact(PUBLIC_COMBO_ITEM_COLUMNS)}`);
    publicEmbed('product-category', `/products?select=${compact(PUBLIC_PRODUCT_COLUMNS)},${compact(PUBLIC_PRODUCT_CATEGORY_EMBED)}&limit=5`);
    publicEmbed('combo-with-items', `/combo_products?select=${compact(PUBLIC_COMBO_COLUMNS)},combo_items(product_id,quantity,products(id,name_es,name_en))`);
    add(role, 'combo_items', 'public-star', { path: '/combo_items?select=*&limit=1', expect: same(okExpect({ forbidKeys: ALL_HIDDEN })) });

    // Closed relations: anon never had SELECT; authenticated loses it with B.
    for (const table of CLOSED_RELATIONS) {
      const column = CLOSED_COLUMN[table];
      const before = role === 'anon' ? denied() : leak([column], { requireRows: false });
      add(role, table, 'closed-star', { path: `/${table}?select=*&limit=1`, expect: both(before, denied()) });
      add(role, table, 'closed-direct', { column, path: `/${table}?select=${column}&limit=1`, expect: both(before, denied()) });
      add(role, table, 'closed-head', {
        method: 'HEAD', headers: PREFER_COUNT, path: `/${table}?select=*`, expect: both(role === 'anon' ? denied() : okExpect(), denied())
      });
    }

    // admin_list_* RPCs: admin only (A stays applied in both phases).
    for (const [rpc, keys] of Object.entries(ADMIN_RPCS)) {
      add(role, 'rpc', 'rpc', {
        rpc, variant: rpc, method: 'POST', path: `/rpc/${rpc}`, body: { p_limit: 5 },
        expect: same(role === 'admin' ? { type: 'rpc-ok', keys } : denied())
      });
    }
  }
  return cases;
}

// Every PATCH body writes the table's hidden columns itself, so a leak is shown by the value the request just
// wrote (writing a hidden column stays allowed after B: only SELECT is revoked) and never depends on seed data.
const WRITE_TARGETS = (ids) => [
  { table: 'products', id: ids.product, select: compact(PUBLIC_PRODUCT_COLUMNS), hidden: 'base_price', star: ['base_price', 'profit_margin'], body: { is_active: true, base_price: 12.34, profit_margin: 25 } },
  { table: 'combo_products', id: ids.combo, select: compact(PUBLIC_COMBO_COLUMNS), hidden: 'base_total_price', star: ['base_total_price', 'profit_margin'], body: { is_active: true, base_total_price: 20.5, profit_margin: 30 } },
  { table: 'product_categories', id: ids.category, select: compact(PUBLIC_CATEGORY_COLUMNS), hidden: 'profit_margin', star: ['profit_margin'], body: { is_active: true, profit_margin: 15 } },
  { table: 'inventory', id: ids.inventory, select: compact(PUBLIC_INVENTORY_COLUMNS), hidden: 'cost_per_unit', star: ['cost_per_unit', 'supplier_reference'], body: { is_active: true, cost_per_unit: 2.5, supplier_reference: 'SUPPLIER-PROBE' } },
  { table: 'shipping_zones', id: ids.zone, select: compact(ADMIN_SHIPPING_COLUMNS), hidden: 'transport_cost', star: ['transport_cost'], body: { is_active: true, transport_cost: 3.5 } }
];

function writeCases(ids, suffix) {
  const cases = [];
  const add = (role, table, kind, over) => cases.push({
    id: `${table}|${role}|${kind}|${over.method}${over.variant ? `|${over.variant}` : ''}`,
    group: kind,
    write: true,
    role,
    table,
    kind,
    ...over
  });
  const noRows = { maxRows: 0 };

  for (const target of WRITE_TARGETS(ids)) {
    const { table } = target;
    const row = `/${table}?id=eq.${target.id}`;
    const hiddenOf = HIDDEN_COLUMNS[table];
    const patch = { method: 'PATCH', body: target.body };

    // Admin: the shapes the app uses (explicit public select) must survive B; RETURNING * and a hidden
    // select must not.
    add('admin', table, 'write-returning-public', { ...patch, headers: REPRESENTATION, path: `${row}&select=${target.select}`, expect: same(okExpect({ forbidKeys: hiddenOf })) });
    add('admin', table, 'write-single-object', {
      ...patch, headers: { ...REPRESENTATION, Accept: 'application/vnd.pgrst.object+json' }, path: `${row}&select=${target.select}`, expect: same(okExpect({ forbidKeys: hiddenOf }))
    });
    add('admin', table, 'write-returning-star', { ...patch, headers: REPRESENTATION, path: row, expect: both(leak(target.star), denied()) });
    add('admin', table, 'write-returning-hidden', { ...patch, headers: REPRESENTATION, path: `${row}&select=id,${target.hidden}`, expect: both(leak([target.hidden]), denied()) });
    add('admin', table, 'write-minimal', { ...patch, headers: { Prefer: 'return=minimal' }, path: row, expect: same(okExpect()) });

    // Customer: RLS filters the row (0 rows) but the column privilege check is at plan time.
    add('customer', table, 'write-returning-public', { ...patch, headers: REPRESENTATION, path: `${row}&select=${target.select}`, expect: same(okExpect(noRows)) });
    add('customer', table, 'write-returning-star', { ...patch, headers: REPRESENTATION, path: row, expect: both(okExpect(noRows), denied()) });
    add('customer', table, 'write-returning-hidden', { ...patch, headers: REPRESENTATION, path: `${row}&select=id,${target.hidden}`, expect: both(okExpect(noRows), denied()) });

    // Anon has no UPDATE grant at all: denied before and after.
    add('anon', table, 'write-returning-public', { ...patch, headers: REPRESENTATION, path: `${row}&select=${target.select}`, expect: same(denied()) });
    add('anon', table, 'write-returning-star', { ...patch, headers: REPRESENTATION, path: row, expect: same(denied()) });
  }

  // INSERT shapes. Slugs / batch numbers are unique per run (the scratch DB is rebuilt, but be safe).
  const categoryBody = (n) => ({ slug: `probe-${suffix}-${n}`, name_es: 'Probe', name_en: 'Probe', profit_margin: 15 });
  const post = (role, table, kind, variant, over) => add(role, table, kind, { method: 'POST', variant, ...over });
  post('admin', 'product_categories', 'write-returning-public', 'insert', {
    headers: REPRESENTATION, path: `/product_categories?select=${compact(PUBLIC_CATEGORY_COLUMNS)}`, body: categoryBody(1), expect: same(okExpect({ forbidKeys: ['profit_margin'] }))
  });
  post('admin', 'product_categories', 'write-single-object', 'insert', {
    headers: { ...REPRESENTATION, Accept: 'application/vnd.pgrst.object+json' }, path: `/product_categories?select=${compact(PUBLIC_CATEGORY_COLUMNS)}`, body: categoryBody(2), expect: same(okExpect({ forbidKeys: ['profit_margin'] }))
  });
  post('admin', 'product_categories', 'write-returning-star', 'insert', {
    headers: REPRESENTATION, path: '/product_categories', body: categoryBody(3), expect: both(leak(['profit_margin']), denied())
  });
  post('admin', 'product_categories', 'write-minimal', 'insert', {
    headers: { Prefer: 'return=minimal' }, path: '/product_categories', body: categoryBody(4), expect: same(okExpect())
  });
  const inventoryBody = (n, extra = {}) => ({ product_id: ids.productForInventory ?? ids.product, quantity: 1, batch_number: `probe-${suffix}-${n}`, ...extra });
  post('admin', 'inventory', 'write-returning-public', 'insert', {
    headers: REPRESENTATION, path: '/inventory?select=id,product_id,quantity,is_active', body: inventoryBody(1), expect: same(okExpect({ forbidKeys: HIDDEN_COLUMNS.inventory }))
  });
  post('admin', 'inventory', 'write-returning-hidden', 'insert', {
    headers: REPRESENTATION, path: '/inventory?select=id,cost_per_unit', body: inventoryBody(2, { cost_per_unit: 1.5 }), expect: both(leak(['cost_per_unit']), denied())
  });
  post('customer', 'product_categories', 'write-returning-public', 'insert', {
    headers: REPRESENTATION, path: `/product_categories?select=${compact(PUBLIC_CATEGORY_COLUMNS)}`, body: categoryBody(5), expect: same(denied())
  });
  post('anon', 'product_categories', 'write-returning-public', 'insert', {
    headers: REPRESENTATION, path: `/product_categories?select=${compact(PUBLIC_CATEGORY_COLUMNS)}`, body: categoryBody(6), expect: same(denied())
  });
  post('anon', 'product_categories', 'write-returning-star', 'insert', {
    headers: REPRESENTATION, path: '/product_categories', body: categoryBody(7), expect: same(denied())
  });
  return cases;
}

/**
 * @param {{writes?: boolean, ids?: object, suffix?: string, production?: boolean}} options
 * Writes are only ever built for a local target (production => read-only case list).
 */
export function buildCases({ writes = false, ids, suffix = 'run', production = false } = {}) {
  const cases = readCases();
  if (writes && !production) {
    if (!ids) throw new Error('buildCases: write cases need the discovered row ids');
    cases.push(...writeCases(ids, suffix));
  }
  return cases;
}

// ---------------------------------------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------------------------------------

const isSuccess = (status) => status >= 200 && status < 300;
const rowCount = (body) => (Array.isArray(body) ? body.length : body && typeof body === 'object' ? 1 : 0);

function deepKeys(value, into = new Set()) {
  if (Array.isArray(value)) value.forEach((item) => deepKeys(item, into));
  else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      into.add(key);
      deepKeys(child, into);
    }
  }
  return into;
}

function hasNonNull(value, key) {
  if (Array.isArray(value)) return value.some((item) => hasNonNull(item, key));
  if (value && typeof value === 'object') {
    return Object.entries(value).some(([k, child]) => (k === key && child !== null && child !== undefined) || hasNonNull(child, key));
  }
  return false;
}

const isDenial = (testCase, { status, body }) => (
  (status === 401 || status === 403) && (testCase.method === 'HEAD' || body?.code === '42501')
);

/** Verdict for one response. Values from the body are never copied into the verdict (names/counts only). */
export function evaluate(testCase, response, phase) {
  const expectation = testCase.expect[phase];
  const { status, body } = response;
  const code = body && typeof body === 'object' && !Array.isArray(body) ? body.code ?? null : null;
  const verdict = (pass, reason, observed) => ({
    id: testCase.id, group: testCase.group, kind: testCase.kind, role: testCase.role, table: testCase.table,
    column: testCase.column, method: testCase.method, expected: expectation.type, status, code, pass, reason, observed
  });

  switch (expectation.type) {
    case 'denied':
      return isDenial(testCase, response)
        ? verdict(true, 'denied with 42501', 'denied')
        : verdict(false, `expected 401/403 with code 42501, got status ${status} code ${code ?? '-'}`, isSuccess(status) ? 'allowed' : 'other');

    case 'leak': {
      if (!isSuccess(status)) return verdict(false, `expected the column to be readable, got status ${status} code ${code ?? '-'}`, 'other');
      const rows = rowCount(body);
      if (rows === 0) {
        return expectation.requireRows === false
          ? verdict(true, 'readable, no rows visible (status-only evidence)', 'allowed')
          : verdict(false, 'readable but 0 rows visible: cannot prove the leak (seed or use a role that sees rows)', 'allowed');
      }
      const keys = deepKeys(body);
      const missing = expectation.columns.filter((c) => !keys.has(c));
      if (missing.length) return verdict(false, `columns missing from the response: ${missing.join(', ')}`, 'allowed');
      const nulls = expectation.columns.filter((c) => !NULLABLE_HIDDEN.has(c) && !hasNonNull(body, c));
      if (nulls.length) return verdict(false, `columns present but null in every row: ${nulls.join(', ')}`, 'allowed');
      return verdict(true, `LEAK documented: ${expectation.columns.join(', ')} readable (${rows} row(s))`, 'allowed');
    }

    case 'ok': {
      if (!isSuccess(status)) return verdict(false, `expected success, got status ${status} code ${code ?? '-'}`, isDenial(testCase, response) ? 'denied' : 'other');
      const exposed = (expectation.forbidKeys ?? []).filter((k) => deepKeys(body).has(k));
      if (exposed.length) return verdict(false, `hidden keys exposed in a public read: ${exposed.join(', ')}`, 'allowed');
      if (expectation.maxRows !== undefined && rowCount(body) > expectation.maxRows) {
        return verdict(false, `${rowCount(body)} row(s) returned, expected at most ${expectation.maxRows} (RLS should filter)`, 'allowed');
      }
      return verdict(true, 'readable, no hidden key', 'allowed');
    }

    case 'either':
      if (isSuccess(status)) return verdict(true, 'allowed (no hidden column touched by the generated SQL)', 'allowed');
      if (isDenial(testCase, response)) return verdict(true, 'denied with 42501 (generated SQL touches table.*)', 'denied');
      return verdict(false, `expected success or a 42501 denial, got status ${status} code ${code ?? '-'}`, 'other');

    case 'rpc-ok': {
      if (status !== 200) return verdict(false, `expected 200, got status ${status} code ${code ?? '-'}`, 'other');
      if (!Array.isArray(body) || body.length === 0) return verdict(false, 'RPC returned no rows (seed or check the admin role)', 'allowed');
      const missing = expectation.keys.filter((k) => !(k in body[0]));
      return missing.length
        ? verdict(false, `RPC row misses keys: ${missing.join(', ')}`, 'allowed')
        : verdict(true, `RPC returned ${body.length} row(s) with the cost keys`, 'allowed');
    }

    default:
      return verdict(false, `unknown expectation type ${expectation.type}`, 'other');
  }
}

// ---------------------------------------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------------------------------------

const REQUEST_TIMEOUT_MS = 15_000;
const redact = (text, secrets) => Object.values(secrets).filter(Boolean).reduce((out, s) => out.split(s).join('[redacted]'), String(text));

/** Sends one case. Never throws on HTTP/network failure (status 0); throws ProbeGuardError on a forbidden request. */
export async function executeCase(testCase, { target, keys, fetchImpl = fetch }) {
  assertRequestAllowed(testCase, { production: target.mode === 'production' });
  const token = testCase.role === 'anon' ? keys.anon : keys[testCase.role];
  const headers = { apikey: keys.anon, Authorization: `Bearer ${token}`, ...testCase.headers };
  const init = { method: testCase.method, headers, redirect: 'manual', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) };
  if (testCase.body !== undefined) {
    init.body = JSON.stringify(testCase.body);
    init.headers['Content-Type'] = 'application/json';
  }
  try {
    const res = await fetchImpl(`${target.base}${testCase.path}`, init);
    const text = testCase.method === 'HEAD' ? '' : await res.text();
    let body = null;
    if (text) {
      try { body = JSON.parse(text); } catch { body = null; }
    }
    return { status: res.status, body, contentRange: res.headers.get('content-range') };
  } catch (error) {
    return { status: 0, body: { code: 'PROBE_NETWORK', message: redact(error?.message ?? 'network error', keys) }, contentRange: null };
  }
}

/** Finds one real row id per guarded table (public `id` column only; works before and after B). */
export async function discoverIds({ target, keys, fetchImpl = fetch }) {
  const ask = async (table) => {
    const res = await executeCase(
      { id: `discover|${table}`, role: 'admin', method: 'GET', path: `/${table}?select=id&order=id&limit=1`, headers: {}, expect: {} },
      { target, keys, fetchImpl }
    );
    const id = Array.isArray(res.body) ? res.body[0]?.id : undefined;
    if (!id) throw new Error(`no row found in ${table} (status ${res.status}); seed the scratch database before running the write cases`);
    return id;
  };
  return {
    product: await ask('products'),
    combo: await ask('combo_products'),
    category: await ask('product_categories'),
    inventory: await ask('inventory'),
    zone: await ask('shipping_zones')
  };
}

export async function runProbe({ target, keys, phase, cases, fetchImpl = fetch, onResult }) {
  if (!PHASES.includes(phase)) throw new Error(`unknown phase ${phase}`);
  if (target.mode === 'production') {
    const forbidden = cases.find((c) => {
      try { assertRequestAllowed(c, { production: true }); return false; } catch { return true; }
    });
    if (forbidden) throw new ProbeGuardError(`production run refused before any request: case ${forbidden.id} is not read-only`);
  }
  const results = [];
  for (const testCase of cases) {
    const response = await executeCase(testCase, { target, keys, fetchImpl });
    const result = evaluate(testCase, response, phase);
    results.push(result);
    onResult?.(result);
  }
  const failed = results.filter((r) => !r.pass).length;
  return { phase, mode: target.mode, total: results.length, passed: results.length - failed, failed, results };
}

// ---------------------------------------------------------------------------------------------------------
// Reporting, CLI parsing, token minting
// ---------------------------------------------------------------------------------------------------------

export function formatReport(report, { phase, target, keys }) {
  const lines = [`PostgREST contract probe  phase=${phase}  mode=${target.mode}  target=${target.base}`];
  const byGroup = new Map();
  for (const r of report.results) {
    const g = byGroup.get(r.group) ?? { passed: 0, failed: 0 };
    g[r.pass ? 'passed' : 'failed'] += 1;
    byGroup.set(r.group, g);
  }
  lines.push('', 'By group:');
  for (const [group, g] of byGroup) lines.push(`  ${group.padEnd(26)} pass ${String(g.passed).padStart(3)}  fail ${String(g.failed).padStart(3)}`);
  const eithers = report.results.filter((r) => r.expected === 'either');
  if (eithers.length) {
    const tally = eithers.reduce((acc, r) => ({ ...acc, [r.observed]: (acc[r.observed] ?? 0) + 1 }), {});
    lines.push('', `Bare HEAD+count (no select) observed: ${JSON.stringify(tally)}`);
  }
  const failures = report.results.filter((r) => !r.pass);
  if (failures.length) {
    lines.push('', 'FAILURES:');
    for (const r of failures) lines.push(`  FAIL ${r.id}  [${r.method} ${r.role}] status=${r.status} code=${r.code ?? '-'}  ${r.reason}`);
  }
  lines.push('', `${report.passed}/${report.total} passed, ${report.failed} failed  (phase ${phase}, ${target.mode})`);
  const secretLike = /eyJ[\w-]+\.[\w-]+\.[\w-]+/g;
  return redact(lines.join('\n'), keys).replace(secretLike, '[redacted-jwt]');
}

export function parseArgs(argv) {
  const out = { phase: null, allowProduction: false, json: false, writes: true, mint: null, sub: null };
  for (const arg of argv) {
    if (arg.startsWith('--phase=')) out.phase = arg.slice(8);
    else if (arg === '--i-understand-this-hits-production') out.allowProduction = true;
    else if (arg === '--json') out.json = true;
    else if (arg === '--no-writes') out.writes = false;
    else if (arg.startsWith('--mint=')) out.mint = arg.slice(7);
    else if (arg.startsWith('--sub=')) out.sub = arg.slice(6);
    else throw new Error(`unknown argument ${arg.split('=')[0]}`);
  }
  if (out.mint !== null) {
    if (!['anon', 'customer', 'admin'].includes(out.mint)) throw new Error('--mint must be anon, customer or admin');
    return out;
  }
  if (!PHASES.includes(out.phase)) throw new Error(`--phase must be one of ${PHASES.join(', ')}`);
  return out;
}

export function readConfig(env) {
  const names = ['PROBE_BASE_URL', 'PROBE_ANON_KEY', 'PROBE_CUSTOMER_JWT', 'PROBE_ADMIN_JWT'];
  const missing = names.filter((n) => !env[n]);
  if (missing.length) throw new Error(`missing environment variables: ${missing.join(', ')}`);
  return { baseUrl: env.PROBE_BASE_URL, keys: { anon: env.PROBE_ANON_KEY, customer: env.PROBE_CUSTOMER_JWT, admin: env.PROBE_ADMIN_JWT } };
}

/** A plain secret signs as-is; a JWKS ({"keys":[{"kty":"oct","k":...}]}, the Supabase CLI stack) signs with the decoded `k`. */
function signingKey(secret) {
  if (!secret.trim().startsWith('{')) return secret;
  const oct = JSON.parse(secret).keys?.find((key) => key.kty === 'oct' && key.k);
  if (!oct) throw new Error('mintJwt: the JWKS has no symmetric (oct) key to sign HS256 with');
  return Buffer.from(oct.k, 'base64url');
}

/** HS256 JWT for a LOCAL PostgREST (the secret comes from the caller's environment; nothing is stored). */
export function mintJwt({ secret, role, sub, now = Math.floor(Date.now() / 1000), ttlSeconds = 900 }) {
  if (!secret) throw new Error('mintJwt: a secret is required');
  const key = signingKey(secret);
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const payload = role === 'anon'
    ? { role, iat: now, exp: now + ttlSeconds }
    : { role, aud: 'authenticated', sub, iat: now, exp: now + ttlSeconds };
  const unsigned = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(payload)}`;
  return `${unsigned}.${createHmac('sha256', key).update(unsigned).digest('base64url')}`;
}

/** Test helper: the response a server would give if it satisfied `expectation` for `testCase`. */
export function synthesizeResponse(expectation, testCase) {
  const headless = testCase.method === 'HEAD';
  switch (expectation.type) {
    case 'denied':
      return { status: testCase.role === 'anon' ? 401 : 403, body: headless ? null : { code: '42501', message: 'permission denied' } };
    case 'leak': {
      if (expectation.requireRows === false) return { status: 200, body: [] };
      const row = Object.fromEntries(expectation.columns.map((c) => [c, NULLABLE_HIDDEN.has(c) ? null : 1]));
      return { status: 200, body: [{ id: 'x', ...row }] };
    }
    case 'rpc-ok':
      return { status: 200, body: [Object.fromEntries(expectation.keys.map((k) => [k, 1]))] };
    case 'ok':
    case 'either':
    default:
      if (headless || testCase.headers?.Prefer === 'return=minimal') return { status: headless ? 200 : 204, body: null };
      return { status: 200, body: expectation.maxRows === 0 ? [] : [{ id: 'x' }] };
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.mint) {
    const secret = process.env.PROBE_JWT_SECRET;
    const role = args.mint === 'anon' ? 'anon' : 'authenticated';
    process.stdout.write(mintJwt({ secret, role, sub: args.sub ?? undefined }));
    return 0;
  }
  const { baseUrl, keys } = readConfig(process.env);
  const target = assertSafeTarget(baseUrl, { allowProduction: args.allowProduction });
  const production = target.mode === 'production';
  const writes = args.writes && !production;
  const log = (line) => process.stderr.write(`${line}\n`);
  if (production) log('PRODUCTION target: READ-ONLY run (GET, HEAD and admin_list_* RPC calls only); response values are never printed.');
  const ids = writes ? await discoverIds({ target, keys }) : undefined;
  const cases = buildCases({ writes, ids, suffix: Date.now().toString(36), production });
  const report = await runProbe({ target, keys, phase: args.phase, cases });
  process.stdout.write(`${args.json ? JSON.stringify(report, null, 2) : formatReport(report, { phase: args.phase, target, keys })}\n`);
  return report.failed === 0 ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((code) => { process.exitCode = code; }).catch((error) => {
    process.stderr.write(`probe: ${error.name === 'ProbeGuardError' ? 'REFUSED: ' : ''}${error.message}\n`);
    process.exitCode = 2;
  });
}
