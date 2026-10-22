import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';

// Pinned to 17:00 ET on Oct 14: windows are ET calendar days/months, so hoursAgo(1..) and daysAgo(<=13) stay in range.
const PINNED_NOW = new Date('2026-10-14T21:00:00Z');
const hoursAgo = (h) => new Date(Date.now() - h * 3600 * 1000).toISOString();
const daysAgo = (d) => hoursAgo(d * 24);

const tables = vi.hoisted(() => ({ data: {}, errors: {} }));
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
    ['select', 'eq', 'in', 'order', 'range', 'gte'].forEach((m) => {
      chain[m] = () => chain;
    });
    chain.then = (resolve) =>
      resolve({
        data: tables.errors[table] ? null : (tables.data[table] ?? []),
        count: (tables.data[table] ?? []).length,
        error: tables.errors[table] ?? null
      });
    return chain;
  };
  const costRpc = { admin_list_product_costs: 'products', admin_list_combo_costs: 'combo_products' };
  const rpc = async (name) => ({ data: tables.data[costRpc[name]] ?? [], error: null });
  return { supabase: { from: (table) => makeChain(table), rpc } };
});

import DashboardPage from '@/components/DashboardPage';

beforeEach(() => {
  tables.errors = {};
  vi.setSystemTime(PINNED_NOW);
});
afterEach(() => vi.useRealTimers());

const order = (id, status, payment_status, total, created_at, extra = {}) => ({
  id,
  status,
  payment_status,
  total_amount: total,
  shipping_cost: '0',
  discount_amount: '0',
  payment_method: 'zelle',
  created_at,
  validated_at: payment_status === 'validated' ? created_at : null,
  ...extra
});

const remittance = (id, status, payment_validated_at, extra = {}) => ({
  id,
  status,
  commission_total: '2.50',
  amount_sent: '100',
  discount_amount: '0',
  payment_validated_at,
  delivered_at: null,
  completed_at: null,
  ...extra
});

const baseTables = () => ({
  currencies: [],
  orders: [],
  order_items: [],
  products: [],
  combo_products: [],
  remittances: [],
  remittance_types: [],
  zelle_transaction_history: [],
  site_visits: []
});

const headline = (period, row) => screen.getByTestId(`headline-${period}-${row}`);

describe('DashboardPage financials (H5, H6, H9, H10)', () => {
  it('separates sales, net income and collected, and shows the proof row and estimated profit', async () => {
    tables.data = {
      ...baseTables(),
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
      remittances: [
        remittance('r1', 'completed', daysAgo(3), { commission_total: '23.14', amount_sent: '684.30', completed_at: daysAgo(3), delivered_at: daysAgo(3) })
      ]
    };

    render(<DashboardPage onNavigate={() => {}} />);

    // Sales (gross orders only): 30.76 + 1155.54 = 1186.30. Remittance commission/volume are not mixed in.
    await waitFor(() => expect(headline('monthly', 'sales')).toHaveTextContent(/1186\.30/));
    // Net income: order profit 78.38 + commission 23.14 = 101.52
    expect(headline('monthly', 'netIncome')).toHaveTextContent(/101\.52/);
    // Collected (cash): orders 1186.30 + remittance amount_sent 684.30 = 1870.60
    expect(headline('monthly', 'collected')).toHaveTextContent(/1870\.60/);
    expect(headline('monthly', 'sales')).not.toHaveTextContent(/1209\.44/);

    // H10: dedicated row shows 1
    const row = screen.getByText('dashboard.orderStatus.proofToReview').parentElement;
    expect(within(row).getByText('1')).toBeTruthy();
  });

  it('defines the three headline metrics in tooltips', async () => {
    tables.data = baseTables();
    render(<DashboardPage onNavigate={() => {}} />);
    await waitFor(() => expect(headline('daily', 'sales')).toHaveTextContent(/0\.00/));
    ['sales', 'netIncome', 'collected'].forEach((key) => {
      expect(screen.getAllByTitle(`dashboard.headline.${key}Def`).length).toBeGreaterThan(0);
    });
  });

  it('moves the daily net income and volume when a remittance payment is validated (D4)', async () => {
    tables.data = { ...baseTables(), remittances: [remittance('r-val', 'payment_validated', hoursAgo(1))] };
    render(<DashboardPage onNavigate={() => {}} />);

    await waitFor(() => expect(headline('daily', 'netIncome')).toHaveTextContent(/2\.50/));
    expect(headline('daily', 'collected')).toHaveTextContent(/100\.00/);
    expect(headline('daily', 'sales')).toHaveTextContent(/0\.00/);
  });

  it('shows the validated-but-undelivered remittances as a separate pending-delivery liability', async () => {
    tables.data = {
      ...baseTables(),
      remittances: [
        remittance('r-val', 'payment_validated', hoursAgo(1)),
        remittance('r-proc', 'processing', daysAgo(2), { amount_sent: '50', commission_total: '1' }),
        remittance('r-done', 'delivered', daysAgo(2), { delivered_at: hoursAgo(1) })
      ]
    };
    render(<DashboardPage onNavigate={() => {}} />);

    const card = await screen.findByTestId('remittance-pending-delivery');
    await waitFor(() => expect(card).toHaveTextContent(/146\.50/));
    expect(card).toHaveTextContent('(2)');
  });

  it('shows the cash delivery charge as its own line inside Collected and counts it as income', async () => {
    tables.data = { ...baseTables(), remittances: [remittance('r-cash', 'payment_validated', hoursAgo(1), { delivery_cost: '15' })] };
    render(<DashboardPage onNavigate={() => {}} />);

    // collected = amount_sent 100 + delivery 15; net income = commission 2.50 + delivery 15
    await waitFor(() => expect(headline('daily', 'collected')).toHaveTextContent(/115\.00/));
    expect(headline('daily', 'deliveryCharge')).toHaveTextContent(/15\.00/);
    expect(headline('daily', 'netIncome')).toHaveTextContent(/17\.50/);
  });

  it('subtracts the remittance courier cost (transport) from net income where a snapshot exists', async () => {
    tables.data = {
      ...baseTables(),
      remittances: [remittance('r-cash', 'payment_validated', hoursAgo(1), { delivery_cost: '15', shipping_zone_id: 'z1', created_at: hoursAgo(2) })],
      remittance_courier_costs: [{ remittance_id: 'r-cash', amount_usd: '4', created_at: hoursAgo(3) }]
    };
    render(<DashboardPage onNavigate={() => {}} />);

    await waitFor(() => expect(headline('daily', 'netIncome')).toHaveTextContent(/13\.50/)); // 2.50 + 15 - 4
    expect(screen.getByTestId('pnl-remittance-courier-cost-daily')).toHaveTextContent(/-\$4\.00/);
  });

  it('keeps working when remittance_courier_costs does not exist yet and says the cost is unavailable', async () => {
    tables.data = {
      ...baseTables(),
      remittances: [remittance('r-cash', 'payment_validated', hoursAgo(1), { delivery_cost: '15', shipping_zone_id: 'z1' })]
    };
    tables.errors = { remittance_courier_costs: { code: '42P01', message: 'relation does not exist' } };
    render(<DashboardPage onNavigate={() => {}} />);

    await waitFor(() => expect(headline('daily', 'collected')).toHaveTextContent(/115\.00/));
    expect(screen.getByTestId('remittance-courier-unavailable')).toBeTruthy();
    expect(screen.queryByTestId('stats-error')).toBeNull();
  });

  it('does not treat a validated remittance as paid out', async () => {
    tables.data = { ...baseTables(), remittances: [remittance('r-val', 'payment_validated', hoursAgo(1))] };
    render(<DashboardPage onNavigate={() => {}} />);
    await waitFor(() => expect(headline('daily', 'netIncome')).toHaveTextContent(/2\.50/));
    const payoutRow = screen.getByTestId('remittance-volume-daily');
    expect(payoutRow).toHaveTextContent(/dashboard\.remittanceVolumeSent.*100\.00/);
    expect(payoutRow).toHaveTextContent(/dashboard\.remittancePayout.*-\$0\.00/);
  });

  it('leaves the shipping charged out of the order costs row', async () => {
    tables.data = {
      ...baseTables(),
      orders: [order('o1', 'completed', 'validated', '100', hoursAgo(1), { shipping_cost: '10' })],
      order_items: [{ order_id: 'o1', item_type: 'product', item_id: 'p40', total_price: 90 }],
      products: [{ id: 'p40', profit_margin: 100 }] // profit inside 90 = 45
    };
    render(<DashboardPage onNavigate={() => {}} />);

    // costs = revenue 100 - shipping 10 - profit 45 = 45 (it used to be 100 - 45 = 55)
    await waitFor(() => expect(screen.getByTestId('pnl-orders-costs-daily')).toHaveTextContent(/-\$45\.00/));
    expect(screen.getByTestId('pnl-orders-shipping-daily')).toHaveTextContent(/-\$10\.00/);
  });

  it('shows rounded cents, never float noise', async () => {
    tables.data = {
      ...baseTables(),
      orders: [
        order('a', 'completed', 'validated', '0.1', hoursAgo(1)),
        order('b', 'completed', 'validated', '0.2', hoursAgo(1))
      ]
    };
    render(<DashboardPage onNavigate={() => {}} />);
    await waitFor(() => expect(headline('daily', 'sales')).toHaveTextContent(/\$0\.30\b/));
  });

  it('shows "—" instead of $0.00 until the first load finishes', async () => {
    tables.data = baseTables();
    render(<DashboardPage onNavigate={() => {}} />);
    expect(headline('daily', 'sales')).toHaveTextContent('—');
    expect(headline('daily', 'sales')).not.toHaveTextContent('0.00');
    await waitFor(() => expect(headline('daily', 'sales')).toHaveTextContent(/\$0\.00/));
  });

  it('shows a visible error with retry when the stats cannot be loaded', async () => {
    tables.data = baseTables();
    tables.errors = { orders: { code: '500', message: 'boom' } };
    render(<DashboardPage onNavigate={() => {}} />);

    const alert = await screen.findByTestId('stats-error');
    expect(alert).toHaveAttribute('role', 'alert');
    expect(within(alert).getByRole('button', { name: 'dashboard.retry' })).toBeTruthy();
    expect(headline('daily', 'sales')).toHaveTextContent('—');
  });

  it('labels the payment-method breakdown as all-time', async () => {
    tables.data = { ...baseTables(), orders: [order('a', 'completed', 'validated', '10', daysAgo(200))] };
    render(<DashboardPage onNavigate={() => {}} />);
    expect(await screen.findByText(/dashboard\.paymentMethodsPeriod/)).toBeTruthy();
  });

  it('uses the margin that the admin RPC returns (not the default) for the estimated profit', async () => {
    tables.data = {
      ...baseTables(),
      orders: [order('o-day', 'dispatched', 'validated', '30.76', hoursAgo(1), { discount_amount: '1.62' })],
      order_items: [{ order_id: 'o-day', item_type: 'product', item_id: 'p100', total_price: 140 }],
      // markup 100% != default 40%: profit inside 140 is 140*100/200 = 70
      products: [{ id: 'p100', profit_margin: 100 }]
    };

    render(<DashboardPage onNavigate={() => {}} />);

    // 70 - 1.62 discount = 68.38 (with the default margin it would be 40 - 1.62 = 38.38)
    await waitFor(() => expect(headline('daily', 'netIncome')).toHaveTextContent(/68\.38/));
    expect(screen.queryByText(/38\.38/)).toBeNull();
  });
});
