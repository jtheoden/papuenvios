import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const state = { orders: [], inputs: [] };

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

// ---- UI stubs (not under test): a row action to start the cancel flow, and the two dialogs
vi.mock('@/components/tables/ResponsiveTableWrapper', () => ({
  default: ({ data, columns }) => {
    const actions = columns.find((c) => c.key === 'actions');
    return <div>{data.map((order) => <div key={order.id}>{actions.render(null, order)}</div>)}</div>;
  }
}));
vi.mock('@/components/admin/OrderActionButtons', () => ({
  default: ({ order, onCancelOrder, onRestockOrder }) => (
    <div>
      <button type="button" onClick={onCancelOrder}>{`cancel-${order.order_number}`}</button>
      {order.has_consumed_stock && (
        <button type="button" onClick={onRestockOrder}>{`restock-${order.order_number}`}</button>
      )}
    </div>
  )
}));
vi.mock('@/components/admin/OrderTableConfig', () => ({
  getTableColumns: () => [],
  getModalColumns: () => []
}));
vi.mock('@/components/admin/modals', () => ({
  OrderDetailsModal: () => null,
  DeliveryProofModal: () => null,
  ConfirmDialog: ({ show, title, message, onConfirm, onCancel }) =>
    show ? (
      <div data-testid="confirm">
        <span>{title}</span>
        <span>{message}</span>
        <button type="button" onClick={onConfirm}>confirm-yes</button>
        <button type="button" onClick={onCancel}>confirm-no</button>
      </div>
    ) : null,
  InputDialog: ({ show, onConfirm }) =>
    show ? (
      <button type="button" onClick={() => onConfirm(state.inputs.length ? state.inputs.shift() : 'customer asked')}>
        input-submit
      </button>
    ) : null
}));
vi.mock('@/components/ToastNotification', () => ({
  default: ({ message, type }) => <div data-testid="toast" data-type={type}>{message}</div>
}));

import AdminOrdersTab from '@/components/AdminOrdersTab';
import { cancelOrder, restockOrder, getAllOrders } from '@/lib/orderService';

const ORDER = { id: 'o1', order_number: 'ORD-1', status: 'processing', payment_status: 'validated', order_items: [] };

const startCancel = async () => {
  render(<AdminOrdersTab />);
  fireEvent.click(await screen.findByRole('button', { name: 'cancel-ORD-1' }));
  fireEvent.click(await screen.findByRole('button', { name: 'input-submit' }));
  fireEvent.click(await screen.findByRole('button', { name: 'confirm-yes' }));
};

describe('AdminOrdersTab - restock prompt after cancelling a consumed order (W7)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.orders = [ORDER];
    state.inputs = [];
  });

  it('asks whether to return the units, then asks for its OWN reason (not the cancel reason)', async () => {
    cancelOrder.mockResolvedValue({ id: 'o1', stockConsumed: true });
    restockOrder.mockResolvedValue({ ok: true, restocked: true });
    state.inputs = ['cancel reason', 'goods came back']; // 1st: cancel dialog, 2nd: restock dialog

    await startCancel();

    const dialog = await screen.findByTestId('confirm');
    expect(dialog).toHaveTextContent('adminOrders.modals.restockTitle');
    expect(dialog).toHaveTextContent('adminOrders.messages.restockPrompt');
    expect(restockOrder).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'confirm-yes' }));
    expect(restockOrder).not.toHaveBeenCalled(); // the reason dialog comes first
    fireEvent.click(await screen.findByRole('button', { name: 'input-submit' }));

    await waitFor(() => expect(restockOrder).toHaveBeenCalledWith('o1', 'goods came back'));
    await waitFor(() => expect(screen.getByTestId('toast')).toHaveTextContent('adminOrders.messages.restockSuccess'));
  });

  it('does not restock when the admin answers no', async () => {
    cancelOrder.mockResolvedValue({ id: 'o1', stockConsumed: true });

    await startCancel();
    fireEvent.click(await screen.findByRole('button', { name: 'confirm-no' }));

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(restockOrder).not.toHaveBeenCalled();
  });

  it('does not ask at all when the cancelled order had no consumed stock', async () => {
    cancelOrder.mockResolvedValue({ id: 'o1', stockConsumed: false });

    await startCancel();

    await waitFor(() => expect(screen.getByTestId('toast')).toHaveTextContent('adminOrders.messages.cancelSuccess'));
    expect(screen.queryByTestId('confirm')).toBeNull();
    expect(restockOrder).not.toHaveBeenCalled();
  });

  it('shows an error toast (does not swallow) when the restock fails', async () => {
    cancelOrder.mockResolvedValue({ id: 'o1', stockConsumed: true });
    restockOrder.mockRejectedValue(new Error('boom'));

    await startCancel();
    fireEvent.click(await screen.findByRole('button', { name: 'confirm-yes' }));
    fireEvent.click(await screen.findByRole('button', { name: 'input-submit' }));

    await waitFor(() => expect(screen.getByTestId('toast')).toHaveTextContent('adminOrders.messages.restockError'));
    expect(screen.getByTestId('toast')).toHaveAttribute('data-type', 'error');
  });
});

describe('AdminOrdersTab - persistent "return to inventory" action on cancelled orders', () => {
  const CANCELLED = { id: 'o2', order_number: 'ORD-2', status: 'cancelled', payment_status: 'validated', order_items: [], has_consumed_stock: true };

  beforeEach(() => {
    vi.clearAllMocks();
    state.orders = [CANCELLED];
    state.inputs = [];
  });

  const openRestock = async () => {
    render(<AdminOrdersTab />);
    fireEvent.click(await screen.findByRole('button', { name: 'restock-ORD-2' }));
  };

  it('asks for a reason, restocks with exactly that reason and reloads the list', async () => {
    restockOrder.mockResolvedValue({ ok: true, restocked: true });
    state.inputs = ['returned by courier'];
    await openRestock();
    const callsBefore = getAllOrders.mock.calls.length;

    fireEvent.click(await screen.findByRole('button', { name: 'input-submit' }));

    await waitFor(() => expect(restockOrder).toHaveBeenCalledWith('o2', 'returned by courier'));
    await waitFor(() => expect(screen.getByTestId('toast')).toHaveTextContent('adminOrders.messages.restockSuccess'));
    await waitFor(() => expect(getAllOrders.mock.calls.length).toBeGreaterThan(callsBefore));
  });

  it('requires a reason: an empty one shows an error and never calls the service', async () => {
    state.inputs = ['   '];
    await openRestock();

    fireEvent.click(await screen.findByRole('button', { name: 'input-submit' }));

    await waitFor(() =>
      expect(screen.getByTestId('toast')).toHaveTextContent('adminOrders.messages.restockReasonRequired')
    );
    expect(restockOrder).not.toHaveBeenCalled();
  });

  it('shows an error toast when the restock fails', async () => {
    restockOrder.mockRejectedValue(new Error('boom'));
    state.inputs = ['returned'];
    await openRestock();

    fireEvent.click(await screen.findByRole('button', { name: 'input-submit' }));

    await waitFor(() => expect(screen.getByTestId('toast')).toHaveTextContent('adminOrders.messages.restockError'));
    expect(screen.getByTestId('toast')).toHaveAttribute('data-type', 'error');
  });

  it('reports "nothing to restock" as info and still reloads', async () => {
    restockOrder.mockResolvedValue({ ok: true, restocked: false });
    state.inputs = ['returned'];
    await openRestock();

    fireEvent.click(await screen.findByRole('button', { name: 'input-submit' }));

    await waitFor(() => expect(screen.getByTestId('toast')).toHaveTextContent('adminOrders.messages.restockNothing'));
    expect(screen.getByTestId('toast')).toHaveAttribute('data-type', 'info');
  });
});
