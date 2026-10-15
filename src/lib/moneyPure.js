/**
 * Money helpers (pure, no dependencies).
 *
 * Every monetary value that reaches an order must be rounded with roundMoney so that the
 * cart, the confirmation modal, the payload sent to createOrder and what Postgres stores
 * (numeric(10,2), round half-up) are identical.
 */

/**
 * Round to cents, half-up (half away from zero for negatives), float-safe.
 *
 * Technique: Math.round(x * 100) / 100 is wrong for values such as 1.005 because
 * 1.005 * 100 === 100.49999999999999. Instead:
 *  1. toPrecision(15) strips binary noise accumulated by earlier operations
 *     (e.g. 0.1 + 0.2 -> 0.3, 14.739300000000002 -> 14.7393).
 *  2. The decimal point is shifted through exponent notation (Number('1.005e2') is exactly
 *     100.5), so Math.round sees the true decimal value.
 *
 * Non-finite or non-numeric input yields 0. Never returns -0.
 *
 * @param {number|string|null|undefined} value
 * @returns {number}
 */
export const roundMoney = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;

  const sign = n < 0 ? -1 : 1;
  const clean = Number(Math.abs(n).toPrecision(15));
  const shifted = Number(`${clean}e2`);
  // Exponent-notation strings (e.g. "1e-7") break the shift; plain scaling is safe there
  const cents = Number.isFinite(shifted) ? Math.round(shifted) : Math.round(clean * 100);
  const result = sign * Number(`${cents}e-2`);

  return result === 0 ? 0 : result;
};

/**
 * Sum values and round the result to cents. Invalid entries count as 0.
 *
 * @param {Array<number|string|null|undefined>} values
 * @returns {number}
 */
export const sumMoney = (values) => {
  if (!Array.isArray(values)) return 0;
  return roundMoney(values.reduce((acc, v) => acc + roundMoney(v), 0));
};
