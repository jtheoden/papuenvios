/**
 * Order Management Service
 * Handles order creation, retrieval, updates, and payment validation
 */

import { supabase } from './supabase';

/**
 * Generate unique order number
 * Format: ORD-YYYYMMDD-XXXXX (e.g., ORD-20251007-12345)
 * Uses timestamp + random to avoid race conditions
 */
export const generateOrderNumber = async () => {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');

  // Use timestamp (last 5 digits) + random (2 digits) for uniqueness
  const timestamp = Date.now().toString().slice(-5);
  const random = Math.floor(Math.random() * 100).toString().padStart(2, '0');
  const uniqueId = `${timestamp}${random}`.slice(0, 5);

  const orderNumber = `ORD-${today}-${uniqueId}`;

  // Verify uniqueness (unlikely collision, but safety check)
  const { data } = await supabase
    .from('orders')
    .select('order_number')
    .eq('order_number', orderNumber)
    .maybeSingle();

  // If collision (extremely rare), add microseconds
  if (data) {
    const microseconds = (Date.now() % 1000).toString().padStart(3, '0');
    return `ORD-${today}-${timestamp.slice(-2)}${microseconds}`;
  }

  return orderNumber;
};

/**
 * Create new order
 * @param {Object} orderData - Order information
 * @param {Array} items - Order items (products, combos, remittances)
 * @returns {Object} Created order with items
 */
export const createOrder = async (orderData, items) => {
  try {
    // Generate order number
    const orderNumber = await generateOrderNumber();

    // Prepare order data
    const order = {
      order_number: orderNumber,
      user_id: orderData.userId,
      order_type: orderData.orderType || 'product', // 'product', 'remittance', 'mixed'
      status: 'pending',
      subtotal: orderData.subtotal,
      discount_amount: orderData.discountAmount || 0,
      shipping_cost: orderData.shippingCost || 0,
      tax_amount: orderData.taxAmount || 0,
      total_amount: orderData.totalAmount,
      currency_id: orderData.currencyId,
      shipping_address: orderData.shippingAddress || null,
      recipient_info: orderData.recipientInfo || null,
      delivery_instructions: orderData.deliveryInstructions || '',
      payment_method: orderData.paymentMethod || 'zelle',
      payment_status: 'pending',
      payment_reference: orderData.paymentReference || '',
      payment_proof_url: orderData.paymentProofUrl || null,
      shipping_zone_id: orderData.shippingZoneId || null,
      zelle_account_id: orderData.zelleAccountId || null,
      notes: orderData.notes || '',
      offer_id: orderData.offerId || null
    };

    // Insert order
    const { data: createdOrder, error: orderError } = await supabase
      .from('orders')
      .insert(order)
      .select()
      .single();

    if (orderError) throw orderError;

    // Prepare order items
    const orderItems = items.map(item => ({
      order_id: createdOrder.id,
      item_type: item.itemType, // 'product', 'combo', 'remittance'
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

    // Insert order items
    const { data: createdItems, error: itemsError } = await supabase
      .from('order_items')
      .insert(orderItems)
      .select();

    if (itemsError) throw itemsError;

    // Reserve inventory for products
    for (const item of items) {
      if (item.itemType === 'product' && item.inventoryId) {
        await reserveInventory(item.inventoryId, item.quantity);
      }
    }

    return {
      success: true,
      order: {
        ...createdOrder,
        items: createdItems
      }
    };
  } catch (error) {
    console.error('Error creating order:', error);
    return {
      success: false,
      error: error.message
    };
  }
};

/**
 * Reserve inventory for order
 * @param {string} inventoryId - Inventory record ID
 * @param {number} quantity - Quantity to reserve
 */
const reserveInventory = async (inventoryId, quantity) => {
  try {
    // Get current inventory
    const { data: inventory, error: fetchError } = await supabase
      .from('inventory')
      .select('reserved_quantity')
      .eq('id', inventoryId)
      .single();

    if (fetchError) throw fetchError;

    // Update reserved quantity
    const newReserved = (inventory.reserved_quantity || 0) + quantity;

    const { error: updateError } = await supabase
      .from('inventory')
      .update({ reserved_quantity: newReserved })
      .eq('id', inventoryId);

    if (updateError) throw updateError;

    // Log inventory movement
    await supabase
      .from('inventory_movements')
      .insert({
        inventory_id: inventoryId,
        movement_type: 'reserved',
        quantity_change: -quantity,
        reference_type: 'order',
        notes: 'Reserved for order'
      });

    return { success: true };
  } catch (error) {
    console.error('Error reserving inventory:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Release reserved inventory (e.g., when order is rejected)
 * @param {string} inventoryId - Inventory record ID
 * @param {number} quantity - Quantity to release
 */
const releaseInventory = async (inventoryId, quantity) => {
  try {
    // Get current inventory
    const { data: inventory, error: fetchError } = await supabase
      .from('inventory')
      .select('reserved_quantity')
      .eq('id', inventoryId)
      .single();

    if (fetchError) throw fetchError;

    // Update reserved quantity
    const newReserved = Math.max(0, (inventory.reserved_quantity || 0) - quantity);

    const { error: updateError } = await supabase
      .from('inventory')
      .update({ reserved_quantity: newReserved })
      .eq('id', inventoryId);

    if (updateError) throw updateError;

    // Log inventory movement
    await supabase
      .from('inventory_movements')
      .insert({
        inventory_id: inventoryId,
        movement_type: 'released',
        quantity_change: quantity,
        reference_type: 'order',
        notes: 'Released from rejected/cancelled order'
      });

    return { success: true };
  } catch (error) {
    console.error('Error releasing inventory:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Reduce inventory quantity (when payment is validated)
 * @param {string} inventoryId - Inventory record ID
 * @param {number} quantity - Quantity to reduce
 */
const reduceInventory = async (inventoryId, quantity) => {
  try {
    // Get current inventory
    const { data: inventory, error: fetchError } = await supabase
      .from('inventory')
      .select('quantity, reserved_quantity')
      .eq('id', inventoryId)
      .single();

    if (fetchError) throw fetchError;

    // Reduce both actual and reserved quantities
    const newQuantity = inventory.quantity - quantity;
    const newReserved = Math.max(0, (inventory.reserved_quantity || 0) - quantity);

    const { error: updateError } = await supabase
      .from('inventory')
      .update({
        quantity: newQuantity,
        reserved_quantity: newReserved
      })
      .eq('id', inventoryId);

    if (updateError) throw updateError;

    // Log inventory movement
    await supabase
      .from('inventory_movements')
      .insert({
        inventory_id: inventoryId,
        movement_type: 'sold',
        quantity_change: -quantity,
        reference_type: 'order',
        notes: 'Sold - payment validated'
      });

    return { success: true };
  } catch (error) {
    console.error('Error reducing inventory:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Get user's orders
 * @param {string} userId - User ID
 * @param {Object} filters - Optional filters (status, payment_status, etc.)
 * @returns {Array} User's orders with items
 */
export const getUserOrders = async (userId, filters = {}) => {
  try {
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

    if (error) throw error;

    return {
      success: true,
      orders: data || []
    };
  } catch (error) {
    console.error('Error fetching user orders:', error);
    return {
      success: false,
      error: error.message,
      orders: []
    };
  }
};

/**
 * Get single order by ID
 * @param {string} orderId - Order ID
 * @returns {Object} Order with full details
 */
export const getOrderById = async (orderId) => {
  try {
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

    if (error) throw error;

    // Fetch user profile
    if (order && order.user_id) {
      const { data: profile, error: profileError } = await supabase
        .from('user_profiles')
        .select('user_id, full_name, email')
        .eq('user_id', order.user_id)
        .single();

      if (!profileError && profile) {
        order.user_profiles = profile;
      }
    }

    return {
      success: true,
      order: order
    };
  } catch (error) {
    console.error('Error fetching order:', error);
    return {
      success: false,
      error: error.message
    };
  }
};

/**
 * Get all orders (admin only)
 * @param {Object} filters - Optional filters
 * @returns {Array} All orders
 */
export const getAllOrders = async (filters = {}) => {
  try {
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

    if (error) throw error;

    // Fetch user profiles for all orders
    if (orders && orders.length > 0) {
      const userIds = [...new Set(orders.map(order => order.user_id))];

      const { data: profiles, error: profilesError } = await supabase
        .from('user_profiles')
        .select('user_id, full_name, email')
        .in('user_id', userIds);

      if (!profilesError && profiles) {
        // Create a map of user_id to profile
        const profileMap = {};
        profiles.forEach(profile => {
          profileMap[profile.user_id] = profile;
        });

        // Attach profiles to orders
        orders.forEach(order => {
          order.user_profiles = profileMap[order.user_id] || null;
        });
      }
    }

    return {
      success: true,
      orders: orders || []
    };
  } catch (error) {
    console.error('Error fetching all orders:', error);
    return {
      success: false,
      error: error.message,
      orders: []
    };
  }
};

/**
 * Get pending orders count (for admin notifications)
 * @returns {number} Count of pending orders
 */
export const getPendingOrdersCount = async () => {
  try {
    const { data, error } = await supabase
      .rpc('get_pending_orders_count');

    if (error) throw error;

    return {
      success: true,
      count: data || 0
    };
  } catch (error) {
    console.error('Error fetching pending orders count:', error);
    return {
      success: false,
      count: 0
    };
  }
};

/**
 * Validate payment and update order
 * @param {string} orderId - Order ID
 * @param {string} adminId - Admin user ID
 * @returns {Object} Updated order
 */
export const validatePayment = async (orderId, adminId) => {
  try {
    // Get order with items
    const { data: order, error: fetchError } = await supabase
      .from('orders')
      .select('*, order_items (*)')
      .eq('id', orderId)
      .single();

    if (fetchError) throw fetchError;

    // Update order status
    const { data: updatedOrder, error: updateError } = await supabase
      .from('orders')
      .update({
        payment_status: 'validated',
        status: 'processing',
        validated_by: adminId,
        validated_at: new Date().toISOString()
      })
      .eq('id', orderId)
      .select()
      .single();

    if (updateError) throw updateError;

    // Reduce inventory for product items and combo items
    for (const item of order.order_items) {
      if (item.item_type === 'product' && item.inventory_id) {
        // Direct product
        await reduceInventory(item.inventory_id, item.quantity);
      } else if (item.item_type === 'combo' && item.item_id) {
        // Get combo items (products within the combo)
        const { data: comboItems } = await supabase
          .from('combo_items')
          .select('product_id, quantity')
          .eq('combo_id', item.item_id);

        if (comboItems) {
          for (const comboItem of comboItems) {
            // Get inventory_id for each product in combo
            const { data: product } = await supabase
              .from('products')
              .select('inventory_id')
              .eq('id', comboItem.product_id)
              .single();

            if (product?.inventory_id) {
              // Reduce inventory: combo quantity * item quantity in combo
              await reduceInventory(product.inventory_id, item.quantity * comboItem.quantity);
            }
          }
        }
      }
    }

    // Log status change
    await supabase
      .from('order_status_history')
      .insert({
        order_id: orderId,
        previous_status: order.status,
        new_status: 'processing',
        changed_by: adminId,
        notes: 'Payment validated by admin'
      });

    return {
      success: true,
      order: updatedOrder
    };
  } catch (error) {
    console.error('Error validating payment:', error);
    return {
      success: false,
      error: error.message
    };
  }
};

/**
 * Reject payment and update order
 * @param {string} orderId - Order ID
 * @param {string} adminId - Admin user ID
 * @param {string} rejectionReason - Reason for rejection
 * @returns {Object} Updated order
 */
export const rejectPayment = async (orderId, adminId, rejectionReason) => {
  try {
    // Get order with items
    const { data: order, error: fetchError } = await supabase
      .from('orders')
      .select('*, order_items (*)')
      .eq('id', orderId)
      .single();

    if (fetchError) throw fetchError;

    // Update order status
    const { data: updatedOrder, error: updateError } = await supabase
      .from('orders')
      .update({
        payment_status: 'rejected',
        status: 'cancelled',
        validated_by: adminId,
        validated_at: new Date().toISOString(),
        rejection_reason: rejectionReason
      })
      .eq('id', orderId)
      .select()
      .single();

    if (updateError) throw updateError;

    // Release reserved inventory for product items
    for (const item of order.order_items) {
      if (item.item_type === 'product' && item.inventory_id) {
        await releaseInventory(item.inventory_id, item.quantity);
      }
    }

    // Log status change
    await supabase
      .from('order_status_history')
      .insert({
        order_id: orderId,
        previous_status: order.status,
        new_status: 'cancelled',
        changed_by: adminId,
        notes: `Payment rejected: ${rejectionReason}`
      });

    return {
      success: true,
      order: updatedOrder
    };
  } catch (error) {
    console.error('Error rejecting payment:', error);
    return {
      success: false,
      error: error.message
    };
  }
};

/**
 * Update order status
 * @param {string} orderId - Order ID
 * @param {string} newStatus - New status
 * @param {string} adminId - Admin user ID
 * @param {string} notes - Optional notes
 * @returns {Object} Updated order
 */
export const updateOrderStatus = async (orderId, newStatus, adminId, notes = '') => {
  try {
    // Get current order
    const { data: order, error: fetchError } = await supabase
      .from('orders')
      .select('status')
      .eq('id', orderId)
      .single();

    if (fetchError) throw fetchError;

    // Update order
    const { data: updatedOrder, error: updateError } = await supabase
      .from('orders')
      .update({ status: newStatus })
      .eq('id', orderId)
      .select()
      .single();

    if (updateError) throw updateError;

    // Log status change
    await supabase
      .from('order_status_history')
      .insert({
        order_id: orderId,
        previous_status: order.status,
        new_status: newStatus,
        changed_by: adminId,
        notes: notes
      });

    return {
      success: true,
      order: updatedOrder
    };
  } catch (error) {
    console.error('Error updating order status:', error);
    return {
      success: false,
      error: error.message
    };
  }
};

/**
 * Upload payment proof screenshot
 * @param {File} file - Image file
 * @param {string} orderId - Order ID
 * @returns {Object} Upload result with URL
 */
export const uploadPaymentProof = async (file, orderId) => {
  try {
    // Handle both File and Blob objects
    let fileExt = 'jpg'; // Default extension
    if (file.name) {
      // File object - has name property
      fileExt = file.name.split('.').pop();
    } else if (file.type) {
      // Blob object - extract extension from MIME type
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
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('order-documents')
      .upload(filePath, file, {
        cacheControl: '3600',
        upsert: false
      });

    if (uploadError) throw uploadError;

    // Get public URL
    const { data: urlData } = supabase.storage
      .from('order-documents')
      .getPublicUrl(filePath);

    // Update order with proof URL
    const { error: updateError } = await supabase
      .from('orders')
      .update({ payment_proof_url: urlData.publicUrl })
      .eq('id', orderId);

    if (updateError) throw updateError;

    return {
      success: true,
      url: urlData.publicUrl
    };
  } catch (error) {
    console.error('Error uploading payment proof:', error);
    return {
      success: false,
      error: error.message
    };
  }
};

/**
 * Start processing an order (Payment Validated → Processing)
 * @param {string} orderId - Order ID
 * @param {string} adminId - Admin user ID
 * @returns {Promise<{success: boolean, order?: Object, error?: string}>}
 */
export const startProcessingOrder = async (orderId, adminId) => {
  try {
    // Verify order exists and payment is validated
    const { data: order, error: fetchError } = await supabase
      .from('orders')
      .select('id, order_number, status, payment_status')
      .eq('id', orderId)
      .single();

    if (fetchError) throw fetchError;

    if (order.payment_status !== 'validated') {
      return {
        success: false,
        error: 'Payment must be validated before processing'
      };
    }

    // Update order status
    const { data: updatedOrder, error: updateError } = await supabase
      .from('orders')
      .update({
        status: 'processing',
        processing_started_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('id', orderId)
      .select()
      .single();

    if (updateError) throw updateError;

    return {
      success: true,
      order: updatedOrder
    };
  } catch (error) {
    console.error('Error starting order processing:', error);
    return {
      success: false,
      error: error.message
    };
  }
};

/**
 * Mark order as shipped (Processing → Shipped)
 * @param {string} orderId - Order ID
 * @param {string} adminId - Admin user ID
 * @param {string} trackingInfo - Optional tracking information
 * @returns {Promise<{success: boolean, order?: Object, error?: string}>}
 */
export const markOrderAsShipped = async (orderId, adminId, trackingInfo = '') => {
  try {
    // Verify order exists and is in processing
    const { data: order, error: fetchError } = await supabase
      .from('orders')
      .select('id, order_number, status')
      .eq('id', orderId)
      .single();

    if (fetchError) throw fetchError;

    if (order.status !== 'processing') {
      return {
        success: false,
        error: 'Order must be in processing status'
      };
    }

    // Update order status
    const updateData = {
      status: 'shipped',
      shipped_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    if (trackingInfo) {
      updateData.notes = order.notes ?
        `${order.notes}\n\nTracking: ${trackingInfo}` :
        `Tracking: ${trackingInfo}`;
    }

    const { data: updatedOrder, error: updateError } = await supabase
      .from('orders')
      .update(updateData)
      .eq('id', orderId)
      .select()
      .single();

    if (updateError) throw updateError;

    return {
      success: true,
      order: updatedOrder
    };
  } catch (error) {
    console.error('Error marking order as shipped:', error);
    return {
      success: false,
      error: error.message
    };
  }
};

/**
 * Mark order as delivered with proof (Shipped → Delivered)
 * @param {string} orderId - Order ID
 * @param {File} proofFile - Delivery proof image file
 * @param {string} adminId - Admin user ID
 * @returns {Promise<{success: boolean, order?: Object, error?: string}>}
 */
export const markOrderAsDelivered = async (orderId, proofFile, adminId) => {
  try {
    // Verify order exists and is shipped
    const { data: order, error: fetchError } = await supabase
      .from('orders')
      .select('id, order_number, status')
      .eq('id', orderId)
      .single();

    if (fetchError) throw fetchError;

    if (order.status !== 'shipped') {
      return {
        success: false,
        error: 'Order must be in shipped status'
      };
    }

    // Upload delivery proof
    const fileName = `delivery-proof-${orderId}-${Date.now()}.jpg`;
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('payment-proofs') // Reusing same bucket
      .upload(fileName, proofFile, {
        cacheControl: '3600',
        upsert: false
      });

    if (uploadError) throw uploadError;

    // Get public URL
    const { data: urlData } = supabase.storage
      .from('payment-proofs')
      .getPublicUrl(fileName);

    // Update order status
    const { data: updatedOrder, error: updateError } = await supabase
      .from('orders')
      .update({
        status: 'delivered',
        delivered_at: new Date().toISOString(),
        delivery_proof_url: urlData.publicUrl,
        updated_at: new Date().toISOString()
      })
      .eq('id', orderId)
      .select()
      .single();

    if (updateError) throw updateError;

    return {
      success: true,
      order: updatedOrder
    };
  } catch (error) {
    console.error('Error marking order as delivered:', error);
    return {
      success: false,
      error: error.message
    };
  }
};

/**
 * Complete an order (Delivered → Completed)
 * Can be called automatically or manually
 * @param {string} orderId - Order ID
 * @returns {Promise<{success: boolean, order?: Object, error?: string}>}
 */
export const completeOrder = async (orderId) => {
  try {
    // Verify order exists and is delivered
    const { data: order, error: fetchError } = await supabase
      .from('orders')
      .select('id, order_number, status')
      .eq('id', orderId)
      .single();

    if (fetchError) throw fetchError;

    if (order.status !== 'delivered') {
      return {
        success: false,
        error: 'Order must be in delivered status'
      };
    }

    // Update order status
    const { data: updatedOrder, error: updateError } = await supabase
      .from('orders')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('id', orderId)
      .select()
      .single();

    if (updateError) throw updateError;

    return {
      success: true,
      order: updatedOrder
    };
  } catch (error) {
    console.error('Error completing order:', error);
    return {
      success: false,
      error: error.message
    };
  }
};

/**
 * Calculate days an order has been in processing
 * @param {Object} order - Order object with processing_started_at
 * @returns {number|null} Number of days or null if not in processing
 */
export const getDaysInProcessing = (order) => {
  if (!order || order.status !== 'processing' || !order.processing_started_at) {
    return null;
  }

  const now = new Date();
  const started = new Date(order.processing_started_at);
  const diffTime = Math.abs(now - started);
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  return diffDays;
};

/**
 * Cancel an order
 * @param {string} orderId - Order ID
 * @param {string} adminId - Admin user ID
 * @param {string} reason - Cancellation reason
 * @returns {Promise<{success: boolean, order?: Object, error?: string}>}
 */
export const cancelOrder = async (orderId, adminId, reason) => {
  try {
    // Get order with items
    const { data: order, error: fetchError } = await supabase
      .from('orders')
      .select('*, order_items(*)')
      .eq('id', orderId)
      .single();

    if (fetchError) throw fetchError;

    // Release reserved inventory
    for (const item of order.order_items) {
      if (item.inventory_id) {
        await releaseInventory(item.inventory_id, item.quantity);
      }
    }

    // Update order status
    const { data: updatedOrder, error: updateError } = await supabase
      .from('orders')
      .update({
        status: 'cancelled',
        rejection_reason: reason,
        updated_at: new Date().toISOString()
      })
      .eq('id', orderId)
      .select()
      .single();

    if (updateError) throw updateError;

    return {
      success: true,
      order: updatedOrder
    };
  } catch (error) {
    console.error('Error cancelling order:', error);
    return {
      success: false,
      error: error.message
    };
  }
};
