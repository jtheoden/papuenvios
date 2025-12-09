/**
 * Order Management Service
 * Handles order creation, retrieval, updates, and payment validation
 * Uses standardized error handling with AppError class
 */

import { supabase } from './supabase';
import {
  handleError,
  logError,
  createValidationError,
  createNotFoundError,
  parseSupabaseError,
  createPermissionError,
  ERROR_CODES
} from './errorHandler';
import { logActivity } from './activityLogger';
import { getUserCategoryWithDiscount } from './orderDiscountService';
import { ZELLE_STATUS, ZELLE_TRANSACTION_TYPES, upsertZelleTransactionStatus } from './zelleService';

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
 * Generate unique order number
 * Format: ORD-YYYYMMDD-XXXXX (e.g., ORD-20251007-12345)
 * Uses timestamp + random to avoid race conditions, with DB constraint as backup
 * @throws {AppError} If generation fails
 * @returns {Promise<string>} Unique order number
 */
export const generateOrderNumber = async () => {
  try {
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');

    // Use timestamp (last 5 digits) + random (2 digits) for uniqueness
    const timestamp = Date.now().toString().slice(-5);
    const random = Math.floor(Math.random() * 100).toString().padStart(2, '0');
    const uniqueId = `${timestamp}${random}`.slice(0, 5);

    const orderNumber = `ORD-${today}-${uniqueId}`;

    // Verify uniqueness (unlikely collision, but safety check)
    // NOTE: This is a graceful fallback - database constraint on order_number is the primary guard
    const { data } = await supabase
      .from('orders')
      .select('order_number', { count: 'exact', head: true })
      .eq('order_number', orderNumber);

    // If collision (extremely rare), add microseconds
    if (data && data.length > 0) {
      const microseconds = (Date.now() % 1000).toString().padStart(3, '0');
      return `ORD-${today}-${timestamp.slice(-2)}${microseconds}`;
    }

    return orderNumber;
  } catch (error) {
    if (error.code) throw error;
    const appError = handleError(error, ERROR_CODES.INTERNAL_SERVER_ERROR, {
      operation: 'generateOrderNumber'
    });
    throw appError;
  }
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
 * TRANSACTION BOUNDARY (for future DB transaction wrapper support):
 * BEGIN TRANSACTION
 *   1. Insert order record
 *   2. Insert order_items records (all at once)
 *   3. Update inventory reserved_quantity for all products (batch)
 *   4. Insert inventory_movements records (batch logging)
 * COMMIT TRANSACTION
 *
 * If any step fails, rollback all changes.
 * Current implementation: Supabase doesn't support explicit transactions,
 * so we batch operations where possible and fail loudly on errors.
 *
 * @param {Object} orderData - Order information
 * @param {Array} items - Order items (products, combos, remittances)
 * @throws {AppError} If validation fails, creation fails, or inventory reservation fails
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

    // Note: No validation needed for initial order creation
    // Orders always start in PENDING status

    // Generate order number
    const orderNumber = await generateOrderNumber();

    // Prepare order data with initial state
    const order = {
      order_number: orderNumber,
      user_id: orderData.userId,
      order_type: orderData.orderType || 'product',
      status: ORDER_STATUS.PENDING,
      subtotal: orderData.subtotal || 0,
      discount_amount: orderData.discountAmount || 0,
      shipping_cost: orderData.shippingCost || 0,
      tax_amount: orderData.taxAmount || 0,
      total_amount: orderData.totalAmount,
      currency_id: orderData.currencyId,
      shipping_address: orderData.shippingAddress || null,
      recipient_info: orderData.recipientInfo || null,
      delivery_instructions: orderData.deliveryInstructions || '',
      payment_method: orderData.paymentMethod || 'zelle',
      payment_status: PAYMENT_STATUS.PENDING,
      payment_reference: orderData.paymentReference || '',
      payment_proof_url: orderData.paymentProofUrl || null,
      shipping_zone_id: orderData.shippingZoneId || null,
      zelle_account_id: orderData.zelleAccountId || null,
      notes: orderData.notes || '',
      offer_id: orderData.offerId || null
    };

    // ATOMIC: Insert order
    const { data: createdOrder, error: orderError } = await supabase
      .from('orders')
      .insert(order)
      .select()
      .single();

    if (orderError) {
      const appError = parseSupabaseError(orderError);
      logError(appError, { operation: 'createOrder - insert order', orderNumber });
      throw appError;
    }

    // ATOMIC: Prepare and insert order items
    const orderItems = items.map(item => ({
      order_id: createdOrder.id,
      item_type: item.itemType,
      item_id: item.itemId,
      item_name_es: item.nameEs,
      item_name_en: item.nameEn,
      quantity: item.quantity,
      unit_price: item.unitPrice,
      total_price: item.totalPrice,
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

    // ATOMIC: Reserve inventory for all products in parallel (not sequential)
    // This reduces N queries from O(n) sequential to single batch operation
    const inventoryReservations = items
      .filter(item => item.itemType === 'product' && item.inventoryId)
      .map(item => ({ id: item.inventoryId, quantity: item.quantity }));

    if (inventoryReservations.length > 0) {
      // Batch fetch all inventory records
      const inventoryIds = inventoryReservations.map(r => r.id);
      const { data: inventoryRecords, error: fetchError } = await supabase
        .from('inventory')
        .select('id, reserved_quantity')
        .in('id', inventoryIds);

      if (fetchError) {
        const appError = parseSupabaseError(fetchError);
        logError(appError, { operation: 'createOrder - fetch inventory', orderId: createdOrder.id });
        throw appError;
      }

      // Build update operations for all inventory records
      const inventoryMap = new Map(inventoryRecords.map(inv => [inv.id, inv]));
      const updatePromises = inventoryReservations.map(async (res) => {
        const current = inventoryMap.get(res.id);
        if (current) {
          const newReserved = (current.reserved_quantity || 0) + res.quantity;
          return supabase
            .from('inventory')
            .update({ reserved_quantity: newReserved })
            .eq('id', res.id);
        }
      });

      const updateResults = await Promise.all(updatePromises);
      const hasError = updateResults.some(result => result.error);
      if (hasError) {
        const errorResult = updateResults.find(result => result.error);
        const appError = parseSupabaseError(errorResult.error);
        logError(appError, { operation: 'createOrder - update inventory', orderId: createdOrder.id });
        throw appError;
      }

      // Log all inventory movements in single insert
      const movements = inventoryReservations.map(res => ({
        inventory_id: res.id,
        movement_type: 'reserved',
        quantity_change: -res.quantity,
        reference_type: 'order',
        reference_id: createdOrder.id,
        notes: `Reserved for order ${orderNumber}`
      }));

      const { error: movementError } = await supabase
        .from('inventory_movements')
        .insert(movements);

      if (movementError) {
        const appError = parseSupabaseError(movementError);
        logError(appError, { operation: 'createOrder - log inventory movements', orderId: createdOrder.id });
        // Don't fail order creation if logging fails
      }
    }

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
// INVENTORY MANAGEMENT (PRIVATE HELPERS)
// ============================================================================

/**
 * Reserve inventory for order
 * @param {string} inventoryId - Inventory record ID
 * @param {number} quantity - Quantity to reserve
 * @throws {AppError} If fetch or update fails
 */
const reserveInventory = async (inventoryId, quantity) => {
  try {
    if (!inventoryId || quantity <= 0) {
      throw createValidationError({
        inventoryId: !inventoryId ? 'Inventory ID is required' : undefined,
        quantity: quantity <= 0 ? 'Quantity must be greater than 0' : undefined
      });
    }

    // Get current inventory
    const { data: inventory, error: fetchError } = await supabase
      .from('inventory')
      .select('reserved_quantity')
      .eq('id', inventoryId)
      .single();

    if (fetchError) {
      const appError = parseSupabaseError(fetchError);
      logError(appError, { operation: 'reserveInventory - fetch', inventoryId });
      throw appError;
    }

    if (!inventory) {
      throw createNotFoundError('Inventory', inventoryId);
    }

    // Update reserved quantity
    const newReserved = (inventory.reserved_quantity || 0) + quantity;

    const { error: updateError } = await supabase
      .from('inventory')
      .update({ reserved_quantity: newReserved })
      .eq('id', inventoryId);

    if (updateError) {
      const appError = parseSupabaseError(updateError);
      logError(appError, { operation: 'reserveInventory - update', inventoryId });
      throw appError;
    }

    // Log inventory movement (graceful fallback if fails)
    try {
      await supabase
        .from('inventory_movements')
        .insert({
          inventory_id: inventoryId,
          movement_type: 'reserved',
          quantity_change: -quantity,
          reference_type: 'order',
          notes: 'Reserved for order'
        });
    } catch (logError) {
      logError(logError, { operation: 'reserveInventory - log movement', inventoryId });
    }
  } catch (error) {
    if (error.code) throw error;
    const appError = handleError(error, ERROR_CODES.INTERNAL_SERVER_ERROR, {
      operation: 'reserveInventory',
      inventoryId
    });
    throw appError;
  }
};

/**
 * Release reserved inventory (when order is rejected/cancelled)
 * @param {string} inventoryId - Inventory record ID
 * @param {number} quantity - Quantity to release
 * @throws {AppError} If fetch or update fails
 */
const releaseInventory = async (inventoryId, quantity) => {
  try {
    if (!inventoryId || quantity <= 0) {
      throw createValidationError({
        inventoryId: !inventoryId ? 'Inventory ID is required' : undefined,
        quantity: quantity <= 0 ? 'Quantity must be greater than 0' : undefined
      });
    }

    // Get current inventory
    const { data: inventory, error: fetchError } = await supabase
      .from('inventory')
      .select('reserved_quantity')
      .eq('id', inventoryId)
      .single();

    if (fetchError) {
      const appError = parseSupabaseError(fetchError);
      logError(appError, { operation: 'releaseInventory - fetch', inventoryId });
      throw appError;
    }

    if (!inventory) {
      throw createNotFoundError('Inventory', inventoryId);
    }

    // Update reserved quantity (ensure non-negative)
    const newReserved = Math.max(0, (inventory.reserved_quantity || 0) - quantity);

    const { error: updateError } = await supabase
      .from('inventory')
      .update({ reserved_quantity: newReserved })
      .eq('id', inventoryId);

    if (updateError) {
      const appError = parseSupabaseError(updateError);
      logError(appError, { operation: 'releaseInventory - update', inventoryId });
      throw appError;
    }

    // Log inventory movement (graceful fallback if fails)
    try {
      await supabase
        .from('inventory_movements')
        .insert({
          inventory_id: inventoryId,
          movement_type: 'released',
          quantity_change: quantity,
          reference_type: 'order',
          notes: 'Released from rejected/cancelled order'
        });
    } catch (movementError) {
      logError(movementError, { operation: 'releaseInventory - log movement', inventoryId });
    }
  } catch (error) {
    if (error.code) throw error;
    const appError = handleError(error, ERROR_CODES.INTERNAL_SERVER_ERROR, {
      operation: 'releaseInventory',
      inventoryId
    });
    throw appError;
  }
};

/**
 * Reduce inventory quantity (when payment is validated)
 * @param {string} inventoryId - Inventory record ID
 * @param {number} quantity - Quantity to reduce
 * @throws {AppError} If fetch, validation, or update fails
 */
const reduceInventory = async (inventoryId, quantity) => {
  try {
    if (!inventoryId || quantity <= 0) {
      throw createValidationError({
        inventoryId: !inventoryId ? 'Inventory ID is required' : undefined,
        quantity: quantity <= 0 ? 'Quantity must be greater than 0' : undefined
      });
    }

    // Get current inventory
    const { data: inventory, error: fetchError } = await supabase
      .from('inventory')
      .select('quantity, reserved_quantity, available_quantity')
      .eq('id', inventoryId)
      .single();

    if (fetchError) {
      const appError = parseSupabaseError(fetchError);
      logError(appError, { operation: 'reduceInventory - fetch', inventoryId });
      throw appError;
    }

    if (!inventory) {
      throw createNotFoundError('Inventory', inventoryId);
    }

    const availableStock =
      inventory.available_quantity ??
      (inventory.quantity ?? 0) - (inventory.reserved_quantity ?? 0);

    // Validate sufficient stock
    if (availableStock < quantity) {
      throw createValidationError(
        { quantity: `Insufficient stock. Available: ${availableStock}, Requested: ${quantity}` },
        ERROR_CODES.INSUFFICIENT_STOCK
      );
    }

    // Reduce both actual and reserved quantities
    const newQuantity = (inventory.quantity ?? availableStock) - quantity;
    const newReserved = Math.max(0, (inventory.reserved_quantity || 0) - quantity);

    const { error: updateError } = await supabase
      .from('inventory')
      .update({
        quantity: newQuantity,
        reserved_quantity: newReserved,
        updated_at: new Date().toISOString()
      })
      .eq('id', inventoryId);

    if (updateError) {
      const appError = parseSupabaseError(updateError);
      logError(appError, { operation: 'reduceInventory - update', inventoryId });
      throw appError;
    }

    // Log inventory movement (graceful fallback if fails)
    try {
      await supabase
        .from('inventory_movements')
        .insert({
          inventory_id: inventoryId,
          movement_type: 'sold',
          quantity_change: -quantity,
          reference_type: 'order',
          notes: 'Sold - payment validated'
        });
    } catch (movementError) {
      logError(movementError, { operation: 'reduceInventory - log movement', inventoryId });
    }
  } catch (error) {
    if (error.code) throw error;
    const appError = handleError(error, ERROR_CODES.INTERNAL_SERVER_ERROR, {
      operation: 'reduceInventory',
      inventoryId
    });
    throw appError;
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
        shipping_zones (province_name, shipping_cost)
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
        shipping_zones (province_name, shipping_cost)
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
        shipping_zones (province_name, shipping_cost)
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
        return orders.map(order => ({
          ...order,
          user_profiles: profileMap.get(order.user_id) || { user_id: order.user_id, full_name: null, email: null }
        }));
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
 * Validate payment and update order with inventory reduction
 * CRITICAL: Requires payment_status === 'proof_uploaded' and order.status === 'pending'
 * Handles both direct products and combo items by batching product lookups
 *
 * TRANSACTION BOUNDARY (for future DB transaction wrapper support):
 * BEGIN TRANSACTION
 *   1. Fetch order and validate state (status === pending, payment_status === proof_uploaded)
 *   2. Batch fetch all combo_items for combo order items (N+1 optimization)
 *   3. Batch fetch all products for combo items (N+1 optimization)
 *   4. Calculate all inventory reductions (direct products + combo product quantities)
 *   5. Execute all inventory reductions in parallel (Promise.all)
 *   6. Update order status to PROCESSING and payment_status to VALIDATED
 *   7. Log order status history (graceful fallback if fails)
 * COMMIT TRANSACTION
 *
 * If any critical step (1-6) fails, rollback all inventory changes.
 * Logging failure (step 7) doesn't rollback - logging is non-critical.
 *
 * @param {string} orderId - Order ID
 * @param {string} adminId - Admin user ID
 * @throws {AppError} If validation fails, state invalid, or inventory operations fail
 * @returns {Promise<Object>} Updated order with reduced inventory
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
    validateOrderTransition(order.status, ORDER_STATUS.PROCESSING);
    validatePaymentTransition(order.payment_status, PAYMENT_STATUS.VALIDATED);

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

    // Get admin email for logging
    const adminEmail = await getUserEmail(adminId);
    const activityResult = await logOrderActivity({
      action: 'payment_validated',
      entityId: orderId,
      performedBy: adminEmail,
      description: `Pago validado y orden movida a procesamiento`,
      metadata: buildOrderPaymentMetadata(updatedOrder, {
        validatedBy: adminEmail,
        validatedAt: updatedOrder?.validated_at
      })
    });

    // OPTIMIZE: Fix N³ problem - batch fetch all combo items and products at once
    // instead of nested loops within order items
    const comboItemIds = order.order_items
      .filter(item => item.item_type === 'combo')
      .map(item => item.item_id);

    let comboItemsMap = new Map();
    let productsMap = new Map();

    if (comboItemIds.length > 0) {
      // Batch fetch all combo items
      const { data: comboItems, error: comboError } = await supabase
        .from('combo_items')
        .select('combo_id, product_id, quantity')
        .in('combo_id', comboItemIds);

      if (comboError) {
        const appError = parseSupabaseError(comboError);
        logError(appError, { operation: 'validatePayment - fetch combos', orderId });
        throw appError;
      }

      // Build map of combo_id => combo_items for efficient lookup
      if (comboItems) {
        comboItems.forEach(item => {
          if (!comboItemsMap.has(item.combo_id)) {
            comboItemsMap.set(item.combo_id, []);
          }
          comboItemsMap.get(item.combo_id).push(item);
        });

        // Batch fetch inventory records for all products referenced by combo items
        const productIds = [...new Set(comboItems.map(item => item.product_id))];
        if (productIds.length > 0) {
          const { data: inventories, error: inventoriesError } = await supabase
            .from('inventory')
            .select('id, product_id')
            .in('product_id', productIds);

          if (inventoriesError) {
            const appError = parseSupabaseError(inventoriesError);
            logError(appError, { operation: 'validatePayment - fetch inventory', orderId });
            throw appError;
          }

          // Build map of product_id => inventory for efficient lookup
          if (inventories) {
            inventories.forEach(inventory => {
              productsMap.set(inventory.product_id, { inventory_id: inventory.id });
            });
          }
        }
      }
    }

    // ATOMIC: Reduce inventory for all items
    // Collect all inventory reduction operations
    const inventoryReductions = [];

    for (const item of order.order_items) {
      if (item.item_type === 'product' && item.inventory_id) {
        // Direct product
        inventoryReductions.push({ inventoryId: item.inventory_id, quantity: item.quantity });
      } else if (item.item_type === 'combo' && item.item_id) {
        // Combo - get items from batched data
        const comboItems = comboItemsMap.get(item.item_id) || [];
        for (const comboItem of comboItems) {
          const product = productsMap.get(comboItem.product_id);
          if (product?.inventory_id) {
            // Reduce inventory: combo quantity * item quantity in combo
            inventoryReductions.push({
              inventoryId: product.inventory_id,
              quantity: item.quantity * comboItem.quantity
            });
          }
        }
      }
    }

    // Execute all inventory reductions in parallel
    if (inventoryReductions.length > 0) {
      const reductionPromises = inventoryReductions.map(reduction =>
        reduceInventory(reduction.inventoryId, reduction.quantity)
      );
      await Promise.all(reductionPromises);
    }

    // Log status change (graceful fallback if fails)
    try {
      await supabase
        .from('order_status_history')
        .insert({
          order_id: orderId,
          previous_status: order.status,
          new_status: ORDER_STATUS.PROCESSING,
          changed_by: adminId,
          notes: 'Payment validated by admin'
        });
    } catch (historyError) {
      logError(historyError, { operation: 'validatePayment - log history', orderId });
    }

    // Sync Zelle transaction history for observabilidad (graceful fallback)
    if (order.zelle_account_id && activityResult?.status === 'inserted') {
      try {
        await upsertZelleTransactionStatus({
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
        logError(zelleError, { operation: 'validatePayment - zelle sync', orderId });
      }
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
 * Reject payment and cancel order
 * CRITICAL: Requires payment_status === 'proof_uploaded'
 * Releases all reserved inventory and logs rejection
 *
 * TRANSACTION BOUNDARY (for future DB transaction wrapper support):
 * BEGIN TRANSACTION
 *   1. Fetch order and validate state (status === pending, payment_status === proof_uploaded)
 *   2. Update order status to CANCELLED and payment_status to REJECTED
 *   3. Release reserved inventory for all product items (parallel Promise.all)
 *   4. Log order status history (graceful fallback if fails)
 * COMMIT TRANSACTION
 *
 * If any critical step (1-3) fails, rollback all inventory changes.
 * Logging failure (step 4) doesn't rollback - logging is non-critical.
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
      await supabase
        .from('order_status_history')
        .insert({
          order_id: orderId,
          previous_status: order.status,
          new_status: ORDER_STATUS.PENDING,
          changed_by: adminId,
          notes: `Payment rejected: ${rejectionReason}`
        });
    } catch (historyError) {
      logError(historyError, { operation: 'rejectPayment - log history', orderId });
    }

    // Get admin email for logging
    const adminEmail = await getUserEmail(adminId);
    const activityResult = await logOrderActivity({
      action: 'payment_rejected',
      entityId: orderId,
      performedBy: adminEmail,
      description: 'Pago rechazado por administrador',
      metadata: buildOrderPaymentMetadata(updatedOrder, {
        rejectionReason,
        validatedBy: adminEmail,
        validatedAt: updatedOrder?.validated_at
      })
    });

    // Sync Zelle transaction history (graceful fallback)
    if (order.zelle_account_id && activityResult?.status === 'inserted') {
      try {
        await upsertZelleTransactionStatus({
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
        logError(zelleError, { operation: 'rejectPayment - zelle sync', orderId });
      }
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
      await supabase
        .from('order_status_history')
        .insert({
          order_id: orderId,
          previous_status: order.status,
          new_status: newStatus,
          changed_by: adminId,
          notes: notes
        });
    } catch (historyError) {
      logError(historyError, { operation: 'updateOrderStatus - log history', orderId });
    }

    // Get admin email for logging
    const adminEmail = await getUserEmail(adminId);
    logOrderActivity({
      action: 'order_status_updated',
      entityId: orderId,
      performedBy: adminEmail,
      description: `Estado de orden cambiado a ${newStatus}`,
      metadata: { previousStatus: order.status, newStatus, notes }
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
 * @throws {AppError} If validation fails, authorization fails, or upload fails
 * @returns {Promise<string>} Public URL of uploaded proof
 */
export const uploadPaymentProof = async (file, orderId, userId) => {
  try {
    if (!file || !orderId || !userId) {
      throw createValidationError({
        file: !file ? 'Proof file is required' : undefined,
        orderId: !orderId ? 'Order ID is required' : undefined,
        userId: !userId ? 'User ID is required' : undefined
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

    // Update order with proof URL and mark as proof uploaded
    const { error: updateError } = await supabase
      .from('orders')
      .update({
        payment_proof_url: urlData.publicUrl,
        payment_status: PAYMENT_STATUS.PROOF_UPLOADED,
        rejection_reason: null,
        updated_at: new Date().toISOString()
      })
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
      description: `Comprobante de pago subido`,
      metadata: buildOrderPaymentMetadata(
        { ...order, payment_status: PAYMENT_STATUS.PROOF_UPLOADED },
        { paymentProofUrl: urlData.publicUrl }
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

    // Get public URL
    const { data: urlData } = supabase.storage
      .from('order-delivery-proofs')
      .getPublicUrl(fileName);

    // Update order status
    const { data: updatedOrder, error: updateError } = await supabase
      .from('orders')
      .update({
        status: ORDER_STATUS.DELIVERED,
        delivered_at: new Date().toISOString(),
        delivery_proof_url: urlData.publicUrl,
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
      description: 'Orden marcada como entregada con evidencia',
      metadata: { deliveryProofUrl: urlData.publicUrl }
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
      description: 'Orden marcada como completada',
      metadata: { notes }
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
 * Releases all reserved inventory
 *
 * TRANSACTION BOUNDARY (for future DB transaction wrapper support):
 * BEGIN TRANSACTION
 *   1. Fetch order with items and validate state (pending or processing)
 *   2. Release reserved inventory for all items (parallel Promise.all)
 *   3. Update order status to CANCELLED
 *   4. Log order status history (graceful fallback if fails)
 * COMMIT TRANSACTION
 *
 * If any critical step (1-3) fails, rollback all inventory changes.
 * Logging failure (step 4) doesn't rollback - logging is non-critical.
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

    // ATOMIC: Release reserved inventory for all items in parallel
    const releasePromises = order.order_items
      .filter(item => item.inventory_id)
      .map(item => releaseInventory(item.inventory_id, item.quantity));

    if (releasePromises.length > 0) {
      await Promise.all(releasePromises);
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

    // Log status change (graceful fallback if fails)
    try {
      await supabase
        .from('order_status_history')
        .insert({
          order_id: orderId,
          previous_status: order.status,
          new_status: ORDER_STATUS.CANCELLED,
          changed_by: adminId,
          notes: `Cancelled: ${reason}`
        });
    } catch (historyError) {
      logError(historyError, { operation: 'cancelOrder - log history', orderId });
    }

    // Get admin email for logging
    const adminEmail = await getUserEmail(adminId);
    logOrderActivity({
      action: 'order_cancelled',
      entityId: orderId,
      performedBy: adminEmail,
      description: `Orden cancelada por administrador (${reason})`,
      metadata: { reason }
    });

    return updatedOrder;
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

    const releasePromises = order.order_items
      .filter(item => item.inventory_id)
      .map(item => releaseInventory(item.inventory_id, item.quantity));

    if (releasePromises.length > 0) {
      await Promise.all(releasePromises);
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

    // Reopen order - reset to pending status
    const { data: updatedOrder, error: updateError } = await supabase
      .from('orders')
      .update({
        status: ORDER_STATUS.PENDING,
        payment_status: PAYMENT_STATUS.PENDING,
        rejection_reason: null,
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

    // Reopen order - reset to pending status
    const { data: updatedOrder, error: updateError } = await supabase
      .from('orders')
      .update({
        status: ORDER_STATUS.PENDING,
        payment_status: PAYMENT_STATUS.PENDING,
        rejection_reason: null,
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
