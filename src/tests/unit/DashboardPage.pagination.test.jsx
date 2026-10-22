import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';

// Pinned to 17:00 ET on Oct 14: windows are ET calendar days/months, so hoursAgo(1..) and daysAgo(<=13) stay in range.
const PINNED_NOW = new Date('2026-10-14T21:00:00Z');
const hoursAgo = (h) => new Date(Date.now() - h * 3600 * 1000).toISOString();
const daysAgo = (d) => hoursAgo(d * 24);

const tables = vi.hoisted(() => ({ data: {} }));
const stable = vi.hoisted(() => ({
  auth: { user: { id: 'su' }, isAdmin: true, isSuperAdmin: true },
  business: { products: [], combos: [], financialSettings: { productProfit: 40 }, visualSettings: {} }
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => stable.auth
}));
vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (key) => key, language: 'en' })
}));
vi.mock('@/contexts/BusinessContext', () => ({
  useBusiness: () => stable.business
}));
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
  const MAX_ROWS = 1000; // PostgREST max_rows: a response is cut here unless the client pages with .range()
  const makeChain = (table) => {
    const chain = {};
    let window = [0, MAX_ROWS - 1];
    ['select', 'eq', 'in', 'order', 'gte'].forEach((m) => {
      chain[m] = () => chain;
    });
    chain.range = (from, to) => {
      window = [from, Math.min(to, from + MAX_ROWS - 1)];
      return chain;
    };
    chain.then = (resolve) => {
      const rows = tables.data[table] ?? [];
      return resolve({ data: rows.slice(window[0], window[1] + 1), count: rows.length, error: null });
    };
    return chain;
  };
  const rpc = async () => ({ data: [], error: null });
  return { supabase: { from: (table) => makeChain(table), rpc } };
});
import DashboardPage from '@/components/DashboardPage';

beforeEach(() => {
  vi.setSystemTime(PINNED_NOW);
});
afterEach(() => vi.useRealTimers());

const emptyTables = () => ({
  currencies: [], orders: [], order_items: [], products: [], combo_products: [], remittances: [],
  remittance_types: [], zelle_transaction_history: [], site_visits: []
});

describe('DashboardPage reads past the 1000-row server cap', () => {
  it('counts every order, not just the first 1000', async () => {
    const created = hoursAgo(1);
    tables.data = {
      ...emptyTables(),
      orders: Array.from({ length: 1500 }, (_, i) => ({
        id: `o-${i}`, status: 'completed', payment_status: 'validated', total_amount: '1.00', shipping_cost: '0',
        discount_amount: '0', payment_method: 'zelle', created_at: created, validated_at: created
      }))
    };
    render(<DashboardPage onNavigate={() => {}} />);

    await waitFor(() => expect(screen.getByTestId('headline-daily-sales')).toHaveTextContent(/1500\.00/));
  });

  it('counts every remittance, not just the first 1000', async () => {
    tables.data = {
      ...emptyTables(),
      remittances: Array.from({ length: 1200 }, (_, i) => ({
        id: `r-${i}`, status: 'payment_validated', commission_total: '2.50', amount_sent: '100', discount_amount: '0',
        payment_validated_at: hoursAgo(1), delivered_at: null, completed_at: null
      }))
    };
    render(<DashboardPage onNavigate={() => {}} />);

    await waitFor(() => expect(screen.getByTestId('headline-daily-netIncome')).toHaveTextContent(/3000\.00/));
  });
});
