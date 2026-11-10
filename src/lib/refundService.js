/**
 * Client of the refunds queue backend (RPCs admin_refund_counts, admin_list_refunds, admin_resolve_refund over the table
 * refund_requests). Admin only; the database enforces it (42501).
 * The front is deployed BEFORE the migrations are applied in production: while the RPCs do not exist, reads answer
 * "no refunds" (no toast, no console noise) and the module stops asking for 5 minutes after a failure, then tries again,
 * so applying the migrations is picked up without a reload. Writes never degrade: the admin must see that they failed.
 */
import { supabase } from './supabase';
import { AppError, ERROR_CODES, logError } from './errorHandler';
import { isBackendMissingError } from './commissionProposalRules';
import { refundProofExtension, validateRefundProofFile } from './refundRules';

const MISSING_RETRY_MS = 5 * 60 * 1000;
let missingAt = null; // when the backend was last found missing
const backendKnownMissing = () => missingAt !== null && Date.now() - missingAt < MISSING_RETRY_MS;
const softMissingAt = new Map(); // per RPC, for the read-only audit surfaces
export const resetRefundBackendForTests = () => {
  missingAt = null;
  softMissingAt.clear();
};

/** Event the refunds screen dispatches after a resolution so other surfaces (header badge) refresh at once. */
export const REFUNDS_CHANGED_EVENT = 'papuenvios:refunds-changed';
export const notifyRefundsChanged = () => {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(REFUNDS_CHANGED_EVENT));
};

const REFUND_PROOF_BUCKET = 'refund-proofs';

/** Typed refusal raised on the client: context.reason is what the screens switch on. */
const refusal = (reason, code, status, extra = {}) => new AppError(reason, code, status, { reason, ...extra });

const sha256Hex = async (file) => {
  try {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', await file.arrayBuffer());
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return null; // the hash is optional
  }
};

const REASON_CODES = {
  proof_required: ERROR_CODES.VALIDATION_FAILED,
  refund_on_hold: ERROR_CODES.CONFLICT,
  already_resolved: ERROR_CODES.CONFLICT,
  invalid_argument: ERROR_CODES.VALIDATION_FAILED,
  not_authorized: ERROR_CODES.FORBIDDEN,
  refund_not_found: ERROR_CODES.NOT_FOUND
};

/** Documented refusals of the RPCs as { reason, ...detail }, or null when the error is not one of ours. */
const refusalContext = (error) => {
  const message = String(error?.message || '');
  const details = String(error?.details ?? error?.detail ?? '');
  if (error?.code === '42501') return { reason: 'not_authorized' };
  if (error?.code === 'P0002' && message.includes('refund_not_found')) return { reason: 'refund_not_found' };
  if (error?.code === '22023') {
    if (message.includes('refund_on_hold')) {
      const match = details.match(/eligible_at=(\S+)/);
      return { reason: 'refund_on_hold', eligibleAt: match ? match[1] : null };
    }
    if (message.includes('already_resolved')) return { reason: 'already_resolved' };
    if (message.includes('proof_required')) return { reason: 'proof_required' };
    if (message.includes('invalid_argument')) return { reason: 'invalid_argument', field: details || null };
  }
  return null;
};

const toAppError = (error, operation) => {
  const context = refusalContext(error);
  const appError = new AppError(
    error?.message || `${operation}_failed`,
    context ? REASON_CODES[context.reason] : ERROR_CODES.CONFLICT,
    context?.reason === 'not_authorized' ? 403 : 409,
    context || {}
  );
  // A non-admin hitting the RPC is expected (the badge asks on every poll): refused, not logged.
  if (context?.reason !== 'not_authorized') logError(appError, { operation });
  return appError;
};

const toNumber = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Open-request counts for the badge, the tab and the dashboard card.
 * actionable = past the 48 h hold (what must be worked today); overdue and dueSoon are subsets of it.
 * pendingAmountUsd sums only USD rows: it is NOT the total owed when other currencies exist.
 * @returns {Promise<{actionable:number,onHold:number,dueSoon:number,overdue:number,pendingAmountUsd:number}>}
 */
export const getRefundCounts = async () => {
  const empty = { actionable: 0, onHold: 0, dueSoon: 0, overdue: 0, pendingAmountUsd: 0 };
  if (backendKnownMissing()) return empty;
  const { data, error } = await supabase.rpc('admin_refund_counts');
  if (error) {
    if (isBackendMissingError(error)) {
      missingAt = Date.now();
      return empty;
    }
    throw toAppError(error, 'admin_refund_counts');
  }
  return {
    actionable: toNumber(data?.actionable),
    onHold: toNumber(data?.on_hold),
    dueSoon: toNumber(data?.due_soon),
    overdue: toNumber(data?.overdue),
    pendingAmountUsd: toNumber(data?.pending_amount_usd)
  };
};

/**
 * @param {{ status?: 'pending'|'refunded'|'not_applicable'|'all', limit?: number, offset?: number, queueState?: string|null }} [options]
 * @returns {Promise<{ total: number, items: Array<object> }>}
 */
export const listRefunds = async ({ status = 'all', limit = 200, offset = 0, queueState = null } = {}) => {
  if (backendKnownMissing()) return { total: 0, items: [] };
  const { data, error } = await supabase.rpc('admin_list_refunds', {
    p_status: status,
    p_limit: limit,
    p_offset: offset,
    p_queue_state: queueState
  });
  if (error) {
    if (isBackendMissingError(error)) {
      missingAt = Date.now();
      return { total: 0, items: [] };
    }
    throw toAppError(error, 'admin_list_refunds');
  }
  return { total: toNumber(data?.total), items: Array.isArray(data?.items) ? data.items : [] };
};

/**
 * Resolves an open request. Throws an AppError whose context.reason is one of
 * refund_on_hold (context.eligibleAt) | already_resolved | invalid_argument (context.field) | not_authorized | refund_not_found.
 * @param {{ refundId: string, action: 'refunded'|'not_applicable', reference?: string, refundedAt?: string|null, reason?: string }} input
 */
export const resolveRefund = async ({
  refundId,
  action,
  reference = null,
  refundedAt = null,
  reason = null,
  proofFile = null,
  selfResolveConfirm = false
}) => {
  if (!refundId || !['refunded', 'not_applicable'].includes(action)) {
    throw new AppError('invalid_argument: refundId and a valid action are required', ERROR_CODES.VALIDATION_FAILED, 400, {
      reason: 'invalid_argument'
    });
  }
  const trimmed = (value) => (typeof value === 'string' && value.trim() ? value.trim() : null);

  // 'refunded' needs a proof (the database enforces it too). Checked here so nothing is uploaded for a doomed request.
  let proofPath = null;
  let proofSha = null;
  if (action === 'refunded') {
    const problem = validateRefundProofFile(proofFile);
    if (problem === 'missing') throw refusal('proof_required', ERROR_CODES.VALIDATION_FAILED, 400);
    if (problem) throw refusal('invalid_proof_file', ERROR_CODES.VALIDATION_FAILED, 400, { problem });
    proofPath = `refunds/${refundId}/${globalThis.crypto.randomUUID()}.${refundProofExtension(proofFile.type)}`;
    proofSha = await sha256Hex(proofFile);
    const { error: uploadError } = await supabase.storage
      .from(REFUND_PROOF_BUCKET)
      .upload(proofPath, proofFile, { contentType: proofFile.type, upsert: false });
    if (uploadError) {
      const appError = refusal('proof_upload_failed', ERROR_CODES.DB_ERROR, 500);
      logError(appError, { operation: 'refund_proof_upload' });
      throw appError;
    }
  }

  // The upload happened before the RPC: if the RPC does not accept the resolution, the object is removed (best effort) so no
  // orphan stays in the private bucket. A failing cleanup never hides the original error.
  const discardUpload = async () => {
    if (!proofPath) return;
    try {
      await supabase.storage.from(REFUND_PROOF_BUCKET).remove([proofPath]);
    } catch {
      /* the original error matters more */
    }
  };

  const { data, error } = await supabase.rpc('admin_resolve_refund_v2', {
    p_refund_id: refundId,
    p_action: action,
    p_reference: trimmed(reference),
    p_refunded_at: refundedAt || null,
    p_reason: trimmed(reason),
    p_proof_path: proofPath,
    p_proof_sha256: proofSha,
    p_self_resolve_confirm: selfResolveConfirm === true
  });
  if (error) {
    await discardUpload();
    throw toAppError(error, 'admin_resolve_refund_v2');
  }
  if (!data || data.ok !== true) {
    await discardUpload();
    // The only documented non-exception refusal: the admin is the customer of this refund (separation of duties).
    throw refusal(data?.code === 'self_resolution_not_allowed' ? 'self_resolution_not_allowed' : 'invalid_argument',
      data?.code === 'self_resolution_not_allowed' ? ERROR_CODES.FORBIDDEN : ERROR_CODES.VALIDATION_FAILED,
      data?.code === 'self_resolution_not_allowed' ? 403 : 400);
  }
  // An idempotent replay returns the row as it was stored: if its proof is not the one just uploaded, the new object is an orphan.
  if (proofPath && data.refund?.proof_path !== proofPath) await discardUpload();
  return data.refund;
};

/**
 * Read-only RPC for surfaces that must never add noise (detail sections, KPIs, customer view): any failure reads as null.
 * A missing RPC (migration not applied yet) is remembered for 5 minutes per RPC so the page does not keep asking.
 */
const softRpc = async (name, args) => {
  const missing = softMissingAt.get(name);
  if (missing !== undefined && Date.now() - missing < MISSING_RETRY_MS) return null;
  try {
    const { data, error } = await supabase.rpc(name, args);
    if (error) {
      if (isBackendMissingError(error)) softMissingAt.set(name, Date.now());
      return null;
    }
    return data ?? null;
  } catch {
    return null;
  }
};

/**
 * Refund episodes and event timeline of an operation, admin only. Personal columns (customer id, payment evidence) and the
 * actor / reference ids of the timeline are dropped here: the screens never see them.
 * @returns {Promise<{ refunds: object[], timeline: object[], incomplete: boolean } | null>} null when neither RPC answered
 */
export const getOperationRefundDetail = async (kind, operationId) => {
  const args = { p_operation_type: kind, p_operation_id: operationId };
  const [refunds, timeline] = await Promise.all([softRpc('admin_get_operation_refunds', args), softRpc('admin_operation_timeline', args)]);
  if (!Array.isArray(refunds) && !Array.isArray(timeline)) return null;
  return {
    incomplete: !Array.isArray(refunds) || !Array.isArray(timeline),
    refunds: (Array.isArray(refunds) ? refunds : []).map(
      ({ user_id: _user, payment_evidence: _evidence, resolved_by: _resolver, ...safe }) => safe
    ),
    timeline: (Array.isArray(timeline) ? timeline : []).map(({ ts, source, kind: eventKind, summary }) => ({
      ts,
      source,
      kind: eventKind,
      summary: summary || {}
    }))
  };
};

/** Aggregated refund metrics (no PII) for a [from, to) range, or null when unavailable. */
export const getRefundMetrics = ({ from, to, operationType = null }) =>
  softRpc('admin_refund_metrics', {
    p_from: new Date(from).toISOString(),
    p_to: new Date(to).toISOString(),
    p_operation_type: operationType
  });

/** Proofs whose one-year retention ends within `days`: { count, overdueUnpurged } or null. */
export const getExpiringProofs = async (days = 30) => {
  const data = await softRpc('admin_refund_proofs_expiring', { p_days: days });
  if (!data) return null;
  return { count: toNumber(data.count), overdueUnpurged: toNumber(data.overdue_unpurged) };
};

/** Customer view: refund episodes of one of MY operations ([] when none, or when the RPC does not exist yet). */
export const getMyOperationRefund = async (kind, operationId) => {
  const data = await softRpc('my_operation_refund', { p_kind: kind, p_operation_id: operationId });
  return Array.isArray(data?.refunds) ? data.refunds : [];
};

/**
 * Which of the given refunds have an open dispute: an array of ids, or null when the state cannot be known
 * (RPC not applied yet, no permission): the screens then hide the dispute control instead of offering a blind button.
 */
export const getRefundDisputeStates = async (refundIds) => {
  const ids = [...new Set(refundIds ?? [])].slice(0, 500);
  if (ids.length === 0) return [];
  const data = await softRpc('admin_refund_dispute_states', { p_refund_ids: ids });
  return Array.isArray(data) ? data : null;
};

/** Opens or closes a dispute on a refund (a dispute blocks the purge of its proof). Writes never degrade. */
export const setRefundDispute = async (refundId, open) => {
  const { data, error } = await supabase.rpc('admin_set_refund_dispute', { p_refund_id: refundId, p_open: open === true });
  if (error) throw toAppError(error, 'admin_set_refund_dispute');
  if (!data || data.ok !== true) {
    const self = data?.code === 'self_resolution_not_allowed';
    throw refusal(self ? 'self_resolution_not_allowed' : 'invalid_argument', self ? ERROR_CODES.FORBIDDEN : ERROR_CODES.VALIDATION_FAILED, self ? 403 : 400);
  }
  return data;
};

const invokePurge = async (body) => {
  const { data, error } = await supabase.functions.invoke('purge-refund-proofs', { body });
  if (error) {
    const status = error?.context?.status;
    if (status === 401 || status === 403) throw refusal('not_authorized', ERROR_CODES.FORBIDDEN, 403);
    const countChanged = status === 409;
    const appError = refusal(countChanged ? 'count_changed' : 'purge_failed', countChanged ? ERROR_CODES.CONFLICT : ERROR_CODES.DB_ERROR, countChanged ? 409 : 500);
    logError(appError, { operation: 'purge_refund_proofs' });
    throw appError;
  }
  return data;
};

/** Edge Function, preview mode: how many expired proofs would be deleted. Nothing is deleted. */
export const previewPurgeRefundProofs = async () => {
  const data = await invokePurge({ mode: 'preview' });
  return { due: toNumber(data?.due), capped: data?.capped === true };
};

/** Edge Function, execute mode: the count must equal the one the admin saw (the function refuses otherwise). */
export const executePurgeRefundProofs = async (confirmCount) => {
  if (!Number.isInteger(confirmCount) || confirmCount < 0) {
    throw refusal('invalid_argument', ERROR_CODES.VALIDATION_FAILED, 400);
  }
  const data = await invokePurge({ mode: 'execute', confirm_count: confirmCount });
  return { purged: toNumber(data?.purged), skipped: toNumber(data?.skipped), failed: toNumber(data?.failed) };
};
