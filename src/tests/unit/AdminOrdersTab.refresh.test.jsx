import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';

const state = { orders: [], inputs: [], realtime: null, refreshStock: vi.fn() };

vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (key) => key, language: 'es' })
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'admin-1' } }) }));
vi.mock('@/contexts/BusinessContext', () => ({
  useBusiness: () => ({ visualSettings: {}, refreshStock: state.refreshStock })
}));
vi.mock('@/hooks/useRealtimeSubscription', () => ({
  useRealtimeOrders: vi.fn((opts) => { state.realtime = opts; })
}));
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
  default: ({ order, onValidatePayment, onCancelOrder, onRestockOrder }) => (
    <div>
      <button type="button" onClick={onValidatePayment}>{`validate-${order.order_number}`}</button>
      <button type="button" onClick={onCancelOrder}>{`cancel-${order.order_number}`}</button>
      <button type="button" onClick={onRestockOrder}>{`restock-${order.order_number}`}</button>
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
  ConfirmDialog: ({ show, onConfirm }) =>
    show ? <button type="button" onClick={onConfirm}>confirm-yes</button> : null,
  InputDialog: ({ show, onConfirm }) =>
    show ? <button type="button" onClick={() => onConfirm('a reason')}>input-submit</button> : null
}));
vi.mock('@/components/ToastNotification', () => ({
  default: ({ message }) => <div data-testid="toast">{message}</div>
}));

import AdminOrdersTab from '@/components/AdminOrdersTab';
import { getAllOrders, validatePayment, cancelOrder, restockOrder } from '@/lib/orderService';

const ORDER = { id: 'o1', order_number: 'ORD-1', status: 'processing', payment_status: 'pending', order_items: [] };
const advance = (ms) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

// Flush the mount effect and the already-resolved getAllOrders mock inside act, so every render and effect
// hop completes before the first query. Waiting with a polling ByRole query instead makes each hop queue
// behind a synchronous poll that costs hundreds of ms under CPU load, and the table did not appear within
// the 5 s timeout.
const mountAndSettle = async () => {
  render(<AdminOrdersTab />);
  await act(async () => {});
  await screen.findByText('validate-ORD-1');
  return getAllOrders.mock.calls.length;
};

describe('AdminOrdersTab - reload debounce and stock refresh', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.orders = [ORDER];
    state.refreshStock = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('coalesces a burst of realtime events into a single reload after ~500ms', async () => {
    const before = await mountAndSettle();
    vi.useFakeTimers();

    act(() => {
      state.realtime.onUpdate();
      state.realtime.onUpdate();
      state.realtime.onUpdate();
    });

    await advance(250);
    expect(getAllOrders.mock.calls.length).toBe(before);
    await advance(1000);
    expect(getAllOrders.mock.calls.length).toBe(before + 1);
    await advance(5000);
    expect(getAllOrders.mock.calls.length).toBe(before + 1);
  });

  it('validating a payment refreshes stock once and reloads orders once even if realtime also fires', async () => {
    validatePayment.mockResolvedValue({ success: true });
    const before = await mountAndSettle();
    vi.useFakeTimers();

    fireEvent.click(screen.getByRole('button', { name: 'validate-ORD-1' }));
    fireEvent.click(screen.getByRole('button', { name: 'confirm-yes' }));
    await advance(0); // let validatePayment resolve: the handler refreshes stock and schedules the reload
    expect(validatePayment).toHaveBeenCalled();
    act(() => state.realtime.onUpdate()); // the realtime echo of the same change

    expect(state.refreshStock).toHaveBeenCalledTimes(1);
    await advance(5000);
    expect(getAllOrders.mock.calls.length).toBe(before + 1);
  });

  it('cancelling an order refreshes stock', async () => {
    cancelOrder.mockResolvedValue({ id: 'o1', stockConsumed: false });
    await mountAndSettle();

    fireEvent.click(screen.getByRole('button', { name: 'cancel-ORD-1' }));
    fireEvent.click(await screen.findByText('input-submit'));
    fireEvent.click(await screen.findByText('confirm-yes'));

    await waitFor(() => expect(state.refreshStock).toHaveBeenCalledTimes(1));
  });

  it('restocking an order refreshes stock', async () => {
    restockOrder.mockResolvedValue({ ok: true, restocked: true });
    await mountAndSettle();

    fireEvent.click(screen.getByRole('button', { name: 'restock-ORD-1' }));
    fireEvent.click(await screen.findByText('input-submit'));

    await waitFor(() => expect(restockOrder).toHaveBeenCalledWith('o1', 'a reason'));
    await waitFor(() => expect(state.refreshStock).toHaveBeenCalledTimes(1));
  });
});
