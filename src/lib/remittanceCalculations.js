/**
 * Pure remittance calculation functions — no DB dependencies.
 * These are the single source of truth formulas used by remittanceService.js.
 */

/**
 * Forward: given amount to send, calculate amount delivered.
 * Formula: deliver = (amount * rate) - (effectiveCommission * rate)
 */
export function calcForward({ amount, exchangeRate, commissionPct, commissionFixed, offer = null }) {
  const totalCommission = (amount * commissionPct / 100) + commissionFixed;
  let discountAmount = 0;

  if (offer?.discount_type && offer?.discount_value) {
    if (offer.discount_type === 'percentage') {
      discountAmount = totalCommission * (offer.discount_value / 100);
    } else if (offer.discount_type === 'fixed') {
      discountAmount = Math.min(offer.discount_value, totalCommission);
    }
    discountAmount = Math.round(discountAmount * 100) / 100;
  }

  const effectiveCommission = Math.max(0, totalCommission - discountAmount);
  const amountToDeliver = (amount * exchangeRate) - (effectiveCommission * exchangeRate);

  return {
    totalCommission: parseFloat(totalCommission.toFixed(2)),
    discountAmount: parseFloat(discountAmount.toFixed(2)),
    effectiveCommission: parseFloat(effectiveCommission.toFixed(2)),
    amountToDeliver: parseFloat(amountToDeliver.toFixed(4)),
  };
}

/**
 * Reverse: given desired receive amount, calculate amount to send.
 * Formula: send = ((desired / rate) + commFixed) / (1 - commPct/100)
 */
export function calcReverse({ desiredReceive, exchangeRate, commissionPct, commissionFixed }) {
  const denominator = 1 - (commissionPct / 100);
  if (denominator <= 0) throw new Error('Commission percentage cannot be 100% or more');

  const amountToSend = ((desiredReceive / exchangeRate) + commissionFixed) / denominator;
  return parseFloat(amountToSend.toFixed(4));
}

/**
 * Invariant: forward(reverse(desired)) ≈ desired (within rounding).
 */
export function roundtrip(params) {
  const send = calcReverse(params);
  const result = calcForward({ ...params, amount: send });
  return result.amountToDeliver;
}
