/**
 * Pure rules of the admin refunds queue: queue state, filters, counts, summary, search, ordering and the copyable block.
 * The database is the source of truth for the window (eligible_at / due_at); the queue state is recomputed here from the
 * stored instants and the clock so the screen stays right between the 30 s refreshes.
 */
import { refundQueueState } from '@/lib/refundWindow';

export const REFUND_FILTERS = ['toRefund', 'verify', 'onHold', 'overdue', 'refunded', 'notApplicable', 'all'];

const STATE_RANK = { overdue: 0, due_soon: 1, on_time: 2, on_hold: 3 };

const isPending = (r) => r.status === 'pending';
const isActionable = (r) => isPending(r) && r.queueState !== 'on_hold';

const PREDICATES = {
  toRefund: isActionable,
  verify: (r) => isPending(r) && r.payment_evidence === 'proof_unverified',
  onHold: (r) => isPending(r) && r.queueState === 'on_hold',
  overdue: (r) => isPending(r) && r.queueState === 'overdue',
  refunded: (r) => r.status === 'refunded',
  notApplicable: (r) => r.status === 'not_applicable',
  all: () => true
};

/** Adds queueState (null once resolved) computed against `now`. */
export const withQueueState = (refund, now = new Date()) => ({
  ...refund,
  queueState: isPending(refund) ? refundQueueState({ eligibleAt: refund.eligible_at, dueAt: refund.due_at }, now) : null
});

export const filterRefunds = (refunds, filterId) => refunds.filter(PREDICATES[filterId] || PREDICATES.all);

export const countByFilter = (refunds) =>
  Object.fromEntries(REFUND_FILTERS.map((id) => [id, filterRefunds(refunds, id).length]));

/** pendingAmountUsd adds USD rows only: other currencies are never mixed into it. */
export const summarizeRefunds = (refunds) => {
  const pending = refunds.filter(isPending);
  return {
    pending: pending.length,
    pendingAmountUsd: pending.filter((r) => r.currency === 'USD').reduce((sum, r) => sum + Number(r.amount || 0), 0),
    dueSoon: pending.filter((r) => r.queueState === 'due_soon').length,
    overdue: pending.filter((r) => r.queueState === 'overdue').length,
    actionable: pending.filter(isActionable).length,
    onHold: pending.filter((r) => r.queueState === 'on_hold').length
  };
};

const normalize = (value) =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

export const searchRefunds = (refunds, query) => {
  const needle = normalize(query).trim();
  if (!needle) return refunds;
  return refunds.filter((r) =>
    [r.operation_number, r.customer_name, r.customer_email].some((field) => normalize(field).includes(needle))
  );
};

/** Open ones by urgency (then nearest deadline), resolved ones by most recent resolution. */
export const sortRefunds = (refunds) =>
  [...refunds].sort((a, b) => {
    const rankA = a.queueState ? STATE_RANK[a.queueState] : 4;
    const rankB = b.queueState ? STATE_RANK[b.queueState] : 4;
    if (rankA !== rankB) return rankA - rankB;
    if (a.queueState) return new Date(a.due_at) - new Date(b.due_at);
    return new Date(b.resolved_at || 0) - new Date(a.resolved_at || 0);
  });

/** One block to paste while making the Zelle. `t` translates the labels (adminRefunds.copy.*). */
export const buildRefundCopyText = (refund, { t }) =>
  [
    `${t('adminRefunds.copy.amount')}: ${Number(refund.amount).toFixed(2)} ${refund.currency}`,
    `${t('adminRefunds.copy.customer')}: ${refund.customer_name || '-'}`,
    `${t('adminRefunds.copy.email')}: ${refund.customer_email || '-'}`,
    `${t('adminRefunds.copy.phone')}: ${refund.payer_phone || '-'}`,
    `${t('adminRefunds.copy.paymentReference')}: ${refund.payment_reference || '-'}`,
    `${t('adminRefunds.copy.operation')}: ${refund.operation_number || '-'}`
  ].join('\n');

const toLocalDay = (date) => {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

/**
 * Instant to send as p_refunded_at for the day picked in the modal: null for today (the server stamps now()), local noon
 * for a past day, never before eligible_at (the server refuses that).
 */
const pickedInstant = (dateText, eligibleAt, now) => {
  if (!dateText || dateText === toLocalDay(now)) return null;
  const noon = new Date(`${dateText}T12:00:00`);
  if (Number.isNaN(noon.getTime())) return null;
  return { noon, eligible: new Date(eligibleAt) };
};

export const refundedAtFromDate = (dateText, eligibleAt, now = new Date()) => {
  const picked = pickedInstant(dateText, eligibleAt, now);
  if (!picked) return null;
  return (picked.noon < picked.eligible ? picked.eligible : picked.noon).toISOString();
};

/** True when the chosen day is the day the refund became available but noon came earlier: the instant is raised. */
export const isRefundDateClamped = (dateText, eligibleAt, now = new Date()) => {
  const picked = pickedInstant(dateText, eligibleAt, now);
  return Boolean(picked) && picked.noon < picked.eligible;
};

export const todayLocalDay = (now = new Date()) => toLocalDay(now);
