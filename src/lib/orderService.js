/**
 * Order Management Service
 * Handles order creation, retrieval, updates, and payment validation
 * Uses standardized error handling with AppError class
 */

import { supabase } from './supabase';
import {
  AppError,
  handleError,
  logError,
  createValidationError,
  createNotFoundError,
  parseSupabaseError,
  createPermissionError,
  ERROR_CODES
} from './errorHandler';
import { logActivity } from './activityLogger';
import { isValidPayerPhone, normalizePayerPhone } from './payerPhone';
import { getUserCategoryWithDiscount } from './orderDiscountService';
import { ZELLE_STATUS, ZELLE_TRANSACTION_TYPES, upsertZelleTransactionStatus } from './zelleService';
import { isInsufficientStockError } from './stockErrors';
import { roundMoney } from './moneyPure';

export { isInsufficientStockError };

const isValidUUID = (value) => {
  if (!value || typeof value !== 'string') return false;
  return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/.test(value);
};

const logOrderActivity = async ({ action, entityId, performedBy, description, metadata }) => {
  try {
    return await logActivity({
      action,
      entityType: 'order',
      entityId,
      performedBy,
      description,
      metadata
    });
  } catch (err) {
    console.warn('[orderService] Failed to log activity', err?.message || err);
    return { status: 'error', error: err };
  }
};

const buildOrderPaymentMetadata = (order, metadata = {}) => ({
  paymentType: 'order',
  orderId: order?.id,
  orderNumber: order?.order_number,
  paymentStatus: order?.payment_status,
  orderStatus: order?.status,
  paymentMethod: order?.payment_method,
  paymentReference: order?.payment_reference || null,
  totalAmount: order?.total_amount,
  ...metadata
});

// ============================================================================
// STATE MACHINE CONSTANTS
// ============================================================================

/**
 * Valid order statuses
 */
export const ORDER_STATUS = {
  PENDING: 'pending',           // Initial state - waiting for payment validation
  PROCESSING: 'processing',     // Payment validated - preparing for dispatch
  DISPATCHED: 'dispatched',     // Order dispatched - in transit
  DELIVERED: 'delivered',       // Order delivered - awaiting completion
  COMPLETED: 'completed',       // Fully completed - no further actions
  CANCELLED: 'cancelled'        // Cancelled - no longer valid
};

/**
 * Valid payment statuses
 */
export const PAYMENT_STATUS = {
  PENDING: 'pending',           // Awaiting proof upload
  PROOF_UPLOADED: 'proof_uploaded', // Proof uploaded - awaiting validation
  VALIDATED: 'validated',       // Payment confirmed by admin
  REJECTED: 'rejected'          // Payment rejected - can retry
};

/**
 * State transition matrix - defines valid transitions
 * Format: currentStatus => allowedNextStatuses
 */
const ORDER_TRANSITIONS = {
  [ORDER_STATUS.PENDING]: [
    ORDER_STATUS.PROCESSING,
    ORDER_STATUS.CANCELLED
  ],
  [ORDER_STATUS.PROCESSING]: [
    ORDER_STATUS.DISPATCHED,
    ORDER_STATUS.CANCELLED
  ],
  [ORDER_STATUS.DISPATCHED]: [
    ORDER_STATUS.DELIVERED
  ],
  [ORDER_STATUS.DELIVERED]: [
    ORDER_STATUS.COMPLETED
  ],
  [ORDER_STATUS.COMPLETED]: [],     // Terminal state
  [ORDER_STATUS.CANCELLED]: [
    ORDER_STATUS.PENDING  // Allow reopening cancelled orders
  ]
};

/**
 * Payment status transitions
 * Format: currentStatus => allowedNextStatuses
 */
const PAYMENT_TRANSITIONS = {
  [PAYMENT_STATUS.PENDING]: [
    PAYMENT_STATUS.PROOF_UPLOADED,
    PAYMENT_STATUS.REJECTED,
    // Super admins can validate directly without proof
    PAYMENT_STATUS.VALIDATED
  ],
  [PAYMENT_STATUS.PROOF_UPLOADED]: [
    PAYMENT_STATUS.VALIDATED,
    PAYMENT_STATUS.REJECTED,
    PAYMENT_STATUS.PENDING  // Can reset if rejected
  ],
  [PAYMENT_STATUS.VALIDATED]: [],   // Terminal for payments
  [PAYMENT_STATUS.REJECTED]: [
    PAYMENT_STATUS.PENDING  // Can retry after rejection
  ]
};

// ============================================================================
// STATE MACHINE VALIDATION HELPERS
// ============================================================================

/**
 * Validate order status transition
 * @param {string} currentStatus - Current order status
 * @param {string} newStatus - Proposed new status
 * @throws {AppError} If transition is invalid
 */
const validateOrderTransition = (currentStatus, newStatus) => {
  if (!ORDER_STATUS[Object.keys(ORDER_STATUS).find(k => ORDER_STATUS[k] === currentStatus)]) {
    throw createValidationError({ status: `Invalid current status: ${currentStatus}` });
  }

  if (!ORDER_STATUS[Object.keys(ORDER_STATUS).find(k => ORDER_STATUS[k] === newStatus)]) {
    throw createValidationError({ status: `Invalid new status: ${newStatus}` });
  }

  const allowedTransitions = ORDER_TRANSITIONS[currentStatus];
  if (!allowedTransitions.includes(newStatus)) {
    throw createValidationError(
      { status: `Cannot transition from ${currentStatus} to ${newStatus}` },
      `Invalid order status transition. From ${currentStatus}, you can only transition to: ${allowedTransitions.join(', ') || 'no further transitions allowed'}`
    );
  }
};

/**
 * Validate payment status transition
 * @param {string} currentStatus - Current payment status
 * @param {string} newStatus - Proposed new status
 * @throws {AppError} If transition is invalid
 */
const validatePaymentTransition = (currentStatus, newStatus) => {
  if (!PAYMENT_STATUS[Object.keys(PAYMENT_STATUS).find(k => PAYMENT_STATUS[k] === currentStatus)]) {
    throw createValidationError({ payment_status: `Invalid current payment status: ${currentStatus}` });
  }

  if (!PAYMENT_STATUS[Object.keys(PAYMENT_STATUS).find(k => PAYMENT_STATUS[k] === newStatus)]) {
    throw createValidationError({ payment_status: `Invalid new payment status: ${newStatus}` });
  }

  const allowedTransitions = PAYMENT_TRANSITIONS[currentStatus];
  if (!allowedTransitions.includes(newStatus)) {
    throw createValidationError(
      { payment_status: `Cannot transition from ${currentStatus} to ${newStatus}` },
      `Invalid payment status transition. From ${currentStatus}, you can only transition to: ${allowedTransitions.join(', ') || 'no further transitions allowed'}`
    );
  }
};

// ============================================================================
// ORDER NUMBER GENERATION
// ============================================================================

/**
 * Generate an order number
 * Format: ORD-YYYYMMDD-XXXXX (e.g., ORD-20251007-12345)
 * 5 random digits per day; the UNIQUE constraint on orders.order_number is the real guard
 * and createOrder retries with a fresh number on collision.
 * shortcut: 100k numbers/day, birthday collisions get likely past ~300 orders/day; widen the
 * suffix or move to a DB sequence before that volume.
 * @returns {Promise<string>} Order number
 */
export const generateOrderNumber = async () => {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const suffix = crypto.getRandomValues(new Uint32Array(1))[0] % 100000;
  return `ORD-${today}-${String(suffix).padStart(5, '0')}`;
};

const MAX_ORDER_NUMBER_ATTEMPTS = 3;
const isOrderNumberCollision = (error) =>
  error?.code === '23505' && /order_number/.test(`${error.message || ''} ${error.details || ''}`);

// ============================================================================
// USER EMAIL HELPER (for activity logging)
// ============================================================================

/**
 * Get user email by user ID for activity logging
 * @param {string} userId - User ID
 * @returns {Promise<string>} User email or userId as fallback
 */
const getUserEmail = async (userId) => {
  if (!userId) return 'system';

  try {
    const { data, error } = await supabase
      .from('user_profiles')
      .select('email')
      .eq('user_id', userId)
      .single();

    if (error || !data) {
      console.warn(`[getUserEmail] Could not fetch email for user ${userId}:`, error);
      return userId; // Fallback to ID if email not found
    }

    return data.email;
  } catch (err) {
    console.warn(`[getUserEmail] Error fetching email for ${userId}:`, err);
    return userId; // Fallback to ID on error
  }
};

// ============================================================================
// ORDER CREATION
// ============================================================================

/**
 * Create new order with items and inventory reservation
 * Validates initial state, reserves inventory, creates order and order items atomically
 *
 * Flow:
 *   1. Insert order record
 *   2. Insert order_items records (all at once)
 *   3. reserve_order_inventory RPC (atomic, server-side; expands combos, FEFO,
 *      cancels the order itself when stock is insufficient)
 *
 * Supabase has no client-side transactions: steps 1-2 are separate requests, but
 * the stock decision (step 3) is a single transaction, so concurrent orders can
 * never oversell. A failed reservation leaves the order cancelled, never pending.
 *
 * @param {Object} orderData - Order information
 * @param {Array} items - Order items (products, combos, remittances)
 * @throws {AppError} If validation fails, creation fails, or stock is insufficient (code INSUFFICIENT_STOCK)
 * @returns {Promise<Object>} Created order with items
 */
export const createOrder = async (orderData, items) => {
  try {
    // Validate required fields
    if (!orderData.userId || !orderData.totalAmount || !items || items.length === 0) {
      throw createValidationError({
        userId: !orderData.userId ? 'User ID is required' : undefined,
        totalAmount: !orderData.totalAmount ? 'Total amount is required' : undefined,
        items: !items || items.length === 0 ? 'At least one item is required' : undefined
      }, 'Missing required order fields');
    }

    // The payer contact phone is mandatory; reject before any DB access
    if (!isValidPayerPhone(orderData.payerPhone)) {
      throw createValidationError({
        payerPhone: 'A valid payer contact phone is required'
      }, 'Missing payer phone');
    }

    // Note: Orders always start in PENDING status

    // Prepare order data with initial state (order_number is set per insert attempt)
    const order = {
      user_id: orderData.userId,
      order_type: orderData.orderType || 'product',
      status: ORDER_STATUS.PENDING,
      // Defensive cent rounding: callers already round, but Postgres numeric(10,2) must
      // never be the one deciding how an unrounded value is rounded.
      subtotal: roundMoney(orderData.subtotal),
      discount_amount: roundMoney(orderData.discountAmount),
      shipping_cost: roundMoney(orderData.shippingCost),
      tax_amount: roundMoney(orderData.taxAmount),
      total_amount: roundMoney(orderData.totalAmount),
      currency_id: orderData.currencyId,
      shipping_address: orderData.shippingAddress || null,
      recipient_info: orderData.recipientInfo || null,
      delivery_instructions: orderData.deliveryInstructions || '',
      payment_method: orderData.paymentMethod || 'zelle',
      payment_status: PAYMENT_STATUS.PENDING,
      payment_reference: orderData.paymentReference || '',
      payment_proof_url: orderData.paymentProofUrl || null,
      payer_phone: normalizePayerPhone(orderData.payerPhone),
      shipping_zone_id: orderData.shippingZoneId || null,
      zelle_account_id: orderData.zelleAccountId || null,
      notes: orderData.notes || '',
      offer_id: orderData.offerId || null
    };

    // ATOMIC: Insert order, retrying with a new number if order_number collides
    let createdOrder = null;
    let orderNumber = null;
    for (let attempt = 1; attempt <= MAX_ORDER_NUMBER_ATTEMPTS; attempt += 1) {
      orderNumber = await generateOrderNumber();
      const { data, error: orderError } = await supabase
        .from('orders')
        .insert({ ...order, order_number: orderNumber })
        .select()
        .single();

      if (!orderError) {
        createdOrder = data;
        break;
      }
      const appError = parseSupabaseError(orderError);
      logError(appError, { operation: 'createOrder - insert order', orderNumber, attempt });
      if (!isOrderNumberCollision(orderError) || attempt === MAX_ORDER_NUMBER_ATTEMPTS) throw appError;
    }

    // ATOMIC: Prepare and insert order items
    const orderItems = items.map(item => ({
      order_id: createdOrder.id,
      item_type: item.itemType,
      item_id: item.itemId,
      item_name_es: item.nameEs,
      item_name_en: item.nameEn,
      quantity: item.quantity,
      unit_price: roundMoney(item.unitPrice),
      total_price: roundMoney(item.totalPrice),
      inventory_id: item.inventoryId || null,
      remittance_amount: item.remittanceAmount || null,
      exchange_rate: item.exchangeRate || null,
      recipient_data: item.recipientData || null
    }));

    const { data: createdItems, error: itemsError } = await supabase
      .from('order_items')
      .insert(orderItems)
      .select();

    if (itemsError) {
      const appError = parseSupabaseError(itemsError);
      logError(appError, { operation: 'createOrder - insert items', orderId: createdOrder.id });
      throw appError;
    }

    // ATOMIC (server-side): reserve stock for products and combo components in one RPC.
    // Insufficient stock cancels the order inside that transaction and throws a typed error.
    await reserveOrCancel(createdOrder.id);

    // Activity log (best effort) - get email for proper logging
    const userEmail = await getUserEmail(orderData.userId);
    logOrderActivity({
      action: 'order_created',
      entityId: createdOrder.id,
      performedBy: userEmail,
      description: `Orden ${orderNumber} creada`,
      metadata: {
        orderNumber,
        subtotal: orderData.subtotal,
        discountAmount: orderData.discountAmount,
        shippingCost: orderData.shippingCost,
        totalAmount: orderData.totalAmount,
        currencyId: orderData.currencyId,
        paymentMethod: orderData.paymentMethod,
        offerId: orderData.offerId
      }
    });

    return {
      ...createdOrder,
      items: createdItems
    };
  } catch (error) {
    if (error.code) throw error;
    const appError = handleError(error, ERROR_CODES.INTERNAL_SERVER_ERROR, {
      operation: 'createOrder'
    });
    throw appError;
  }
};

// ============================================================================
// STOCK RESERVATION (server-side, atomic)
// ============================================================================
// All stock movements happen inside Postgres (SECURITY DEFINER RPCs, see
// supabase/migrations/20261014190000_atomic_stock_reservation.sql). The client
// only orders the calls; it never reads-modifies-writes inventory.

const callStockRpc = async (rpcName, orderId, extraArgs = {}) => {
  const { data, error } = await supabase.rpc(rpcName, { p_order_id: orderId, ...extraArgs });
  if (error) {
    const appError = parseSupabaseError(error);
    logError(appError, { operation: rpcName, orderId });
    throw appError;
  }
  return data || {};
};

const stockRefusalToError = (result, orderId) => {
  const reason = result.reason || 'unknown';
  if (reason === 'insufficient_stock' || reason === 'invalid_item') {
    return new AppError(
      `Stock reservation refused: ${reason}`,
      ERROR_CODES.INSUFFICIENT_STOCK,
      409,
      {
        reason,
        orderId,
        productId: result.product_id ?? null,
        available: result.available ?? null
      }
    );
  }
  return new AppError(
    `Stock operation refused: ${reason}`,
    ERROR_CODES.INVALID_OPERATION,
    409,
    { reason, orderId }
  );
};

/**
 * Whether the order owns 'consumed' allocations (authoritative: read from
 * order_stock_allocations, not inferred from payment_status). A read failure is logged and
 * treated as "unknown = no"; restock stays available from the order list.
 */
const hasConsumedAllocations = async (orderId) => {
  const { data, error } = await supabase
    .from('order_stock_allocations')
    .select('id')
    .eq('order_id', orderId)
    .eq('state', 'consumed')
    .limit(1);
  if (error) {
    logError(error, { operation: 'hasConsumedAllocations', orderId });
    return false;
  }
  return Array.isArray(data) && data.length > 0;
};

/**
 * Reserve stock for an order that already has its items. The RPC cancels the
 * order itself (same transaction) when stock is insufficient.
 * @throws {AppError} INSUFFICIENT_STOCK / INVALID_OPERATION when refused, or a DB error
 */
const reserveOrderStock = async (orderId) => {
  const result = await callStockRpc('reserve_order_inventory', orderId);
  if (!result.ok) throw stockRefusalToError(result, orderId);
  return result;
};

/**
 * Return the units consumed by a CANCELLED order to the inventory (admin only).
 * Never automatic: goods may already have left, so the admin must confirm the physical return.
 * @param {string} orderId
 * @param {string} reason - why the units are being returned (stored in the movement notes)
 * @throws {AppError} when the reason is empty, the RPC fails, or it refuses (e.g. order not cancelled)
 * @returns {Promise<{ok: boolean, restocked: boolean, reason: string|null}>}
 */
export const restockOrder = async (orderId, reason) => {
  if (!orderId || !reason || !String(reason).trim()) {
    throw createValidationError({
      orderId: !orderId ? 'Order ID is required' : undefined,
      reason: !reason || !String(reason).trim() ? 'A restock reason is required' : undefined
    }, 'Missing required fields for restock');
  }
  const result = await callStockRpc('restock_order_inventory', orderId, { p_reason: String(reason).trim() });
  if (!result.ok) throw stockRefusalToError(result, orderId);
  return result;
};

/**
 * Release the reservation of an already-cancelled order. Never throws: the
 * cancellation is the user-visible outcome, and expire_stale_order_reservations
 * sweeps cancelled orders that still hold stock.
 */
const releaseOrderStock = async (orderId) => {
  try {
    await callStockRpc('release_order_inventory', orderId);
  } catch (releaseError) {
    logError(releaseError, { operation: 'releaseOrderStock', orderId });
  }
};

/** Best-effort compensation when a reserve call failed for transport reasons. */
const revertOrderToCancelled = async (orderId, reason) => {
  try {
    const { error } = await supabase
      .from('orders')
      .update({
        status: ORDER_STATUS.CANCELLED,
        payment_status: PAYMENT_STATUS.REJECTED,
        rejection_reason: reason,
        updated_at: new Date().toISOString()
      })
      .eq('id', orderId);
    if (error) logError(error, { operation: 'revertOrderToCancelled', orderId });
  } catch (revertError) {
    logError(revertError, { operation: 'revertOrderToCancelled', orderId });
  }
};

/** Reserve, and when the call fails WITHOUT a business answer, cancel the order again. */
const reserveOrCancel = async (orderId) => {
  try {
    return await reserveOrderStock(orderId);
  } catch (reserveError) {
    // A business refusal was already cancelled server-side; anything else may not have been.
    if (reserveError?.context?.reason === undefined) {
      await revertOrderToCancelled(orderId, 'reservation_failed');
    }
    throw reserveError;
  }
};

// ============================================================================
// ORDER RETRIEVAL
// ============================================================================

/**
 * Get user's orders with optional filters
 * @param {string} userId - User ID
 * @param {Object} filters - Optional filters (status, payment_status)
 * @throws {AppError} If userId missing or query fails
 * @returns {Promise<Array>} User's orders with items
 */
export const getUserOrders = async (userId, filters = {}) => {
  try {
    if (!userId) {
      throw createValidationError({ userId: 'User ID is required' });
    }

    let query = supabase
      .from('orders')
      .select(`
        *,
        order_items (*),
        currencies (code, symbol),
        shipping_zones (province_name, municipality_name, shipping_cost)
      `)
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    // Apply filters
    if (filters.status) {
      query = query.eq('status', filters.status);
    }
    if (filters.payment_status) {
      query = query.eq('payment_status', filters.payment_status);
    }

    const { data, error } = await query;

    if (error) {
      const appError = parseSupabaseError(error);
      logError(appError, { operation: 'getUserOrders', userId, filters });
      throw appError;
    }

    const orders = data || [];

    // Enrich orders with category discount and offer info (for accurate UI breakdowns)
    const categoryInfo = await getUserCategoryWithDiscount(userId);
    const categoryDiscount = categoryInfo?.enabled
      ? {
          category_name: categoryInfo.category,
          discount_percentage: categoryInfo.discountPercent || 0,
          discount_description: categoryInfo.categoryDiscount?.description || '',
          enabled: true
        }
      : null;

    const offerIds = Array.from(
      new Set(
        orders
          .map(order => order.offer_id)
          .filter(id => !!id && isValidUUID(id))
      )
    );

    let offersMap = {};
    if (offerIds.length > 0) {
      const createOfferSelect = () =>
        supabase
          .from('offers')
          .select('id, code, discount_type, discount_value, name_es, name_en, is_active');

      const { data: offersData, error: offersError } = await createOfferSelect().in('id', offerIds);

      if (!offersError && Array.isArray(offersData)) {
        offersMap = offersData.reduce((acc, offer) => {
          acc[offer.id] = offer;
          return acc;
        }, {});
      } else {
        // Some Supabase deployments return 400 for `in` queries with uuid arrays. Fall back to per-id fetches.
        if (offersError) {
          console.warn('[orderService] Failed to enrich offers via IN query', offersError.message);
        }

        const fallbackOffers = await Promise.all(
          offerIds.map(async (offerId) => {
            const { data, error } = await createOfferSelect().eq('id', offerId).maybeSingle();
            if (!error && data) {
              return data;
            }
            console.warn('[orderService] Failed to fetch offer info for order list', offerId, error?.message);
            return null;
          })
        );

        offersMap = fallbackOffers.filter(Boolean).reduce((acc, offer) => {
          acc[offer.id] = offer;
          return acc;
        }, {});
      }
    }

    return orders.map(order => ({
      ...order,
      user_category_discount: categoryDiscount && categoryDiscount.enabled ? categoryDiscount : null,
      offer_info: offersMap[order.offer_id] || null
    }));
  } catch (error) {
    if (error.code) throw error;
    const appError = handleError(error, ERROR_CODES.DB_ERROR, {
      operation: 'getUserOrders',
      userId
    });
    throw appError;
  }
};

/**
 * Get single order by ID with related data
 * Batches user profile fetch to avoid extra queries
 * @param {string} orderId - Order ID
 * @throws {AppError} If orderId missing or query fails
 * @returns {Promise<Object>} Order with full details including user profile
 */
export const getOrderById = async (orderId) => {
  try {
    if (!orderId) {
      throw createValidationError({ orderId: 'Order ID is required' });
    }

    // Query order without user_profiles join (due to schema relationship constraints)
    // User profile will be enriched manually after fetching order
    const { data: order, error } = await supabase
      .from('orders')
      .select(`
        *,
        order_items (*),
        currencies (code, symbol),
        shipping_zones (province_name, municipality_name, shipping_cost)
      `)
      .eq('id', orderId)
      .single();

    if (error) {
      const appError = parseSupabaseError(error);
      logError(appError, { operation: 'getOrderById', orderId });
      throw appError;
    }

    if (!order) {
      throw createNotFoundError('Order', orderId);
    }

    // Enrich order with user profile, category, and offer data if order exists
    if (order && order.user_id) {
      // Fetch user profile
      const { data: profile, error: profileError } = await supabase
        .from('user_profiles')
        .select('user_id, full_name, email')
        .eq('user_id', order.user_id)
        .single();

      // Fetch user category with discount info
      const { data: userCategory, error: categoryError } = await supabase
        .from('user_categories')
        .select('category_name')
        .eq('user_id', order.user_id)
        .maybeSingle();

      let categoryDiscount = null;
      if (!categoryError && userCategory) {
        const { data: discount, error: discountError } = await supabase
          .from('category_discounts')
          .select('discount_percentage, discount_description, enabled')
          .eq('category_name', userCategory.category_name)
          .maybeSingle();

        if (!discountError && discount) {
          categoryDiscount = {
            category_name: userCategory.category_name,
            discount_percentage: discount.discount_percentage || 0,
            discount_description: discount.discount_description,
            enabled: discount.enabled
          };
        }
      }

      // Fetch offer info if offer was applied
      let offerInfo = null;
      if (order.offer_id) {
        const baseOfferQuery = supabase
          .from('offers')
          .select('id, code, discount_type, discount_value, name_es, name_en, is_active')
          .limit(1);

        let offer;
        let offerError;

        if (isValidUUID(order.offer_id)) {
          ({ data: offer, error: offerError } = await baseOfferQuery
            .eq('id', order.offer_id)
            .maybeSingle());
        } else {
          // Legacy data may store the coupon code instead of UUID; avoid breaking with a 400 error
          ({ data: offer, error: offerError } = await baseOfferQuery
            .eq('code', order.offer_id)
            .maybeSingle());
        }

        if (!offerError && offer) {
          offerInfo = offer;
        } else if (offerError) {
          console.warn('[orderService] Failed to fetch offer info for order', order.id, offerError.message);
        }
      }

      return {
        ...order,
        user_profiles: profile || null,
        user_category_discount: categoryDiscount,
        offer_info: offerInfo
      };
    }

    return order;
  } catch (error) {
    if (error.code) throw error;
    const appError = handleError(error, ERROR_CODES.DB_ERROR, {
      operation: 'getOrderById',
      orderId
    });
    throw appError;
  }
};

/**
 * Mutates the given orders: has_consumed_stock = true when a CANCELLED order owns at least
 * one 'consumed' allocation (asked to the database through orders_with_consumed_stock, not
 * inferred from payment status). Never throws: on error the flag stays false and the failure is logged.
 */
const flagConsumedStock = async (orders) => {
  if (!Array.isArray(orders)) return;
  orders.forEach((o) => { o.has_consumed_stock = false; });
  const cancelledIds = orders.filter((o) => o.status === ORDER_STATUS.CANCELLED).map((o) => o.id);
  if (cancelledIds.length === 0) return;

  // RPC (ids in the request body) instead of .in('order_id', ids): hundreds of uuids in a
  // GET URL exceed proxy limits and would silently hide the button.
  const { data, error } = await supabase.rpc('orders_with_consumed_stock', { p_order_ids: cancelledIds });
  if (error) {
    logError(error, { operation: 'flagConsumedStock' });
    return;
  }
  const consumed = new Set((data || []).map((row) => row.order_id));
  orders.forEach((o) => { o.has_consumed_stock = consumed.has(o.id); });
};

/**
 * Get all orders with filters (admin only)
 * Batches user profile fetch to avoid N+1 queries
 * @param {Object} filters - Optional filters (status, payment_status, order_type)
 * @throws {AppError} If query fails
 * @returns {Promise<Array>} All orders with user profiles batched
 */
export const getAllOrders = async (filters = {}) => {
  try {
    // Query orders without user_profiles join (due to schema relationship constraints)
    // User profiles will be enriched manually after fetching orders
    let query = supabase
      .from('orders')
      .select(`
        *,
        order_items (*),
        currencies (code, symbol),
        shipping_zones (province_name, municipality_name, shipping_cost)
      `)
      .order('created_at', { ascending: false });

    // Apply filters
    if (filters.status) {
      query = query.eq('status', filters.status);
    }
    if (filters.payment_status) {
      query = query.eq('payment_status', filters.payment_status);
    }
    if (filters.order_type) {
      query = query.eq('order_type', filters.order_type);
    }

    const { data: orders, error } = await query;

    if (error) {
      const appError = parseSupabaseError(error);
      logError(appError, { operation: 'getAllOrders', filters });
      throw appError;
    }

    // Authoritative restock flag: cancelled orders that own 'consumed' allocations may still
    // need their units returned (admin decision). A failed read only hides the button.
    await flagConsumedStock(orders);

    // Enrich orders with user profile data if orders exist
    if (orders && orders.length > 0) {
      const userIds = [...new Set(orders.map(o => o.user_id))];

      const { data: profiles, error: profileError } = await supabase
        .from('user_profiles')
        .select('user_id, full_name, email')
        .in('user_id', userIds);

      if (!profileError && profiles && profiles.length > 0) {
        // Create a map for O(1) lookups
        const profileMap = new Map(profiles.map(p => [p.user_id, p]));

        // Enrich each order with its user profile
        return orders.map(order => {
          const profile = profileMap.get(order.user_id) || { user_id: order.user_id, full_name: null, email: null };
          return {
            ...order,
            user_profiles: profile,
            // Map to user_name and user_email for table columns compatibility
            user_name: order.user_name || profile.full_name || null,
            user_email: order.user_email || profile.email || null
          };
        });
      }
    }

    return orders || [];
  } catch (error) {
    if (error.code) throw error;
    const appError = handleError(error, ERROR_CODES.DB_ERROR, {
      operation: 'getAllOrders'
    });
    throw appError;
  }
};

/**
 * Get pending orders count (for admin notifications)
 * @throws {AppError} If RPC call fails
 * @returns {Promise<number>} Count of pending orders
 */
export const getPendingOrdersCount = async () => {
  try {
    const { data, error } = await supabase.rpc('get_pending_orders_count');

    if (error) {
      const appError = parseSupabaseError(error);
      logError(appError, { operation: 'getPendingOrdersCount' });
      throw appError;
    }

    return data || 0;
  } catch (error) {
    if (error.code) throw error;
    const appError = handleError(error, ERROR_CODES.DB_ERROR, {
      operation: 'getPendingOrdersCount'
    });
    throw appError;
  }
};

// ============================================================================
// PAYMENT VALIDATION & REJECTION
// ============================================================================

/**
 * Validate payment and consume the stock reserved for the order
 * CRITICAL: Requires payment_status === 'proof_uploaded' (or pending for super admins) and a valid transition to processing
 *
 * Flow:
 *   1. Fetch order and validate the state machine
 *   2. Update order status to PROCESSING and payment_status to VALIDATED
 *   3. consume_order_inventory RPC (atomic, idempotent): quantity -= q and
 *      reserved -= q for every allocation. No-op for legacy orders created before
 *      the stock cutover. A managed order that was never reserved is reserved and
 *      consumed in the same transaction.
 *      If this fails the order update is reverted, so the admin can simply retry.
 *   4. Log activity / status history / Zelle sync (graceful fallback if they fail)
 *
 * @param {string} orderId - Order ID
 * @param {string} adminId - Admin user ID
 * @throws {AppError} If validation fails, state invalid, or stock cannot be consumed
 * @returns {Promise<Object>} Updated order
 */
export const validatePayment = async (orderId, adminId) => {
  try {
    if (!orderId || !adminId) {
      throw createValidationError({
        orderId: !orderId ? 'Order ID is required' : undefined,
        adminId: !adminId ? 'Admin ID is required' : undefined
      });
    }

    // Fetch order with items
    const { data: order, error: fetchError } = await supabase
      .from('orders')
      .select('*, order_items (*)')
      .eq('id', orderId)
      .single();

    if (fetchError) {
      const appError = parseSupabaseError(fetchError);
      logError(appError, { operation: 'validatePayment - fetch', orderId });
      throw appError;
    }

    if (!order) {
      throw createNotFoundError('Order', orderId);
    }

    // CRITICAL: Validate state machine - only pending orders with proof uploaded
    // Only validate transition if we're not already in the target state
    if (order.status !== ORDER_STATUS.PROCESSING) {
      validateOrderTransition(order.status, ORDER_STATUS.PROCESSING);
    }
    if (order.payment_status !== PAYMENT_STATUS.VALIDATED) {
      validatePaymentTransition(order.payment_status, PAYMENT_STATUS.VALIDATED);
    }

    // ATOMIC: Update order status
    const { data: updatedOrder, error: updateError } = await supabase
      .from('orders')
      .update({
        payment_status: PAYMENT_STATUS.VALIDATED,
        status: ORDER_STATUS.PROCESSING,
        validated_by: adminId,
        validated_at: new Date().toISOString()
      })
      .eq('id', orderId)
      .select()
      .single();

    if (updateError) {
      const appError = parseSupabaseError(updateError);
      logError(appError, { operation: 'validatePayment - update', orderId });
      throw appError;
    }

    // ATOMIC (server-side): consume the reservation. On any failure undo the status
    // change so the order is not left validated with its stock untouched.
    try {
      const consumed = await callStockRpc('consume_order_inventory', orderId);
      if (!consumed.ok) throw stockRefusalToError(consumed, orderId);
    } catch (consumeError) {
      const { error: revertError } = await supabase
        .from('orders')
        .update({
          payment_status: order.payment_status,
          status: order.status,
          validated_by: order.validated_by ?? null,
          validated_at: order.validated_at ?? null
        })
        .eq('id', orderId);
      if (revertError) {
        // The order is now validated but its stock was not consumed: surface it for manual follow-up
        logError(parseSupabaseError(revertError), { operation: 'validatePayment - revert', orderId });
      }
      throw consumeError;
    }

    // Get admin email for logging
    const adminEmail = await getUserEmail(adminId);
    await logOrderActivity({
      action: 'payment_validated',
      entityId: orderId,
      performedBy: adminEmail,
      description: `Pago validado - Orden ${updatedOrder?.order_number || orderId}`,
      metadata: buildOrderPaymentMetadata(updatedOrder, {
        orderId,
        orderNumber: updatedOrder?.order_number,
        validatedBy: adminEmail,
        validatedAt: updatedOrder?.validated_at
      })
    });

    // Log status change (graceful fallback if fails)
    try {
      const { error: historyError } = await supabase
        .from('order_status_history')
        .insert({
          order_id: orderId,
          previous_status: order.status,
          new_status: ORDER_STATUS.PROCESSING,
          changed_by: adminId,
          notes: 'Payment validated by admin'
        });
      if (historyError) logError(historyError, { operation: 'validatePayment - log history', orderId });
    } catch (historyError) {
      logError(historyError, { operation: 'validatePayment - log history', orderId });
    }

    // Sync Zelle transaction history for observabilidad (graceful fallback)
    // CRITICAL: Always register Zelle transaction when validating payment, independent of activity log status
    if (order.zelle_account_id) {
      try {
        const zelleResult = await upsertZelleTransactionStatus({
          referenceId: orderId,
          transactionType: order.order_type === 'combo'
            ? ZELLE_TRANSACTION_TYPES.COMBO
            : ZELLE_TRANSACTION_TYPES.PRODUCT,
          status: ZELLE_STATUS.VALIDATED,
          amount: order.total_amount || 0,
          zelleAccountId: order.zelle_account_id,
          validatedBy: adminId
        });
      } catch (zelleError) {
        console.error('[validatePayment] ERROR registering Zelle transaction:', zelleError);
        logError(zelleError, { operation: 'validatePayment - zelle sync', orderId });
      }
    } else {
      console.warn('[validatePayment] No zelle_account_id found in order, skipping Zelle registration');
    }

    return updatedOrder;
  } catch (error) {
    if (error.code) throw error;
    const appError = handleError(error, ERROR_CODES.INTERNAL_SERVER_ERROR, {
      operation: 'validatePayment',
      orderId
    });
    throw appError;
  }
};

/**
 * Reject a payment (the order stays PENDING so the customer can retry with a new proof)
 * Requires status === pending and payment_status pending | proof_uploaded.
 *
 * Stock: a rejection does NOT release the reservation. The order is still alive
 * (uploadPaymentProof accepts rejected -> proof_uploaded and never re-reserves), so
 * releasing here would let the customer retry against stock somebody else took.
 * A rejected order that is abandoned is cancelled and released by
 * expire_stale_order_reservations, which times rejections from validated_at.
 *
 * @param {string} orderId - Order ID
 * @param {string} adminId - Admin user ID
 * @param {string} rejectionReason - Reason for rejection
 * @throws {AppError} If validation fails, state invalid, or operations fail
 * @returns {Promise<Object>} Updated cancelled order
 */
export const rejectPayment = async (orderId, adminId, rejectionReason) => {
  try {
    if (!orderId || !adminId || !rejectionReason) {
      throw createValidationError({
        orderId: !orderId ? 'Order ID is required' : undefined,
        adminId: !adminId ? 'Admin ID is required' : undefined,
        rejectionReason: !rejectionReason ? 'Rejection reason is required' : undefined
      }, 'Missing required fields for payment rejection');
    }

    // Fetch order with items
    const { data: order, error: fetchError } = await supabase
      .from('orders')
      .select('*, order_items (*)')
      .eq('id', orderId)
      .single();

    if (fetchError) {
      const appError = parseSupabaseError(fetchError);
      logError(appError, { operation: 'rejectPayment - fetch', orderId });
      throw appError;
    }

    if (!order) {
      throw createNotFoundError('Order', orderId);
    }

    // CRITICAL: Validate state - only pending orders can have payment rejected
    if (order.status !== ORDER_STATUS.PENDING) {
      throw createValidationError(
        { status: `Current order status is ${order.status}, but must be ${ORDER_STATUS.PENDING}` },
        'Payment can only be rejected for pending orders'
      );
    }

    // Allow rejecting payments that are either PENDING or have PROOF_UPLOADED
    if (order.payment_status !== PAYMENT_STATUS.PROOF_UPLOADED &&
        order.payment_status !== PAYMENT_STATUS.PENDING) {
      throw createValidationError(
        { payment_status: `Cannot reject payment with status ${order.payment_status}` },
        'El pago solo puede rechazarse si está pendiente o tiene comprobante subido'
      );
    }

    // ATOMIC: Update order status (keep pending so user can retry with new proof)
    const { data: updatedOrder, error: updateError } = await supabase
      .from('orders')
      .update({
        payment_status: PAYMENT_STATUS.REJECTED,
        status: ORDER_STATUS.PENDING,
        validated_by: adminId,
        validated_at: new Date().toISOString(),
        rejection_reason: rejectionReason
      })
      .eq('id', orderId)
      .select()
      .single();

    if (updateError) {
      const appError = parseSupabaseError(updateError);
      logError(appError, { operation: 'rejectPayment - update', orderId });
      throw appError;
    }

    // Log status change (graceful fallback if fails)
    try {
      const { error: historyError } = await supabase
        .from('order_status_history')
        .insert({
          order_id: orderId,
          previous_status: order.status,
          new_status: ORDER_STATUS.PENDING,
          changed_by: adminId,
          notes: `Payment rejected: ${rejectionReason}`
        });
      if (historyError) logError(historyError, { operation: 'rejectPayment - log history', orderId });
    } catch (historyError) {
      logError(historyError, { operation: 'rejectPayment - log history', orderId });
    }

    // Get admin email for logging
    const adminEmail = await getUserEmail(adminId);
    await logOrderActivity({
      action: 'payment_rejected',
      entityId: orderId,
      performedBy: adminEmail,
      description: `Pago rechazado - Orden ${updatedOrder?.order_number || orderId}`,
      metadata: buildOrderPaymentMetadata(updatedOrder, {
        orderId,
        orderNumber: updatedOrder?.order_number,
        rejectionReason,
        validatedBy: adminEmail,
        validatedAt: updatedOrder?.validated_at
      })
    });

    // Sync Zelle transaction history (graceful fallback)
    // CRITICAL: Always register Zelle transaction when rejecting payment, independent of activity log status
    if (order.zelle_account_id) {
      try {
        const zelleResult = await upsertZelleTransactionStatus({
          referenceId: orderId,
          transactionType: order.order_type === 'combo'
            ? ZELLE_TRANSACTION_TYPES.COMBO
            : ZELLE_TRANSACTION_TYPES.PRODUCT,
          status: ZELLE_STATUS.REJECTED,
          amount: order.total_amount || 0,
          zelleAccountId: order.zelle_account_id,
          validatedBy: adminId
        });
      } catch (zelleError) {
        console.error('[rejectPayment] ERROR registering Zelle transaction:', zelleError);
        logError(zelleError, { operation: 'rejectPayment - zelle sync', orderId });
      }
    } else {
      console.warn('[rejectPayment] No zelle_account_id found in order, skipping Zelle registration');
    }

    return updatedOrder;
  } catch (error) {
    if (error.code) throw error;
    const appError = handleError(error, ERROR_CODES.INTERNAL_SERVER_ERROR, {
      operation: 'rejectPayment',
      orderId
    });
    throw appError;
  }
};

// ============================================================================
// ORDER STATUS UPDATES & WORKFLOW
// ============================================================================

/**
 * Update order status with full state machine validation
 * @param {string} orderId - Order ID
 * @param {string} newStatus - New status (must be valid ORDER_STATUS)
 * @param {string} adminId - Admin user ID
 * @param {string} notes - Optional notes for status change
 * @throws {AppError} If validation fails, state invalid, or update fails
 * @returns {Promise<Object>} Updated order
 */
export const updateOrderStatus = async (orderId, newStatus, adminId, notes = '') => {
  try {
    if (!orderId || !newStatus || !adminId) {
      throw createValidationError({
        orderId: !orderId ? 'Order ID is required' : undefined,
        newStatus: !newStatus ? 'New status is required' : undefined,
        adminId: !adminId ? 'Admin ID is required' : undefined
      });
    }

    // Get current order
    const { data: order, error: fetchError } = await supabase
      .from('orders')
      .select('status')
      .eq('id', orderId)
      .single();

    if (fetchError) {
      const appError = parseSupabaseError(fetchError);
      logError(appError, { operation: 'updateOrderStatus - fetch', orderId });
      throw appError;
    }

    if (!order) {
      throw createNotFoundError('Order', orderId);
    }

    // CRITICAL: Validate state machine transition
    validateOrderTransition(order.status, newStatus);

    // Update order
    const { data: updatedOrder, error: updateError } = await supabase
      .from('orders')
      .update({
        status: newStatus,
        updated_at: new Date().toISOString()
      })
      .eq('id', orderId)
      .select()
      .single();

    if (updateError) {
      const appError = parseSupabaseError(updateError);
      logError(appError, { operation: 'updateOrderStatus - update', orderId, newStatus });
      throw appError;
    }

    // Log status change (graceful fallback if fails)
    try {
      const { error: historyError } = await supabase
        .from('order_status_history')
        .insert({
          order_id: orderId,
          previous_status: order.status,
          new_status: newStatus,
          changed_by: adminId,
          notes: notes
        });
      if (historyError) logError(historyError, { operation: 'updateOrderStatus - log history', orderId });
    } catch (historyError) {
      logError(historyError, { operation: 'updateOrderStatus - log history', orderId });
    }

    // Get admin email for logging
    const adminEmail = await getUserEmail(adminId);
    logOrderActivity({
      action: 'order_status_updated',
      entityId: orderId,
      performedBy: adminEmail,
      description: `Estado cambiado a ${newStatus} - Orden ${updatedOrder?.order_number || orderId}`,
      metadata: { orderId, orderNumber: updatedOrder?.order_number, previousStatus: order.status, newStatus, notes }
    });

    return updatedOrder;
  } catch (error) {
    if (error.code) throw error;
    const appError = handleError(error, ERROR_CODES.INTERNAL_SERVER_ERROR, {
      operation: 'updateOrderStatus',
      orderId
    });
    throw appError;
  }
};

/**
 * Upload payment proof screenshot with authorization validation
 * @param {File} file - Image file
 * @param {string} orderId - Order ID
 * @param {string} userId - User ID (for authorization)
 * @param {string} paymentReference - Payer name/company (titular/empresa que realiza el pago)
 * @param {Object} [options]
 * @param {string} options.payerPhone - Payer contact phone (required; stored in orders.payer_phone)
 * @throws {AppError} If validation fails, authorization fails, or upload fails
 * @returns {Promise<string>} Public URL of uploaded proof
 */
export const uploadPaymentProof = async (file, orderId, userId, paymentReference = '', options = {}) => {
  try {
    const { payerPhone } = options || {};
    if (!file || !orderId || !userId || !isValidPayerPhone(payerPhone)) {
      throw createValidationError({
        file: !file ? 'Proof file is required' : undefined,
        orderId: !orderId ? 'Order ID is required' : undefined,
        userId: !userId ? 'User ID is required' : undefined,
        payerPhone: !isValidPayerPhone(payerPhone) ? 'A valid payer contact phone is required' : undefined
      }, 'Missing required fields for proof upload');
    }

    // Fetch order to validate ownership and state
    const { data: order, error: fetchError } = await supabase
      .from('orders')
      .select('id, order_number, user_id, status, payment_status, payment_method, total_amount, payment_reference')
      .eq('id', orderId)
      .single();

    if (fetchError) {
      const appError = parseSupabaseError(fetchError);
      logError(appError, { operation: 'uploadPaymentProof - fetch', orderId });
      throw appError;
    }

    if (!order) {
      throw createNotFoundError('Order', orderId);
    }

    // Authorize - user must own the order
    if (order.user_id !== userId) {
      throw createPermissionError('upload proof for this order', 'owner');
    }

    // Validate order state - can only upload proof for pending orders (including rejected payments)
    if (order.status !== ORDER_STATUS.PENDING) {
      throw createValidationError(
        { status: `Current order status is ${order.status}, but must be ${ORDER_STATUS.PENDING}` },
        'Payment proof can only be uploaded for pending orders'
      );
    }

    // Handle both File and Blob objects
    let fileExt = 'jpg';
    if (file.name) {
      fileExt = file.name.split('.').pop();
    } else if (file.type) {
      const mimeToExt = {
        'image/jpeg': 'jpg',
        'image/jpg': 'jpg',
        'image/png': 'png',
        'image/webp': 'webp',
        'image/gif': 'gif'
      };
      fileExt = mimeToExt[file.type] || 'jpg';
    }

    const fileName = `payment-proof-${orderId}-${Date.now()}.${fileExt}`;
    const filePath = `payment-proofs/${fileName}`;

    // Upload to Supabase Storage
    const { error: uploadError } = await supabase.storage
      .from('order-documents')
      .upload(filePath, file, {
        cacheControl: '3600',
        upsert: false
      });

    if (uploadError) {
      const appError = parseSupabaseError(uploadError);
      logError(appError, { operation: 'uploadPaymentProof - upload', filePath });
      throw appError;
    }

    // Get public URL
    const { data: urlData } = supabase.storage
      .from('order-documents')
      .getPublicUrl(filePath);

    // Update order with proof URL, payment reference, and mark as proof uploaded
    const updateData = {
      payment_proof_url: urlData.publicUrl,
      payment_status: PAYMENT_STATUS.PROOF_UPLOADED,
      payer_phone: normalizePayerPhone(payerPhone),
      rejection_reason: null,
      updated_at: new Date().toISOString()
    };

    // Include payment_reference if provided
    if (paymentReference && paymentReference.trim()) {
      updateData.payment_reference = paymentReference.trim();
    }

    const { error: updateError } = await supabase
      .from('orders')
      .update(updateData)
      .eq('id', orderId);

    if (updateError) {
      const appError = parseSupabaseError(updateError);
      logError(appError, { operation: 'uploadPaymentProof - update', orderId });
      throw appError;
    }

    // Get user email for logging
    const userEmail = await getUserEmail(userId);
    logOrderActivity({
      action: 'payment_proof_uploaded',
      entityId: orderId,
      performedBy: userEmail,
      description: `Comprobante subido - Orden ${order?.order_number || orderId}`,
      metadata: buildOrderPaymentMetadata(
        { ...order, payment_status: PAYMENT_STATUS.PROOF_UPLOADED },
        { orderId, orderNumber: order?.order_number, paymentProofUrl: urlData.publicUrl }
      )
    });

    return urlData.publicUrl;
  } catch (error) {
    if (error.code) throw error;
    const appError = handleError(error, ERROR_CODES.INTERNAL_SERVER_ERROR, {
      operation: 'uploadPaymentProof',
      orderId
    });
    throw appError;
  }
};

/**
 * Start processing an order (Payment Validated → Processing)
 * Validates order is in correct state for processing
 * @param {string} orderId - Order ID
 * @param {string} adminId - Admin user ID
 * @throws {AppError} If order not found, invalid state, or update fails
 * @returns {Promise<Object>} Updated order in processing state
 */
export const startProcessingOrder = async (orderId, adminId) => {
  try {
    if (!orderId || !adminId) {
      throw createValidationError({
        orderId: !orderId ? 'Order ID is required' : undefined,
        adminId: !adminId ? 'Admin ID is required' : undefined
      });
    }

    // Verify order exists and payment is validated
    const { data: order, error: fetchError } = await supabase
      .from('orders')
      .select('id, order_number, status, payment_status')
      .eq('id', orderId)
      .single();

    if (fetchError) {
      const appError = parseSupabaseError(fetchError);
      logError(appError, { operation: 'startProcessingOrder - fetch', orderId });
      throw appError;
    }

    if (!order) {
      throw createNotFoundError('Order', orderId);
    }

    // Validate state machine
    if (order.payment_status !== PAYMENT_STATUS.VALIDATED) {
      throw createValidationError(
        { payment_status: `Current payment status is ${order.payment_status}, but must be ${PAYMENT_STATUS.VALIDATED}` },
        'Payment must be validated before processing'
      );
    }

    validateOrderTransition(order.status, ORDER_STATUS.PROCESSING);

    // Update order status
    const { data: updatedOrder, error: updateError } = await supabase
      .from('orders')
      .update({
        status: ORDER_STATUS.PROCESSING,
        processing_started_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('id', orderId)
      .select()
      .single();

    if (updateError) {
      const appError = parseSupabaseError(updateError);
      logError(appError, { operation: 'startProcessingOrder - update', orderId });
      throw appError;
    }

    return updatedOrder;
  } catch (error) {
    if (error.code) throw error;
    const appError = handleError(error, ERROR_CODES.INTERNAL_SERVER_ERROR, {
      operation: 'startProcessingOrder',
      orderId
    });
    throw appError;
  }
};

/**
 * Mark order as shipped (Processing → Shipped)
 * Validates order is in processing state
 * @param {string} orderId - Order ID
 * @param {string} adminId - Admin user ID
 * @param {string} trackingInfo - Optional tracking information
 * @throws {AppError} If order not found, invalid state, or update fails
 * @returns {Promise<Object>} Updated order in shipped state
 */
export const markOrderAsDispatched = async (orderId, adminId, trackingInfo = '') => {
  try {
    if (!orderId || !adminId) {
      throw createValidationError({
        orderId: !orderId ? 'Order ID is required' : undefined,
        adminId: !adminId ? 'Admin ID is required' : undefined
      });
    }

    // Verify order exists and is in processing
    const { data: order, error: fetchError } = await supabase
      .from('orders')
      .select('id, order_number, status')
      .eq('id', orderId)
      .single();

    if (fetchError) {
      const appError = parseSupabaseError(fetchError);
      logError(appError, { operation: 'markOrderAsDispatched - fetch', orderId });
      throw appError;
    }

    if (!order) {
      throw createNotFoundError('Order', orderId);
    }

    // Validate state machine
    validateOrderTransition(order.status, ORDER_STATUS.DISPATCHED);

    // Update order status
    const updateData = {
      status: ORDER_STATUS.DISPATCHED,
      dispatched_at: new Date().toISOString(),
      dispatched_by: adminId,
      updated_at: new Date().toISOString()
    };

    if (trackingInfo) {
      updateData.notes = order.notes
        ? `${order.notes}\n\nTracking: ${trackingInfo}`
        : `Tracking: ${trackingInfo}`;
    }

    const { data: updatedOrder, error: updateError } = await supabase
      .from('orders')
      .update(updateData)
      .eq('id', orderId)
      .select()
      .single();

    if (updateError) {
      const appError = parseSupabaseError(updateError);
      logError(appError, { operation: 'markOrderAsDispatched - update', orderId });
      throw appError;
    }

    // Get admin email for logging
    const adminEmail = await getUserEmail(adminId);
    logOrderActivity({
      action: 'order_dispatched',
      entityId: orderId,
      performedBy: adminEmail,
      description: `Orden ${order.order_number} marcada como despachada`,
      metadata: { trackingInfo, orderNumber: order.order_number }
    });

    return updatedOrder;
  } catch (error) {
    if (error.code) throw error;
    const appError = handleError(error, ERROR_CODES.INTERNAL_SERVER_ERROR, {
      operation: 'markOrderAsDispatched',
      orderId
    });
    throw appError;
  }
};

// Backward compatibility alias
export const markOrderAsShipped = markOrderAsDispatched;

/**
 * Mark order as delivered with proof (Shipped → Delivered)
 * Requires valid delivery proof file
 * @param {string} orderId - Order ID
 * @param {File} proofFile - Delivery proof image file
 * @param {string} adminId - Admin user ID
 * @throws {AppError} If order not found, invalid state, no proof, or update fails
 * @returns {Promise<Object>} Updated order in delivered state
 */
export const markOrderAsDelivered = async (orderId, proofFile, adminId) => {
  try {
    if (!orderId || !proofFile || !adminId) {
      throw createValidationError({
        orderId: !orderId ? 'Order ID is required' : undefined,
        proofFile: !proofFile ? 'Delivery proof file is required' : undefined,
        adminId: !adminId ? 'Admin ID is required' : undefined
      }, 'Missing required fields for delivery confirmation');
    }

    // Verify order exists and is shipped
    const { data: order, error: fetchError } = await supabase
      .from('orders')
      .select('id, order_number, status')
      .eq('id', orderId)
      .single();

    if (fetchError) {
      const appError = parseSupabaseError(fetchError);
      logError(appError, { operation: 'markOrderAsDelivered - fetch', orderId });
      throw appError;
    }

    if (!order) {
      throw createNotFoundError('Order', orderId);
    }

    // Validate state machine
    validateOrderTransition(order.status, ORDER_STATUS.DELIVERED);

    // Get authenticated user for file path
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user?.id) {
      const appError = parseSupabaseError(authError) || new Error('User not authenticated');
      logError(appError, { operation: 'markOrderAsDelivered - getUser', orderId });
      throw appError;
    }

    // Upload delivery proof to order-delivery-proofs bucket
    // Path format: {user_id}/{order_id}/filename (required by RLS policy)
    const fileName = `${user.id}/${orderId}/delivery-proof-${Date.now()}.jpg`;
    const { error: uploadError } = await supabase.storage
      .from('order-delivery-proofs')
      .upload(fileName, proofFile, {
        cacheControl: '3600',
        upsert: false
      });

    if (uploadError) {
      const appError = parseSupabaseError(uploadError);
      logError(appError, { operation: 'markOrderAsDelivered - upload', fileName });
      throw appError;
    }

    // Store the file path (NOT public URL) - signed URLs will be generated when displaying
    // This matches the pattern used by remittances for private bucket storage

    // Update order status
    const { data: updatedOrder, error: updateError } = await supabase
      .from('orders')
      .update({
        status: ORDER_STATUS.DELIVERED,
        delivered_at: new Date().toISOString(),
        delivery_proof_url: fileName, // Store path only, not full URL
        updated_at: new Date().toISOString()
      })
      .eq('id', orderId)
      .select()
      .single();

    if (updateError) {
      const appError = parseSupabaseError(updateError);
      logError(appError, { operation: 'markOrderAsDelivered - update', orderId });
      throw appError;
    }

    // Get admin email for logging
    const adminEmail = await getUserEmail(adminId);
    logOrderActivity({
      action: 'order_delivered',
      entityId: orderId,
      performedBy: adminEmail,
      description: `Entregada con evidencia - Orden ${updatedOrder?.order_number || orderId}`,
      metadata: { orderId, orderNumber: updatedOrder?.order_number, deliveryProofPath: fileName }
    });

    return updatedOrder;
  } catch (error) {
    if (error.code) throw error;
    const appError = handleError(error, ERROR_CODES.INTERNAL_SERVER_ERROR, {
      operation: 'markOrderAsDelivered',
      orderId
    });
    throw appError;
  }
};

/**
 * Complete an order (Delivered → Completed)
 * Final state transition - order can no longer be modified
 * @param {string} orderId - Order ID
 * @param {string} notes - Optional completion notes
 * @throws {AppError} If order not found, invalid state, or update fails
 * @returns {Promise<Object>} Updated order in completed state
 */
export const completeOrder = async (orderId, notes = '') => {
  try {
    if (!orderId) {
      throw createValidationError({ orderId: 'Order ID is required' });
    }

    // Verify order exists and is delivered
    const { data: order, error: fetchError } = await supabase
      .from('orders')
      .select('id, order_number, status')
      .eq('id', orderId)
      .single();

    if (fetchError) {
      const appError = parseSupabaseError(fetchError);
      logError(appError, { operation: 'completeOrder - fetch', orderId });
      throw appError;
    }

    if (!order) {
      throw createNotFoundError('Order', orderId);
    }

    // Validate state machine
    validateOrderTransition(order.status, ORDER_STATUS.COMPLETED);

    // Update order status
    const updateData = {
      status: ORDER_STATUS.COMPLETED,
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    if (notes) {
      updateData.notes = order.notes ? `${order.notes}\n\n${notes}` : notes;
    }

    const { data: updatedOrder, error: updateError } = await supabase
      .from('orders')
      .update(updateData)
      .eq('id', orderId)
      .select()
      .single();

    if (updateError) {
      const appError = parseSupabaseError(updateError);
      logError(appError, { operation: 'completeOrder - update', orderId });
      throw appError;
    }

    logOrderActivity({
      action: 'order_completed',
      entityId: orderId,
      performedBy: 'system',
      description: `Completada - Orden ${updatedOrder?.order_number || orderId}`,
      metadata: { orderId, orderNumber: updatedOrder?.order_number, notes }
    });

    return updatedOrder;
  } catch (error) {
    if (error.code) throw error;
    const appError = handleError(error, ERROR_CODES.INTERNAL_SERVER_ERROR, {
      operation: 'completeOrder',
      orderId
    });
    throw appError;
  }
};

/**
 * Cancel an order with full state validation
 * CRITICAL: Can only cancel pending or processing orders
 *
 * Flow: validate state -> set status CANCELLED -> release_order_inventory RPC
 * (idempotent; only releases 'reserved' allocations, so stock already consumed by a
 * validated payment is NOT restocked - that is an explicit inventory decision).
 * A lost release call is healed by expire_stale_order_reservations (orphan sweep).
 *
 * @param {string} orderId - Order ID
 * @param {string} adminId - Admin user ID
 * @param {string} reason - Cancellation reason
 * @throws {AppError} If order not found, invalid state, or operations fail
 * @returns {Promise<Object>} Updated cancelled order
 */
export const cancelOrder = async (orderId, adminId, reason) => {
  try {
    if (!orderId || !adminId || !reason) {
      throw createValidationError({
        orderId: !orderId ? 'Order ID is required' : undefined,
        adminId: !adminId ? 'Admin ID is required' : undefined,
        reason: !reason ? 'Cancellation reason is required' : undefined
      }, 'Missing required fields for order cancellation');
    }

    // Get order with items
    const { data: order, error: fetchError } = await supabase
      .from('orders')
      .select('*, order_items(*)')
      .eq('id', orderId)
      .single();

    if (fetchError) {
      const appError = parseSupabaseError(fetchError);
      logError(appError, { operation: 'cancelOrder - fetch', orderId });
      throw appError;
    }

    if (!order) {
      throw createNotFoundError('Order', orderId);
    }

    // CRITICAL: Validate state machine - can only cancel pending or processing
    const cancellableStatuses = [ORDER_STATUS.PENDING, ORDER_STATUS.PROCESSING];
    if (!cancellableStatuses.includes(order.status)) {
      throw createValidationError(
        { status: `Order is in ${order.status} state` },
        `Orders can only be cancelled in ${cancellableStatuses.join(' or ')} states`
      );
    }

    // ATOMIC: Update order status
    const { data: updatedOrder, error: updateError } = await supabase
      .from('orders')
      .update({
        status: ORDER_STATUS.CANCELLED,
        rejection_reason: reason,
        updated_at: new Date().toISOString()
      })
      .eq('id', orderId)
      .select()
      .single();

    if (updateError) {
      const appError = parseSupabaseError(updateError);
      logError(appError, { operation: 'cancelOrder - update', orderId });
      throw appError;
    }

    // The release RPC only acts on cancelled orders and is idempotent (consumed stock is not restocked).
    await releaseOrderStock(orderId);

    // Log status change (graceful fallback if fails)
    try {
      const { error: historyError } = await supabase
        .from('order_status_history')
        .insert({
          order_id: orderId,
          previous_status: order.status,
          new_status: ORDER_STATUS.CANCELLED,
          changed_by: adminId,
          notes: `Cancelled: ${reason}`
        });
      if (historyError) logError(historyError, { operation: 'cancelOrder - log history', orderId });
    } catch (historyError) {
      logError(historyError, { operation: 'cancelOrder - log history', orderId });
    }

    // Get admin email for logging
    const adminEmail = await getUserEmail(adminId);
    logOrderActivity({
      action: 'order_cancelled',
      entityId: orderId,
      performedBy: adminEmail,
      description: `Cancelada por admin - Orden ${updatedOrder?.order_number || orderId}`,
      metadata: { orderId, orderNumber: updatedOrder?.order_number, reason }
    });

    // The caller may offer restockOrder() only when the database really consumed units.
    return { ...updatedOrder, stockConsumed: await hasConsumedAllocations(orderId) };
  } catch (error) {
    if (error.code) throw error;
    const appError = handleError(error, ERROR_CODES.INTERNAL_SERVER_ERROR, {
      operation: 'cancelOrder',
      orderId
    });
    throw appError;
  }
};

/**
 * Allow order owner to cancel while pending
 */
export const cancelOrderByUser = async (orderId, userId, reason = 'cancelled_by_user') => {
  try {
    if (!orderId || !userId) {
      throw createValidationError({ orderId: !orderId ? 'Order ID is required' : undefined, userId: !userId ? 'User ID is required' : undefined });
    }

    const { data: order, error: fetchError } = await supabase
      .from('orders')
      .select('id, user_id, status, order_number, order_items(*)')
      .eq('id', orderId)
      .single();

    if (fetchError) {
      const appError = parseSupabaseError(fetchError);
      logError(appError, { operation: 'cancelOrderByUser - fetch', orderId });
      throw appError;
    }

    if (!order) {
      throw createNotFoundError('Order', orderId);
    }

    if (order.user_id !== userId) {
      throw createPermissionError('cancel this order', 'owner');
    }

    if (order.status !== ORDER_STATUS.PENDING) {
      throw createValidationError({ status: `Order is in ${order.status} state` }, 'Only pending orders can be cancelled by the user');
    }

    const { data: updatedOrder, error: updateError } = await supabase
      .from('orders')
      .update({
        status: ORDER_STATUS.CANCELLED,
        payment_status: PAYMENT_STATUS.REJECTED,
        rejection_reason: reason,
        updated_at: new Date().toISOString()
      })
      .eq('id', orderId)
      .select()
      .single();

    if (updateError) {
      const appError = parseSupabaseError(updateError);
      logError(appError, { operation: 'cancelOrderByUser - update', orderId });
      throw appError;
    }

    await releaseOrderStock(orderId);

    // Get user email for logging
    const userEmail = await getUserEmail(userId);
    logOrderActivity({
      action: 'order_cancelled',
      entityId: orderId,
      performedBy: userEmail,
      description: `Usuario canceló orden ${order.order_number}`,
      metadata: { reason }
    });

    return updatedOrder;
  } catch (error) {
    if (error.code) throw error;
    const appError = handleError(error, ERROR_CODES.INTERNAL_SERVER_ERROR, {
      operation: 'cancelOrderByUser',
      orderId
    });
    throw appError;
  }
};

// ============================================================================
// ORDER STATISTICS
// ============================================================================

/**
 * Calculate days an order has been in processing
 * Pure helper function - no database interaction
 * @param {Object} order - Order object with processing_started_at and status
 * @returns {number|null} Number of days or null if not in processing
 */
export const getDaysInProcessing = (order) => {
  if (!order || order.status !== ORDER_STATUS.PROCESSING || !order.processing_started_at) {
    return null;
  }

  const now = new Date();
  const started = new Date(order.processing_started_at);
  const diffTime = Math.abs(now - started);
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  return diffDays;
};

// ============================================================================
// ORDER REOPENING
// ============================================================================

/**
 * Reopen a cancelled order (user action)
 * Allows users to reopen their own cancelled orders to retry payment
 * @param {string} orderId - Order ID to reopen
 * @param {string} userId - User ID performing the action
 * @returns {Promise<Object>} Reopened order
 */
export const reopenOrder = async (orderId, userId) => {
  try {
    if (!orderId || !userId) {
      throw createValidationError({
        orderId: !orderId ? 'Order ID is required' : undefined,
        userId: !userId ? 'User ID is required' : undefined
      }, 'Missing required fields for order reopening');
    }

    // Fetch order to verify existence and ownership
    const { data: order, error: fetchError } = await supabase
      .from('orders')
      .select('id, order_number, user_id, status, payment_status')
      .eq('id', orderId)
      .single();

    if (fetchError) {
      const appError = parseSupabaseError(fetchError);
      logError(appError, { operation: 'reopenOrder - fetch', orderId });
      throw appError;
    }

    if (!order) {
      throw createNotFoundError('Order', orderId);
    }

    // Verify user ownership
    if (order.user_id !== userId) {
      throw createValidationError(
        { userId: 'User does not own this order' },
        'Solo puedes reabrir tus propias órdenes'
      );
    }

    // Verify order is cancelled
    if (order.status !== ORDER_STATUS.CANCELLED) {
      throw createValidationError(
        { status: `Order status is ${order.status}, must be cancelled` },
        'Solo puedes reabrir órdenes canceladas'
      );
    }

    // Validate state transition
    validateOrderTransition(order.status, ORDER_STATUS.PENDING);

    // Reopen order - reset to pending status.
    // (orders has no cancelled_by / cancelled_at / cancellation_reason columns: sending
    // them made PostgREST reject the whole update.)
    const { data: updatedOrder, error: updateError } = await supabase
      .from('orders')
      .update({
        status: ORDER_STATUS.PENDING,
        payment_status: PAYMENT_STATUS.PENDING,
        updated_at: new Date().toISOString()
      })
      .eq('id', orderId)
      .select()
      .single();

    if (updateError) {
      const appError = parseSupabaseError(updateError);
      logError(appError, { operation: 'reopenOrder - update', orderId });
      throw appError;
    }

    // Re-reserve the stock that was released on cancel. When it is no longer available the
    // RPC cancels the order again and this throws INSUFFICIENT_STOCK (the reopen is refused).
    await reserveOrCancel(orderId);

    // Log activity
    const userEmail = await getUserEmail(userId);
    logOrderActivity({
      action: 'order_reopened',
      entityId: orderId,
      performedBy: userEmail,
      description: `Usuario reabrió orden ${order.order_number}`,
      metadata: { orderNumber: order.order_number, reason: 'user_request' }
    });

    return updatedOrder;
  } catch (error) {
    if (error.code) throw error;
    const appError = handleError(error, ERROR_CODES.INTERNAL_SERVER_ERROR, {
      operation: 'reopenOrder',
      orderId,
      userId
    });
    logError(appError);
    throw appError;
  }
};

/**
 * Reopen a cancelled order (admin action)
 * Allows admins to reopen any cancelled order with a reason
 * @param {string} orderId - Order ID to reopen
 * @param {string} adminId - Admin user ID performing the action
 * @param {string} reason - Reason for reopening
 * @returns {Promise<Object>} Reopened order
 */
export const reopenOrderByAdmin = async (orderId, adminId, reason = 'Reapertura administrativa') => {
  try {
    if (!orderId || !adminId) {
      throw createValidationError({
        orderId: !orderId ? 'Order ID is required' : undefined,
        adminId: !adminId ? 'Admin ID is required' : undefined
      }, 'Missing required fields for order reopening');
    }

    // Fetch order to verify existence
    const { data: order, error: fetchError } = await supabase
      .from('orders')
      .select('id, order_number, status, payment_status')
      .eq('id', orderId)
      .single();

    if (fetchError) {
      const appError = parseSupabaseError(fetchError);
      logError(appError, { operation: 'reopenOrderByAdmin - fetch', orderId });
      throw appError;
    }

    if (!order) {
      throw createNotFoundError('Order', orderId);
    }

    // Verify order is cancelled
    if (order.status !== ORDER_STATUS.CANCELLED) {
      throw createValidationError(
        { status: `Order status is ${order.status}, must be cancelled` },
        'Solo puedes reabrir órdenes canceladas'
      );
    }

    // Validate state transition
    validateOrderTransition(order.status, ORDER_STATUS.PENDING);

    // Reopen order - reset to pending status.
    // (orders has no cancelled_by / cancelled_at / cancellation_reason columns: sending
    // them made PostgREST reject the whole update.)
    const { data: updatedOrder, error: updateError } = await supabase
      .from('orders')
      .update({
        status: ORDER_STATUS.PENDING,
        payment_status: PAYMENT_STATUS.PENDING,
        updated_at: new Date().toISOString()
      })
      .eq('id', orderId)
      .select()
      .single();

    if (updateError) {
      const appError = parseSupabaseError(updateError);
      logError(appError, { operation: 'reopenOrderByAdmin - update', orderId });
      throw appError;
    }

    // Same contract as reopenOrder: re-reserve or refuse with INSUFFICIENT_STOCK.
    await reserveOrCancel(orderId);

    // Log activity
    const adminEmail = await getUserEmail(adminId);
    logOrderActivity({
      action: 'order_reopened',
      entityId: orderId,
      performedBy: adminEmail,
      description: `Administrador reabrió orden ${order.order_number}: ${reason}`,
      metadata: { orderNumber: order.order_number, reason, reopenedBy: 'admin' }
    });

    return updatedOrder;
  } catch (error) {
    if (error.code) throw error;
    const appError = handleError(error, ERROR_CODES.INTERNAL_SERVER_ERROR, {
      operation: 'reopenOrderByAdmin',
      orderId,
      adminId
    });
    logError(appError);
    throw appError;
  }
};
