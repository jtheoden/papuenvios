/**
 * RB-22: the "validate payment" confirmation of AdminOrdersTab carries the cause of an incoherent order total.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const state = { orders: [] };

vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (key) => key, language: 'es' })
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'admin-1' } }) }));
vi.mock('@/contexts/BusinessContext', () => ({ useBusiness: () => ({ visualSettings: {} }) }));
vi.mock('@/hooks/useRealtimeSubscription', () => ({ useRealtimeOrders: vi.fn() }));
vi.mock('@/lib/styleUtils', () => ({ getPrimaryButtonStyle: () => ({}) }));
vi.mock('@/lib/supabase', () => ({ supabase: {} }));
vi.mock('@/lib/orderService', () => ({
  getAllOrders: vi.fn(async () => state.orders),
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
vi.mock('@/components/admin/OrderActionButtons', () => ({
  default: ({ order, onValidatePayment }) => (
    <button type="button" onClick={() => onValidatePayment(order)}>{`validate-${order.order_number}`}</button>
  )
}));
vi.mock('@/components/admin/OrderTableConfig', () => ({
  getTableColumns: () => [],
  getModalColumns: () => []
}));
vi.mock('@/components/admin/modals', () => ({
  OrderDetailsModal: () => null,
  DeliveryProofModal: () => null,
  InputDialog: () => null,
  ConfirmDialog: ({ show, message }) => (show ? <div data-testid="confirm" style={{ whiteSpace: 'pre-line' }}>{message}</div> : null)
}));
vi.mock('@/components/ToastNotification', () => ({ default: () => null }));

import AdminOrdersTab from '@/components/AdminOrdersTab';

const ORDER = {
  id: 'o1',
  order_number: 'ORD-1',
  status: 'pending',
  payment_status: 'proof_uploaded',
  subtotal: 50,
  discount_amount: 5,
  shipping_cost: 7.5,
  tax_amount: 0,
  total_amount: 52.5,
  order_items: [{ item_type: 'product', total_price: 50 }]
};

const openValidate = async (order) => {
  state.orders = [order];
  render(<AdminOrdersTab />);
  fireEvent.click(await screen.findByRole('button', { name: 'validate-ORD-1' }));
  return screen.findByTestId('confirm');
};

describe('AdminOrdersTab - validate payment confirmation (RB-22)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('includes the warning of its cause when the total is below the formula', async () => {
    const dialog = await openValidate({ ...ORDER, discount_amount: 0, shipping_cost: 0, total_amount: 0.01 });
    expect(dialog).toHaveTextContent('adminOrders.messages.confirmValidate');
    expect(dialog).toHaveTextContent('adminOrders.totalWarning.total_below_formula');
  });

  it('includes the subtotal cause when the items do not add up', async () => {
    const dialog = await openValidate({ ...ORDER, subtotal: 80, discount_amount: 0, shipping_cost: 0, total_amount: 80 });
    expect(dialog).toHaveTextContent('adminOrders.totalWarning.subtotal_mismatch');
  });

  it('does not include any warning when the order is coherent', async () => {
    const dialog = await openValidate(ORDER);
    expect(dialog).toHaveTextContent('adminOrders.messages.confirmValidate');
    expect(dialog.textContent).not.toContain('adminOrders.totalWarning');
  });
});
