import { ERROR_CODES } from './errorHandler';

/**
 * True when the error is the typed "not enough stock" error raised by the
 * reserve / consume stock RPC wrappers in orderService.
 * Lives in its own module so UI components can import it without pulling orderService.
 * @param {unknown} error
 * @returns {boolean}
 */
export const isInsufficientStockError = (error) =>
  Boolean(error) && error.code === ERROR_CODES.INSUFFICIENT_STOCK;

/** Reasons for which the reserve RPC refuses an order without it being a stock shortage. */
const RESERVATION_REFUSAL_REASONS = ['too_many_open_reservations', 'empty_order'];

/**
 * True for any refusal the checkout should explain to the customer: not enough stock
 * (INSUFFICIENT_STOCK) or a reserve refusal such as the open-reservations limit.
 * @param {unknown} error
 * @returns {boolean}
 */
export const isStockReservationRefusal = (error) =>
  isInsufficientStockError(error) || RESERVATION_REFUSAL_REASONS.includes(error?.context?.reason);

/**
 * True when an inventory edit was refused because quantity would drop below the reserved units
 * (check constraint inventory_reserved_lte_quantity).
 * @param {unknown} error
 * @returns {boolean}
 */
export const isStockBelowReservedError = (error) =>
  Boolean(error) && error.context?.reason === 'stock_below_reserved';
