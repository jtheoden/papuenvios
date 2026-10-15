/**
 * Locale-aware formatting driven by the app language (never the browser default).
 */

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
