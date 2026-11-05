// src/lib/refreshGuard.js
//
// Guard for the Supabase refresh-token endpoint (`/auth/v1/token?grant_type=refresh_token`).
//
// Why: auth-js only treats network errors and 502/503/504 as retryable. A 429 becomes a
// non-retryable AuthApiError, so `_callRefreshToken` runs `_removeSession()`: the stored
// session (including a refresh token the server still considers valid) is deleted and
// SIGNED_OUT is emitted. One rate-limit response (limit is per IP; people in Cuba share
// IPs behind CGNAT) therefore logged the person out for good.
//
// The same happens with 408 and with 5xx other than 502/503/504 (500 JSON, Cloudflare's 520
// HTML page...): auth-js cannot parse/classify them as temporary and drops the session.
//
// What: wrap `fetch` (passed as `global.fetch`, which supabase-js also hands to auth-js).
//  - 429, 408 or 5xx (except 502/503/504, which auth-js already retries) on a refresh request
//    -> start a cooldown (Retry-After clamped to [30 s, 5 min], else exponential backoff, plus
//    jitter) and THROW a TypeError, which auth-js classifies as a retryable network failure:
//    the session stays in storage and the refresh is retried later.
//  - During the cooldown refresh requests fail locally without touching the network, so a
//    burst of callers (pollers, role retries, several tabs) cannot hammer the endpoint.
//  - A successful refresh clears the cooldown. Any other status (400/401 invalid refresh
//    token, 502/503/504) passes through unchanged, so a genuinely dead session still ends.
//  - The cooldown (with its failure count) lives in localStorage and follows `storage` events,
//    so reloads and other tabs share it.
//
// Known limit (inherent, do not try to "fix" it here): while blocked, every getSession() holds
// auth-js's lock for its whole local retry loop (~25 s, 200 ms doubling). Calls serialize on
// that lock, so REST requests stall (then go out with the anon key) until the cooldown ends.
// Failing faster is impossible from a fetch wrapper: any answer auth-js can keep the session
// on is "retryable", and retryable errors are retried by that same loop.
//
// shortcut: plain network errors (offline, DNS) are not guarded and keep auth-js's own retry loop.

const STORAGE_KEY = 'papuenvios-refresh-block';

export const REFRESH_RATE_LIMIT_BASE_MS = 30_000;
export const REFRESH_RATE_LIMIT_MAX_MS = 5 * 60_000;
const JITTER_RATIO = 0.2; // jitter only adds time: never retry before Retry-After

// Stored as {"until":ms,"failures":n}; a bare number (older format) is read as `until`.
const readPersisted = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { until: 0, failures: 0 };
    const parsed = JSON.parse(raw);
    const until = Number(typeof parsed === 'object' && parsed ? parsed.until : parsed);
    const failures = Number(typeof parsed === 'object' && parsed ? parsed.failures : 0);
    if (!Number.isFinite(until) || until <= 0) return { until: 0, failures: 0 };
    return {
      // A tampered/skewed value must not block refreshes for longer than the cap.
      until: Math.min(until, Date.now() + REFRESH_RATE_LIMIT_MAX_MS),
      failures: Number.isFinite(failures) && failures > 0 ? Math.min(failures, 10) : 0
    };
  } catch {
    return { until: 0, failures: 0 };
  }
};

const persistState = () => {
  try {
    if (state.until > 0) localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // storage unavailable: the in-memory cooldown still applies for this page
  }
};

let state = readPersisted();
const listeners = new Set();

const notify = () => {
  const blocked = isRefreshBlocked();
  listeners.forEach((listener) => {
    try {
      listener(blocked);
    } catch {
      // a faulty subscriber must not break the fetch path
    }
  });
};

export const getRefreshBlockRemainingMs = () => Math.max(0, state.until - Date.now());
export const isRefreshBlocked = () => getRefreshBlockRemainingMs() > 0;

/** Listener receives `true` when a cooldown starts and `false` when a refresh succeeds. */
export const subscribeRefreshBlock = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** Test helper. `keepStorage` simulates a fresh page load that re-reads the persisted cooldown. */
export const resetRefreshGuard = ({ keepStorage = false } = {}) => {
  if (!keepStorage) {
    state = { until: 0, failures: 0 };
    persistState();
  }
  state = readPersisted();
};

// Another tab started or cleared the cooldown: follow it.
if (typeof window !== 'undefined' && window.addEventListener) {
  window.addEventListener('storage', (event) => {
    if (event.key !== null && event.key !== STORAGE_KEY) return;
    const wasBlocked = isRefreshBlocked();
    state = readPersisted();
    if (wasBlocked !== isRefreshBlocked()) notify();
  });
}

export const isRefreshRequest = (input) => {
  const raw = typeof input === 'string' ? input : input?.url ?? String(input);
  try {
    const url = new URL(raw, 'http://localhost');
    return url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'refresh_token';
  } catch {
    return false;
  }
};

const parseRetryAfterMs = (value) => {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(value);
  return Number.isNaN(date) ? null : Math.max(0, date - Date.now());
};

const startCooldown = (retryAfterHeader) => {
  state.failures += 1;
  const backoff = REFRESH_RATE_LIMIT_BASE_MS * 2 ** (state.failures - 1);
  // Clamp: Retry-After 0 must not hammer the endpoint, 86400 must not lock people out for hours.
  const base = Math.min(Math.max(parseRetryAfterMs(retryAfterHeader) ?? backoff, REFRESH_RATE_LIMIT_BASE_MS), REFRESH_RATE_LIMIT_MAX_MS);
  state.until = Date.now() + base * (1 + Math.random() * JITTER_RATIO);
  persistState();
  notify();
};

const clearCooldown = () => {
  if (state.until === 0 && state.failures === 0) return;
  state = { until: 0, failures: 0 };
  persistState();
  notify();
};

// 502/503/504 are already "retryable" for auth-js; the rest of these would end the session.
const isTemporaryRefreshFailure = (status) =>
  status === 429 || status === 408 || (status >= 500 && ![502, 503, 504].includes(status));

/**
 * Wraps a poll tick: skipped while the refresh is in cooldown (the request would stall on auth-js's
 * lock and then go out with the anon key). The caller keeps its last value; the next tick after the
 * cooldown runs normally.
 */
export const skipWhileRefreshBlocked = (fn) => (...args) => (isRefreshBlocked() ? undefined : fn(...args));

/** Nothing left to refresh (signed out): drop the cooldown so the next session starts clean. */
export const clearRefreshBlock = clearCooldown;

const pausedError = () =>
  new TypeError(`Token refresh paused: rate limited or unavailable, retry in ${Math.ceil(getRefreshBlockRemainingMs() / 1000)}s`);

export const createRefreshGuardFetch = (baseFetch = (...args) => globalThis.fetch(...args)) =>
  async (input, init) => {
    if (!isRefreshRequest(input)) return baseFetch(input, init);
    if (isRefreshBlocked()) throw pausedError();

    const response = await baseFetch(input, init);
    if (isTemporaryRefreshFailure(response.status)) {
      startCooldown(response.headers?.get?.('Retry-After'));
      throw pausedError();
    }
    if (response.ok) clearCooldown();
    return response;
  };
