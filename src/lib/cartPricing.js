/**
 * Cart pricing
 *
 * Pure unit-price resolution for cart items, extracted from CartPage so it can be tested.
 *
 * The cart subtotal is treated as USD (base currency) downstream: CartPage converts it with
 * convertCurrency(subtotal, 'USD', currencyCode). Branches that return an amount already
 * expressed in another currency (displayed_price) convert it to the selected currency, as the
 * product detail page does.
 */

/**
 * Price the catalog shows for a product: final_price, a GENERATED column
 * (base_price * (1 + profit_margin / 100)), in the product's own currency.
 * Returned in the base currency and rounded to 2 decimals like the catalog does.
 * Returns null when it cannot be resolved reliably, so the caller falls back.
 */
const getCatalogProductPrice = (item, { baseCurrencyId, convertAmount }) => {
  const finalPrice = parseFloat(item.final_price);
  if (!Number.isFinite(finalPrice) || finalPrice < 0) return null;

  let price = finalPrice;
  const productCurrencyId = item.base_currency_id;
  if (productCurrencyId && baseCurrencyId && productCurrencyId !== baseCurrencyId && typeof convertAmount === 'function') {
    const converted = convertAmount(finalPrice, productCurrencyId, baseCurrencyId);
    if (!Number.isFinite(converted)) return null;
    price = converted;
  }

  return Math.round(price * 100) / 100;
};

/**
 * Resolve the unit price of one cart item.
 *
 * @param {object} item - Cart item (product or combo, with optional price snapshot fields)
 * @param {object} context
 * @param {string|number|null} context.selectedCurrency - Currently selected currency id
 * @param {string|number|null} [context.baseCurrencyId] - Base (USD) currency id
 * @param {function} context.convertAmount - (amount, fromCurrencyId, toCurrencyId) => number
 * @param {object} [context.financialSettings] - { productProfit, comboProfit }
 * @returns {number} Unit price
 */
export const getCartItemUnitPrice = (item, { selectedCurrency, baseCurrencyId = null, convertAmount, financialSettings = {} }) => {
  if (!item) return 0;

  // Price snapshot taken when the item was added (product detail page).
  if (item.displayed_price && item.displayed_currency_id) {
    const displayedPrice = parseFloat(item.displayed_price);
    if (item.displayed_currency_id !== selectedCurrency) {
      return convertAmount(displayedPrice, item.displayed_currency_id, selectedCurrency);
    }
    return displayedPrice;
  }

  if (item.calculated_price_usd) {
    return parseFloat(item.calculated_price_usd);
  }

  // Legacy fallback (items without a price snapshot)
  if (item.products) {
    const basePrice = parseFloat(item.baseTotalPrice || 0);
    const profitMargin = parseFloat(item.profitMargin || financialSettings.comboProfit || 35) / 100;
    return basePrice * (1 + profitMargin);
  }

  // Product added from the catalog list: charge exactly what the catalog displays.
  const catalogPrice = getCatalogProductPrice(item, { baseCurrencyId, convertAmount });
  if (catalogPrice !== null) return catalogPrice;

  // Legacy fallback: product without final_price (old cart entries)
  const basePrice = parseFloat(item.base_price || item.basePrice || 0);
  const profitMargin = parseFloat(financialSettings.productProfit || 40) / 100;
  return basePrice * (1 + profitMargin);
};
