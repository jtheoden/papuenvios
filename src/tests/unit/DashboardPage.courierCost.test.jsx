import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';

// Pinned to 17:00 ET (mid month): "today" is a calendar day, so hoursAgo(1..50) must stay inside it.
const PINNED_NOW = new Date('2026-10-14T21:00:00Z');
const hoursAgo = (h) => new Date(Date.now() - h * 3600 * 1000).toISOString();

const tables = vi.hoisted(() => ({ data: {}, errors: {} }));
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
  const makeChain = (table) => {
    const chain = {};
    ['select', 'eq', 'in', 'order', 'range', 'gte'].forEach((m) => { chain[m] = () => chain; });
    chain.then = (resolve) =>
      resolve({
        data: tables.errors[table] ? null : (tables.data[table] ?? []),
        count: (tables.data[table] ?? []).length,
        error: tables.errors[table] ?? null
      });
    return chain;
  };
  return { supabase: { from: (table) => makeChain(table), rpc: async () => ({ data: [], error: null }) } };
});

import DashboardPage from '@/components/DashboardPage';

beforeEach(() => vi.setSystemTime(PINNED_NOW));
afterEach(() => vi.useRealTimers());

const order = (id, status, created_at, shipping_cost, shipping_zone_id = 'z1') => ({
  id, status, shipping_zone_id, payment_status: 'validated', total_amount: '50', shipping_cost, discount_amount: '0',
  payment_method: 'zelle', created_at, validated_at: created_at
});
const base = () => ({
  currencies: [], order_items: [], products: [], combo_products: [], remittances: [],
  remittance_types: [], zelle_transaction_history: [], site_visits: []
});

describe('DashboardPage courier cost card', () => {
  it('labels the old card as shipping charged and shows charged, courier cost, difference and unrecorded count', async () => {
    tables.errors = {};
    tables.data = {
      ...base(),
      orders: [
        order('a', 'completed', hoursAgo(1), '10'),
        order('b', 'completed', hoursAgo(2), '0'),
        order('c', 'cancelled', hoursAgo(2), '99')
      ],
      order_courier_costs: [
        { order_id: 'a', amount_usd: '6.50' },
        { order_id: 'b', amount_usd: null },
        { order_id: 'c', amount_usd: '50' }
      ]
    };
    render(<DashboardPage onNavigate={() => {}} />);

    const card = await screen.findByTestId('courier-cost-card');
    expect(screen.getByText('dashboard.shippingCollected')).toBeTruthy();
    expect(screen.queryByText('dashboard.transportCosts')).toBeNull();
    await waitFor(() => {
      const row = (label) => within(card).getByText(label).closest('tr');
      expect(within(row('dashboard.courier.collected')).getAllByText('$10.00').length).toBe(3);
      expect(within(row('dashboard.courier.cost')).getAllByText('$6.50').length).toBe(3);
      expect(within(row('dashboard.courier.difference')).getAllByText('$3.50').length).toBe(3);
      expect(within(row('dashboard.courier.unrecorded')).getAllByText('1').length).toBe(3);
    });
  });

  it('compares charged vs courier only on orders with a tariff and keeps the total charged visible', async () => {
    tables.errors = {};
    tables.data = {
      ...base(),
      orders: [order('a', 'completed', hoursAgo(1), '10'), order('e', 'completed', hoursAgo(2), '20')],
      order_courier_costs: [{ order_id: 'a', amount_usd: '6.50', created_at: hoursAgo(5) }] // e: zone but no row, created after the cutoff
    };
    render(<DashboardPage onNavigate={() => {}} />);
    const card = await screen.findByTestId('courier-cost-card');
    await waitFor(() => {
      const row = (label) => within(card).getByText(label).closest('tr');
      expect(within(row('dashboard.courier.collected')).getAllByText('$30.00').length).toBe(3);
      expect(within(row('dashboard.courier.collectedCompared')).getAllByText('$10.00').length).toBe(3);
      expect(within(row('dashboard.courier.cost')).getAllByText('$6.50').length).toBe(3);
      expect(within(row('dashboard.courier.difference')).getAllByText('$3.50').length).toBe(3);
      expect(within(row('dashboard.courier.unrecorded')).getAllByText('0').length).toBe(3);
      expect(within(row('dashboard.courier.missingRow')).getAllByText('1').length).toBe(3);
    });
  });

  it('does not alert on orders from before the first recorded snapshot, nor when the table is empty', async () => {
    tables.errors = {};
    tables.data = {
      ...base(),
      orders: [order('old', 'completed', hoursAgo(50), '10'), order('a', 'completed', hoursAgo(1), '10')],
      order_courier_costs: [{ order_id: 'a', amount_usd: '6.50', created_at: hoursAgo(1) }]
    };
    const first = render(<DashboardPage onNavigate={() => {}} />);
    let card = await screen.findByTestId('courier-cost-card');
    await waitFor(() => within(card).getByText('dashboard.courier.difference'));
    expect(within(card).queryByText('dashboard.courier.missingRow')).toBeNull();
    first.unmount();

    tables.data = { ...base(), orders: [order('n', 'completed', hoursAgo(1), '10')], order_courier_costs: [] };
    render(<DashboardPage onNavigate={() => {}} />);
    card = await screen.findByTestId('courier-cost-card');
    await waitFor(() => within(card).getByText('dashboard.courier.difference'));
    expect(within(card).queryByText('dashboard.courier.missingRow')).toBeNull();
  });

  it('shows n/a (not 0 and not a number) as the difference when no order has a tariff', async () => {
    tables.errors = {};
    tables.data = {
      ...base(),
      orders: [order('a', 'completed', hoursAgo(1), '10')],
      order_courier_costs: []
    };
    render(<DashboardPage onNavigate={() => {}} />);
    const card = await screen.findByTestId('courier-cost-card');
    await waitFor(() => {
      const diff = within(card).getByText('dashboard.courier.difference').closest('tr');
      expect(within(diff).getAllByText('dashboard.courier.notAvailable').length).toBe(3);
      expect(diff.textContent).not.toMatch(/\$/);
    });
  });

  it('puts the sign before the dollar sign for a negative difference and names USD', async () => {
    tables.errors = {};
    tables.data = {
      ...base(),
      orders: [order('a', 'completed', hoursAgo(1), '2')],
      order_courier_costs: [{ order_id: 'a', amount_usd: '5' }]
    };
    render(<DashboardPage onNavigate={() => {}} />);
    const card = await screen.findByTestId('courier-cost-card');
    await waitFor(() => {
      const diff = within(card).getByText('dashboard.courier.difference').closest('tr');
      expect(within(diff).getAllByText('-$3.00').length).toBe(3);
    });
    expect(card.textContent).toMatch(/USD/);
  });

  it('does not render the missing-row alert when every order with a zone has a row', async () => {
    tables.errors = {};
    tables.data = {
      ...base(),
      orders: [order('a', 'completed', hoursAgo(1), '10')],
      order_courier_costs: [{ order_id: 'a', amount_usd: '6.50' }]
    };
    render(<DashboardPage onNavigate={() => {}} />);
    const card = await screen.findByTestId('courier-cost-card');
    await waitFor(() => within(card).getByText('dashboard.courier.difference'));
    expect(within(card).queryByText('dashboard.courier.missingRow')).toBeNull();
  });

  it('shows an unavailable alert, not zeros, when the courier costs cannot be read', async () => {
    tables.data = {
      ...base(),
      orders: [order('a', 'completed', hoursAgo(1), '10')]
    };
    tables.errors = { order_courier_costs: { code: '42P01', message: 'relation does not exist' } };
    render(<DashboardPage onNavigate={() => {}} />);

    const card = await screen.findByTestId('courier-cost-card');
    await waitFor(() => expect(within(card).getByRole('alert')).toHaveTextContent('dashboard.courier.unavailable'));
    expect(within(card).queryByText('dashboard.courier.cost')).toBeNull();
    expect(within(card).queryByText('dashboard.courier.difference')).toBeNull();
  });
});
