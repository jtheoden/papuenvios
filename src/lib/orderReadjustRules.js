/**
 * Rules of the super admin order readjustment (RPC superadmin_readjust_order). Pure.
 * The server re-validates everything; these checks keep the form and the service honest before the round trip.
 */
import { roundMoney, roundTo } from './moneyPure';
import { REASON_MIN_LENGTH, REASON_MAX_LENGTH } from './commissionOverrideRules';

// Same lists as orders_status_check and orders_payment_status_check.
export const ORDER_STATUSES = ['pending', 'processing', 'dispatched', 'delivered', 'completed', 'cancelled'];
export const PAYMENT_STATUSES = ['pending', 'proof_uploaded', 'validated', 'rejected'];

const isGiven = (value) => value !== undefined && value !== null && value !== '';
const hasAtMostDecimals = (value, decimals) => Math.abs(roundTo(value, decimals) - value) <= 1e-9;
const validMoney = (value, { positive }) => {
  const number = Number(value);
  return Number.isFinite(number) && (positive ? number > 0 : number >= 0) && hasAtMostDecimals(number, 2);
};

/** Subtotal and total like orders_money_total_identity_chk: subtotal - discount + shipping + tax. */
export const calcReadjustedOrder = ({ items, discountAmount = 0, shippingCost = 0, taxAmount = 0 }) => {
  const subtotal = roundMoney(items.reduce((sum, item) => sum + roundMoney(Number(item.unitPrice) * Number(item.quantity)), 0));
  return { subtotal, total: roundMoney(subtotal - Number(discountAmount) + Number(shippingCost) + Number(taxAmount)) };
};

/**
 * @param {{reason?: string, items?: Array<{id?: string, unitPrice?: number|string}>, discountAmount?: number|string,
 *          shippingCost?: number|string, status?: string, paymentStatus?: string}} input - only the values being changed
 * @returns {Record<string, string>} error codes by field; {} when valid
 */
export const validateOrderReadjust = ({ reason, items, discountAmount, shippingCost, status, paymentStatus }) => {
  const errors = {};
  const length = String(reason ?? '').trim().length;
  if (length < REASON_MIN_LENGTH || length > REASON_MAX_LENGTH) errors.reason = 'length';

  const lines = Array.isArray(items) ? items : [];
  if (lines.some((item) => !item?.id || !validMoney(item.unitPrice, { positive: true }))) errors.items = 'invalid';
  if (isGiven(discountAmount) && !validMoney(discountAmount, { positive: false })) errors.discountAmount = 'invalid';
  if (isGiven(shippingCost) && !validMoney(shippingCost, { positive: false })) errors.shippingCost = 'invalid';
  if (isGiven(status) && !ORDER_STATUSES.includes(status)) errors.status = 'invalid';
  if (isGiven(paymentStatus) && !PAYMENT_STATUSES.includes(paymentStatus)) errors.paymentStatus = 'invalid';

  if (!lines.length && ![discountAmount, shippingCost, status, paymentStatus].some(isGiven)) errors.nothing = 'empty';
  return errors;
};
