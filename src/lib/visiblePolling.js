// src/lib/visiblePolling.js
//
// The one polling helper of the app (Supabase egress budget, Free plan). A resource is a key + fetcher shared by every
// subscriber of that key: one request per interval per tab, whatever the number of components showing it.
//  - Runs only while the tab is visible. Hidden: timers stop and a refresh only marks the data stale. Visible again:
//    reloads at once when stale or older than POLL_FRESH_MS (today's 30 s freshness), then resumes.
//  - Skips ticks while the token refresh is blocked (skipWhileRefreshBlocked) and catches up when it clears.
//  - Interval jitter ±10 %, exponential backoff on errors (capped at 10 min), reset after a success.
//  - refreshPoll(key) runs now (realtime event, own mutation, view opened); calls made while a request is in flight
//    coalesce into ONE rerun, because the in-flight answer may predate the change.
//  - refreshOnWrite(path): own writes through the Supabase client (requestBudget's write signal) refresh the
//    resource at once, without waiting for the interval or realtime.
import { useCallback, useEffect, useRef } from 'react';
import { getRefreshBlockRemainingMs, skipWhileRefreshBlocked, subscribeRefreshBlock } from '@/lib/refreshGuard';
import { subscribeApiWrites } from '@/lib/requestBudget';

export const POLL_FRESH_MS = 30_000;
export const POLL_MAX_BACKOFF_MS = 10 * 60_000;
/** Counter whose changes already arrive by realtime: the poll is only a safety net. */
export const POLL_REALTIME_FALLBACK_MS = 5 * 60_000;
export const POLL_COUNTER_MS = 2 * 60_000;
export const POLL_STATS_MS = 5 * 60_000;
const JITTER = 0.1;

const resources = new Map();
const watchers = new Map();

const isHidden = () => typeof document !== 'undefined' && document.hidden === true;

const emit = (res, kind, payload) => {
  res.subs.forEach((sub) => {
    try {
      sub[kind]?.(payload);
    } catch {
      // a faulty subscriber must not break the others
    }
  });
  if (kind === 'onData') watchers.get(res.key)?.forEach((listener) => listener(payload));
};

const intervalOf = (res) => Math.min(...[...res.subs].map((sub) => sub.intervalMs));

const schedule = (res) => {
  clearTimeout(res.timer);
  if (isHidden() || res.subs.size === 0) return;
  const base = intervalOf(res);
  const wait = res.failures ? base * 2 ** res.failures : base;
  const jittered = wait * (1 + (Math.random() * 2 - 1) * JITTER);
  res.timer = setTimeout(() => tick(res), Math.min(jittered, POLL_MAX_BACKOFF_MS));
};

const run = (res) => {
  if (res.inFlight) {
    res.rerun = res.rerun || {};
    res.rerun.promise = res.rerun.promise || new Promise((resolve) => { res.rerun.resolve = resolve; });
    return res.rerun.promise;
  }
  clearTimeout(res.timer);
  res.stale = false;
  const [first] = res.subs;
  res.inFlight = Promise.resolve()
    .then(() => first.fetcher())
    .then(
      (value) => {
        res.value = value;
        res.fetchedAt = Date.now();
        res.failures = 0;
        emit(res, 'onData', value);
      },
      (error) => {
        res.failures += 1;
        emit(res, 'onError', error);
      }
    )
    .finally(() => {
      res.inFlight = null;
      const rerun = res.rerun;
      res.rerun = null;
      if (resources.get(res.key) !== res) {
        rerun?.resolve();
        return;
      }
      if (rerun) {
        Promise.resolve(runNow(res)).then(rerun.resolve);
      } else {
        schedule(res);
      }
    });
  return res.inFlight;
};

const guardedRun = skipWhileRefreshBlocked(run);

/** Hidden or refresh blocked: keep the last value, remember it is stale (blocked: look again when the cooldown ends). */
const runNow = (res) => {
  const started = guardedRun(res);
  if (started === undefined) {
    res.stale = true;
    schedule(res);
    const blockedMs = getRefreshBlockRemainingMs();
    if (blockedMs > 0 && !isHidden() && res.subs.size > 0) {
      clearTimeout(res.timer);
      res.timer = setTimeout(() => tick(res), Math.min(intervalOf(res), blockedMs + 1_000));
    }
  }
  return started;
};

function tick(res) {
  runNow(res);
}

const resume = () => {
  resources.forEach((res) => {
    if (res.inFlight) return;
    if (res.stale || !res.fetchedAt || Date.now() - res.fetchedAt >= POLL_FRESH_MS) runNow(res);
    else schedule(res);
  });
};

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (isHidden()) resources.forEach((res) => clearTimeout(res.timer));
    else resume();
  });
}
subscribeRefreshBlock((blocked) => {
  if (!blocked) resources.forEach((res) => { if (res.stale && !res.inFlight) runNow(res); });
});
subscribeApiWrites((path) => {
  resources.forEach((res) => {
    if ([...res.subs].some((sub) => sub.refreshOnWrite?.(path))) runNow(res);
  });
});

/**
 * @param {string} key shared by every subscriber of the same data
 * @param {() => Promise<*>} fetcher
 * @param {{ intervalMs: number, onData?: Function, onError?: Function, refreshOnWrite?: (path: string) => boolean,
 *   immediate?: boolean }} options (immediate: false = the caller already has the data, first run after one interval)
 * @returns {() => void} unsubscribe
 */
export const subscribePoll = (key, fetcher, { intervalMs, onData, onError, refreshOnWrite, immediate = true } = {}) => {
  let res = resources.get(key);
  if (!res) {
    res = { key, subs: new Set(), value: undefined, fetchedAt: 0, failures: 0, inFlight: null, rerun: null, timer: null, stale: false };
    resources.set(key, res);
  }
  const sub = { fetcher, intervalMs, onData, onError, refreshOnWrite };
  res.subs.add(sub);

  if (res.inFlight) {
    // its answer reaches this subscriber too
  } else if (!immediate) {
    res.fetchedAt = res.fetchedAt || Date.now(); // the caller just loaded it: first run after one interval
    schedule(res);
  } else if (res.fetchedAt && Date.now() - res.fetchedAt < POLL_FRESH_MS) {
    const { value } = res;
    queueMicrotask(() => { if (res.subs.has(sub)) onData?.(value); });
    schedule(res);
  } else {
    runNow(res);
  }

  return () => {
    res.subs.delete(sub);
    if (res.subs.size > 0) return;
    clearTimeout(res.timer);
    if (resources.get(key) === res) resources.delete(key);
  };
};

/** Runs the resource now (coalesced). Resolves when its data (or error) has been delivered. */
export const refreshPoll = (key) => {
  const res = resources.get(key);
  return res ? Promise.resolve(runNow(res)) : Promise.resolve();
};

/** Passive listener: notified of every new value of `key`, never fetches nor keeps it alive. */
export const watchPoll = (key, listener) => {
  if (!watchers.has(key)) watchers.set(key, new Set());
  watchers.get(key).add(listener);
  return () => watchers.get(key)?.delete(listener);
};

/** Test helper. */
export const resetPolling = () => {
  resources.forEach((res) => clearTimeout(res.timer));
  resources.clear();
  watchers.clear();
};

/**
 * Hook over subscribePoll. Callbacks are read through a ref, so they may change every render.
 * @returns {() => Promise<void>} refresh now
 */
export const useVisiblePolling = (key, fetcher, { intervalMs, enabled = true, onData, onError, refreshOnWrite, immediate = true } = {}) => {
  const ref = useRef({ fetcher, onData, onError, refreshOnWrite });
  ref.current = { fetcher, onData, onError, refreshOnWrite };

  useEffect(() => {
    if (!enabled) return undefined;
    return subscribePoll(key, () => ref.current.fetcher(), {
      intervalMs,
      onData: (value) => ref.current.onData?.(value),
      onError: (error) => ref.current.onError?.(error),
      refreshOnWrite: (path) => Boolean(ref.current.refreshOnWrite?.(path)),
      immediate
    });
  }, [key, enabled, intervalMs, immediate]);

  return useCallback(() => refreshPoll(key), [key]);
};
