import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';

const hoursAgo = (h) => new Date(Date.now() - h * 3600 * 1000).toISOString();
const daysAgo = (d) => hoursAgo(d * 24);

const tables = vi.hoisted(() => ({ data: {}, selects: [] }));
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
  const makeChain = (table) => {
    const chain = {};
    ['eq', 'in', 'order', 'range'].forEach((m) => {
      chain[m] = () => chain;
    });
    chain.select = (columns) => {
      tables.selects.push({ table, columns });
      return chain;
    };
    chain.then = (resolve) =>
      resolve({ data: tables.data[table] ?? [], count: (tables.data[table] ?? []).length, error: null });
    return chain;
  };
  return { supabase: { from: (table) => makeChain(table) } };
});

import DashboardPage from '@/components/DashboardPage';

describe('DashboardPage currency display (no currencies.exchange_rate column)', () => {
  it('loads only existing currency columns and offers no unconvertible currency selector', async () => {
    tables.selects = [];
    tables.data = {
      currencies: [
        { id: 'u', code: 'USD', symbol: '$', is_base: true },
        { id: 'c', code: 'CUP', symbol: '$', is_base: false }
      ],
      orders: [],
      order_items: [],
      products: [],
      combo_products: [],
      remittances: [],
      remittance_types: [],
      zelle_transaction_history: [],
      site_visits: []
    };

    render(<DashboardPage onNavigate={() => {}} />);

    await waitFor(() => expect(tables.selects.some((s) => s.table === 'currencies')).toBe(true));
    const currencySelects = tables.selects.filter((s) => s.table === 'currencies');
    currencySelects.forEach((s) => {
      expect(s.columns).not.toBe('*');
      expect(s.columns).not.toMatch(/exchange_rate/);
    });
    expect(screen.queryByRole('option', { name: /CUP/ })).toBeNull();
    expect(screen.queryByRole('combobox')).toBeNull();
  });
});
