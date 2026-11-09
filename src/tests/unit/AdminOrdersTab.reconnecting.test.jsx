import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

const state = vi.hoisted(() => ({ orders: [], gate: null, auth: { user: { id: 'admin-1' }, sessionStatus: 'ok' } }));

vi.mock('@/contexts/LanguageContext', () => ({ useLanguage: () => ({ t: (key) => key, language: 'es' }) }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => state.auth }));
vi.mock('@/contexts/BusinessContext', () => ({ useBusiness: () => ({ visualSettings: {}, refreshStock: vi.fn() }) }));
vi.mock('@/hooks/useRealtimeSubscription', () => ({ useRealtimeOrders: vi.fn() }));
vi.mock('@/lib/styleUtils', () => ({ getPrimaryButtonStyle: () => ({}) }));
vi.mock('@/lib/supabase', () => ({ supabase: {} }));
vi.mock('@/lib/orderService', () => ({
  getAllOrders: vi.fn(async () => { if (state.gate) await state.gate; return state.orders; }),
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
  default: ({ data, emptyMessage }) => (
    <div>
      <span data-testid="rows">{data.length}</span>
      {emptyMessage && <span data-testid="empty">{emptyMessage}</span>}
    </div>
  )
}));
vi.mock('@/components/admin/OrderActionButtons', () => ({ default: () => null }));
vi.mock('@/components/admin/OrderTableConfig', () => ({ getTableColumns: () => [], getModalColumns: () => [] }));
vi.mock('@/components/admin/modals', () => ({
  OrderDetailsModal: () => null,
  DeliveryProofModal: () => null,
  ConfirmDialog: () => null,
  InputDialog: () => null
}));
vi.mock('@/components/ToastNotification', () => ({ default: () => null }));

import AdminOrdersTab from '@/components/AdminOrdersTab';
import { getAllOrders } from '@/lib/orderService';
import { createRefreshGuardFetch, resetRefreshGuard } from '@/lib/refreshGuard';

const REFRESH_URL = 'https://x.supabase.co/auth/v1/token?grant_type=refresh_token';
const block = () => createRefreshGuardFetch(async () => new Response('{}', { status: 429 }))(REFRESH_URL).catch(() => {});
const ORDER = { id: 'o1', order_number: 'ORD-1', status: 'processing', payment_status: 'pending', order_items: [] };
const mount = async () => {
  const view = render(<AdminOrdersTab />);
  await act(async () => {});
  return view;
};

describe('AdminOrdersTab while the session is reconnecting', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    resetRefreshGuard();
    state.orders = [];
    state.gate = null;
    state.auth.sessionStatus = 'ok';
  });

  it('says it is reconnecting (with a retry) instead of "no orders" when the list is empty', async () => {
    state.auth.sessionStatus = 'reconnecting';
    await block();
    await mount();

    expect(screen.getByTestId('reconnecting-notice')).toBeTruthy();
    expect(screen.queryByTestId('empty')).toBeNull();
  });

  it('a read that finishes while the refresh is blocked (anon key, RLS-empty) does not wipe the orders already shown', async () => {
    state.orders = [ORDER];
    await mount();
    expect(screen.getByTestId('rows').textContent).toBe('1');

    state.orders = []; // what the anon-key read returns
    await block();
    await act(async () => { fireEvent.click(screen.getByTitle('dashboard.refresh')); });

    expect(screen.getByTestId('rows').textContent).toBe('1');
  });

  it('reloads the list once the session is back', async () => {
    state.auth.sessionStatus = 'reconnecting';
    await block();
    const { rerender } = await mount();
    const before = getAllOrders.mock.calls.length;

    state.orders = [ORDER];
    state.auth.sessionStatus = 'ok';
    resetRefreshGuard();
    rerender(<AdminOrdersTab />);
    await act(async () => {});

    expect(getAllOrders.mock.calls.length).toBe(before + 1);
    expect(screen.getByTestId('rows').textContent).toBe('1');
    expect(screen.queryByTestId('reconnecting-notice')).toBeNull();
  });

  it('a read that STARTED during the cooldown is discarded even if the cooldown expired before it returned, and a reload follows', async () => {
    state.orders = [ORDER];
    const { rerender } = await mount();
    expect(screen.getByTestId('rows').textContent).toBe('1');

    await block();
    state.auth.sessionStatus = 'reconnecting';
    rerender(<AdminOrdersTab />);
    let release;
    state.gate = new Promise((resolve) => { release = resolve; });
    state.orders = []; // what the anon-key read returns
    await act(async () => { fireEvent.click(screen.getByTitle('dashboard.refresh')); });

    resetRefreshGuard(); // cooldown expires while the read is still waiting
    state.gate = null;
    await act(async () => { release(); });
    expect(screen.getByTestId('rows').textContent).toBe('1'); // not wiped

    const before = getAllOrders.mock.calls.length;
    state.orders = [ORDER, { ...ORDER, id: 'o2' }];
    state.auth.sessionStatus = 'ok';
    rerender(<AdminOrdersTab />);
    await act(async () => {});
    expect(getAllOrders.mock.calls.length).toBe(before + 1);
    expect(screen.getByTestId('rows').textContent).toBe('2');
  });

  it('a read that starts and ends with the refresh unblocked replaces the list', async () => {
    state.orders = [ORDER];
    await mount();
    state.orders = [];
    await act(async () => { fireEvent.click(screen.getByTitle('dashboard.refresh')); });
    expect(screen.getByTestId('rows').textContent).toBe('0');
  });
});
