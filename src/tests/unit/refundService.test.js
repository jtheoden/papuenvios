import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const rpc = vi.fn();
const upload = vi.fn();
const remove = vi.fn();
const invoke = vi.fn();
vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (...args) => rpc(...args),
    functions: { invoke: (...args) => invoke(...args) },
    storage: { from: (bucket) => ({ upload: (...a) => upload(bucket, ...a), remove: (...a) => remove(bucket, ...a) }) }
  }
}));
const logError = vi.hoisted(() => vi.fn());
vi.mock('@/lib/errorHandler', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, logError };
});

import {
  getRefundCounts,
  listRefunds,
  resolveRefund,
  getOperationRefundDetail,
  getRefundMetrics,
  getExpiringProofs,
  getMyOperationRefund,
  getRefundDisputeStates,
  setRefundDispute,
  previewPurgeRefundProofs,
  executePurgeRefundProofs,
  resetRefundBackendForTests
} from '@/lib/refundService';

const ZERO_COUNTS = { actionable: 0, onHold: 0, dueSoon: 0, overdue: 0, pendingAmountUsd: 0 };

describe('refundService', () => {
  beforeEach(() => {
    rpc.mockReset();
    invoke.mockReset();
    upload.mockReset().mockResolvedValue({ data: {}, error: null });
    remove.mockReset().mockResolvedValue({ data: [], error: null });
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
    const PATH = /^refunds\/r1\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.png$/;
    const proofFile = () => new File(['proof-bytes'], 'zelle.png', { type: 'image/png' });
    const okRow = (status) => ({ ok: true, refund: { id: 'r1', status } });

    it('uploads the proof to the private bucket, then resolves through admin_resolve_refund_v2', async () => {
      rpc.mockResolvedValue({ data: okRow('refunded'), error: null });
      const file = proofFile();
      const out = await resolveRefund({ refundId: 'r1', action: 'refunded', reference: ' ZELLE-1 ', refundedAt: '2026-10-30T12:00:00.000Z', proofFile: file });
      expect(out).toEqual({ id: 'r1', status: 'refunded' });
      expect(upload).toHaveBeenCalledTimes(1);
      const [bucket, path, sent, options] = upload.mock.calls[0];
      expect(bucket).toBe('refund-proofs');
      expect(path).toMatch(PATH);
      expect(sent).toBe(file);
      expect(options).toEqual({ contentType: 'image/png', upsert: false });
      const [name, params] = rpc.mock.calls[0];
      expect(name).toBe('admin_resolve_refund_v2');
      expect(params).toMatchObject({
        p_refund_id: 'r1',
        p_action: 'refunded',
        p_reference: 'ZELLE-1',
        p_refunded_at: '2026-10-30T12:00:00.000Z',
        p_reason: null,
        p_proof_path: path,
        p_self_resolve_confirm: false
      });
      expect(params.p_proof_sha256 === null || /^[0-9a-f]{64}$/.test(params.p_proof_sha256)).toBe(true);
    });

    it('keeps the uploaded proof when the server stored exactly that path', async () => {
      rpc.mockImplementation(async (_name, params) => ({
        data: { ok: true, refund: { id: 'r1', status: 'refunded', proof_path: params.p_proof_path } },
        error: null
      }));
      await resolveRefund({ refundId: 'r1', action: 'refunded', reference: 'x', proofFile: proofFile() });
      expect(remove).not.toHaveBeenCalled();
    });

    it('removes the new upload when the server answers ok with another proof (idempotent replay of an earlier resolution)', async () => {
      rpc.mockResolvedValue({ data: { ok: true, refund: { id: 'r1', status: 'refunded', proof_path: 'refunds/r1/earlier.png' } }, error: null });
      const out = await resolveRefund({ refundId: 'r1', action: 'refunded', reference: 'x', proofFile: proofFile() });
      expect(out.proof_path).toBe('refunds/r1/earlier.png');
      expect(remove).toHaveBeenCalledTimes(1);
      expect(remove.mock.calls[0][1]).toEqual([upload.mock.calls[0][1]]);
    });

    it('a not_applicable resolution needs no proof and uploads nothing', async () => {
      rpc.mockResolvedValue({ data: okRow('not_applicable'), error: null });
      await resolveRefund({ refundId: 'r1', action: 'not_applicable', reason: ' never arrived ' });
      expect(upload).not.toHaveBeenCalled();
      expect(rpc).toHaveBeenCalledWith('admin_resolve_refund_v2', {
        p_refund_id: 'r1',
        p_action: 'not_applicable',
        p_reference: null,
        p_refunded_at: null,
        p_reason: 'never arrived',
        p_proof_path: null,
        p_proof_sha256: null,
        p_self_resolve_confirm: false
      });
    });

    it('passes the reinforced self-resolution confirmation only when asked', async () => {
      rpc.mockResolvedValue({ data: okRow('not_applicable'), error: null });
      await resolveRefund({ refundId: 'r1', action: 'not_applicable', reason: 'x', selfResolveConfirm: true });
      expect(rpc.mock.calls[0][1].p_self_resolve_confirm).toBe(true);
    });

    it('refuses locally, before any upload or call, a missing proof, a bad file, a missing id or a bad action', async () => {
      await expect(resolveRefund({ refundId: 'r1', action: 'refunded', reference: 'x' })).rejects.toMatchObject({ context: { reason: 'proof_required' } });
      await expect(
        resolveRefund({ refundId: 'r1', action: 'refunded', reference: 'x', proofFile: new File(['x'], 'a.txt', { type: 'text/plain' }) })
      ).rejects.toMatchObject({ context: { reason: 'invalid_proof_file' } });
      await expect(resolveRefund({ action: 'refunded', reference: 'x' })).rejects.toBeTruthy();
      await expect(resolveRefund({ refundId: 'r1', action: 'bogus' })).rejects.toBeTruthy();
      expect(upload).not.toHaveBeenCalled();
      expect(rpc).not.toHaveBeenCalled();
    });

    it('a failed upload stops before the RPC', async () => {
      upload.mockResolvedValue({ data: null, error: { message: 'boom' } });
      await expect(resolveRefund({ refundId: 'r1', action: 'refunded', reference: 'x', proofFile: proofFile() })).rejects.toMatchObject({
        context: { reason: 'proof_upload_failed' }
      });
      expect(rpc).not.toHaveBeenCalled();
    });

    it('removes the uploaded proof when the RPC fails or refuses (no orphan), and types the refusal', async () => {
      rpc.mockResolvedValueOnce({ data: null, error: { code: '22023', message: 'refund_on_hold: x', details: 'eligible_at=2026-10-28T14:00:00Z' } });
      await expect(resolveRefund({ refundId: 'r1', action: 'refunded', reference: 'x', proofFile: proofFile() })).rejects.toMatchObject({
        context: { reason: 'refund_on_hold', eligibleAt: '2026-10-28T14:00:00Z' }
      });
      expect(remove).toHaveBeenCalledTimes(1);
      expect(remove.mock.calls[0][0]).toBe('refund-proofs');
      expect(remove.mock.calls[0][1]).toEqual([upload.mock.calls[0][1]]);

      rpc.mockResolvedValueOnce({ data: { ok: false, code: 'self_resolution_not_allowed' }, error: null });
      await expect(resolveRefund({ refundId: 'r1', action: 'refunded', reference: 'x', proofFile: proofFile() })).rejects.toMatchObject({
        context: { reason: 'self_resolution_not_allowed' }
      });
      expect(remove).toHaveBeenCalledTimes(2);
    });

    it('a failing cleanup never hides the original error', async () => {
      remove.mockRejectedValue(new Error('cleanup failed'));
      rpc.mockResolvedValue({ data: null, error: { code: '22023', message: 'already_resolved: x' } });
      await expect(resolveRefund({ refundId: 'r1', action: 'refunded', reference: 'x', proofFile: proofFile() })).rejects.toMatchObject({
        context: { reason: 'already_resolved' }
      });
    });

    it.each([
      [{ code: '22023', message: 'refund_on_hold: refunds start 48 hours after the cancellation', details: 'eligible_at=2026-10-28T14:00:00Z' }, 'refund_on_hold'],
      [{ code: '22023', message: 'already_resolved: this refund request is already refunded' }, 'already_resolved'],
      [{ code: '22023', message: 'invalid_argument: p_reference is required', details: 'p_reference' }, 'invalid_argument'],
      [{ code: '22023', message: 'proof_required: a proof of the refund is required', details: 'p_proof_path' }, 'proof_required'],
      [{ code: '42501', message: 'insufficient_privilege' }, 'not_authorized'],
      [{ code: 'P0002', message: 'refund_not_found' }, 'refund_not_found']
    ])('types the server refusal %#', async (error, reason) => {
      rpc.mockResolvedValue({ data: null, error });
      await expect(resolveRefund({ refundId: 'r1', action: 'not_applicable', reason: 'x' })).rejects.toMatchObject({
        context: expect.objectContaining({ reason })
      });
    });

    it('exposes the field on invalid_argument', async () => {
      rpc.mockResolvedValueOnce({ data: null, error: { code: '22023', message: 'invalid_argument: p_proof_path', details: 'p_proof_path' } });
      await expect(resolveRefund({ refundId: 'r1', action: 'not_applicable', reason: 'x' })).rejects.toMatchObject({
        context: { reason: 'invalid_argument', field: 'p_proof_path' }
      });
    });

    it('does not swallow a missing backend on a write: the admin must see that it failed', async () => {
      rpc.mockResolvedValue({ data: null, error: { code: '42883', message: 'function does not exist' } });
      await expect(resolveRefund({ refundId: 'r1', action: 'not_applicable', reason: 'x' })).rejects.toBeTruthy();
    });

    it('never logs the reference, the proof path or the file name', async () => {
      rpc.mockResolvedValue({ data: null, error: { code: '22023', message: 'already_resolved: x' } });
      await expect(
        resolveRefund({ refundId: 'r1', action: 'refunded', reference: 'SECRET-ZELLE-77', proofFile: proofFile() })
      ).rejects.toBeTruthy();
      const logged = JSON.stringify(logError.mock.calls);
      expect(logged).not.toContain('SECRET-ZELLE-77');
      expect(logged).not.toContain('refunds/');
      expect(logged).not.toContain('zelle.png');
    });
  });

  describe('read-only audit surfaces (degrade silently)', () => {
    const missing = { data: null, error: { code: '42883', message: 'missing' } };

    it('getOperationRefundDetail strips actor ids, ref ids and personal columns', async () => {
      rpc.mockImplementation(async (name) =>
        name === 'admin_get_operation_refunds'
          ? { data: [{ id: 'r1', status: 'pending', user_id: 'u', payment_evidence: 'validated', amount: 10, currency: 'USD', proof_state: 'none', queue_state: 'on_hold', eligible_at: 'e', due_at: 'd', cancelled_at: 'c', resolved_at: null, refunded_at: null, self_resolved: false, proof_expires_at: null }], error: null }
          : { data: [{ ts: 't', source: 'refund_event', kind: 'created', actor_id: 'a', ref_id: 'x', summary: { to: 'pending' } }], error: null }
      );
      const detail = await getOperationRefundDetail('order', 'op1');
      expect(rpc).toHaveBeenCalledWith('admin_get_operation_refunds', { p_operation_type: 'order', p_operation_id: 'op1' });
      expect(rpc).toHaveBeenCalledWith('admin_operation_timeline', { p_operation_type: 'order', p_operation_id: 'op1' });
      expect(detail.timeline).toEqual([{ ts: 't', source: 'refund_event', kind: 'created', summary: { to: 'pending' } }]);
      expect(detail.refunds[0]).not.toHaveProperty('user_id');
      expect(detail.refunds[0]).not.toHaveProperty('payment_evidence');
      expect(detail.refunds[0].status).toBe('pending');
    });

    it('getOperationRefundDetail flags a partial failure as incomplete', async () => {
      rpc.mockImplementation(async (name) =>
        name === 'admin_get_operation_refunds' ? { data: [], error: null } : { data: null, error: { code: '42501', message: 'x' } }
      );
      const detail = await getOperationRefundDetail('order', 'op1');
      expect(detail.incomplete).toBe(true);
      expect(detail.refunds).toEqual([]);
    });

    it('getOperationRefundDetail returns null when both RPCs are missing, and never throws on other failures', async () => {
      rpc.mockResolvedValue(missing);
      expect(await getOperationRefundDetail('order', 'op1')).toBeNull();
      resetRefundBackendForTests();
      rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'nope' } });
      expect(await getOperationRefundDetail('remittance', 'op1')).toBeNull();
    });

    it('getRefundMetrics returns the payload, or null when absent or failing', async () => {
      rpc.mockResolvedValueOnce({ data: { total_refunded: 4 }, error: null });
      const range = { from: new Date('2026-10-01T00:00:00Z'), to: new Date('2026-11-01T00:00:00Z') };
      expect(await getRefundMetrics(range)).toEqual({ total_refunded: 4 });
      expect(rpc).toHaveBeenCalledWith('admin_refund_metrics', {
        p_from: '2026-10-01T00:00:00.000Z',
        p_to: '2026-11-01T00:00:00.000Z',
        p_operation_type: null
      });
      rpc.mockResolvedValueOnce(missing);
      expect(await getRefundMetrics(range)).toBeNull();
      resetRefundBackendForTests();
      rpc.mockResolvedValueOnce({ data: null, error: { code: '42501', message: 'x' } });
      expect(await getRefundMetrics(range)).toBeNull();
    });

    it('getExpiringProofs maps the payload and degrades to null', async () => {
      rpc.mockResolvedValueOnce({ data: { count: 2, items: [{ refund_id: 'r', proof_expires_at: 'x' }], overdue_unpurged: 1 }, error: null });
      expect(await getExpiringProofs(30)).toEqual({ count: 2, overdueUnpurged: 1 });
      expect(rpc).toHaveBeenCalledWith('admin_refund_proofs_expiring', { p_days: 30 });
      rpc.mockResolvedValueOnce(missing);
      expect(await getExpiringProofs(30)).toBeNull();
    });

    it('getMyOperationRefund returns the owner refunds and [] when the RPC is missing or fails', async () => {
      rpc.mockResolvedValueOnce({ data: { refunds: [{ status: 'pending', stage: 'on_hold' }] }, error: null });
      expect(await getMyOperationRefund('remittance', 'op1')).toEqual([{ status: 'pending', stage: 'on_hold' }]);
      expect(rpc).toHaveBeenCalledWith('my_operation_refund', { p_kind: 'remittance', p_operation_id: 'op1' });
      rpc.mockResolvedValueOnce(missing);
      expect(await getMyOperationRefund('order', 'op1')).toEqual([]);
      resetRefundBackendForTests();
      rpc.mockResolvedValueOnce({ data: null, error: { code: 'XX000', message: 'boom' } });
      expect(await getMyOperationRefund('order', 'op1')).toEqual([]);
    });
  });

  describe('getRefundDisputeStates', () => {
    it('returns the ids with an open dispute', async () => {
      rpc.mockResolvedValueOnce({ data: ['a', 'c'], error: null });
      expect(await getRefundDisputeStates(['a', 'b', 'c'])).toEqual(['a', 'c']);
      expect(rpc).toHaveBeenCalledWith('admin_refund_dispute_states', { p_refund_ids: ['a', 'b', 'c'] });
    });
    it('does not call the RPC for an empty list', async () => {
      expect(await getRefundDisputeStates([])).toEqual([]);
      expect(rpc).not.toHaveBeenCalled();
    });
    it('returns null (state unknown) when the RPC is missing or fails', async () => {
      rpc.mockResolvedValueOnce({ data: null, error: { code: '42883', message: 'missing' } });
      expect(await getRefundDisputeStates(['a'])).toBeNull();
      resetRefundBackendForTests();
      rpc.mockResolvedValueOnce({ data: null, error: { code: '42501', message: 'x' } });
      expect(await getRefundDisputeStates(['a'])).toBeNull();
    });
  });

  describe('dispute and purge (writes never degrade)', () => {
    it('setRefundDispute returns the RPC answer', async () => {
      rpc.mockResolvedValue({ data: { ok: true, open: true }, error: null });
      expect(await setRefundDispute('r1', true)).toEqual({ ok: true, open: true });
      expect(rpc).toHaveBeenCalledWith('admin_set_refund_dispute', { p_refund_id: 'r1', p_open: true });
    });

    it('setRefundDispute surfaces the self-management refusal as a typed error', async () => {
      rpc.mockResolvedValue({ data: { ok: false, code: 'self_resolution_not_allowed' }, error: null });
      await expect(setRefundDispute('r1', true)).rejects.toMatchObject({ context: { reason: 'self_resolution_not_allowed' } });
    });

    it('setRefundDispute throws on an RPC error (not_authorized for 42501)', async () => {
      rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'x' } });
      await expect(setRefundDispute('r1', false)).rejects.toMatchObject({ context: { reason: 'not_authorized' } });
    });

    it('previewPurgeRefundProofs calls the Edge Function in preview mode', async () => {
      invoke.mockResolvedValue({ data: { due: 3, capped: false }, error: null });
      expect(await previewPurgeRefundProofs()).toEqual({ due: 3, capped: false });
      expect(invoke).toHaveBeenCalledWith('purge-refund-proofs', { body: { mode: 'preview' } });
    });

    it('executePurgeRefundProofs sends the confirmed count and returns the counters', async () => {
      invoke.mockResolvedValue({ data: { purged: 2, skipped: 1, failed: 0 }, error: null });
      expect(await executePurgeRefundProofs(3)).toEqual({ purged: 2, skipped: 1, failed: 0 });
      expect(invoke).toHaveBeenCalledWith('purge-refund-proofs', { body: { mode: 'execute', confirm_count: 3 } });
    });

    it('executePurgeRefundProofs refuses a non-integer count without calling the function', async () => {
      await expect(executePurgeRefundProofs('3')).rejects.toMatchObject({ context: { reason: 'invalid_argument' } });
      expect(invoke).not.toHaveBeenCalled();
    });

    it('maps 401/403 from the function to not_authorized', async () => {
      for (const status of [401, 403]) {
        invoke.mockResolvedValueOnce({ data: null, error: { context: { status }, message: 'x' } });
        await expect(previewPurgeRefundProofs()).rejects.toMatchObject({ context: { reason: 'not_authorized' } });
      }
    });

    it('a 409 from the function is reported as count_changed; other failures as purge_failed', async () => {
      invoke.mockResolvedValueOnce({ data: null, error: { context: { status: 409 }, message: 'x' } });
      await expect(executePurgeRefundProofs(3)).rejects.toMatchObject({ context: { reason: 'count_changed' } });
      invoke.mockResolvedValueOnce({ data: null, error: { context: { status: 500 }, message: 'x' } });
      await expect(previewPurgeRefundProofs()).rejects.toMatchObject({ context: { reason: 'purge_failed' } });
    });
  });
});
