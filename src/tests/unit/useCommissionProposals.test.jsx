import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

const svc = vi.hoisted(() => ({ getOpenProposals: vi.fn() }));
vi.mock('@/lib/commissionProposalService', () => ({ getOpenProposals: (...a) => svc.getOpenProposals(...a) }));
vi.mock('@/lib/errorHandler', async (orig) => ({ ...(await orig()), logError: vi.fn() }));

import useCommissionProposals from '@/hooks/useCommissionProposals';

const rem = (id, updated_at = 't1') => ({ id, updated_at, status: 'payment_pending' });
const pending = { id: 'p1', remittance_id: 'r1', status: 'pending', created_at: 'x' };

describe('useCommissionProposals', () => {
  beforeEach(() => vi.clearAllMocks());

  it('loads the open proposals of the given remittances, grouped', async () => {
    svc.getOpenProposals.mockResolvedValue([pending]);
    const { result } = renderHook(() => useCommissionProposals([rem('r1')]));
    await waitFor(() => expect(result.current.pending.r1).toEqual(pending));
    expect(svc.getOpenProposals).toHaveBeenCalledWith(['r1']);
  });

  it('refetches when a remittance row changes (the existing Realtime reload replaces the list) but not on identical rerenders', async () => {
    svc.getOpenProposals.mockResolvedValue([]);
    const { rerender } = renderHook(({ list }) => useCommissionProposals(list), { initialProps: { list: [rem('r1')] } });
    await waitFor(() => expect(svc.getOpenProposals).toHaveBeenCalledTimes(1));
    rerender({ list: [rem('r1')] }); // new array, same content
    rerender({ list: [rem('r1', 't2')] }); // updated_at moved
    await waitFor(() => expect(svc.getOpenProposals).toHaveBeenCalledTimes(2));
  });

  it('does not query without remittances', async () => {
    renderHook(() => useCommissionProposals([]));
    await Promise.resolve();
    expect(svc.getOpenProposals).not.toHaveBeenCalled();
  });

  it('a failing read leaves "no proposals" without throwing (silent degradation)', async () => {
    svc.getOpenProposals.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useCommissionProposals([rem('r1')]));
    await waitFor(() => expect(svc.getOpenProposals).toHaveBeenCalled());
    expect(result.current.pending).toEqual({});
  });

  it('refresh() reloads on demand', async () => {
    svc.getOpenProposals.mockResolvedValue([]);
    const { result } = renderHook(() => useCommissionProposals([rem('r1')]));
    await waitFor(() => expect(svc.getOpenProposals).toHaveBeenCalledTimes(1));
    await act(async () => { await result.current.refresh(); });
    expect(svc.getOpenProposals).toHaveBeenCalledTimes(2);
  });

  it('only asks for remittances that can still carry a proposal (payment_pending / payment_rejected)', async () => {
    svc.getOpenProposals.mockResolvedValue([]);
    const list = [rem('r1'), { id: 'r2', updated_at: 't', status: 'processing' }, { id: 'r3', updated_at: 't', status: 'payment_rejected' }];
    renderHook(() => useCommissionProposals(list));
    await waitFor(() => expect(svc.getOpenProposals).toHaveBeenCalledWith(['r1', 'r3']));
  });

  it('does not query when no remittance can carry a proposal', async () => {
    renderHook(() => useCommissionProposals([{ id: 'r2', updated_at: 't', status: 'processing' }]));
    await Promise.resolve();
    expect(svc.getOpenProposals).not.toHaveBeenCalled();
  });

  it('splits long id lists into chunks so the URL stays short', async () => {
    svc.getOpenProposals.mockResolvedValue([]);
    const list = Array.from({ length: 120 }, (_, i) => rem(`r${i}`));
    renderHook(() => useCommissionProposals(list));
    await waitFor(() => expect(svc.getOpenProposals).toHaveBeenCalledTimes(3));
    expect(Math.max(...svc.getOpenProposals.mock.calls.map(([ids]) => ids.length))).toBeLessThanOrEqual(50);
  });

  it('discards an out-of-order (older) response', async () => {
    let resolveFirst;
    svc.getOpenProposals
      .mockImplementationOnce(() => new Promise((r) => { resolveFirst = r; }))
      .mockResolvedValueOnce([{ id: 'new', remittance_id: 'r1', status: 'pending', created_at: 'b' }]);
    const { result, rerender } = renderHook(({ list }) => useCommissionProposals(list), { initialProps: { list: [rem('r1')] } });
    rerender({ list: [rem('r1', 't2')] });
    await waitFor(() => expect(result.current.pending.r1?.id).toBe('new'));
    await act(async () => { resolveFirst([{ id: 'old', remittance_id: 'r1', status: 'pending', created_at: 'a' }]); });
    expect(result.current.pending.r1.id).toBe('new');
  });
});
