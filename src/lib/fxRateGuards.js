import { FX_REFERENCE_BOUNDS } from '@/lib/fxReference';

/**
 * Guards for the operative USD->EUR rate typed in Settings > Financial.
 * The hard band matches the one the Bizum quote enforces server side, so a typo (e.g. 92)
 * is caught here instead of silently blocking Bizum.
 */

export const USD_EUR_BOUNDS = FX_REFERENCE_BOUNDS;
// A change larger than this against the current rate needs an explicit confirmation.
export const FX_RATE_CONFIRM_CHANGE_RATIO = 0.05;

export const isUsdEurPair = (fromCode, toCode) =>
  typeof fromCode === 'string' && typeof toCode === 'string' && fromCode.toUpperCase() === 'USD' && toCode.toUpperCase() === 'EUR';

/** @returns {{ok: true} | {ok: false, code: 'out_of_band'}} */
export const validateUsdEurRate = (value) => {
  const rate = typeof value === 'number' ? value : Number.parseFloat(value);
  if (!Number.isFinite(rate) || rate < USD_EUR_BOUNDS.min || rate > USD_EUR_BOUNDS.max) {
    return { ok: false, code: 'out_of_band' };
  }
  return { ok: true };
};

/** Absolute relative change |new - old| / old; null when there is no usable previous rate. */
export const rateChangeRatio = (previousRate, nextRate) => {
  const previous = Number.parseFloat(previousRate);
  const next = Number.parseFloat(nextRate);
  if (!Number.isFinite(previous) || previous <= 0 || !Number.isFinite(next)) return null;
  return Math.abs(next - previous) / previous;
};

export const requiresChangeConfirmation = (previousRate, nextRate) => {
  const ratio = rateChangeRatio(previousRate, nextRate);
  return ratio !== null && ratio > FX_RATE_CONFIRM_CHANGE_RATIO + Number.EPSILON;
};

const codeOf = (currency) => String(currency?.code ?? '').toUpperCase();

/**
 * Currencies a rate selector may offer. Only active currencies, plus the (owner-approved) exception:
 * an inactive EUR as the target of a USD rate, so USD->EUR can be loaded without activating EUR.
 */
export const selectableRateCurrencies = (currencies, { role, otherId }) => {
  const list = Array.isArray(currencies) ? currencies : [];
  const available = list.filter((currency) => currency.is_active && currency.id !== otherId);
  const other = list.find((currency) => currency.id === otherId);
  if (role === 'to' && codeOf(other) === 'USD' && other.is_active) {
    const inactiveEur = list.find((currency) => !currency.is_active && codeOf(currency) === 'EUR');
    if (inactiveEur) available.push(inactiveEur);
  }
  return available;
};

/** A rate pair is storable when both currencies are active, or it is USD -> (inactive) EUR. */
export const isRatePairAllowed = (fromCurrency, toCurrency) => {
  if (!fromCurrency || !toCurrency) return false;
  if (fromCurrency.is_active && toCurrency.is_active) return true;
  return fromCurrency.is_active && codeOf(fromCurrency) === 'USD' && codeOf(toCurrency) === 'EUR';
};
