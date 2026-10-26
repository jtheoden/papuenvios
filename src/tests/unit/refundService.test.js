import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const rpc = vi.fn();
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: (...args) => rpc(...args) } }));
const logError = vi.hoisted(() => vi.fn());
vi.mock('@/lib/errorHandler', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, logError };
});

import {
  getRefundCounts,
  listRefunds,
  resolveRefund,
  resetRefundBackendForTests
} from '@/lib/refundService';

const ZERO_COUNTS = { actionable: 0, onHold: 0, dueSoon: 0, overdue: 0, pendingAmountUsd: 0 };

describe('refundService', () => {
  beforeEach(() => {
    rpc.mockReset();
    logError.mockReset();
    resetRefundBackendForTests();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  describe('getRefundCounts', () => {
    it('maps the RPC payload to camelCase numbers', async () => {
      rpc.mockResolvedValue({
        data: { actionable: 3, on_hold: 2, due_soon: 1, overdue: 1, pending_amount_usd: '410.50' },
        error: null
      });
      expect(await getRefundCounts()).toEqual({ actionable: 3, onHold: 2, dueSoon: 1, overdue: 1, pendingAmountUsd: 410.5 });
      expect(rpc).toHaveBeenCalledWith('admin_refund_counts');
    });

    it.each(['42883', '42P01', 'PGRST202', 'PGRST205'])('reads %s (backend not deployed yet) as no refunds and stops asking', async (code) => {
      rpc.mockResolvedValue({ data: null, error: { code, message: 'missing' } });
      expect(await getRefundCounts()).toEqual(ZERO_COUNTS);
      expect(await getRefundCounts()).toEqual(ZERO_COUNTS);
      expect(await listRefunds()).toEqual({ total: 0, items: [] });
      expect(rpc).toHaveBeenCalledTimes(1);
    });

    it('retries a missing backend after 5 minutes (no reload needed) and stays quiet meanwhile', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-10-30T12:00:00Z'));
      rpc.mockResolvedValue({ data: null, error: { code: '42883', message: 'missing' } });
      expect(await getRefundCounts()).toEqual(ZERO_COUNTS);
      vi.setSystemTime(new Date('2026-10-30T12:04:59Z'));
      expect(await getRefundCounts()).toEqual(ZERO_COUNTS);
      expect(rpc).toHaveBeenCalledTimes(1);

      // migrations applied meanwhile
      rpc.mockResolvedValue({ data: { actionable: 2, on_hold: 0, due_soon: 0, overdue: 0, pending_amount_usd: 5 }, error: null });
      vi.setSystemTime(new Date('2026-10-30T12:05:01Z'));
      expect((await getRefundCounts()).actionable).toBe(2);
      expect(rpc).toHaveBeenCalledTimes(2);
      expect(logError).not.toHaveBeenCalled();
    });

    it('asks again after another 5 minutes when the backend is still missing', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-10-30T12:00:00Z'));
      rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'missing' } });
      await listRefunds();
      vi.setSystemTime(new Date('2026-10-30T12:05:01Z'));
      expect(await listRefunds()).toEqual({ total: 0, items: [] });
      expect(rpc).toHaveBeenCalledTimes(2);
      vi.setSystemTime(new Date('2026-10-30T12:06:00Z'));
      await listRefunds();
      expect(rpc).toHaveBeenCalledTimes(2);
    });

    it('does not log the expected 42501 of a non-admin (no console noise from the badge)', async () => {
      rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'insufficient_privilege' } });
      await expect(getRefundCounts()).rejects.toMatchObject({ context: { reason: 'not_authorized' } });
      expect(logError).not.toHaveBeenCalled();
    });

    it('rethrows other errors so the caller can decide (the badge counts 0)', async () => {
      rpc.mockResolvedValue({ data: null, error: { code: '57014', message: 'timeout' } });
      await expect(getRefundCounts()).rejects.toBeTruthy();
    });

    it('maps 42501 to a not_authorized reason', async () => {
      rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'insufficient_privilege' } });
      await expect(getRefundCounts()).rejects.toMatchObject({ context: { reason: 'not_authorized' } });
    });
  });

  describe('listRefunds', () => {
    it('passes the filters and returns total and items', async () => {
      rpc.mockResolvedValue({ data: { total: 1, items: [{ id: 'r1' }] }, error: null });
      const out = await listRefunds({ status: 'pending', limit: 50, offset: 10, queueState: 'overdue' });
      expect(out).toEqual({ total: 1, items: [{ id: 'r1' }] });
      expect(rpc).toHaveBeenCalledWith('admin_list_refunds', {
        p_status: 'pending',
        p_limit: 50,
        p_offset: 10,
        p_queue_state: 'overdue'
      });
    });

    it('defaults to every status, 200 rows and no queue filter', async () => {
      rpc.mockResolvedValue({ data: { total: 0, items: [] }, error: null });
      await listRefunds();
      expect(rpc).toHaveBeenCalledWith('admin_list_refunds', { p_status: 'all', p_limit: 200, p_offset: 0, p_queue_state: null });
    });

    it('tolerates a null payload', async () => {
      rpc.mockResolvedValue({ data: null, error: null });
      expect(await listRefunds()).toEqual({ total: 0, items: [] });
    });
  });

  describe('resolveRefund', () => {
    it('sends a refunded resolution', async () => {
      rpc.mockResolvedValue({ data: { id: 'r1', status: 'refunded' }, error: null });
      const out = await resolveRefund({ refundId: 'r1', action: 'refunded', reference: ' ZELLE-1 ', refundedAt: '2026-10-30T12:00:00.000Z' });
      expect(out).toEqual({ id: 'r1', status: 'refunded' });
      expect(rpc).toHaveBeenCalledWith('admin_resolve_refund', {
        p_refund_id: 'r1',
        p_action: 'refunded',
        p_reference: 'ZELLE-1',
        p_refunded_at: '2026-10-30T12:00:00.000Z',
        p_reason: null
      });
    });

    it('sends a not_applicable resolution', async () => {
      rpc.mockResolvedValue({ data: { id: 'r1', status: 'not_applicable' }, error: null });
      await resolveRefund({ refundId: 'r1', action: 'not_applicable', reason: ' never arrived ' });
      expect(rpc).toHaveBeenCalledWith('admin_resolve_refund', {
        p_refund_id: 'r1',
        p_action: 'not_applicable',
        p_reference: null,
        p_refunded_at: null,
        p_reason: 'never arrived'
      });
    });

    it('refuses locally without calling the server when the id or action is missing', async () => {
      await expect(resolveRefund({ action: 'refunded', reference: 'x' })).rejects.toBeTruthy();
      await expect(resolveRefund({ refundId: 'r1', action: 'bogus' })).rejects.toBeTruthy();
      expect(rpc).not.toHaveBeenCalled();
    });

    it.each([
      [{ code: '22023', message: 'refund_on_hold: refunds start 48 hours after the cancellation', details: 'eligible_at=2026-10-28T14:00:00Z' }, 'refund_on_hold'],
      [{ code: '22023', message: 'already_resolved: this refund request is already refunded' }, 'already_resolved'],
      [{ code: '22023', message: 'invalid_argument: p_reference is required', details: 'p_reference' }, 'invalid_argument'],
      [{ code: '42501', message: 'insufficient_privilege' }, 'not_authorized'],
      [{ code: 'P0002', message: 'refund_not_found' }, 'refund_not_found']
    ])('types the server refusal %#', async (error, reason) => {
      rpc.mockResolvedValue({ data: null, error });
      await expect(resolveRefund({ refundId: 'r1', action: 'refunded', reference: 'x' })).rejects.toMatchObject({
        context: expect.objectContaining({ reason })
      });
    });

    it('exposes eligible_at on refund_on_hold and the field on invalid_argument', async () => {
      rpc.mockResolvedValueOnce({ data: null, error: { code: '22023', message: 'refund_on_hold: x', details: 'eligible_at=2026-10-28T14:00:00Z' } });
      await expect(resolveRefund({ refundId: 'r1', action: 'refunded', reference: 'x' })).rejects.toMatchObject({
        context: { reason: 'refund_on_hold', eligibleAt: '2026-10-28T14:00:00Z' }
      });
      rpc.mockResolvedValueOnce({ data: null, error: { code: '22023', message: 'invalid_argument: p_reference', details: 'p_reference' } });
      await expect(resolveRefund({ refundId: 'r1', action: 'refunded', reference: 'x' })).rejects.toMatchObject({
        context: { reason: 'invalid_argument', field: 'p_reference' }
      });
    });

    it('does not swallow a missing backend on a write: the admin must see that it failed', async () => {
      rpc.mockResolvedValue({ data: null, error: { code: '42883', message: 'function does not exist' } });
      await expect(resolveRefund({ refundId: 'r1', action: 'refunded', reference: 'x' })).rejects.toBeTruthy();
    });
  });
});
