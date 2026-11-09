// src/lib/sessionRefresh.js
//
// The only sanctioned way to FORCE a token refresh (auth.refreshSession() refreshes even when the token has
// hours left). Everything else must rely on auth-js (autoRefreshToken / getSession), which refreshes only when
// due. Concurrent callers share one in-flight request, and nothing is sent during the refresh guard's cooldown.
import { isRefreshBlocked } from '@/lib/refreshGuard';

let inFlight = null;

const pausedResult = () => ({
  data: { user: null, session: null },
  error: Object.assign(new Error('Token refresh paused: rate limited or unavailable'), { name: 'AuthRetryableFetchError', status: 0 })
});

/** @param {{ refreshSession: () => Promise<{data: object, error: object|null}> }} auth supabase.auth */
export const refreshSessionOnce = (auth) => {
  if (isRefreshBlocked()) return Promise.resolve(pausedResult());
  if (!inFlight) inFlight = Promise.resolve(auth.refreshSession()).finally(() => { inFlight = null; });
  return inFlight;
};
