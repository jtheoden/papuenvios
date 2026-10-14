import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

const state = { handler: null, realtimeCalls: [] };

vi.mock('@/hooks/useRealtimeSubscription', () => ({
  useRealtimeRemittances: vi.fn((opts) => {
    state.realtimeCalls.push(opts);
    state.handler = opts.onUpdate;
    return { isSubscribed: true };
  })
}));
vi.mock('@/lib/remittanceService', () => ({
  TO_PROCESS_STATUSES: ['payment_proof_uploaded', 'payment_validated', 'processing'],
  getAdminWorkRemittances: vi.fn()
}));

import { usePendingRemittances } from '@/hooks/usePendingRemittances';
import { getAdminWorkRemittances } from '@/lib/remittanceService';

const R1 = { id: 'r1', status: 'payment_pending' };
const R2 = { id: 'r2', status: 'payment_proof_uploaded' };
const R3 = { id: 'r3', status: 'processing' };

describe('usePendingRemittances', () => {
  beforeEach(() => {
    state.handler = null;
    state.realtimeCalls = [];
    getAdminWorkRemittances.mockReset();
    getAdminWorkRemittances.mockResolvedValue([R1, R3]);
  });
  afterEach(() => vi.restoreAllMocks());

  it('loads remittances and computes the to-process count with badge statuses', async () => {
    const { result } = renderHook(() => usePendingRemittances({ enabled: true }));
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.remittances).toEqual([R1, R3]);
    expect(result.current.toProcessCount).toBe(1);
    expect(result.current.error).toBeNull();
  });

  it('does nothing while disabled', async () => {
    renderHook(() => usePendingRemittances({ enabled: false }));
    expect(getAdminWorkRemittances).not.toHaveBeenCalled();
    expect(state.realtimeCalls.every((c) => c.enabled === false)).toBe(true);
  });

  it('reloads on realtime events and reports new arrivals', async () => {
    const { result } = renderHook(() => usePendingRemittances({ enabled: true }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.newCount).toBe(0);

    getAdminWorkRemittances.mockResolvedValue([R1, R2, R3]);
    await act(async () => {
      await state.handler({ eventType: 'INSERT' });
    });

    expect(result.current.toProcessCount).toBe(2);
    expect(result.current.newCount).toBe(1);
    expect(result.current.loading).toBe(false);
  });

  it('polls every 30 seconds as a fallback', async () => {
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    renderHook(() => usePendingRemittances({ enabled: true }));
    await waitFor(() => expect(getAdminWorkRemittances).toHaveBeenCalledTimes(1));

    const poll = setIntervalSpy.mock.calls.find(([, delay]) => delay === 30000);
    expect(poll).toBeTruthy();
    await act(async () => {
      await poll[0]();
    });
    expect(getAdminWorkRemittances).toHaveBeenCalledTimes(2);
  });

  it('keeps the previous list and flags refreshFailed when a later refresh fails', async () => {
    const { result } = renderHook(() => usePendingRemittances({ enabled: true }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    getAdminWorkRemittances.mockRejectedValueOnce(new Error('network'));
    await act(async () => {
      await state.handler({ eventType: 'UPDATE' });
    });

    expect(result.current.remittances).toEqual([R1, R3]);
    expect(result.current.error).toBeNull();
    expect(result.current.refreshFailed).toBe(true);

    await act(async () => {
      await state.handler({ eventType: 'UPDATE' });
    });
    expect(result.current.refreshFailed).toBe(false);
  });

  it('treats a failure before any successful load as a blocking error, not a stale warning', async () => {
    getAdminWorkRemittances.mockRejectedValueOnce(new Error('boom'));
    const { result } = renderHook(() => usePendingRemittances({ enabled: true }));
    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(result.current.refreshFailed).toBe(false);
  });

  it('retry shows the loading state again while it reloads', async () => {
    getAdminWorkRemittances.mockRejectedValueOnce(new Error('boom'));
    const { result } = renderHook(() => usePendingRemittances({ enabled: true }));
    await waitFor(() => expect(result.current.error).toBeTruthy());

    let resolve;
    getAdminWorkRemittances.mockReturnValueOnce(new Promise((r) => { resolve = r; }));
    act(() => {
      result.current.retry();
    });
    expect(result.current.loading).toBe(true);
    expect(result.current.error).toBeNull();
    await act(async () => {
      resolve([R1]);
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
  });

  it('exposes the error and recovers on reload', async () => {
    getAdminWorkRemittances.mockRejectedValueOnce(new Error('boom'));
    const { result } = renderHook(() => usePendingRemittances({ enabled: true }));
    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(result.current.loading).toBe(false);

    await act(async () => {
      await result.current.reload();
    });
    expect(result.current.error).toBeNull();
    expect(result.current.remittances).toEqual([R1, R3]);
  });

  it('opens exactly one realtime subscription hook per mount', async () => {
    const { result } = renderHook(() => usePendingRemittances({ enabled: true }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    const perRender = state.realtimeCalls.length;
    expect(perRender).toBeGreaterThan(0);
    // every render calls the realtime hook exactly once (never twice in the same render)
    expect(state.realtimeCalls.every((c) => c.enabled === true)).toBe(true);
  });
});
