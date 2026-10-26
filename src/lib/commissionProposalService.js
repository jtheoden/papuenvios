/**
 * Client of the commission acceptance backend. Reads use EXPLICIT columns (see PROPOSAL_COLUMNS); writes go only
 * through the RPC remittance_accept_commission. (admin_get_commission_proposals exists in the database for admin tools
 * that need created_by; no screen uses it yet, so there is no wrapper.)
 * Until the migrations are applied in production the table / RPCs do not exist: those cases read as "no proposals".
 */
import { supabase } from './supabase';
import { AppError, ERROR_CODES, logError, createValidationError } from './errorHandler';
import { PROPOSAL_COLUMNS, isBackendMissingError, commissionErrorReason } from './commissionProposalRules';

// Once the table is known to be missing (front deployed before the migrations) stop asking: one failed request per
// page load instead of one per refetch. A page reload after the migrations are applied picks the table up.
let backendMissing = false;
export const resetBackendMissingForTests = () => {
  backendMissing = false;
};

/**
 * Pending and informed proposals of the given remittances (newest first).
 * @param {string[]} remittanceIds
 * @returns {Promise<Array<object>>}
 */
export const getOpenProposals = async (remittanceIds) => {
  if (backendMissing || !Array.isArray(remittanceIds) || remittanceIds.length === 0) return [];
  const { data, error } = await supabase
    .from('remittance_commission_proposals')
    .select(PROPOSAL_COLUMNS)
    .in('remittance_id', remittanceIds)
    .in('status', ['pending', 'informed'])
    .order('created_at', { ascending: false });
  if (error) {
    if (isBackendMissingError(error)) {
      backendMissing = true;
      return [];
    }
    throw error;
  }
  return data || [];
};

/**
 * Customer accepts the current proposal. Throws an AppError whose context.reason is one of
 * proposal_not_open | proposal_stale | invalid_transition | not_authorized when the RPC refused.
 */
export const acceptCommission = async (remittanceId, proposalId) => {
  if (!remittanceId || !proposalId) {
    throw createValidationError({ proposalId: 'Remittance and proposal are required' });
  }
  const { data, error } = await supabase.rpc('remittance_accept_commission', {
    p_remittance_id: remittanceId,
    p_proposal_id: proposalId,
  });
  if (error) {
    const reason = commissionErrorReason(error);
    const appError = new AppError(error.message || 'commission_accept_failed', ERROR_CODES.CONFLICT, 409, { reason });
    logError(appError, { operation: 'remittance_accept_commission', remittanceId, proposalId });
    throw appError;
  }
  return data;
};
