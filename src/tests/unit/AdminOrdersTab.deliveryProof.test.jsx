/**
 * W6a: marking an order as delivered from the admin table works with or without a photo.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const state = { orders: [] };
const photo = { name: 'p.png', type: 'image/png', size: 5 };

vi.mock('@/contexts/LanguageContext', () => ({ useLanguage: () => ({ t: (key) => key, language: 'es' }) }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'admin-1' } }) }));
vi.mock('@/contexts/BusinessContext', () => ({ useBusiness: () => ({ visualSettings: {}, refreshStock: vi.fn() }) }));
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
  default: ({ order, onUploadDeliveryProof }) => (
    <button type="button" onClick={onUploadDeliveryProof}>{'deliver-' + order.order_number}</button>
  )
}));
vi.mock('@/components/admin/OrderTableConfig', () => ({ getTableColumns: () => [], getModalColumns: () => [] }));
vi.mock('@/components/admin/modals', () => ({
  OrderDetailsModal: () => null,
  ConfirmDialog: () => null,
  InputDialog: () => null,
  DeliveryProofModal: ({ onConfirm, onClose, summary }) => (
    <div data-testid="delivery-modal">
      <span>{summary.map((s) => s.value).join('|')}</span>
      <button type="button" onClick={() => onConfirm({ file: null, notes: '' }).catch(() => {})}>confirm-none</button>
      <button type="button" onClick={() => onConfirm({ file: photo, notes: '' }).catch(() => {})}>confirm-photo</button>
      <button type="button" onClick={onClose}>close</button>
    </div>
  )
}));
vi.mock('@/components/ToastNotification', () => ({ default: ({ message }) => <div data-testid="toast">{message}</div> }));

import AdminOrdersTab from '@/components/AdminOrdersTab';
import { markOrderAsDelivered, getAllOrders } from '@/lib/orderService';
import { ERROR_CODES } from '@/lib/errorHandler';

const ORDER = { id: 'o1', order_number: 'ORD-1', user_name: 'Jane', status: 'dispatched', payment_status: 'validated', order_items: [] };

const openModal = async () => {
  render(<AdminOrdersTab />);
  fireEvent.click(await screen.findByRole('button', { name: 'deliver-ORD-1' }));
  await screen.findByTestId('delivery-modal');
};

describe('AdminOrdersTab - deliver with or without a photo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.orders = [ORDER];
  });

  it('shows the order number and customer in the dialog summary', async () => {
    await openModal();
    expect(screen.getByText('ORD-1|Jane')).toBeTruthy();
  });

  it('confirming without a photo calls markOrderAsDelivered(id, null, adminId) and closes the dialog', async () => {
    markOrderAsDelivered.mockResolvedValue({ id: 'o1', status: 'delivered' });
    await openModal();
    fireEvent.click(screen.getByRole('button', { name: 'confirm-none' }));
    await waitFor(() => expect(markOrderAsDelivered).toHaveBeenCalledWith('o1', null, 'admin-1'));
    await waitFor(() => expect(screen.queryByTestId('delivery-modal')).toBeNull());
    expect(screen.getByTestId('toast').textContent).toBe('adminOrders.messages.deliveredWithoutPhoto');
  });

  it('confirming with a photo passes the file and shows the usual success message', async () => {
    markOrderAsDelivered.mockResolvedValue({ id: 'o1', status: 'delivered' });
    await openModal();
    fireEvent.click(screen.getByRole('button', { name: 'confirm-photo' }));
    await waitFor(() => expect(markOrderAsDelivered).toHaveBeenCalledWith('o1', photo, 'admin-1'));
    await waitFor(() => expect(screen.getByTestId('toast').textContent).toBe('adminOrders.messages.deliverSuccess'));
  });

  it('a failure keeps the dialog open (the dialog shows the error and its Retry options)', async () => {
    markOrderAsDelivered.mockRejectedValue(Object.assign(new Error('boom'), { stage: 'upload' }));
    await openModal();
    fireEvent.click(screen.getByRole('button', { name: 'confirm-photo' }));
    await waitFor(() => expect(markOrderAsDelivered).toHaveBeenCalled());
    expect(screen.getByTestId('delivery-modal')).toBeTruthy();
  });
});

describe('AdminOrdersTab - another admin moved the order', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.orders = [ORDER];
  });

  it('on a status conflict it reloads the list, closes the dialog and shows the clear conflict message', async () => {
    markOrderAsDelivered.mockRejectedValue(
      Object.assign(new Error('invalid_transition'), { code: ERROR_CODES.CONFLICT, context: { reason: 'invalid_transition' } })
    );
    await openModal();
    getAllOrders.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'confirm-none' }));

    await waitFor(() => expect(screen.queryByTestId('delivery-modal')).toBeNull());
    expect(screen.getByTestId('toast').textContent).toBe('common.statusConflict');
    await waitFor(() => expect(getAllOrders).toHaveBeenCalled(), { timeout: 3000 });
  });
});
