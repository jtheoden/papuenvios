/**
 * Rules of the super admin remittance readjustment (RPC superadmin_readjust_remittance). Pure.
 * The server re-validates everything; these checks keep the form and the service honest before the round trip.
 */
import { roundMoney, roundTo } from './moneyPure';
import { REASON_MIN_LENGTH, REASON_MAX_LENGTH } from './commissionOverrideRules';

// Same list as the remittances_status_check constraint.
export const REMITTANCE_STATUSES = [
  'payment_pending',
  'payment_proof_uploaded',
  'payment_validated',
  'payment_rejected',
  'processing',
  'delivered',
  'completed',
  'cancelled'
];

const isGiven = (value) => value !== undefined && value !== null && value !== '';
const hasAtMostDecimals = (value, decimals) => Math.abs(roundTo(value, decimals) - value) <= 1e-9;

/** Amount to deliver when it is not given: (sent - commission) * rate at 4 decimals, same formula as the RPC. */
export const calcReadjustedDeliver = ({ amountSent, commission, exchangeRate }) =>
  roundMoney(roundMoney(amountSent - commission) * roundTo(exchangeRate, 4));

/**
 * @param {{reason?: string, status?: string, exchangeRate?: number|string, commission?: number|string,
 *          amountToDeliver?: number|string, amountSent?: number|string}} input - only the values being changed
 * @returns {Record<string, string>} error codes by field; {} when valid
 */
export const validateReadjust = ({ reason, status, exchangeRate, commission, amountToDeliver, amountSent }) => {
  const errors = {};
  const length = String(reason ?? '').trim().length;
  if (length < REASON_MIN_LENGTH || length > REASON_MAX_LENGTH) errors.reason = 'length';

  if (isGiven(status) && !REMITTANCE_STATUSES.includes(status)) errors.status = 'invalid';

  if (isGiven(exchangeRate)) {
    const value = Number(exchangeRate);
    if (!Number.isFinite(value) || value <= 0 || !hasAtMostDecimals(value, 4)) errors.exchangeRate = 'invalid';
  }
  if (isGiven(amountSent)) {
    const value = Number(amountSent);
    if (!Number.isFinite(value) || value <= 0 || !hasAtMostDecimals(value, 2)) errors.amountSent = 'invalid';
  }
  if (isGiven(amountToDeliver)) {
    const value = Number(amountToDeliver);
    if (!Number.isFinite(value) || value <= 0 || !hasAtMostDecimals(value, 2)) errors.amountToDeliver = 'invalid';
  }
  if (isGiven(commission)) {
    const value = Number(commission);
    const sent = isGiven(amountSent) ? Number(amountSent) : null;
    if (!Number.isFinite(value) || value < 0 || !hasAtMostDecimals(value, 2)) errors.commission = 'invalid';
    else if (sent !== null && value >= sent) errors.commission = 'range';
  }

  if (![status, exchangeRate, commission, amountToDeliver, amountSent].some(isGiven)) errors.nothing = 'empty';
  return errors;
};
