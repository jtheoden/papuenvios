/**
 * Only a super admin sees the "Readjust" action on orders, in any status (the point is correcting what was already
 * made), never on an own order (the server refuses it). An ordinary admin never sees it.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const auth = vi.hoisted(() => ({ isSuperAdmin: true, user: { id: 'admin-1' } }));
const state = { orders: [] };

vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (key) => key, language: 'es' })
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => auth }));
vi.mock('@/contexts/BusinessContext', () => ({ useBusiness: () => ({ visualSettings: {} }) }));
vi.mock('@/hooks/useRealtimeSubscription', () => ({ useRealtimeOrders: vi.fn() }));
vi.mock('@/lib/styleUtils', () => ({ getPrimaryButtonStyle: () => ({}) }));
vi.mock('@/lib/supabase', () => ({ supabase: {} }));
vi.mock('@/components/ui/use-toast', () => ({ toast: vi.fn() }));
vi.mock('@/lib/orderService', () => ({
  getAllOrders: vi.fn(async () => state.orders),
  readjustOrder: vi.fn(async () => ({})),
  startProcessingOrder: vi.fn(),
  markOrderAsDispatched: vi.fn(),
  markOrderAsDelivered: vi.fn(),
  completeOrder: vi.fn(),
  validatePayment: vi.fn(),
  rejectPayment: vi.fn(),
  getDaysInProcessing: vi.fn(),
  cancelOrder: vi.fn(),
  restockOrder: vi.fn()
}));
vi.mock('@/components/tables/ResponsiveTableWrapper', () => ({
  default: ({ data, columns }) => {
    const actions = columns.find((c) => c.key === 'actions');
    return <div>{data.map((order) => <div key={order.id}>{actions.render(null, order)}</div>)}</div>;
  }
}));
vi.mock('@/components/admin/OrderActionButtons', () => ({ default: () => null }));
vi.mock('@/components/admin/OrderTableConfig', () => ({ getTableColumns: () => [], getModalColumns: () => [] }));
vi.mock('@/components/admin/modals', () => ({
  OrderDetailsModal: () => null,
  DeliveryProofModal: () => null,
  InputDialog: () => null,
  ConfirmDialog: () => null
}));
vi.mock('@/components/ToastNotification', () => ({ default: () => null }));

import AdminOrdersTab from '@/components/AdminOrdersTab';

const BUTTON = 'adminOrders.readjust.button';
const order = (id, status, extra = {}) => ({
  id,
  order_number: `ORD-${status}`,
  user_id: 'u1',
  status,
  payment_status: 'validated',
  subtotal: 248,
  discount_amount: 0,
  shipping_cost: 0,
  tax_amount: 0,
  total_amount: 248,
  order_items: [{ id: 'i1', item_name_es: 'Balita de Gas', quantity: 2, unit_price: 124, total_price: 248 }],
  ...extra
});

beforeEach(() => {
  vi.clearAllMocks();
  auth.isSuperAdmin = true;
  state.orders = [order('o1', 'cancelled')];
});

describe('AdminOrdersTab - super admin readjustment', () => {
  it.each(['pending', 'processing', 'delivered', 'completed', 'cancelled'])(
    'a super admin can readjust a %s order',
    async (status) => {
      state.orders = [order('x', status)];
      render(<AdminOrdersTab />);
      expect(await screen.findByRole('button', { name: BUTTON })).toBeTruthy();
    }
  );

  it('an ordinary admin does not see it', async () => {
    auth.isSuperAdmin = false;
    render(<AdminOrdersTab />);
    await screen.findByText('adminOrders.title');
    expect(screen.queryByRole('button', { name: BUTTON })).toBeNull();
  });

  it('a super admin does not see it on his own order', async () => {
    state.orders = [order('own', 'cancelled', { user_id: 'admin-1' })];
    render(<AdminOrdersTab />);
    await screen.findByText('adminOrders.title');
    expect(screen.queryByRole('button', { name: BUTTON })).toBeNull();
  });

  it('opens the readjustment dialog for that order', async () => {
    render(<AdminOrdersTab />);
    fireEvent.click(await screen.findByRole('button', { name: BUTTON }));
    const dialog = await screen.findByRole('dialog', { name: 'adminOrders.readjust.modalTitle' });
    expect(dialog.textContent).toContain('ORD-cancelled');
  });
});
