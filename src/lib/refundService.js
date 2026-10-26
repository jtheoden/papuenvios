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
export const resetRefundBackendForTests = () => {
  missingAt = null;
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
