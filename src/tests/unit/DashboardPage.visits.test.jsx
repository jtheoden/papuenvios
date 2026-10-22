import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';

const PINNED_NOW = new Date('2026-10-14T21:00:00Z');

// Server-side counts: the page must never read the 4158 rows (PostgREST caps them at max_rows).
const state = vi.hoisted(() => ({ visits: [], visitCalls: [], visitError: null }));
const stable = vi.hoisted(() => ({
  auth: { user: { id: 'su' }, isAdmin: true, isSuperAdmin: true },
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
  const visitsChain = () => {
    const call = { columns: null, options: null, gte: null };
    state.visitCalls.push(call);
    const chain = {
      select: (columns, options) => {
        call.columns = columns;
        call.options = options;
        return chain;
      },
      gte: (column, value) => {
        call.gte = { column, value };
        return chain;
      },
      then: (resolve) => {
        if (state.visitError) return resolve({ data: null, count: null, error: state.visitError });
        const matching = call.gte ? state.visits.filter((v) => v >= call.gte.value) : state.visits;
        // head: true -> no rows come back, only the exact count; row reads are capped like PostgREST max_rows
        return resolve({ data: call.options?.head ? null : matching.slice(0, 1000), count: matching.length, error: null }); // 1000 = PostgREST max_rows
      }
    };
    return chain;
  };
  const emptyChain = () => {
    const chain = {};
    ['select', 'eq', 'in', 'order', 'range', 'gte'].forEach((m) => { chain[m] = () => chain; });
    chain.then = (resolve) => resolve({ data: [], count: 0, error: null });
    return chain;
  };
  return {
    supabase: {
      from: (table) => (table === 'site_visits' ? visitsChain() : emptyChain()),
      rpc: async () => ({ data: [], error: null })
    }
  };
});

import DashboardPage from '@/components/DashboardPage';

const hoursAgo = (h) => new Date(PINNED_NOW.getTime() - h * 3600 * 1000).toISOString();
const daysAgo = (d) => hoursAgo(d * 24);

const tile = (label) => screen.getByText(label).parentElement;

describe('DashboardPage visits (server-side counts)', () => {
  beforeEach(() => {
    state.visitCalls = [];
    state.visitError = null;
    vi.setSystemTime(PINNED_NOW);
  });
  afterEach(() => vi.useRealTimers());

  it('asks the server for four exact head counts instead of reading rows', async () => {
    state.visits = [hoursAgo(1), daysAgo(3), daysAgo(20), daysAgo(200), daysAgo(500)];
    render(<DashboardPage onNavigate={() => {}} />);

    await waitFor(() => expect(within(tile('dashboard.visits.allTime')).getByText('5')).toBeTruthy());
    expect(state.visitCalls).toHaveLength(4);
    state.visitCalls.forEach((call) => expect(call.options).toEqual({ count: 'exact', head: true }));
    expect(state.visitCalls.filter((call) => call.gte)).toHaveLength(3);
    expect(within(tile('dashboard.visits.thisWeek')).getByText('2')).toBeTruthy();
    expect(within(tile('dashboard.visits.thisMonth')).getByText('3')).toBeTruthy();
    expect(within(tile('dashboard.visits.thisYear')).getByText('4')).toBeTruthy();
  });

  it('reports the real total even when it is above the PostgREST row cap', async () => {
    state.visits = Array.from({ length: 4158 }, () => hoursAgo(1));
    render(<DashboardPage onNavigate={() => {}} />);
    await waitFor(() => expect(within(tile('dashboard.visits.allTime')).getByText('4158')).toBeTruthy());
  });

  it('says the visits are unavailable instead of showing zeros when the counts fail', async () => {
    state.visits = [];
    state.visitError = { code: '42501', message: 'permission denied' };
    render(<DashboardPage onNavigate={() => {}} />);

    expect(await screen.findByText('dashboard.visits.unavailable')).toBeTruthy();
    expect(within(tile('dashboard.visits.allTime')).getByText('—')).toBeTruthy();
  });
});
