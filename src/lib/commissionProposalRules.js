/**
 * Pure rules of the customer acceptance of a commission raise (table remittance_commission_proposals, RPCs
 * remittance_accept_commission / admin_get_commission_proposals). No Supabase import: safe for components and tests.
 */
import { roundMoney, roundTo } from './moneyPure';

// Column-level SELECT: created_by / responded_by / override_id are NOT readable by `authenticated`, so a select('*')
// on this table fails with 42501. Always list the columns.
export const PROPOSAL_COLUMNS =
  'id, remittance_id, direction, baseline_commission, new_commission, status, created_at, responded_at';

const MISSING_CODES = ['42P01', '42883', 'PGRST205', 'PGRST202'];

/**
 * True when the table / function does not exist (yet). The front is deployed BEFORE the migrations are applied, so this
 * must read as "no proposals", never as an error for the user.
 */
export const isBackendMissingError = (error) => {
  if (!error) return false;
  // Codes only: matching the message would also hide real bugs such as 42703 (undefined column).
  return MISSING_CODES.includes(error.code);
};

/**
 * A decrease notice is true only while the live commission is the one it announced; after a later raise (6 -> 1
 * informed, 1 -> 8 accepted) it would show a false amount.
 */
export const isInformedCurrent = (remittance, proposal) =>
  Boolean(proposal) && roundMoney(Number(proposal.new_commission)) === roundMoney(Number(remittance.commission_total));

const REASONS = ['commission_pending_acceptance', 'proposal_not_open', 'proposal_stale', 'invalid_transition'];

/** Reason of a documented RPC refusal, or null when it is not one of ours. */
export const commissionErrorReason = (error) => {
  const message = String(error?.message || '');
  if (error?.code === '22023') return REASONS.find((reason) => message.includes(reason)) ?? null;
  if (error?.code === '42501') return 'not_authorized';
  if (error?.code === 'P0002' && message.includes('proposal_not_found')) return 'proposal_not_open';
  return null;
};

const ERROR_KEYS = {
  commission_pending_acceptance: 'pendingAcceptance',
  proposal_not_open: 'notOpen',
  proposal_stale: 'stale',
  invalid_transition: 'invalidTransition',
  not_authorized: 'notAuthorized',
};

/** i18n key for a reason from commissionErrorReason (generic when unknown). */
export const commissionErrorKey = (reason) => `remittances.commissionChange.errors.${ERROR_KEYS[reason] ?? 'generic'}`;

/** { pending: {remittanceId: proposal}, informed: {remittanceId: latest informed proposal} } */
export const groupProposals = (rows) => {
  const grouped = { pending: {}, informed: {} };
  if (!Array.isArray(rows)) return grouped;
  for (const row of rows) {
    if (row.status === 'pending') {
      grouped.pending[row.remittance_id] = row;
    } else if (row.status === 'informed') {
      const current = grouped.informed[row.remittance_id];
      if (!current || String(row.created_at) > String(current.created_at)) grouped.informed[row.remittance_id] = row;
    }
  }
  return grouped;
};

/**
 * Before/after view of a proposal. The amount the customer pays does not change; only what the recipient receives:
 * round((sent - commission) * rate4, 2), same formula as the RPCs.
 */
export const calcCommissionChange = (remittance, proposal) => {
  const rate = roundTo(remittance.exchange_rate, 4);
  const sent = Number(remittance.amount_sent);
  const oldCommission = roundMoney(Number(proposal.baseline_commission));
  const newCommission = roundMoney(Number(proposal.new_commission));
  return {
    oldCommission,
    newCommission,
    oldReceives: roundMoney(roundMoney(sent - oldCommission) * rate),
    newReceives: roundMoney(roundMoney(sent - newCommission) * rate),
    delta: roundMoney(newCommission - oldCommission),
  };
};
