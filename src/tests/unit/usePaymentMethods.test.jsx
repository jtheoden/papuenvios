import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

const auth = { user: { id: 'u1' } };

vi.mock('@/lib/supabase', () => ({ supabase: {} }));

vi.mock('@/contexts/AuthContext', () => ({
  // A fresh user object on every render, like the real context mocks in other suites.
  useAuth: () => ({ user: auth.user ? { ...auth.user } : null }),
}));

const service = {
  listPaymentMethods: vi.fn(),
  listPaymentMethodsForAdmin: vi.fn(),
  setPaymentMethodEnabled: vi.fn(),
};

vi.mock('@/lib/paymentMethodsService', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    listPaymentMethods: (...a) => service.listPaymentMethods(...a),
    listPaymentMethodsForAdmin: (...a) => service.listPaymentMethodsForAdmin(...a),
    setPaymentMethodEnabled: (...a) => service.setPaymentMethodEnabled(...a),
  };
});

import { usePaymentMethods } from '@/hooks/usePaymentMethods';

const ZELLE_ON = [
  { code: 'bizum', available: false, enabled_for_orders: false, enabled_for_remittances: false },
  { code: 'zelle', available: true, enabled_for_orders: true, enabled_for_remittances: true },
];
const ZELLE_ORDERS_OFF = [
  ZELLE_ON[0],
  { ...ZELLE_ON[1], enabled_for_orders: false },
];

beforeEach(() => {
  auth.user = { id: 'u1' };
  service.listPaymentMethods = vi.fn().mockResolvedValue(ZELLE_ON);
  service.listPaymentMethodsForAdmin = vi.fn().mockResolvedValue(ZELLE_ON);
  service.setPaymentMethodEnabled = vi.fn().mockResolvedValue({ code: 'zelle' });
});

describe('usePaymentMethods (customer mode)', () => {
  it('loads once on mount and exposes the helpers', async () => {
    const { result } = renderHook(() => usePaymentMethods());

    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(service.listPaymentMethods).toHaveBeenCalledTimes(1);
    expect(result.current.methods).toEqual(ZELLE_ON);
    expect(result.current.error).toBeNull();
    expect(result.current.isMethodEnabled('zelle', 'orders')).toBe(true);
    expect(result.current.isMethodEnabled('bizum', 'orders')).toBe(false);
    expect(result.current.isFlowBlocked('orders')).toBe(false);
  });

  it('does not call the RPC without a signed-in user and fails open', async () => {
    auth.user = null;
    const { result } = renderHook(() => usePaymentMethods());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(service.listPaymentMethods).not.toHaveBeenCalled();
    expect(result.current.isMethodEnabled('zelle', 'orders')).toBe(true);
    expect(result.current.isFlowBlocked('orders')).toBe(false);
  });

  it('fails open when the listing fails (e.g. migration not deployed yet)', async () => {
    service.listPaymentMethods.mockRejectedValue(new Error('rpc missing'));
    const { result } = renderHook(() => usePaymentMethods());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.methods).toBeNull();
    expect(result.current.isMethodEnabled('zelle', 'orders')).toBe(true);
    expect(result.current.isFlowBlocked('orders')).toBe(false);
  });

  it('refresh() returns the fresh list and updates the state', async () => {
    const { result } = renderHook(() => usePaymentMethods());
    await waitFor(() => expect(result.current.loading).toBe(false));

    service.listPaymentMethods.mockResolvedValue(ZELLE_ORDERS_OFF);
    let fresh;
    await act(async () => {
      fresh = await result.current.refresh();
    });

    expect(fresh).toEqual(ZELLE_ORDERS_OFF);
    expect(result.current.isMethodEnabled('zelle', 'orders')).toBe(false);
    expect(result.current.isFlowBlocked('orders')).toBe(true);
    expect(result.current.isFlowBlocked('remittances')).toBe(false);
  });

  it('refresh() resolves null (fail open) when the reload fails and keeps the last known list', async () => {
    const { result } = renderHook(() => usePaymentMethods());
    await waitFor(() => expect(result.current.loading).toBe(false));

    service.listPaymentMethods.mockRejectedValue(new Error('offline'));
    let fresh;
    await act(async () => {
      fresh = await result.current.refresh();
    });

    expect(fresh).toBeNull();
    expect(result.current.methods).toEqual(ZELLE_ON);
  });

  it('re-reads the status when the window regains focus (mid-checkout toggle)', async () => {
    const { result } = renderHook(() => usePaymentMethods());
    await waitFor(() => expect(result.current.loading).toBe(false));

    service.listPaymentMethods.mockResolvedValue(ZELLE_ORDERS_OFF);
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });

    await waitFor(() => expect(result.current.isMethodEnabled('zelle', 'orders')).toBe(false));
    expect(service.listPaymentMethods).toHaveBeenCalledTimes(2);
  });

  it('stops listening for focus after unmount', async () => {
    const { result, unmount } = renderHook(() => usePaymentMethods());
    await waitFor(() => expect(result.current.loading).toBe(false));
    unmount();

    window.dispatchEvent(new Event('focus'));
    expect(service.listPaymentMethods).toHaveBeenCalledTimes(1);
  });
});

describe('usePaymentMethods (admin mode)', () => {
  it('uses the admin listing', async () => {
    const { result } = renderHook(() => usePaymentMethods({ admin: true }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(service.listPaymentMethodsForAdmin).toHaveBeenCalledTimes(1);
    expect(service.listPaymentMethods).not.toHaveBeenCalled();
  });

  it('toggle() calls the RPC with the params and reloads the list', async () => {
    const { result } = renderHook(() => usePaymentMethods({ admin: true }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    service.listPaymentMethodsForAdmin.mockResolvedValue(ZELLE_ORDERS_OFF);
    const params = { code: 'zelle', flow: 'orders', enabled: false, reason: 'maintenance', confirmLast: true };
    await act(async () => {
      await result.current.toggle(params);
    });

    expect(service.setPaymentMethodEnabled).toHaveBeenCalledWith(params);
    expect(service.listPaymentMethodsForAdmin).toHaveBeenCalledTimes(2);
    expect(result.current.isMethodEnabled('zelle', 'orders')).toBe(false);
  });

  it('toggle() rejects with the typed error and leaves the list untouched', async () => {
    const { result } = renderHook(() => usePaymentMethods({ admin: true }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const failure = new Error('payment_method_last_enabled');
    service.setPaymentMethodEnabled.mockRejectedValue(failure);

    await act(async () => {
      await expect(
        result.current.toggle({ code: 'zelle', flow: 'orders', enabled: false })
      ).rejects.toBe(failure);
    });

    expect(service.listPaymentMethodsForAdmin).toHaveBeenCalledTimes(1);
    expect(result.current.methods).toEqual(ZELLE_ON);
  });
});
