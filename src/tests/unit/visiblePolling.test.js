import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  subscribePoll, refreshPoll, watchPoll, resetPolling, POLL_MAX_BACKOFF_MS, POLL_FRESH_MS
} from '@/lib/visiblePolling';
import { createRefreshGuardFetch, resetRefreshGuard } from '@/lib/refreshGuard';

const setVisibility = (state) => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => state === 'hidden' });
  document.dispatchEvent(new Event('visibilitychange'));
};
const advance = (ms) => vi.advanceTimersByTimeAsync(ms);
const REFRESH_URL = 'https://x.supabase.co/auth/v1/token?grant_type=refresh_token';
const blockRefresh = () => createRefreshGuardFetch(async () => new Response('{}', { status: 429 }))(REFRESH_URL).catch(() => {});

describe('visiblePolling', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0.5); // jitter factor exactly 1
    localStorage.clear();
    resetRefreshGuard();
    resetPolling();
    setVisibility('visible');
  });
  afterEach(() => {
    resetPolling();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('loads at once and then once per interval while visible', async () => {
    const fetcher = vi.fn(async () => 1);
    const onData = vi.fn();
    subscribePoll('k', fetcher, { intervalMs: 120_000, onData });
    await advance(0);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(onData).toHaveBeenCalledWith(1);
    await advance(119_000);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await advance(1_000);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('two subscribers of the same key share one request and both get the value', async () => {
    const fetcher = vi.fn(async () => 7);
    const a = vi.fn();
    const b = vi.fn();
    subscribePoll('k', fetcher, { intervalMs: 120_000, onData: a });
    subscribePoll('k', fetcher, { intervalMs: 120_000, onData: b });
    await advance(0);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(a).toHaveBeenCalledWith(7);
    expect(b).toHaveBeenCalledWith(7);
    await advance(120_000);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('a late subscriber reuses a fresh value instead of fetching again', async () => {
    const fetcher = vi.fn(async () => 3);
    subscribePoll('k', fetcher, { intervalMs: 120_000 });
    await advance(POLL_FRESH_MS - 1_000);
    const late = vi.fn();
    subscribePoll('k', fetcher, { intervalMs: 120_000, onData: late });
    await advance(0);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(late).toHaveBeenCalledWith(3);
  });

  it('jitters the interval by at most ±10 %', async () => {
    Math.random.mockReturnValue(0); // -10 %
    const fetcher = vi.fn(async () => 1);
    subscribePoll('k', fetcher, { intervalMs: 100_000 });
    await advance(0);
    await advance(89_999);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('pauses while hidden (0 requests) and reloads at once when the tab is visible again', async () => {
    const fetcher = vi.fn(async () => 1);
    subscribePoll('k', fetcher, { intervalMs: 120_000 });
    await advance(0);
    setVisibility('hidden');
    await advance(60 * 60_000);
    expect(fetcher).toHaveBeenCalledTimes(1);
    refreshPoll('k'); // e.g. a realtime event while hidden: only marks the data stale
    await advance(0);
    expect(fetcher).toHaveBeenCalledTimes(1);
    setVisibility('visible');
    await advance(0);
    expect(fetcher).toHaveBeenCalledTimes(2);
    await advance(120_000);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('a quick hide/show with fresh data does not refetch', async () => {
    const fetcher = vi.fn(async () => 1);
    subscribePoll('k', fetcher, { intervalMs: 120_000 });
    await advance(0);
    setVisibility('hidden');
    await advance(5_000);
    setVisibility('visible');
    await advance(0);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('refreshPoll runs now, and coalesces calls made while a request is in flight into one rerun', async () => {
    let resolve;
    const fetcher = vi.fn(() => new Promise((r) => { resolve = r; }));
    const onData = vi.fn();
    subscribePoll('k', fetcher, { intervalMs: 120_000, onData });
    await advance(0);
    refreshPoll('k');
    refreshPoll('k');
    const done = refreshPoll('k');
    expect(fetcher).toHaveBeenCalledTimes(1);
    resolve('old');
    await advance(0);
    expect(fetcher).toHaveBeenCalledTimes(2); // one rerun: the first answer may predate the change
    resolve('new');
    await done;
    expect(onData).toHaveBeenLastCalledWith('new');
  });

  it('backs off exponentially on errors (capped at 10 min) and resets after a success', async () => {
    let fail = true;
    const fetcher = vi.fn(async () => { if (fail) throw new Error('x'); return 1; });
    const onError = vi.fn();
    subscribePoll('k', fetcher, { intervalMs: 120_000, onError });
    await advance(0);
    expect(onError).toHaveBeenCalledTimes(1);
    await advance(240_000); // 2x
    expect(fetcher).toHaveBeenCalledTimes(2);
    await advance(480_000); // 4x
    expect(fetcher).toHaveBeenCalledTimes(3);
    await advance(POLL_MAX_BACKOFF_MS); // capped
    expect(fetcher).toHaveBeenCalledTimes(4);
    fail = false;
    await advance(POLL_MAX_BACKOFF_MS);
    expect(fetcher).toHaveBeenCalledTimes(5);
    await advance(120_000); // back to the base interval
    expect(fetcher).toHaveBeenCalledTimes(6);
  });

  it('skips ticks while the token refresh is blocked and catches up when it clears', async () => {
    const fetcher = vi.fn(async () => 1);
    subscribePoll('k', fetcher, { intervalMs: 20_000 });
    await advance(0);
    await blockRefresh(); // 33 s cooldown
    await advance(20_000); // t=20 s tick inside the cooldown
    expect(fetcher).toHaveBeenCalledTimes(1);
    await advance(20_000); // t=40 s tick after it
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('stops when the last subscriber leaves', async () => {
    const fetcher = vi.fn(async () => 1);
    const off = subscribePoll('k', fetcher, { intervalMs: 120_000 });
    await advance(0);
    off();
    await advance(600_000);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('watchPoll is notified of new data without fetching by itself', async () => {
    const seen = vi.fn();
    const offWatch = watchPoll('k', seen);
    await advance(600_000);
    expect(seen).not.toHaveBeenCalled();
    subscribePoll('k', async () => 9, { intervalMs: 120_000 });
    await advance(0);
    expect(seen).toHaveBeenCalledWith(9);
    offWatch();
  });
});
