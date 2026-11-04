import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createRefreshGuardFetch,
  isRefreshRequest,
  isRefreshBlocked,
  getRefreshBlockRemainingMs,
  subscribeRefreshBlock,
  resetRefreshGuard,
  REFRESH_RATE_LIMIT_BASE_MS,
  REFRESH_RATE_LIMIT_MAX_MS
} from '@/lib/refreshGuard';

const REFRESH_URL = 'https://x.supabase.co/auth/v1/token?grant_type=refresh_token';
const res = (status, headers = {}) => new Response('{}', { status, headers });

describe('refreshGuard — fetch wrapper for the Supabase refresh endpoint', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-04T18:30:00Z'));
    localStorage.clear();
    resetRefreshGuard();
  });
  afterEach(() => vi.useRealTimers());

  it('recognises only refresh-token grants', () => {
    expect(isRefreshRequest(REFRESH_URL)).toBe(true);
    expect(isRefreshRequest(new URL(REFRESH_URL))).toBe(true);
    expect(isRefreshRequest({ url: REFRESH_URL })).toBe(true);
    expect(isRefreshRequest('https://x.supabase.co/auth/v1/token?grant_type=password')).toBe(false);
    expect(isRefreshRequest('https://x.supabase.co/rest/v1/user_profiles')).toBe(false);
    // Same words in a different place are not the refresh endpoint.
    expect(isRefreshRequest('https://x.supabase.co/rest/v1/notes?q=/auth/v1/token&grant_type=refresh_token')).toBe(false);
    expect(isRefreshRequest('https://x.supabase.co/auth/v1/token_info?grant_type=refresh_token')).toBe(false);
    expect(isRefreshRequest('not a url')).toBe(false);
  });

  it('passes every other request through untouched, even while blocked', async () => {
    const base = vi.fn().mockResolvedValue(res(200));
    const guarded = createRefreshGuardFetch(base);
    await guarded(REFRESH_URL).catch(() => {}); // not blocked yet: base returns 200
    base.mockResolvedValueOnce(res(429));
    await expect(guarded(REFRESH_URL)).rejects.toThrow(TypeError);
    expect(isRefreshBlocked()).toBe(true);

    const rest = await guarded('https://x.supabase.co/rest/v1/orders');
    expect(rest.status).toBe(200);
    const pwd = await guarded('https://x.supabase.co/auth/v1/token?grant_type=password');
    expect(pwd.status).toBe(200);
  });

  it('turns a 429 into a thrown network-like error (so auth-js keeps the session) and blocks further refreshes without touching the network', async () => {
    const base = vi.fn().mockResolvedValue(res(429));
    const guarded = createRefreshGuardFetch(base);

    await expect(guarded(REFRESH_URL)).rejects.toThrow(/rate limited/i);
    expect(base).toHaveBeenCalledTimes(1);
    expect(isRefreshBlocked()).toBe(true);

    for (let i = 0; i < 10; i += 1) {
      await expect(guarded(REFRESH_URL)).rejects.toThrow(TypeError);
    }
    expect(base).toHaveBeenCalledTimes(1);
  });

  it('honours Retry-After in seconds (never retries earlier, jitter only adds)', async () => {
    const guarded = createRefreshGuardFetch(vi.fn().mockResolvedValue(res(429, { 'Retry-After': '90' })));
    await guarded(REFRESH_URL).catch(() => {});
    const remaining = getRefreshBlockRemainingMs();
    expect(remaining).toBeGreaterThanOrEqual(90_000);
    expect(remaining).toBeLessThanOrEqual(90_000 * 1.2 + 1);
  });

  it('honours Retry-After as an HTTP date', async () => {
    const at = new Date(Date.now() + 120_000).toUTCString();
    const guarded = createRefreshGuardFetch(vi.fn().mockResolvedValue(res(429, { 'Retry-After': at })));
    await guarded(REFRESH_URL).catch(() => {});
    const remaining = getRefreshBlockRemainingMs();
    expect(remaining).toBeGreaterThan(118_000);
    expect(remaining).toBeLessThanOrEqual(120_000 * 1.2 + 1);
  });

  it('without Retry-After uses exponential backoff with jitter, capped', async () => {
    const base = vi.fn().mockResolvedValue(res(429));
    const guarded = createRefreshGuardFetch(base);
    const durations = [];
    for (let i = 0; i < 8; i += 1) {
      await guarded(REFRESH_URL).catch(() => {});
      durations.push(getRefreshBlockRemainingMs());
      vi.advanceTimersByTime(getRefreshBlockRemainingMs() + 1); // cooldown over: next call reaches the network
    }
    expect(durations[0]).toBeGreaterThanOrEqual(REFRESH_RATE_LIMIT_BASE_MS);
    expect(durations[0]).toBeLessThanOrEqual(REFRESH_RATE_LIMIT_BASE_MS * 1.2 + 1);
    expect(durations[1]).toBeGreaterThanOrEqual(REFRESH_RATE_LIMIT_BASE_MS * 2);
    expect(durations[2]).toBeGreaterThanOrEqual(REFRESH_RATE_LIMIT_BASE_MS * 4);
    expect(Math.max(...durations)).toBeLessThanOrEqual(REFRESH_RATE_LIMIT_MAX_MS * 1.2 + 1);
    expect(base).toHaveBeenCalledTimes(8);
  });

  it('lets exactly one refresh through once the cooldown is over, and a success clears the block and the backoff', async () => {
    const base = vi.fn().mockResolvedValueOnce(res(429)).mockResolvedValue(res(200));
    const guarded = createRefreshGuardFetch(base);
    await guarded(REFRESH_URL).catch(() => {});

    vi.advanceTimersByTime(getRefreshBlockRemainingMs() + 1);
    expect(isRefreshBlocked()).toBe(false);
    const ok = await guarded(REFRESH_URL);
    expect(ok.status).toBe(200);
    expect(base).toHaveBeenCalledTimes(2);

    base.mockResolvedValueOnce(res(429));
    await guarded(REFRESH_URL).catch(() => {});
    expect(getRefreshBlockRemainingMs()).toBeLessThanOrEqual(REFRESH_RATE_LIMIT_BASE_MS * 1.2 + 1); // backoff restarted
  });

  it('does not treat other failures (invalid refresh token, 5xx) as rate limiting: they flow to auth-js unchanged', async () => {
    const base = vi.fn().mockResolvedValue(res(400));
    const guarded = createRefreshGuardFetch(base);
    expect((await guarded(REFRESH_URL)).status).toBe(400);
    base.mockResolvedValue(res(503));
    expect((await guarded(REFRESH_URL)).status).toBe(503);
    expect(isRefreshBlocked()).toBe(false);
  });

  it('notifies subscribers when blocked and when a success clears it', async () => {
    const base = vi.fn().mockResolvedValueOnce(res(429)).mockResolvedValue(res(200));
    const guarded = createRefreshGuardFetch(base);
    const seen = [];
    const off = subscribeRefreshBlock((blocked) => seen.push(blocked));

    await guarded(REFRESH_URL).catch(() => {});
    vi.advanceTimersByTime(getRefreshBlockRemainingMs() + 1);
    await guarded(REFRESH_URL);
    off();
    await guarded(REFRESH_URL);

    expect(seen).toEqual([true, false]);
  });

  it('shares the cooldown across reloads/tabs through localStorage and ignores a tampered far-future value', async () => {
    const guarded = createRefreshGuardFetch(vi.fn().mockResolvedValue(res(429)));
    await guarded(REFRESH_URL).catch(() => {});
    const persisted = JSON.parse(localStorage.getItem('papuenvios-refresh-block'));
    expect(persisted.until).toBeGreaterThan(Date.now());
    expect(persisted.failures).toBe(1);

    // New page load: module state is gone, storage still says "blocked".
    const base = vi.fn().mockResolvedValue(res(200));
    resetRefreshGuard({ keepStorage: true });
    expect(isRefreshBlocked()).toBe(true);
    await expect(createRefreshGuardFetch(base)(REFRESH_URL)).rejects.toThrow(TypeError);
    expect(base).not.toHaveBeenCalled();

    localStorage.setItem('papuenvios-refresh-block', JSON.stringify({ until: Date.now() + 10 * 24 * 3600 * 1000, failures: 3 }));
    resetRefreshGuard({ keepStorage: true });
    expect(getRefreshBlockRemainingMs()).toBeLessThanOrEqual(REFRESH_RATE_LIMIT_MAX_MS);
  });

  it.each([
    ['0', 'never hammers: floor at the base cooldown'],
    ['-5', 'negative: floor at the base cooldown'],
    ['abc', 'garbage: normal backoff']
  ])('Retry-After %s -> %s', async (value) => {
    const guarded = createRefreshGuardFetch(vi.fn().mockResolvedValue(res(429, { 'Retry-After': value })));
    await guarded(REFRESH_URL).catch(() => {});
    const remaining = getRefreshBlockRemainingMs();
    expect(remaining).toBeGreaterThanOrEqual(REFRESH_RATE_LIMIT_BASE_MS);
    expect(remaining).toBeLessThanOrEqual(REFRESH_RATE_LIMIT_BASE_MS * 1.2 + 1);
  });

  it('a huge Retry-After (24 h) cannot block refreshes for hours: capped', async () => {
    const guarded = createRefreshGuardFetch(vi.fn().mockResolvedValue(res(429, { 'Retry-After': '86400' })));
    await guarded(REFRESH_URL).catch(() => {});
    expect(getRefreshBlockRemainingMs()).toBeLessThanOrEqual(REFRESH_RATE_LIMIT_MAX_MS * 1.2 + 1);
    expect(getRefreshBlockRemainingMs()).toBeGreaterThanOrEqual(REFRESH_RATE_LIMIT_MAX_MS);
  });

  it.each([408, 500, 501, 505, 520, 522])('a %i on refresh is a temporary failure: cooldown + retryable error, not a pass-through', async (status) => {
    const base = vi.fn().mockResolvedValue(res(status));
    const guarded = createRefreshGuardFetch(base);
    await expect(guarded(REFRESH_URL)).rejects.toThrow(TypeError);
    expect(isRefreshBlocked()).toBe(true);
    await expect(guarded(REFRESH_URL)).rejects.toThrow(TypeError);
    expect(base).toHaveBeenCalledTimes(1);
  });

  it('the failure backoff keeps growing across reloads (failures are persisted with the cooldown)', async () => {
    const guarded = createRefreshGuardFetch(vi.fn().mockResolvedValue(res(429)));
    await guarded(REFRESH_URL).catch(() => {});
    vi.advanceTimersByTime(getRefreshBlockRemainingMs() + 1);
    await guarded(REFRESH_URL).catch(() => {});
    vi.advanceTimersByTime(getRefreshBlockRemainingMs() + 1);

    resetRefreshGuard({ keepStorage: true }); // reload
    await createRefreshGuardFetch(vi.fn().mockResolvedValue(res(429)))(REFRESH_URL).catch(() => {});

    expect(getRefreshBlockRemainingMs()).toBeGreaterThanOrEqual(REFRESH_RATE_LIMIT_BASE_MS * 4); // third failure
  });

  it('keeps reading a legacy numeric value', () => {
    localStorage.setItem('papuenvios-refresh-block', String(Date.now() + 20_000));
    resetRefreshGuard({ keepStorage: true });
    expect(getRefreshBlockRemainingMs()).toBeGreaterThan(19_000);
  });

  it('follows another tab: a cooldown written there blocks here, and clearing it there unblocks here', () => {
    const seen = [];
    const off = subscribeRefreshBlock((blocked) => seen.push(blocked));
    const until = Date.now() + 60_000;

    localStorage.setItem('papuenvios-refresh-block', JSON.stringify({ until, failures: 1 }));
    window.dispatchEvent(new StorageEvent('storage', { key: 'papuenvios-refresh-block', newValue: JSON.stringify({ until, failures: 1 }) }));
    expect(isRefreshBlocked()).toBe(true);

    localStorage.removeItem('papuenvios-refresh-block');
    window.dispatchEvent(new StorageEvent('storage', { key: 'papuenvios-refresh-block', newValue: null }));
    expect(isRefreshBlocked()).toBe(false);
    off();

    expect(seen).toEqual([true, false]);
  });

  it('ignores storage events for other keys', () => {
    const listener = vi.fn();
    const off = subscribeRefreshBlock(listener);
    window.dispatchEvent(new StorageEvent('storage', { key: 'something-else', newValue: 'x' }));
    off();
    expect(listener).not.toHaveBeenCalled();
  });

  it('works when storage is unavailable', async () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied'); });
    const guarded = createRefreshGuardFetch(vi.fn().mockResolvedValue(res(429)));
    await expect(guarded(REFRESH_URL)).rejects.toThrow(TypeError);
    expect(isRefreshBlocked()).toBe(true);
    spy.mockRestore();
  });
});
