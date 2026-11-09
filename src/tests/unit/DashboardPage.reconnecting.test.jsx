import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const state = vi.hoisted(() => ({ productCalls: 0, gate: null }));
const stable = vi.hoisted(() => ({
  auth: { user: { id: 'su' }, isAdmin: true, isSuperAdmin: true, sessionStatus: 'ok' },
  business: { products: [], combos: [], financialSettings: { productProfit: 40 }, visualSettings: {} }
}));

vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => stable.auth }));
vi.mock('@/contexts/LanguageContext', () => ({ useLanguage: () => ({ t: (key) => key, language: 'en' }) }));
vi.mock('@/contexts/BusinessContext', () => ({ useBusiness: () => stable.business }));
vi.mock('@/hooks/useRealtimeSubscription', () => ({
  useRealtimeOrders: vi.fn(),
  useRealtimeRemittances: vi.fn(),
  useRealtimeSubscription: vi.fn()
}));
vi.mock('@/lib/styleUtils', () => ({ getHeadingStyle: () => ({}) }));
vi.mock('@/components/TabsResponsive', () => ({
  default: ({ tabs, activeTab }) => tabs.find((tab) => tab.id === activeTab)?.content ?? null
}));
vi.mock('@/components/AdminOrdersTab', () => ({ default: () => null }));
vi.mock('@/components/AdminRemittancesTab', () => ({ default: () => null }));
vi.mock('@/components/AdminOffersTab', () => ({ default: () => null }));
vi.mock('@/components/RemittanceTypesConfig', () => ({ default: () => null }));
vi.mock('@/components/admin/ZellePaymentHistoryTab', () => ({ default: () => null }));
vi.mock('@/components/ActivityLogTab', () => ({ default: () => null }));
vi.mock('@/lib/supabase', () => {
  const emptyChain = (table) => {
    if (table === 'products') state.productCalls += 1;
    const chain = {};
    ['select', 'eq', 'in', 'order', 'range', 'gte'].forEach((m) => { chain[m] = () => chain; });
    // state.gate (a promise) holds a products read open, like a read queued behind auth-js's lock
    chain.then = (resolve) => (table === 'products' && state.gate ? state.gate : Promise.resolve())
      .then(() => resolve({ data: [], count: 0, error: null }));
    return chain;
  };
  return { supabase: { from: (table) => emptyChain(table), rpc: async () => ({ data: [], error: null }) } };
});

import DashboardPage from '@/components/DashboardPage';
import { createRefreshGuardFetch, resetRefreshGuard } from '@/lib/refreshGuard';

const REFRESH_URL = 'https://x.supabase.co/auth/v1/token?grant_type=refresh_token';
const block = () => createRefreshGuardFetch(async () => new Response('{}', { status: 429 }))(REFRESH_URL).catch(() => {});

describe('DashboardPage while the session is reconnecting', () => {
  beforeEach(() => {
    state.productCalls = 0;
    state.gate = null;
    stable.auth.sessionStatus = 'ok';
    localStorage.clear();
    resetRefreshGuard();
  });

  it('shows the reconnecting notice with a retry instead of zeros / "no data" tiles, and no error banner', async () => {
    stable.auth.sessionStatus = 'reconnecting';
    await block();
    render(<DashboardPage onNavigate={() => {}} />);

    expect(await screen.findByTestId('reconnecting-notice')).toBeTruthy();
    expect(screen.getByText('auth.sessionReconnecting')).toBeTruthy();
    expect(screen.queryByText('dashboard.stats.totalProducts')).toBeNull();
    expect(screen.queryByTestId('refund-kpis')).toBeNull();
    expect(screen.queryByTestId('stats-error')).toBeNull();
  });

  it('a load that finishes while the refresh is blocked was read with the anon key: it is discarded, not shown as zeros', async () => {
    stable.auth.sessionStatus = 'reconnecting';
    await block();
    render(<DashboardPage onNavigate={() => {}} />);
    await screen.findByTestId('reconnecting-notice');

    fireEvent.click(screen.getByRole('button', { name: 'dashboard.retry' }));
    await waitFor(() => expect(state.productCalls).toBeGreaterThan(0));
    await new Promise((resolve) => setTimeout(resolve, 50)); // let the load settle

    expect(screen.getByTestId('reconnecting-notice')).toBeTruthy();
    expect(screen.queryByText('dashboard.stats.totalProducts')).toBeNull();
  });

  it('when the session is back it loads the figures again and the notice goes away', async () => {
    stable.auth.sessionStatus = 'reconnecting';
    await block();
    const { rerender } = render(<DashboardPage onNavigate={() => {}} />);
    await screen.findByTestId('reconnecting-notice');
    const before = state.productCalls;

    stable.auth.sessionStatus = 'ok';
    resetRefreshGuard(); // cooldown over
    rerender(<DashboardPage onNavigate={() => {}} />);

    await waitFor(() => expect(screen.queryByTestId('reconnecting-notice')).toBeNull());
    await waitFor(() => expect(state.productCalls).toBeGreaterThan(before));
    expect(await screen.findByText('dashboard.stats.totalProducts')).toBeTruthy();
  });

  it('a read that STARTED during the cooldown is discarded even if the cooldown expired before it returned, and a reload follows', async () => {
    stable.auth.sessionStatus = 'reconnecting';
    await block();
    const { rerender } = render(<DashboardPage onNavigate={() => {}} />);
    await screen.findByTestId('reconnecting-notice');

    let release;
    state.gate = new Promise((resolve) => { release = resolve; });
    fireEvent.click(screen.getByRole('button', { name: 'dashboard.retry' }));
    await waitFor(() => expect(state.productCalls).toBeGreaterThan(0));
    const before = state.productCalls;

    resetRefreshGuard(); // cooldown expires while the read is still waiting
    state.gate = null;
    release();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByText('dashboard.stats.totalProducts')).toBeNull(); // anon-key rows are not data

    stable.auth.sessionStatus = 'ok';
    rerender(<DashboardPage onNavigate={() => {}} />);
    await waitFor(() => expect(state.productCalls).toBeGreaterThan(before));
    expect((await screen.findAllByText('dashboard.stats.totalProducts')).length).toBeGreaterThan(0);
  });

  it('a read that starts and ends with the refresh unblocked is shown', async () => {
    render(<DashboardPage onNavigate={() => {}} />);
    expect(await screen.findByText('dashboard.stats.totalProducts')).toBeTruthy();
  });
});
