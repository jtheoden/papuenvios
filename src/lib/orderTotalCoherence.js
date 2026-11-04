/**
 * Non-blocking admin hint: does an order's money add up before its payment is validated?
 *
 * The DB already enforces total = subtotal - discount + shipping + tax (orders_money_total_identity_chk), but
 * subtotal itself is client-supplied (see RB-22), so it is compared with the sum of the order items.
 * Historical rounding noise (items 0.998-1.001 x subtotal) must not warn, hence the tolerance.
 */
import { roundMoney } from '@/lib/moneyPure';

const num = (v) => (v === null || v === undefined || v === '' ? 0 : Number(v));
const FORMULA_TOLERANCE = 0.011;
const SUBTOTAL_FLOOR = 0.05;
const SUBTOTAL_RATIO = 0.01;

/**
 * @param {object|null} order - order with order_items (as returned by getOrderById / getAllOrders)
 * @returns {'items_missing'|'subtotal_mismatch'|'total_below_formula'|null} reason to warn, or null
 */
export const getOrderTotalWarning = (order) => {
  if (!order) return null;

  const items = order.order_items;
  if (!Array.isArray(items)) return null; // not loaded (e.g. a query without the join): nothing to compare
  if (items.length === 0) return 'items_missing';

  const subtotal = num(order.subtotal);
  const itemsSum = roundMoney(items.reduce((sum, item) => sum + num(item.total_price), 0));
  if (Math.abs(subtotal - itemsSum) > Math.max(SUBTOTAL_FLOOR, SUBTOTAL_RATIO * subtotal)) return 'subtotal_mismatch';

  const formula = subtotal - num(order.discount_amount) + num(order.shipping_cost) + num(order.tax_amount);
  const total = Number(order.total_amount);
  if (!Number.isFinite(total) || total < formula - FORMULA_TOLERANCE) return 'total_below_formula';

  return null;
};
