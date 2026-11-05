// src/lib/requestBudget.js
//
// Fetch layer for Supabase REST calls (/rest/v1 only; auth, storage, functions and realtime pass untouched). Composed
// with the refresh guard in supabase.js. Why: on the Free plan (5 GB egress) every repeated read costs headers + JSON.
//  1. In-flight dedupe: identical reads (same method, URL, body, Range/Prefer/Accept and user) share one request.
//     Requests with their own abort signal never share.
//  2. An allowlist of exact reads (CACHED_READS: select AND filters) is cached for API_CACHE_TTL_MS in memory and localStorage
//     (public data), so other tabs and reloads reuse them. Every other read, including those that price an operation,
//     goes to the network.
//  3. Budget guardrail, only for the polling counters in GUARDED_READS: once `maxPerMinute` requests of the same
//     method+path really reached the network in the sliding minute, a read is served from the last IDENTICAL answer
//     (never another query's body) only if that answer is younger than the window, with ONE logError per episode.
//     Joined and served reads do not count. Every other read always goes through.
//  4. Writes (POST/PATCH/PUT/DELETE, mutating RPCs) are never delayed or dropped. When one lands, every cached answer
//     and every in-flight read is dropped (this tab and, via localStorage, the others' caches) and subscribeApiWrites
//     listeners are told, so the screen reloads what the action changed at once.
//  5. noteRemoteChange (called on every realtime event) drops stored answers and in-flight reads: the refetches an
//     event triggers always reach the network.
//  Known limit: only writes through /rest/v1 invalidate; storage uploads, Edge Functions and auth calls do not (none
//  of them changes the cached display reads).
//  Switch: VITE_API_GUARD=off turns the whole layer into a pass-through.
import { logError } from '@/lib/errorHandler';

export const API_CACHE_STORAGE_KEY = 'papuenvios-api-cache';
// At most half of CurrencyContext's RATE_REFRESH_MS: a forced refresh never reads an answer older than one interval.
export const API_CACHE_TTL_MS = 2.5 * 60_000;
// Only an explicit allowlist of selects is cached (table -> select as PostgREST receives it, no spaces):
//  - exchange_rates: all active rates at once (getConversionRate -> CurrencyContext) and the pair list that decides
//    which currencies the selector shows (getCurrenciesWithRates);
//  - currencies: the Dashboard's base-currency label.
// CurrencyContext's rates DO price what the screen shows (cart lines, catalog), so every amount that is SAVED is
// re-priced with getLiveConversionRate, which is never cached: the cart checkout (an order is only created when the
// live prices equal the displayed ones), the product save in the inventory, and getExchangeRate (remittance
// confirmation, convertCurrency). getActiveRate and v_effective_courier_cost are never cached either.
// Each entry is the EXACT set of query parameters (select and filters) of one known call; a future read with the same
// select but other filters is not cached.
const CACHED_READS = {
  exchange_rates: [
    { select: 'from_currency_id,to_currency_id,rate,effective_date', is_active: 'eq.true', order: 'effective_date.desc' },
    { select: 'from_currency_id,to_currency_id', is_active: 'eq.true' }
  ],
  currencies: [{ select: 'id,code,symbol,is_base', is_active: 'eq.true', order: 'code.asc' }]
};
const isCachedRead = (table, url) => (CACHED_READS[table] || []).some((expected) => {
  const keys = [...new Set(url.searchParams.keys())];
  return keys.length === Object.keys(expected).length
    && keys.every((key) => url.searchParams.getAll(key).length === 1 && url.searchParams.get(key) === expected[key]);
});
// The guardrail only ever answers these polling counters from memory (method + REST path). Any other read, and in
// particular anything about money, prices or stock (rates, currencies, costs, Zelle accounts, FX status...), always
// reaches the network.
const GUARDED_READS = new Set([
  'POST /rest/v1/rpc/get_pending_orders_count',
  'POST /rest/v1/rpc/admin_refund_counts',
  'POST /rest/v1/rpc/admin_list_refunds',
  'HEAD /rest/v1/remittances',
  'HEAD /rest/v1/site_visits'
]);
const READ_RPC = /^(get|list|has|admin_list)_|^(admin_refund_counts|admin_courier_report|orders_with_consumed_stock|select_available_zelle_account)$/;
const REST_PREFIX = '/rest/v1/';
const MAX_STORED_BODY = 64 * 1024;
const MAX_STORED_ENTRIES = 200;
const NULL_BODY_STATUS = new Set([101, 204, 205, 304]);

const writeListeners = new Set();
const remoteChangeHandlers = new Set();

/** Called on every realtime change: the refetches it triggers never get an answer from before the change. */
export const noteRemoteChange = () => remoteChangeHandlers.forEach((handler) => handler());

const dropHandlers = new Set();
/** Drops every cached answer (this tab and the others' localStorage cache), as a write would. */
export const dropApiCaches = () => {
  dropHandlers.forEach((handler) => handler());
  try {
    localStorage.removeItem(API_CACHE_STORAGE_KEY);
  } catch {
    // storage unavailable
  }
};

/** Listener receives the REST path of every write (e.g. '/rest/v1/orders', '/rest/v1/rpc/admin_resolve_refund'). */
export const subscribeApiWrites = (listener) => {
  writeListeners.add(listener);
  return () => writeListeners.delete(listener);
};

const notifyWrite = (path) => {
  writeListeners.forEach((listener) => {
    try {
      listener(path);
    } catch {
      // a faulty listener must not break the fetch path
    }
  });
};

// Keys reach localStorage: identities are stored hashed, never in clear.
const hashOf = (text) => {
  let hash = 5381;
  for (let i = 0; i < text.length; i += 1) hash = ((hash * 33) ^ text.charCodeAt(i)) >>> 0;
  return hash.toString(36);
};

// The user (not the token, which rotates every hour) is part of the key: RLS answers depend on it.
const identityOf = (authorization) => {
  if (!authorization) return '';
  try {
    const payload = JSON.parse(atob(authorization.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return `user:${hashOf(`${payload.sub || 'anon'}:${payload.role || ''}`)}`;
  } catch {
    // Not a JWT: keep requests of different tokens apart without ever storing the token.
    return `opaque:${hashOf(authorization)}`;
  }
};

const describe = (input, init) => {
  const rawUrl = typeof input === 'string' ? input : input?.url ?? String(input);
  let url;
  try {
    url = new URL(rawUrl, 'http://localhost');
  } catch {
    return null;
  }
  const at = url.pathname.indexOf(REST_PREFIX);
  if (at === -1) return null;
  const path = url.pathname.slice(at);
  const method = (init?.method || input?.method || 'GET').toUpperCase();
  const rpc = path.startsWith(`${REST_PREFIX}rpc/`) ? path.slice(`${REST_PREFIX}rpc/`.length) : null;
  const isRead = method === 'GET' || method === 'HEAD' || (method === 'POST' && rpc !== null && READ_RPC.test(rpc));
  const headers = new Headers(init?.headers || input?.headers || undefined);
  const table = rpc === null ? path.slice(REST_PREFIX.length).split('/')[0] : null;
  const key = [
    method, url.href, typeof init?.body === 'string' ? init.body : '',
    headers.get('range') || '', headers.get('prefer') || '', headers.get('accept') || '',
    identityOf(headers.get('authorization'))
  ].join('|');
  return { path, method, isRead, table, key, budgetKey: `${method} ${path}`, cached: isCachedRead(table, url) };
};

const snapshotOf = async (response, method) => ({
  status: response.status,
  statusText: response.statusText,
  headers: [...response.headers.entries()],
  body: method === 'HEAD' || NULL_BODY_STATUS.has(response.status) ? null : await response.text()
});

const responseOf = (snap) => new Response(snap.body, { status: snap.status, statusText: snap.statusText, headers: snap.headers });

const readPersisted = () => {
  try {
    return JSON.parse(localStorage.getItem(API_CACHE_STORAGE_KEY) || '{}') || {};
  } catch {
    return {};
  }
};

const envEnabled = () => {
  try {
    return import.meta.env?.VITE_API_GUARD !== 'off';
  } catch {
    return true;
  }
};

/**
 * @param {typeof fetch} baseFetch
 * @param {{ enabled?: boolean, maxPerMinute?: number, windowMs?: number, cacheTtlMs?: number }} [options]
 */
export const createRequestBudgetFetch = (
  baseFetch = (...args) => globalThis.fetch(...args),
  { enabled = envEnabled(), maxPerMinute = 30, windowMs = 60_000, cacheTtlMs = API_CACHE_TTL_MS } = {}
) => {
  if (!enabled) return baseFetch;

  const inFlight = new Map(); // key -> Promise<snapshot>
  const ttlCache = new Map(); // key -> { at, snap } (rate tables)
  const lastAnswer = new Map(); // key -> { at, snap } (any read; the guardrail's fallback)
  const hits = new Map(); // budgetKey -> timestamps
  const flagged = new Set();
  let generation = 0;

  Object.entries(readPersisted()).forEach(([key, entry]) => {
    if (entry && Date.now() - entry.at < cacheTtlMs) ttlCache.set(key, entry);
  });

  const persist = () => {
    try {
      const entries = {};
      ttlCache.forEach((entry, key) => { if (entry.persist) entries[key] = entry; });
      if (Object.keys(entries).length) localStorage.setItem(API_CACHE_STORAGE_KEY, JSON.stringify(entries));
    } catch {
      // storage full or unavailable: the memory cache still works for this tab
    }
  };

  const dropAll = () => {
    generation += 1;
    inFlight.clear(); // a read issued from now on must not join one that started before the change
    ttlCache.clear();
    lastAnswer.clear();
    hits.clear();
    flagged.clear();
  };

  dropHandlers.add(() => dropAll());

  // A realtime event: data changed on the server, so no read may be answered from before it.
  remoteChangeHandlers.add(() => {
    generation += 1;
    inFlight.clear();
    lastAnswer.clear();
  });

  if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('storage', (event) => {
      if (event.key === API_CACHE_STORAGE_KEY && event.newValue === null) dropAll();
    });
  }

  const remember = (map, key, value) => {
    map.delete(key);
    map.set(key, value);
    if (map.size > MAX_STORED_ENTRIES) map.delete(map.keys().next().value);
  };

  // Only requests that reach the network count; an answer served by the guardrail does not.
  const recentHits = (budgetKey) => {
    const now = Date.now();
    const recent = (hits.get(budgetKey) || []).filter((t) => now - t < windowMs);
    hits.set(budgetKey, recent);
    if (recent.length < maxPerMinute) flagged.delete(budgetKey);
    return recent;
  };

  return async (input, init) => {
    const req = describe(input, init);
    if (!req) return baseFetch(input, init);

    if (!req.isRead) {
      try {
        return await baseFetch(input, init);
      } finally {
        dropAll();
        try {
          localStorage.removeItem(API_CACHE_STORAGE_KEY);
        } catch {
          // storage unavailable
        }
        notifyWrite(req.path);
      }
    }

    const cached = ttlCache.get(req.key);
    if (cached && Date.now() - cached.at < cacheTtlMs) return responseOf(cached.snap);

    const guarded = GUARDED_READS.has(req.budgetKey);
    const recent = guarded ? recentHits(req.budgetKey) : null;
    const last = guarded ? lastAnswer.get(req.key) : null;
    // Over budget: the identical answer is served only while it is younger than the window itself.
    if (guarded && recent.length >= maxPerMinute && last && Date.now() - last.at < windowMs) {
      if (!flagged.has(req.budgetKey)) {
        flagged.add(req.budgetKey);
        logError(new Error(`Request budget exceeded: ${req.budgetKey} (> ${maxPerMinute}/min), serving the last answer`), {
          operation: 'requestBudget',
          budgetKey: req.budgetKey
        });
      }
      return responseOf(last.snap);
    }
    // Only requests that really reach the network count (joined and served ones do not).
    const countNetworkRequest = () => recent?.push(Date.now());

    // A caller with its own abort signal must not abort (or be aborted by) other callers: no sharing.
    if (init?.signal) {
      countNetworkRequest();
      return baseFetch(input, init);
    }

    let pending = inFlight.get(req.key);
    if (!pending) {
      countNetworkRequest();
      const startedAt = generation;
      pending = baseFetch(input, init)
        .then((response) => snapshotOf(response, req.method))
        .then((snap) => {
          const storable = snap.status >= 200 && snap.status < 300 && (snap.body?.length ?? 0) <= MAX_STORED_BODY;
          if (storable && startedAt === generation) {
            if (guarded) remember(lastAnswer, req.key, { at: Date.now(), snap });
            if (req.cached) {
              remember(ttlCache, req.key, { at: Date.now(), snap, persist: true }); // public data
              persist();
            }
          }
          return snap;
        })
        .finally(() => {
          if (inFlight.get(req.key) === pending) inFlight.delete(req.key);
        });
      inFlight.set(req.key, pending);
    }
    return responseOf(await pending);
  };
};
