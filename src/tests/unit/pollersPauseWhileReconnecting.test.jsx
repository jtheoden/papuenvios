import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, render, screen, act } from '@testing-library/react';

// While the token refresh is in its cooldown every poll would stall on auth-js's lock and then go
// out with the anon key (RLS answers 0 rows / 401). Pollers therefore skip their tick, keep the
// last value on screen, and resume by themselves.

const state = { orders: 2, remittances: 1, handlers: {} };

vi.mock('@/lib/orderService', () => ({ getPendingOrdersCount: vi.fn(async () => state.orders) }));
vi.mock('@/lib/refundService', () => ({
  REFUNDS_CHANGED_EVENT: 'papuenvios:refunds-changed',
  getRefundCounts: vi.fn(async () => ({ actionable: 0, onHold: 0, dueSoon: 0, overdue: 0, pendingAmountUsd: 0 })),
  listRefunds: vi.fn(async () => ({ total: 0, items: [] }))
}));
vi.mock('@/lib/remittanceService', () => ({
  TO_PROCESS_STATUSES: ['payment_proof_uploaded'],
  getPendingRemittancesCount: vi.fn(async () => state.remittances),
  getAdminWorkRemittances: vi.fn(async () => [])
}));
vi.mock('@/hooks/useRealtimeSubscription', () => ({
  useRealtimeOrders: vi.fn(({ onUpdate }) => { state.handlers.orders = onUpdate; return { isSubscribed: true }; }),
  useRealtimeRemittances: vi.fn(({ onUpdate }) => { state.handlers.remittances = onUpdate; return { isSubscribed: true }; })
}));
vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({ language: 'es', setLanguage: vi.fn(), t: (k, params) => (params ? `${k}:${params.count}` : k) })
}));
vi.mock('@/contexts/BusinessContext', () => ({ useBusiness: () => ({ cart: [], visualSettings: {} }) }));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'u1', email: 'a@b.c' },
    isAdmin: true,
    userRole: 'admin',
    userCategory: 'regular',
    roleStatus: 'resolved',
    roleFetchFailed: false,
    sessionStatus: 'ok',
    retryRoleResolution: vi.fn()
  })
}));
vi.mock('@/components/ui/use-toast', () => ({ toast: vi.fn() }));
vi.mock('@/components/ui/user-avatar', () => ({ UserAvatar: () => <span data-testid="avatar" /> }));

import Header from '@/components/Header';
import { usePendingRemittances } from '@/hooks/usePendingRemittances';
import { useRefundQueue } from '@/hooks/useRefundQueue';
import { useRefundCounts } from '@/hooks/useRefundCounts';
import { getAdminWorkRemittances } from '@/lib/remittanceService';
import { listRefunds, getRefundCounts } from '@/lib/refundService';
import { refreshPoll } from '@/lib/visiblePolling';
import { REFUND_COUNTS_KEY } from '@/lib/adminPollKeys';
import {
  createRefreshGuardFetch, resetRefreshGuard, skipWhileRefreshBlocked, isRefreshBlocked
} from '@/lib/refreshGuard';

const REFRESH_URL = 'https://x.supabase.co/auth/v1/token?grant_type=refresh_token';
const blockRefresh = (retryAfter) => createRefreshGuardFetch(async () => new Response('{}', { status: 429, headers: retryAfter ? { 'Retry-After': retryAfter } : {} }))(REFRESH_URL).catch(() => {});
const advance = (ms) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

describe('pollers pause while the token refresh is blocked', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0); // cooldown = exactly 30 s
    localStorage.clear();
    resetRefreshGuard();
    state.orders = 2;
    state.remittances = 1;
    state.handlers = {};
    getAdminWorkRemittances.mockClear();
    listRefunds.mockClear();
    getRefundCounts.mockClear();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('skipWhileRefreshBlocked runs the function only when the refresh is not blocked', async () => {
    const fn = vi.fn();
    const guarded = skipWhileRefreshBlocked(fn);
    guarded();
    await blockRefresh();
    guarded();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('skipWhileRefreshBlocked also skips while the tab is hidden (no egress for background tabs)', () => {
    const fn = vi.fn();
    const guarded = skipWhileRefreshBlocked(fn);
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    guarded();
    hidden.mockReturnValue(false);
    guarded();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('admin badge does not poll while the tab is hidden', async () => {
    const { getPendingOrdersCount } = await import('@/lib/orderService');
    render(<Header currentPage="home" onNavigate={() => {}} />);
    await advance(1000);
    const first = getPendingOrdersCount.mock.calls.length;
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    await advance(90_000);
    expect(getPendingOrdersCount.mock.calls.length).toBe(first);
  });

  it('admin badge keeps its last count (never "0 pending") while reconnecting, and refreshes again afterwards', async () => {
    render(<Header currentPage="home" onNavigate={() => {}} />);
    await advance(1000);
    expect(screen.getByText('3')).toBeTruthy();

    await act(async () => { await blockRefresh(); });
    // What an anon-key request would see: RLS hides everything.
    state.orders = 0;
    state.remittances = 0;
    await act(async () => { state.handlers.orders({ eventType: 'UPDATE' }); });
    await advance(29_000); // the 30 s poll tick falls inside the cooldown (blocked at t=1 s -> until t=31 s)
    expect(screen.getByText('3')).toBeTruthy();

    await advance(31_000); // cooldown over: the next tick (t=60 s) refreshes with real data
    expect(isRefreshBlocked()).toBe(false);
    expect(screen.queryByText('3')).toBeNull();
  });

  it('usePendingRemittances skips its poll during the cooldown and runs it as soon as the cooldown ends', async () => {
    renderHook(() => usePendingRemittances({ enabled: true }));
    await advance(1000);
    const first = getAdminWorkRemittances.mock.calls.length;

    await act(async () => { await blockRefresh(); }); // blocked from t=1 s until t=31 s
    await advance(268_000); // the 5-min tick (270 s with this jitter) is after the cooldown: nothing yet
    expect(getAdminWorkRemittances.mock.calls.length).toBe(first);
    await advance(2_000);
    expect(getAdminWorkRemittances.mock.calls.length).toBe(first + 1);
  });

  it('useRefundQueue skips its poll during the cooldown and runs it as soon as the cooldown ends', async () => {
    renderHook(() => useRefundQueue({ enabled: true }));
    await advance(1000);
    const first = listRefunds.mock.calls.length;

    await act(async () => { await blockRefresh(); }); // blocked from t=1 s until t=31 s
    await advance(268_000); // the 5-min tick (270 s with this jitter) is after the cooldown: nothing yet
    expect(listRefunds.mock.calls.length).toBe(first);
    await advance(2_000);
    expect(listRefunds.mock.calls.length).toBe(first + 1);
  });

  it('useRefundCounts skips its refresh during the cooldown and keeps the last counts', async () => {
    getRefundCounts.mockResolvedValue({ actionable: 4, onHold: 0, dueSoon: 0, overdue: 1, pendingAmountUsd: 0 });
    const { result } = renderHook(() => useRefundCounts({ enabled: true }));
    await advance(1000);
    const first = getRefundCounts.mock.calls.length;
    expect(result.current?.actionable).toBe(4);

    await act(async () => { await blockRefresh('120'); }); // blocked from t=1 s until t=121 s
    getRefundCounts.mockRejectedValue(new Error('anon'));
    await act(async () => { await refreshPoll(REFUND_COUNTS_KEY); }); // e.g. an own write inside the cooldown
    await advance(119_000);
    expect(getRefundCounts.mock.calls.length).toBe(first);
    expect(result.current?.actionable).toBe(4);

    await advance(2_000); // cooldown over: the skipped refresh runs at once instead of waiting for the 5-min tick
    expect(getRefundCounts.mock.calls.length).toBe(first + 1);
  });
});
