/**
 * Rules of the admin commission override (RPC admin_set_remittance_commission). Pure, no dependencies.
 * The server re-validates everything; these checks keep the form and the service honest before the round trip.
 */
import { roundMoney, roundTo } from './moneyPure';

export const REASON_MIN_LENGTH = 10;
export const REASON_MAX_LENGTH = 500;

const ADJUSTABLE_STATUSES = ['payment_pending', 'payment_rejected'];

/** True while the customer has not paid (or the payment was rejected): the only states the RPC accepts. */
export const canAdjustCommission = (remittance) => ADJUSTABLE_STATUSES.includes(remittance?.status);

/**
 * @returns {{commission?: string, reason?: string}} error codes by field; {} when valid.
 *   amountSent is optional: when known, the commission must be below it (the server enforces it too).
 */
export const validateCommissionOverride = ({ commission, reason, amountSent }) => {
  const errors = {};
  const value = commission === '' || commission === null || commission === undefined ? NaN : Number(commission);
  // 1e-9 tolerates float noise (0.1 + 0.2) but not a real third decimal (1.005)
  if (!Number.isFinite(value) || value < 0 || Math.abs(roundMoney(value) - value) > 1e-9) {
    errors.commission = 'invalid';
  } else if (amountSent !== undefined && amountSent !== null && value >= Number(amountSent)) {
    errors.commission = 'range';
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
