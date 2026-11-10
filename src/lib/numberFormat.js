/**
 * Locale-aware formatting driven by the app language (never the browser default).
 */

import { roundMoney, roundTo } from './moneyPure';

const LOCALES = Object.freeze({ es: 'es-ES', en: 'en-US' });

export const localeFor = (language) => LOCALES[language] ?? LOCALES.en;

/** Empty string for null / undefined / non-finite input. */
export const formatNumber = (value, language, options = {}) => {
  const number = Number(value);
  if (value === null || value === undefined || value === '' || !Number.isFinite(number)) return '';
  return new Intl.NumberFormat(localeFor(language), { maximumFractionDigits: 6, ...options }).format(number);
};

/** Date and time in the app locale; empty string for invalid input. */
export const formatDateTime = (value, language) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(localeFor(language), { dateStyle: 'medium', timeStyle: 'short' }).format(date);
};

/** A calendar date (YYYY-MM-DD, e.g. effective_date) as written: UTC, so no time-zone day shift. */
export const formatDateOnly = (value, language) => {
  const date = new Date(value);
  if (value === null || value === undefined || Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(localeFor(language), { dateStyle: 'medium', timeZone: 'UTC' }).format(date);
};

/** Same as formatDateTime but pinned to UTC, to contrast a provider's timestamp with the local time. */
export const formatDateTimeUtc = (value, language) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(localeFor(language), { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(date);
};

/** Shown instead of "NaN" / "$0.00" when a value is unavailable. */
export const UNAVAILABLE = '\u2014';

const toFinite = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

/**
 * Money in the app language: always two decimals, rounded half-up through moneyPure.roundMoney (never
 * toFixed). Unavailable input renders an em dash, not a misleading zero.
 * currencyDisplay: 'code' shows the ISO code (USD) where the symbol is ambiguous (US$, $).
 */
export const formatMoney = (value, { currency = 'USD', language, currencyDisplay = 'symbol' } = {}) => {
  const number = toFinite(value);
  if (number === null) return UNAVAILABLE;
  const amount = roundMoney(number);
  try {
    return new Intl.NumberFormat(localeFor(language), {
      style: 'currency',
      currency,
      currencyDisplay,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(amount);
  } catch {
    // Intl rejects malformed currency codes; keep the amount readable instead of throwing in render.
    return `${formatNumber(amount, language, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
  }
};

/** Exchange rate in the app language: up to six decimals (roundTo), em dash when unavailable. */
export const formatRate = (value, language) => {
  const number = toFinite(value);
  return number === null ? UNAVAILABLE : formatNumber(roundTo(number, 6), language);
};
