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
  if (productCurrencyId && baseCurrencyId && productCurrencyId !== baseCurrencyId && typeof convertAmount === 'function') {
    const converted = convertAmount(finalPrice, productCurrencyId, baseCurrencyId);
    if (!Number.isFinite(converted)) return null;
    price = converted;
  }

  return roundMoney(price);
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
 * Resolve the unit price of one cart item.
 *
 * @param {object} item - Cart item (product or combo, with optional price snapshot fields)
 * @param {object} context
 * @param {string|number|null} context.selectedCurrency - Currently selected currency id
 * @param {string|number|null} [context.baseCurrencyId] - Base (USD) currency id
 * @param {function} context.convertAmount - (amount, fromCurrencyId, toCurrencyId) => number
 * @returns {number} Unit price, or NaN when the item has no resolvable stored price. The cart
 *   flags NaN lines invalid and blocks checkout: a missing price is never charged as 0.
 */
export const getCartItemUnitPrice = (item, { selectedCurrency, baseCurrencyId = null, convertAmount }) => {
  if (!item) return 0;

  // Every branch returns a cent-rounded unit price (after any currency conversion), so the
  // cart, the order payload and Postgres numeric(10,2) all see the same value.

  // Price snapshot taken when the item was added (product detail page).
  if (item.displayed_price && item.displayed_currency_id) {
    const displayedPrice = parseFloat(item.displayed_price);
    if (item.displayed_currency_id !== selectedCurrency) {
      return roundPrice(convertAmount(displayedPrice, item.displayed_currency_id, selectedCurrency));
    }
    return roundPrice(displayedPrice);
  }

  if (item.calculated_price_usd) {
    return roundPrice(parseFloat(item.calculated_price_usd));
  }

  // Combo added from the catalog list: its stored final price, in the base currency.
  if (item.products) {
    const comboPrice = resolveComboPrice(item);
    return comboPrice === null ? NaN : roundPrice(comboPrice);
  }

  // Product added from the catalog list: charge exactly what the catalog displays.
  const catalogPrice = getCatalogProductPrice(item, { baseCurrencyId, convertAmount });
  return catalogPrice === null ? NaN : catalogPrice;
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
