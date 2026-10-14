import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';

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
  const makeChain = (table) => {
    const chain = {};
    ['select', 'eq', 'in', 'order', 'range'].forEach((m) => {
      chain[m] = () => chain;
    });
    chain.then = (resolve) =>
      resolve({ data: tables.data[table] ?? [], count: (tables.data[table] ?? []).length, error: null });
    return chain;
  };
  return { supabase: { from: (table) => makeChain(table) } };
});

import DashboardPage from '@/components/DashboardPage';

const order = (id, status, payment_status, total, created_at, extra = {}) => ({
  id,
  status,
  payment_status,
  total_amount: total,
  shipping_cost: '0',
  discount_amount: '0',
  payment_method: 'zelle',
  created_at,
  ...extra
});

describe('DashboardPage financials (H5, H6, H9, H10)', () => {
  it('shows commission-based headline, the proof row and estimated profit', async () => {
    tables.data = {
      currencies: [],
      orders: [
        order('o-day', 'dispatched', 'validated', '30.76', hoursAgo(1), { discount_amount: '1.62' }),
        order('o-m', 'completed', 'validated', '1155.54', daysAgo(10)),
        order('o-proof', 'pending', 'proof_uploaded', '41.96', daysAgo(1))
      ],
      order_items: [
        { order_id: 'o-day', item_type: 'product', item_id: 'p40', total_price: 140 },
        { order_id: 'o-m', item_type: 'combo', item_id: 'gone', total_price: 140 }
      ],
      products: [{ id: 'p40', profit_margin: 40 }],
      combo_products: [],
      remittances: [
        { id: 'r1', status: 'completed', commission_total: '23.14', amount_sent: '684.30', amount_to_deliver: '661.16', discount_amount: '0', created_at: daysAgo(3), completed_at: daysAgo(3) }
      ],
      remittance_types: [],
      zelle_transaction_history: [],
      site_visits: []
    };

    render(<DashboardPage onNavigate={() => {}} />);

    // Headline monthly revenue: 30.76 + 1155.54 + 23.14 commission = 1209.44 (volume 684.30 excluded)
    await waitFor(() => expect(screen.getAllByText(/1209\.44/).length).toBeGreaterThan(0));
    expect(screen.queryByText(/1870\.60/)).toBeNull();

    // H10: dedicated row shows 1
    const row = screen.getByText('dashboard.orderStatus.proofToReview').parentElement;
    expect(within(row).getByText('1')).toBeTruthy();

    // H6: monthly estimated order profit = 140*40/140 - 1.62 + 140*40/140 (fallback) = 78.38, plus commission 23.14
    await waitFor(() => expect(screen.getAllByText(/101\.52/).length).toBeGreaterThan(0));
  });
});
