/**
 * Rules of the admin commission override (RPC admin_set_remittance_commission). Pure, no dependencies.
 * The server re-validates everything; these checks keep the form and the service honest before the round trip.
 */
import { roundMoney, roundTo } from './moneyPure';

export const REASON_MIN_LENGTH = 10;
export const REASON_MAX_LENGTH = 500;

// Owner decision: the commission freezes once the customer uploads the proof, so it can only be adjusted (up or down)
// before that. shortcut: the prod RPC still accepts payment_proof_uploaded and payment_validated until a migration
// restricts it; the UI is stricter on purpose.
const ADJUSTABLE_STATUSES = ['payment_pending', 'payment_rejected'];
const FROZEN_STATUSES = ['payment_proof_uploaded', 'payment_validated'];
const LOWER_ONLY_STATUSES = ['payment_validated'];

/** True when the commission can still be adjusted from the UI. */
export const canAdjustCommission = (remittance) => ADJUSTABLE_STATUSES.includes(remittance?.status);

/** True when the commission is frozen because the payment was already made (proof uploaded or validated). */
export const isCommissionFrozen = (remittance) => FROZEN_STATUSES.includes(remittance?.status);

/** True when the commission may only be lowered (payment already validated). */
export const isLowerOnlyCommission = (remittance) => LOWER_ONLY_STATUSES.includes(remittance?.status);

/** Translation key of the status label (remittances.status.paymentPending, ...). */
export const remittanceStatusLabelKey = (status) =>
  `remittances.status.${String(status ?? '').replace(/_([a-z])/g, (_, c) => c.toUpperCase())}`;

/**
 * @returns {{commission?: string, reason?: string}} error codes by field; {} when valid.
 *   amountSent is optional: when known, the commission must be below it (the server enforces it too).
 *   maxCommission is optional: when given (payment already validated) the commission may not exceed it ('lowerOnly').
 */
export const validateCommissionOverride = ({ commission, reason, amountSent, maxCommission }) => {
  const errors = {};
  const value = commission === '' || commission === null || commission === undefined ? NaN : Number(commission);
  // 1e-9 tolerates float noise (0.1 + 0.2) but not a real third decimal (1.005)
  if (!Number.isFinite(value) || value < 0 || Math.abs(roundMoney(value) - value) > 1e-9) {
    errors.commission = 'invalid';
  } else if (amountSent !== undefined && amountSent !== null && value >= Number(amountSent)) {
    errors.commission = 'range';
  } else if (maxCommission !== undefined && maxCommission !== null && value > Number(maxCommission)) {
    errors.commission = 'lowerOnly';
  }
  const length = String(reason ?? '').trim().length;
  if (length < REASON_MIN_LENGTH || length > REASON_MAX_LENGTH) errors.reason = 'length';
  return errors;
};

/**
 * What the remittance would look like with the override: the delivery amount keeps the rate the customer was shown
 * (same formula as the RPC: round((sent - commission) * rate, 2)) and the difference is against the standard commission.
 */
export const calcCommissionOverride = ({ amountSent, exchangeRate, commission, standardCommission }) => ({
  commission: roundMoney(commission),
  amountToDeliver: roundMoney(roundMoney(amountSent - commission) * roundTo(exchangeRate, 4)),
  difference: roundMoney(commission - standardCommission),
});
