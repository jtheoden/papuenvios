import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

const listRefunds = vi.hoisted(() => vi.fn());
vi.mock('@/lib/refundService', () => ({ listRefunds }));
vi.mock('@/hooks/useRealtimeSubscription', () => {
  throw new Error('useRefundQueue must not open realtime subscriptions');
});

import { useRefundQueue } from '@/hooks/useRefundQueue';

const hours = (h) => new Date(Date.now() + h * 3600 * 1000).toISOString();
const item = (id, over = {}) => ({
  id,
  status: 'pending',
  eligible_at: hours(-5),
  due_at: hours(100),
  amount: '10.00',
  currency: 'USD',
  ...over
});

describe('useRefundQueue', () => {
  beforeEach(() => {
    listRefunds.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('loads everything once and derives the actionable and overdue counts from the clock', async () => {
    listRefunds.mockResolvedValue({
      total: 4,
      items: [item('a'), item('b', { due_at: hours(-2) }), item('c', { eligible_at: hours(20), due_at: hours(150) }), item('d', { status: 'refunded' })]
    });
    const { result } = renderHook(() => useRefundQueue({ enabled: true }));
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(listRefunds).toHaveBeenCalledWith({ status: 'all', limit: 200 });
    expect(result.current.refunds).toHaveLength(4);
    expect(result.current.total).toBe(4);
    expect(result.current.actionableCount).toBe(2);
    expect(result.current.overdueCount).toBe(1);
    expect(result.current.error).toBeNull();
  });

  it('does nothing when disabled', async () => {
    renderHook(() => useRefundQueue({ enabled: false }));
    expect(listRefunds).not.toHaveBeenCalled();
  });

  it('reports a first-load failure as error, and a later failure as refreshFailed keeping the list', async () => {
    listRefunds.mockRejectedValueOnce(new Error('boom'));
    const { result } = renderHook(() => useRefundQueue({ enabled: true }));
    await waitFor(() => expect(result.current.error).toBeTruthy());

    listRefunds.mockResolvedValueOnce({ total: 1, items: [item('a')] });
    await act(async () => {
      await result.current.retry();
    });
    expect(result.current.error).toBeNull();

    listRefunds.mockRejectedValueOnce(new Error('later'));
    await act(async () => {
      await result.current.reload();
    });
    expect(result.current.refreshFailed).toBe(true);
    expect(result.current.refunds).toHaveLength(1);
    expect(result.current.error).toBeNull();
  });

  it('counts new actionable requests after the first load', async () => {
    listRefunds.mockResolvedValueOnce({ total: 1, items: [item('a')] });
    const { result } = renderHook(() => useRefundQueue({ enabled: true }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.newCount).toBe(0);

    listRefunds.mockResolvedValueOnce({ total: 2, items: [item('a'), item('b')] });
    await act(async () => {
      await result.current.reload();
    });
    expect(result.current.newCount).toBe(1);
  });

  it('polls every 30 seconds', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    listRefunds.mockResolvedValue({ total: 0, items: [] });
    renderHook(() => useRefundQueue({ enabled: true }));
    await vi.advanceTimersByTimeAsync(0);
    const first = listRefunds.mock.calls.length;
    await vi.advanceTimersByTimeAsync(30000);
    expect(listRefunds.mock.calls.length).toBe(first + 1);
  });
});
