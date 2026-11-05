// src/lib/requestBudget.js
//
// Fetch layer for Supabase REST calls (/rest/v1 only; auth, storage, functions and realtime pass untouched). Composed
// with the refresh guard in supabase.js. Why: on the Free plan (5 GB egress) every repeated read costs headers + JSON.
//  1. In-flight dedupe: identical reads (same method, URL, body, Range/Prefer/Accept and user) share one request.
//  2. Display rate reads (all active exchange rates in one read, currency lists) are cached for API_CACHE_TTL_MS in
//     memory and localStorage (public data), so other tabs and reloads reuse them. Reads that price an operation
//     (single-pair rate at confirmation) are never cached.
//  3. Budget guardrail: more than `maxPerMinute` reads of the same method+path in a sliding minute are served from the
//     last identical answer (exact same request only, never another query's body) with ONE logError per episode.
//     Without an identical earlier answer the request goes through.
//  4. Writes (POST/PATCH/PUT/DELETE, mutating RPCs) are never delayed or dropped. When one lands, every cached answer is
//     dropped (this tab and, via localStorage, the others) and subscribeApiWrites listeners are told, so the screen
//     reloads what the action changed at once: an own action is never followed by stale data.
//  Switch: VITE_API_GUARD=off turns the whole layer into a pass-through.
import { logError } from '@/lib/errorHandler';

export const API_CACHE_STORAGE_KEY = 'papuenvios-api-cache';
export const API_CACHE_TTL_MS = 5 * 60_000;
// Only an explicit allowlist of DISPLAY selects is cached (table -> select as PostgREST receives it, no spaces):
//  - exchange_rates: all active rates at once (getConversionRate -> CurrencyContext) and the pair list that decides
//    which currencies the selector shows (getCurrenciesWithRates);
//  - currencies: the Dashboard's base-currency label.
// Everything else goes to the network, in particular the reads that price an operation (getExchangeRate at remittance
// confirmation and convertCurrency in the cart, getActiveRate) and v_effective_courier_cost.
const CACHED_SELECTS = {
  exchange_rates: new Set(['from_currency_id,to_currency_id,rate,effective_date', 'from_currency_id,to_currency_id']),
  currencies: new Set(['id,code,symbol,is_base'])
};
const isCachedRead = (table, url) => Boolean(CACHED_SELECTS[table]?.has(url.searchParams.get('select')));
const READ_RPC = /^(get|list|has|admin_list)_|^(admin_refund_counts|admin_courier_report|orders_with_consumed_stock|select_available_zelle_account)$/;
const REST_PREFIX = '/rest/v1/';
const MAX_STORED_BODY = 64 * 1024;
const MAX_STORED_ENTRIES = 200;
const NULL_BODY_STATUS = new Set([101, 204, 205, 304]);

const writeListeners = new Set();

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

// The user (not the token, which rotates every hour) is part of the key: RLS answers depend on it.
const identityOf = (authorization) => {
  if (!authorization) return '';
  try {
    const payload = JSON.parse(atob(authorization.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return `${payload.sub || 'anon'}:${payload.role || ''}`;
  } catch {
    return authorization;
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
  const lastAnswer = new Map(); // key -> snap (any read; the guardrail's fallback)
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
    ttlCache.clear();
    lastAnswer.clear();
    hits.clear();
    flagged.clear();
  };

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

  const overBudget = (budgetKey) => {
    const now = Date.now();
    const recent = (hits.get(budgetKey) || []).filter((t) => now - t < windowMs);
    recent.push(now);
    hits.set(budgetKey, recent);
    if (recent.length <= maxPerMinute) flagged.delete(budgetKey);
    return recent.length > maxPerMinute;
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

    if (overBudget(req.budgetKey) && lastAnswer.has(req.key)) {
      if (!flagged.has(req.budgetKey)) {
        flagged.add(req.budgetKey);
        logError(new Error(`Request budget exceeded: ${req.budgetKey} (> ${maxPerMinute}/min), serving the last answer`), {
          operation: 'requestBudget',
          budgetKey: req.budgetKey
        });
      }
      return responseOf(lastAnswer.get(req.key));
    }

    // A caller with its own abort signal must not abort (or be aborted by) other callers: no sharing.
    if (init?.signal) return baseFetch(input, init);

    let pending = inFlight.get(req.key);
    if (!pending) {
      const startedAt = generation;
      pending = baseFetch(input, init)
        .then((response) => snapshotOf(response, req.method))
        .then((snap) => {
          const storable = snap.status >= 200 && snap.status < 300 && (snap.body?.length ?? 0) <= MAX_STORED_BODY;
          if (storable && startedAt === generation) {
            remember(lastAnswer, req.key, snap);
            if (req.cached) {
              remember(ttlCache, req.key, { at: Date.now(), snap, persist: true }); // public data
              persist();
            }
          }
          return snap;
        })
        .finally(() => inFlight.delete(req.key));
      inFlight.set(req.key, pending);
    }
    return responseOf(await pending);
  };
};
