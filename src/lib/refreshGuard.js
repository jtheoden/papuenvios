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
// What: wrap `fetch` (passed as `global.fetch`, which supabase-js also hands to auth-js).
//  - 429 on a refresh request -> start a cooldown (Retry-After, else exponential backoff,
//    plus jitter) and THROW a TypeError, which auth-js classifies as a retryable network
//    failure: the session stays in storage and the refresh is retried later.
//  - During the cooldown refresh requests fail locally without touching the network, so a
//    burst of callers (pollers, role retries, several tabs) cannot hammer the endpoint.
//  - A successful refresh clears the cooldown. Any other status passes through unchanged,
//    so a genuinely invalid refresh token still ends the session.
//
// shortcut: only 429 is guarded; network/5xx refresh failures keep auth-js's own retry loop.
// Upgrade if /token traffic from flaky links shows up in the auth logs.

const STORAGE_KEY = 'papuenvios-refresh-block';

export const REFRESH_RATE_LIMIT_BASE_MS = 30_000;
export const REFRESH_RATE_LIMIT_MAX_MS = 5 * 60_000;
const JITTER_RATIO = 0.2; // jitter only adds time: never retry before Retry-After

const readPersistedUntil = () => {
  try {
    const value = Number(localStorage.getItem(STORAGE_KEY));
    if (!Number.isFinite(value) || value <= 0) return 0;
    // A tampered/skewed value must not block refreshes for longer than the cap.
    return Math.min(value, Date.now() + REFRESH_RATE_LIMIT_MAX_MS);
  } catch {
    return 0;
  }
};

const persistUntil = (until) => {
  try {
    if (until > 0) localStorage.setItem(STORAGE_KEY, String(until));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // storage unavailable: the in-memory cooldown still applies for this page
  }
};

let state = { until: readPersistedUntil(), failures: 0 };
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
  if (!keepStorage) persistUntil(0);
  state = { until: readPersistedUntil(), failures: 0 };
};

export const isRefreshRequest = (input) => {
  const url = typeof input === 'string' ? input : input?.url ?? String(input);
  return url.includes('/auth/v1/token') && url.includes('grant_type=refresh_token');
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
  const backoff = Math.min(REFRESH_RATE_LIMIT_BASE_MS * 2 ** (state.failures - 1), REFRESH_RATE_LIMIT_MAX_MS);
  const base = parseRetryAfterMs(retryAfterHeader) ?? backoff;
  state.until = Date.now() + base * (1 + Math.random() * JITTER_RATIO);
  persistUntil(state.until);
  notify();
};

const clearCooldown = () => {
  if (state.until === 0 && state.failures === 0) return;
  state = { until: 0, failures: 0 };
  persistUntil(0);
  notify();
};

/** Nothing left to refresh (signed out): drop the cooldown so the next session starts clean. */
export const clearRefreshBlock = clearCooldown;

const pausedError = () =>
  new TypeError(`Token refresh paused: rate limited, retry in ${Math.ceil(getRefreshBlockRemainingMs() / 1000)}s`);

export const createRefreshGuardFetch = (baseFetch = (...args) => globalThis.fetch(...args)) =>
  async (input, init) => {
    if (!isRefreshRequest(input)) return baseFetch(input, init);
    if (isRefreshBlocked()) throw pausedError();

    const response = await baseFetch(input, init);
    if (response.status === 429) {
      startCooldown(response.headers?.get?.('Retry-After'));
      throw pausedError();
    }
    if (response.ok) clearCooldown();
    return response;
  };
