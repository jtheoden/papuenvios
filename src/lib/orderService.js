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
  ERROR_CODES
} from './errorHandler';
import { logActivity } from './activityLogger';
import { callTransitionRpc } from './statusTransition';
import { isValidPayerPhone, normalizePayerPhone } from './payerPhone';
import { getUserCategoryWithDiscount } from './orderDiscountService';
import { ZELLE_STATUS, ZELLE_TRANSACTION_TYPES, upsertZelleTransactionStatus } from './zelleService';
import { isInsufficientStockError, stockRefusalToError } from './stockErrors';
import { roundMoney } from './moneyPure';
import { PAYMENT_PROOF_MIME_EXT, validatePaymentProofFile } from './paymentProofService';

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
// STATUS CONSTANTS (the transition matrix lives in the database: see statusTransition.js)
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

    // Prepare order data with initial state
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

    // ATOMIC: Insert order. order_number is assigned by the database (trigger set_order_number).
    const { data: createdOrder, error: orderError } = await supabase
      .from('orders')
      .insert(order)
      .select()
      .single();

    if (orderError) {
      const appError = parseSupabaseError(orderError);
      logError(appError, { operation: 'createOrder - insert order' });
      throw appError;
    }
    const orderNumber = createdOrder.order_number;

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
 * Best-effort compensation when a reserve call failed for transport reasons: the owner cancels the pending order
 * through order_cancel (a direct UPDATE of the status would be rejected once status writes are RPC-only).
 */
const revertOrderToCancelled = async (orderId, reason) => {
  try {
    await callTransitionRpc('order_cancel', { p_order_id: orderId, p_reason: reason }, { entity: 'Order', id: orderId });
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
// STATUS TRANSITIONS (server-side, atomic)
// ============================================================================
// Every status change is one order_* RPC (supabase/migrations/20261024110000_order_transition_rpcs.sql): the
// database locks the row, checks the transition matrix against the locked state, applies the stock effect and writes
// the status history in ONE transaction. The client only validates its inputs, uploads files (before the RPC),
// and runs the best-effort side effects afterwards (activity log, Zelle history). A concurrent change surfaces as a
// CONFLICT error (isStatusConflictError) instead of silently overwriting the other actor.

const orderTarget = (orderId) => ({ entity: 'Order', id: orderId });

/** Best-effort Zelle history sync from the row returned by a transition RPC. */
const syncOrderZelleStatus = async (order, status, validatedBy, operation) => {
  if (!order?.zelle_account_id) return;
  try {
    await upsertZelleTransactionStatus({
      referenceId: order.id,
      transactionType: order.order_type === 'combo'
        ? ZELLE_TRANSACTION_TYPES.COMBO
        : ZELLE_TRANSACTION_TYPES.PRODUCT,
      status,
      amount: order.total_amount || 0,
      zelleAccountId: order.zelle_account_id,
      validatedBy
    });
  } catch (zelleError) {
    logError(zelleError, { operation: `${operation} - zelle sync`, orderId: order.id });
  }
};

/** Rethrows AppErrors; wraps anything else as an internal error for `operation`. */
const rethrowAsAppError = (error, operation, context = {}) => {
  if (error.code) throw error;
  throw handleError(error, ERROR_CODES.INTERNAL_SERVER_ERROR, { operation, ...context });
};

// ============================================================================
// PAYMENT VALIDATION & REJECTION
// ============================================================================

/**
 * Validate payment and consume the stock reserved for the order (order_validate_payment).
 * One transaction: status -> processing, payment -> validated, stock consumed, history row. If the stock cannot be
 * consumed nothing changes and the typed INSUFFICIENT_STOCK error is thrown, so the admin can simply retry.
 *
 * @param {string} orderId - Order ID
 * @param {string} adminId - Admin user ID (activity log / Zelle history; authorization is the JWT's)
 * @throws {AppError} CONFLICT when the order already moved, INSUFFICIENT_STOCK, FORBIDDEN, or a DB error
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

    const updatedOrder = await callTransitionRpc('order_validate_payment', { p_order_id: orderId }, orderTarget(orderId));

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

    await syncOrderZelleStatus(updatedOrder, ZELLE_STATUS.VALIDATED, adminId, 'validatePayment');

    return updatedOrder;
  } catch (error) {
    return rethrowAsAppError(error, 'validatePayment', { orderId });
  }
};

/**
 * Reject a payment (order_reject_payment). The order stays PENDING so the customer can retry with a new proof.
 *
 * Stock: a rejection does NOT release the reservation. The order is still alive (a rejected payment accepts a new
 * proof and never re-reserves), so releasing here would let the customer retry against stock somebody else took.
 * A rejected order that is abandoned is cancelled and released by expire_stale_order_reservations.
 *
 * @param {string} orderId - Order ID
 * @param {string} adminId - Admin user ID
 * @param {string} rejectionReason - Reason for rejection
 * @throws {AppError} If validation fails, the order already moved (CONFLICT) or the RPC fails
 * @returns {Promise<Object>} Updated order
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

    const updatedOrder = await callTransitionRpc(
      'order_reject_payment',
      { p_order_id: orderId, p_reason: rejectionReason },
      orderTarget(orderId)
    );

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

    await syncOrderZelleStatus(updatedOrder, ZELLE_STATUS.REJECTED, adminId, 'rejectPayment');

    return updatedOrder;
  } catch (error) {
    return rethrowAsAppError(error, 'rejectPayment', { orderId });
  }
};

// ============================================================================
// ORDER STATUS WORKFLOW
// ============================================================================

/**
 * Upload payment proof screenshot and mark the payment as proof_uploaded (order_submit_proof).
 * The file goes to the private bucket first; if the RPC then refuses (the order moved), the file stays orphaned.
 * @param {File} file - Image file
 * @param {string} orderId - Order ID
 * @param {string} userId - User ID (activity log; ownership is checked by the RPC against the JWT)
 * @param {string} paymentReference - Payer name/company (titular/empresa que realiza el pago)
 * @param {Object} [options]
 * @param {string} options.payerPhone - Payer contact phone (required; stored in orders.payer_phone)
 * @throws {AppError} If validation fails, the upload fails, or the RPC refuses
 * @returns {Promise<string>} Storage path of the uploaded proof (private bucket; sign it to view)
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

    const fileError = validatePaymentProofFile(file);
    if (fileError) {
      throw createValidationError({ file: fileError }, 'Invalid payment proof file');
    }

    const fileExt = PAYMENT_PROOF_MIME_EXT[file.type];
    const filePath = `payment-proofs/payment-proof-${orderId}-${Date.now()}.${fileExt}`;

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

    const order = await callTransitionRpc(
      'order_submit_proof',
      {
        p_order_id: orderId,
        p_proof_path: filePath,
        p_reference: paymentReference?.trim() || null,
        p_payer_phone: normalizePayerPhone(payerPhone)
      },
      orderTarget(orderId)
    );

    const userEmail = await getUserEmail(userId);
    logOrderActivity({
      action: 'payment_proof_uploaded',
      entityId: orderId,
      performedBy: userEmail,
      description: `Comprobante subido - Orden ${order?.order_number || orderId}`,
      metadata: buildOrderPaymentMetadata(order, { orderId, orderNumber: order?.order_number, paymentProofUrl: filePath })
    });

    return filePath;
  } catch (error) {
    return rethrowAsAppError(error, 'uploadPaymentProof', { orderId });
  }
};

/**
 * Start processing an order (order_start_processing: pending + payment validated -> processing).
 * Legacy path: validatePayment already leaves the order in processing.
 * @param {string} orderId - Order ID
 * @param {string} adminId - Admin user ID
 * @throws {AppError} If validation fails, the order already moved (CONFLICT) or the RPC fails
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

    return await callTransitionRpc('order_start_processing', { p_order_id: orderId }, orderTarget(orderId));
  } catch (error) {
    return rethrowAsAppError(error, 'startProcessingOrder', { orderId });
  }
};

/**
 * Mark order as dispatched (order_dispatch: processing -> dispatched). The tracking is APPENDED to the existing
 * notes by the database.
 * @param {string} orderId - Order ID
 * @param {string} adminId - Admin user ID
 * @param {string} trackingInfo - Optional tracking information
 * @throws {AppError} If validation fails, the order already moved (CONFLICT) or the RPC fails
 * @returns {Promise<Object>} Updated order in dispatched state
 */
export const markOrderAsDispatched = async (orderId, adminId, trackingInfo = '') => {
  try {
    if (!orderId || !adminId) {
      throw createValidationError({
        orderId: !orderId ? 'Order ID is required' : undefined,
        adminId: !adminId ? 'Admin ID is required' : undefined
      });
    }

    const updatedOrder = await callTransitionRpc(
      'order_dispatch',
      { p_order_id: orderId, p_tracking: trackingInfo || null },
      orderTarget(orderId)
    );

    const adminEmail = await getUserEmail(adminId);
    logOrderActivity({
      action: 'order_dispatched',
      entityId: orderId,
      performedBy: adminEmail,
      description: `Orden ${updatedOrder?.order_number} marcada como despachada`,
      metadata: { trackingInfo, orderNumber: updatedOrder?.order_number }
    });

    return updatedOrder;
  } catch (error) {
    return rethrowAsAppError(error, 'markOrderAsDispatched', { orderId });
  }
};

// Backward compatibility alias
export const markOrderAsShipped = markOrderAsDispatched;

/**
 * Mark order as delivered (order_mark_delivered: dispatched -> delivered). The delivery photo is OPTIONAL.
 * With a photo it goes to the private order-delivery-proofs bucket first (path {user_id}/{order_id}/..., required by RLS);
 * without one the RPC receives an explicit null proof path and stores no delivery_proof_url.
 * @param {string} orderId - Order ID
 * @param {File|null} proofFile - Optional delivery proof image file
 * @param {string} adminId - Admin user ID
 * @throws {AppError} If validation fails, the upload fails, the order already moved (CONFLICT) or the RPC fails
 * @returns {Promise<Object>} Updated order in delivered state
 */
export const markOrderAsDelivered = async (orderId, proofFile = null, adminId) => {
  try {
    if (!orderId || !adminId) {
      throw createValidationError({
        orderId: !orderId ? 'Order ID is required' : undefined,
        adminId: !adminId ? 'Admin ID is required' : undefined
      }, 'Missing required fields for delivery confirmation');
    }

    let fileName = null; // null = deliver without a photo (the RPC stores no delivery_proof_url)
    if (proofFile) {
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || !user?.id) {
        const appError = parseSupabaseError(authError) || new Error('User not authenticated');
        logError(appError, { operation: 'markOrderAsDelivered - getUser', orderId });
        throw appError;
      }

      fileName = `${user.id}/${orderId}/delivery-proof-${Date.now()}.jpg`;
      const { error: uploadError } = await supabase.storage
        .from('order-delivery-proofs')
        .upload(fileName, proofFile, {
          cacheControl: '3600',
          upsert: false
        });

      if (uploadError) {
        const appError = parseSupabaseError(uploadError);
        logError(appError, { operation: 'markOrderAsDelivered - upload', fileName });
        throw Object.assign(appError, { stage: 'upload' }); // lets the dialog offer "retry / confirm without photo"
      }
    }

    // Store the file path (NOT a public URL): signed URLs are generated when displaying.
    const updatedOrder = await callTransitionRpc(
      'order_mark_delivered',
      { p_order_id: orderId, p_proof_path: fileName },
      orderTarget(orderId)
    );

    const adminEmail = await getUserEmail(adminId);
    logOrderActivity({
      action: 'order_delivered',
      entityId: orderId,
      performedBy: adminEmail,
      description: `${fileName ? 'Entregada con evidencia' : 'Entregada sin evidencia'} - Orden ${updatedOrder?.order_number || orderId}`,
      metadata: { orderId, orderNumber: updatedOrder?.order_number, ...(fileName ? { deliveryProofPath: fileName } : {}) }
    });

    return updatedOrder;
  } catch (error) {
    return rethrowAsAppError(error, 'markOrderAsDelivered', { orderId });
  }
};

/**
 * Complete an order (order_complete: delivered -> completed). Final state; the notes are APPENDED by the database.
 * @param {string} orderId - Order ID
 * @param {string} notes - Optional completion notes
 * @throws {AppError} If validation fails, the order already moved (CONFLICT) or the RPC fails
 * @returns {Promise<Object>} Updated order in completed state
 */
export const completeOrder = async (orderId, notes = '') => {
  try {
    if (!orderId) {
      throw createValidationError({ orderId: 'Order ID is required' });
    }

    const updatedOrder = await callTransitionRpc(
      'order_complete',
      { p_order_id: orderId, p_notes: notes || null },
      orderTarget(orderId)
    );

    logOrderActivity({
      action: 'order_completed',
      entityId: orderId,
      performedBy: 'system',
      description: `Completada - Orden ${updatedOrder?.order_number || orderId}`,
      metadata: { orderId, orderNumber: updatedOrder?.order_number, notes }
    });

    return updatedOrder;
  } catch (error) {
    return rethrowAsAppError(error, 'completeOrder', { orderId });
  }
};

/**
 * Cancel an order as admin (order_cancel: pending | processing -> cancelled, payment unchanged).
 * The release of the reserved stock happens in the same transaction (trigger release_stock_on_order_cancel); stock
 * already consumed by a validated payment is NOT restocked - that is an explicit inventory decision (restockOrder).
 *
 * @param {string} orderId - Order ID
 * @param {string} adminId - Admin user ID
 * @param {string} reason - Cancellation reason
 * @throws {AppError} If validation fails, the order already moved (CONFLICT) or the RPC fails
 * @returns {Promise<Object>} Updated cancelled order plus `stockConsumed`
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

    const updatedOrder = await callTransitionRpc(
      'order_cancel',
      { p_order_id: orderId, p_reason: reason },
      orderTarget(orderId)
    );

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
    return rethrowAsAppError(error, 'cancelOrder', { orderId });
  }
};

/**
 * Allow the order owner to cancel while pending (order_cancel, owner branch: payment becomes rejected).
 */
export const cancelOrderByUser = async (orderId, userId, reason = 'cancelled_by_user') => {
  try {
    if (!orderId || !userId) {
      throw createValidationError({ orderId: !orderId ? 'Order ID is required' : undefined, userId: !userId ? 'User ID is required' : undefined });
    }

    const updatedOrder = await callTransitionRpc(
      'order_cancel',
      { p_order_id: orderId, p_reason: reason },
      orderTarget(orderId)
    );

    const userEmail = await getUserEmail(userId);
    logOrderActivity({
      action: 'order_cancelled',
      entityId: orderId,
      performedBy: userEmail,
      description: `Usuario canceló orden ${updatedOrder?.order_number}`,
      metadata: { reason }
    });

    return updatedOrder;
  } catch (error) {
    return rethrowAsAppError(error, 'cancelOrderByUser', { orderId });
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
 * Reopen a cancelled order (owner only, order_reopen: cancelled -> pending/pending).
 * The RPC re-reserves the stock in the same transaction; when it is no longer available the whole reopen is refused
 * with INSUFFICIENT_STOCK and the order stays cancelled. Reopening on behalf of a customer is not supported (ND-3).
 * @param {string} orderId - Order ID to reopen
 * @param {string} userId - User ID performing the action (activity log; ownership is checked by the RPC)
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

    const updatedOrder = await callTransitionRpc('order_reopen', { p_order_id: orderId }, orderTarget(orderId));

    const userEmail = await getUserEmail(userId);
    logOrderActivity({
      action: 'order_reopened',
      entityId: orderId,
      performedBy: userEmail,
      description: `Usuario reabrió orden ${updatedOrder?.order_number}`,
      metadata: { orderNumber: updatedOrder?.order_number, reason: 'user_request' }
    });

    return updatedOrder;
  } catch (error) {
    return rethrowAsAppError(error, 'reopenOrder', { orderId, userId });
  }
};
