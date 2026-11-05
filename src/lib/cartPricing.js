/**
 * Cart pricing
 *
 * Pure unit-price resolution for cart items, extracted from CartPage so it can be tested.
 *
 * Every line is priced in the base currency (USD), whatever currency the visitor is browsing in:
 * CartPage treats the subtotal as USD, converts it for display only (convertCurrency) and saves
 * the order in the base currency. The displayed_price snapshot stored by the product detail page
 * is in the currency selected when the item was added, so it is converted back to the base
 * currency here; otherwise a CUP snapshot would be summed with USD lines and converted twice.
 */

import { roundMoney, sumMoney } from '@/lib/moneyPure';
import { resolveProductPrice, resolveComboPrice } from '@/lib/publicPricing';

// Cent-round a price but keep NaN for non-finite input: roundMoney would turn it into 0 and the
// cart would silently create a free line. buildCartLines flags such lines so checkout fails closed.
const roundPrice = (value) => (Number.isFinite(Number(value)) ? roundMoney(value) : NaN);

/**
 * Price the catalog shows for a product: its stored final_price, in the product's own
 * currency. Returned in the base currency and rounded to 2 decimals like the catalog does.
 * Returns null when it cannot be resolved reliably; the caller then fails closed (NaN).
 */
const getCatalogProductPrice = (item, { baseCurrencyId, convertAmount }) => {
  const finalPrice = resolveProductPrice(item);
  if (finalPrice === null) return null;

  let price = finalPrice;
  const productCurrencyId = item.base_currency_id;
  if (productCurrencyId && productCurrencyId !== baseCurrencyId) {
    // Fail closed: a price in another currency cannot be normalized without a base currency and a rate.
    if (!baseCurrencyId || typeof convertAmount !== 'function') return null;
    const converted = convertAmount(finalPrice, productCurrencyId, baseCurrencyId);
    if (!Number.isFinite(converted)) return null;
    price = converted;
  }

  return roundMoney(price);
};

/**
 * Stored catalog price of a cart item in the base currency, or null when it cannot be resolved.
 * Combos are stored in the base currency (no currency column); products in their own currency.
 */
const getStoredBasePrice = (item, context) => {
  if (item.products) {
    const comboPrice = resolveComboPrice(item);
    return comboPrice === null ? null : roundPrice(comboPrice);
  }
  return getCatalogProductPrice(item, context);
};

/**
 * Combos added to the cart before the catalog carried their stored price have no usable
 * final price. Take it from the live catalog combo with the same id; if the combo is gone
 * (or has no usable price either) the item stays unpriced and the cart fails closed.
 * Never touches an item that already carries a price, and never applies to products.
 */
export const withStoredComboPrice = (item, catalogCombos = []) => {
  if (!item?.products || resolveComboPrice(item) !== null) return item;

  const live = (catalogCombos || []).find((combo) => combo.id === item.id);
  const finalPrice = live ? resolveComboPrice(live) : null;
  return finalPrice === null ? item : { ...item, finalPrice };
};

/**
 * Resolve the unit price of one cart item, always in the base currency.
 *
 * @param {object} item - Cart item (product or combo, with optional price snapshot fields)
 * @param {object} context
 * @param {string|number|null} [context.baseCurrencyId] - Base (USD) currency id
 * @param {function} context.convertAmount - (amount, fromCurrencyId, toCurrencyId) => number
 * @returns {number} Unit price in the base currency, or NaN when the item has no resolvable stored
 *   price (or a snapshot that cannot be converted). The cart flags NaN lines invalid and blocks
 *   checkout: a missing price is never charged as 0.
 */
export const getCartItemUnitPrice = (item, { baseCurrencyId = null, convertAmount }) => {
  if (!item) return 0;

  // Every branch returns a cent-rounded unit price (after any currency conversion), so the
  // cart, the order payload and Postgres numeric(10,2) all see the same value.

  // Price snapshot taken when the item was added (product detail page), in the currency that
  // was selected then. It is the catalog price converted to that currency (no offers or
  // discounts, see getDisplayPrice), so the item's own base price is the source of truth:
  // reconverting the snapshot would drift with inconsistent rate pairs (USD->CUP 915 vs
  // CUP->USD 1/900 gives 10.17 for a 10 USD item) and fails with a third currency selected.
  if (item.displayed_price && item.displayed_currency_id) {
    const displayedPrice = parseFloat(item.displayed_price);
    // Already in the base currency: exactly what the visitor saw.
    if (item.displayed_currency_id === baseCurrencyId) return roundPrice(displayedPrice);

    const storedBasePrice = getStoredBasePrice(item, { baseCurrencyId, convertAmount });
    if (storedBasePrice !== null) return storedBasePrice;

    // Old entries without a catalog price: undo the conversion with the forward base->snapshot
    // rate (the one that produced the snapshot). Fail closed without base currency or rate.
    if (!baseCurrencyId || typeof convertAmount !== 'function') return NaN;
    const rate = convertAmount(1, baseCurrencyId, item.displayed_currency_id);
    return Number.isFinite(rate) && rate > 0 ? roundPrice(displayedPrice / rate) : NaN;
  }

  if (item.calculated_price_usd) {
    return roundPrice(parseFloat(item.calculated_price_usd));
  }

  // Item added from the catalog list: charge exactly what the catalog displays.
  const storedBasePrice = getStoredBasePrice(item, { baseCurrencyId, convertAmount });
  return storedBasePrice === null ? NaN : storedBasePrice;
};

/**
 * Build the cart lines and subtotal with cent-exact amounts.
 *
 *  - unitPrice  = cent-rounded unit price
 *  - totalPrice = round(unitPrice * quantity)
 *  - subtotal   = round(sum of the already-rounded totalPrice values)
 *
 * Invariant: sum(lines.totalPrice) === subtotal, which is what Postgres will store for
 * order_items.total_price vs orders.subtotal.
 *
 * @param {Array<object>} cart - Cart items
 * @param {function} getUnitPrice - (item) => unit price
 * Fail closed: a line whose unit price is not a finite number, or whose quantity is not a
 * finite number > 0, is flagged `invalid` (its amounts are 0) and `hasInvalidLines` is true.
 * The caller must block checkout instead of creating an order with a silently free line.
 *
 * @param {Array<object>} cart - Cart items
 * @param {function} getUnitPrice - (item) => unit price
 * @returns {{ lines: Array<{ unitPrice: number, totalPrice: number, quantity: number, invalid: boolean }>, subtotal: number, hasInvalidLines: boolean }}
 */
export const buildCartLines = (cart, getUnitPrice) => {
  if (!Array.isArray(cart) || cart.length === 0) return { lines: [], subtotal: 0, hasInvalidLines: false };

  const lines = cart.map((item) => {
    const rawQuantity = item?.quantity;
    const quantity = rawQuantity === null || rawQuantity === '' ? NaN : Number(rawQuantity);
    const rawUnit = getUnitPrice(item);
    const unitValid = rawUnit !== null && rawUnit !== '' && Number.isFinite(Number(rawUnit));
    const invalid = !unitValid || !Number.isFinite(quantity) || quantity <= 0;
    if (invalid) return { unitPrice: 0, quantity: 0, totalPrice: 0, invalid: true };

    const unitPrice = roundMoney(rawUnit);
    return { unitPrice, quantity, totalPrice: roundMoney(unitPrice * quantity), invalid: false };
  });

  return {
    lines,
    subtotal: sumMoney(lines.map((line) => line.totalPrice)),
    hasInvalidLines: lines.some((line) => line.invalid)
  };
};
