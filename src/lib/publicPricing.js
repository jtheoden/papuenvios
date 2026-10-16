/**
 * Public price resolution.
 *
 * The public catalog shows the stored final_price of a product or combo and nothing else:
 * it never recomputes a price from cost or margin fields. A price that is missing, not a
 * number or not positive resolves to null so the caller can show "unavailable" and block
 * the purchase instead of displaying (or charging) 0.
 */

const toPositiveNumber = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
};

const roundCents = (value) => Math.round(value * 100) / 100;

/** Stored product price, in the product's own currency. */
export const resolveProductPrice = (product) => toPositiveNumber(product?.final_price);

/** Stored combo price, in the base currency (combo_products has no currency column). */
export const resolveComboPrice = (combo) =>
  toPositiveNumber(combo?.finalPrice ?? combo?.final_price);

const convertOrNull = (amount, convert, fromCurrencyId, toCurrencyId) => {
  if (!fromCurrencyId || !toCurrencyId || fromCurrencyId === toCurrencyId) return amount;
  if (typeof convert !== 'function') return null;
  const converted = convert(amount, fromCurrencyId, toCurrencyId);
  return Number.isFinite(converted) ? converted : null;
};

/**
 * Not rounded: callers apply discounts first and format (toFixed) at the end, as before.
 * @returns {number|null} product price in the selected currency, or null when unresolved
 */
export const getProductPriceInCurrency = (product, { convert, selectedCurrencyId }) => {
  const price = resolveProductPrice(product);
  if (price === null) return null;
  return convertOrNull(price, convert, product.base_currency_id, selectedCurrencyId);
};

/**
 * @returns {number|null} combo price in the selected currency, or null when unresolved
 */
export const getComboPriceInCurrency = (combo, { convert, baseCurrencyId, selectedCurrencyId }) => {
  const price = resolveComboPrice(combo);
  if (price === null) return null;
  const converted = convertOrNull(price, convert, baseCurrencyId, selectedCurrencyId);
  return converted === null ? null : roundCents(converted);
};
