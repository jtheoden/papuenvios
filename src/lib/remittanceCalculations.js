/**
 * Pure remittance calculation functions — no DB dependencies.
 * Single source of truth for the remittance rounding contract. The SQL twin is
 * public._remittance_quote (same steps, same golden vectors: src/tests/fixtures/remittanceGoldenVectors.json).
 *
 * Forward (the sender sends S):
 *   1. r          = roundTo(rate, 4)                       (the scale exchange_rate is stored at)
 *   2. S          = roundMoney(amount)
 *   3. gross      = roundMoney(S * pct / 100 + fixed)       (pct at the type's full precision)
 *   4. discount   = roundMoney(percentage ? gross * v / 100 : min(v, gross)), never above gross
 *   5. commission = max(0, gross - discount)                (already in cents)
 *   6. deliver    = roundMoney((S - commission) * r)
 * Stored invariant: amount_to_deliver = round((amount_sent - commission_total) * exchange_rate, 2).
 *
 * Reverse (the recipient must get D): S0 = ceilMoney(((D / r) + fixed) / (1 - pct / 100)), then +0.01
 * (bounded search, at most 100 steps) until forward(S).amountToDeliver >= D. The recipient never gets less than requested.
 */
import { normalizeDiscountType } from './offerRules';
import { roundMoney, roundTo, ceilMoney } from './moneyPure';

// Cent steps above the closed-form estimate. With a commission of 95% one net cent needs ~20 cents of S, so the old limit of 3 failed.
// shortcut: linear search, bounded; above ~99% commission it can still exhaust the bound and throws (unusable config anyway).
const MAX_REVERSE_STEPS = 100;
const CENT = 0.01;

const calcDiscount = (gross, offer) => {
  if (!offer?.discount_type || !offer?.discount_value) return 0;
  const type = normalizeDiscountType(offer.discount_type);
  const value = Number(offer.discount_value);
  let discount = 0;
  if (type === 'percentage') discount = roundMoney((gross * value) / 100);
  else if (type === 'fixed_amount') discount = roundMoney(Math.min(value, gross));
  return Math.max(0, Math.min(discount, gross));
};

/**
 * Forward: given amount to send, calculate commission and amount delivered.
 * Returns every value already rounded to its stored scale.
 */
export function calcForward({ amount, exchangeRate, commissionPct, commissionFixed, offer = null }) {
  const rate = roundTo(exchangeRate, 4);
  const amountSent = roundMoney(amount);
  const gross = roundMoney((amountSent * (commissionPct || 0)) / 100 + (commissionFixed || 0));
  const discount = calcDiscount(gross, offer);
  const commission = Math.max(0, roundMoney(gross - discount));
  const amountToDeliver = roundMoney(roundMoney(amountSent - commission) * rate);

  return {
    amountSent,
    exchangeRate: rate,
    totalCommission: gross,
    discountAmount: discount,
    effectiveCommission: commission,
    amountToDeliver,
  };
}

/**
 * Reverse: given the amount the recipient must receive, calculate the amount to send (in cents,
 * rounded up). The offer is ignored here: a discount can only make the forward result deliver more.
 */
export function calcReverse({ desiredReceive, exchangeRate, commissionPct, commissionFixed }) {
  const denominator = 1 - (commissionPct || 0) / 100;
  if (denominator <= 0) throw new Error('Commission percentage cannot be 100% or more');

  const rate = roundTo(exchangeRate, 4);
  if (!Number.isFinite(rate) || rate <= 0) throw new Error('Exchange rate must be a positive number (at most 4 decimals)');
  let amountToSend = ceilMoney((desiredReceive / rate + (commissionFixed || 0)) / denominator);

  for (let i = 0; i <= MAX_REVERSE_STEPS; i += 1) {
    const { amountToDeliver } = calcForward({ amount: amountToSend, exchangeRate: rate, commissionPct, commissionFixed });
    if (amountToDeliver >= desiredReceive) return amountToSend;
    amountToSend = roundMoney(amountToSend + CENT);
  }
  throw new Error('Reverse calculation did not converge');
}

/**
 * View model for the admin simulator (RemittanceTypesConfig): the same contract as the wizard,
 * plus the breakdown the screen shows. commPctAmount + commFixedAmount === totalCommission always
 * (the fixed part is in cents, so rounding the sum rounds only the percentage part).
 * Returns null when the reverse mode is impossible (commission of 100% or more).
 */
export function simulateRemittance({ mode = 'send', amount, exchangeRate, commissionPercentage, commissionFixed }) {
  const params = { exchangeRate, commissionPct: commissionPercentage || 0, commissionFixed: commissionFixed || 0 };
  let sent = amount;
  if (mode === 'receive') {
    if (1 - params.commissionPct / 100 <= 0) return null;
    sent = calcReverse({ desiredReceive: amount, ...params });
  }
  const fwd = calcForward({ amount: sent, ...params });
  const commPctAmount = roundMoney((fwd.amountSent * params.commissionPct) / 100);
  return {
    amount: fwd.amountSent,
    commPctAmount,
    commFixedAmount: roundMoney(fwd.totalCommission - commPctAmount),
    totalCommission: fwd.totalCommission,
    netAmount: roundMoney(fwd.amountSent - fwd.totalCommission),
    exchangeRate: fwd.exchangeRate,
    amountToDeliver: fwd.amountToDeliver,
    effectiveRate: fwd.amountSent > 0 ? fwd.amountToDeliver / fwd.amountSent : 0,
  };
}

/**
 * Total the SENDER pays: amount sent plus the cash delivery cost (decision D2).
 * The delivery cost is never deducted from the amount delivered, so calcForward and
 * calcReverse do not take it into account. Negative or non-numeric costs count as 0.
 */
export function calcTotalToPay({ amountSent, deliveryCost = 0 }) {
  const cost = Number(deliveryCost);
  const safeCost = Number.isFinite(cost) && cost > 0 ? cost : 0;
  return roundMoney(Number(amountSent) + safeCost);
}
