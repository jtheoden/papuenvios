/**
 * Product Service
 * Handles all product-related database operations
 * Uses standardized error handling with AppError class
 */

import { supabase } from './supabase';
import { generateSlug, getCurrentTimestamp } from './queryHelpers';
import { DEFAULTS } from './constants';
import {
  AppError,
  handleError,
  logError,
  createValidationError,
  createNotFoundError,
  parseSupabaseError,
  ERROR_CODES
} from './errorHandler';
import { ORDER_STATUS } from './orderService';
import { logActivity } from './activityLogger';

// Estados que BLOQUEAN eliminación de productos/combos
// (órdenes activas que aún no han sido despachadas)
const BLOCKING_ORDER_STATUSES = [
  ORDER_STATUS.PENDING,
  ORDER_STATUS.PROCESSING
];

// Estados que PERMITEN eliminación (órdenes ya procesadas o canceladas)
const SAFE_DELETE_ORDER_STATUSES = [
  ORDER_STATUS.DISPATCHED,
  ORDER_STATUS.DELIVERED,
  ORDER_STATUS.COMPLETED,
  ORDER_STATUS.CANCELLED
];

// Legacy: Para toggle de estado activo
const IN_PROGRESS_ORDER_STATUSES = [
  ORDER_STATUS.PENDING,
  ORDER_STATUS.PROCESSING,
  ORDER_STATUS.DISPATCHED,
  ORDER_STATUS.DELIVERED
];

/**
 * Get all active products with their categories
 * @throws {AppError} If database query fails
 * @returns {Promise<Array>} Array of products with inventory data
 */
export const getProducts = async (includeInactive = false) => {
  try {
    let query = supabase
      .from('products')
      .select(`
        *,
        category:product_categories(id, name_es, name_en, slug)
      `)
      .order('created_at', { ascending: false });

    if (!includeInactive) {
      query = query.eq('is_active', true);
    }

    const { data, error } = await query;

    if (error) {
      const appError = parseSupabaseError(error);
      logError(appError, { operation: 'getProducts' });
      throw appError;
    }

    // Get inventory data for all products
    const productIds = (data || []).map(p => p.id);
    if (productIds.length === 0) {
      return [];
    }

    const { data: inventoryData, error: invError } = await supabase
      .from('inventory')
      .select('product_id, quantity, available_quantity, expiry_date')
      .in('product_id', productIds)
      .eq('is_active', true)
      .order('created_at', { ascending: false });

    if (invError) {
      const appError = parseSupabaseError(invError);
      logError(appError, { operation: 'getProducts - inventory fetch', productCount: productIds.length });
      // Don't fail, just continue without inventory data
    }

    // Create inventory map with stock and expiry_date
    const inventoryMap = {};
    const expiryDateMap = {};
    (inventoryData || []).forEach(inv => {
      if (!inventoryMap[inv.product_id]) {
        inventoryMap[inv.product_id] = 0;
      }
      inventoryMap[inv.product_id] += inv.available_quantity || 0;

      // Keep the most recent expiry_date (first one due to order by created_at desc)
      if (!expiryDateMap[inv.product_id] && inv.expiry_date) {
        expiryDateMap[inv.product_id] = inv.expiry_date;
      }
    });

    // Add stock and expiry_date from inventory
    const transformedData = (data || []).map(product => ({
      ...product,
      stock: inventoryMap[product.id] || 0,
      expiry_date: expiryDateMap[product.id] || null
    }));

    return transformedData;
  } catch (error) {
    if (error.code) throw error; // Already an AppError
    const appError = handleError(error, ERROR_CODES.DB_ERROR, { operation: 'getProducts' });
    throw appError;
  }
};

/**
 * Find in-progress orders that include a specific product directly or through combos
 * @param {string} productId - Product ID
 * @returns {Promise<{directOrders: Array, comboOrders: Array}>}
 */
const findInProgressOrdersForProduct = async (productId) => {
  const statusFilter = IN_PROGRESS_ORDER_STATUSES;

  const { data: directOrders, error: directOrdersError } = await supabase
    .from('order_items')
    .select('order_id, item_id, item_type, orders!inner(order_number, status)')
    .eq('item_type', 'product')
    .eq('item_id', productId)
    .in('orders.status', statusFilter);

  if (directOrdersError) {
    const appError = parseSupabaseError(directOrdersError);
    logError(appError, { operation: 'findInProgressOrdersForProduct - direct', productId });
    throw appError;
  }

  const { data: comboItems, error: comboItemsError } = await supabase
    .from('combo_items')
    .select('combo_id')
    .eq('product_id', productId);

  if (comboItemsError) {
    const appError = parseSupabaseError(comboItemsError);
    logError(appError, { operation: 'findInProgressOrdersForProduct - comboItems', productId });
    throw appError;
  }

  const comboIds = (comboItems || []).map(item => item.combo_id);
  let comboOrders = [];

  if (comboIds.length > 0) {
    const { data: comboOrdersData, error: comboOrdersError } = await supabase
      .from('order_items')
      .select('order_id, item_id, item_type, orders!inner(order_number, status)')
      .eq('item_type', 'combo')
      .in('item_id', comboIds)
      .in('orders.status', statusFilter);

    if (comboOrdersError) {
      const appError = parseSupabaseError(comboOrdersError);
      logError(appError, { operation: 'findInProgressOrdersForProduct - comboOrders', productId, comboCount: comboIds.length });
      throw appError;
    }

    comboOrders = comboOrdersData || [];
  }

  return {
    directOrders: directOrders || [],
    comboOrders
  };
};

/**
 * Toggle product active state with validation against in-progress orders
 * @param {string} productId - Product ID
 * @param {boolean} isActive - Desired active state
 * @returns {Promise<Object>} Updated product
 */
export const setProductActiveState = async (productId, isActive) => {
  try {
    if (!productId) {
      throw createValidationError({ productId: 'Product ID is required' });
    }

    if (!isActive) {
      const { directOrders, comboOrders } = await findInProgressOrdersForProduct(productId);
      const hasBlockingOrders = (directOrders?.length || 0) > 0 || (comboOrders?.length || 0) > 0;

      if (hasBlockingOrders) {
        throw new AppError(
          'Cannot deactivate product with in-progress orders',
          ERROR_CODES.CONFLICT,
          409,
          {
            directOrders,
            comboOrders
          }
        );
      }
    }

    const { data, error } = await supabase
      .from('products')
      .update({
        is_active: isActive,
        updated_at: getCurrentTimestamp()
      })
      .eq('id', productId)
      .select()
      .single();

    if (error) {
      const appError = parseSupabaseError(error);
      logError(appError, { operation: 'setProductActiveState', productId, isActive });
      throw appError;
    }

    return data;
  } catch (error) {
    if (error.code) throw error;
    const appError = new AppError(
      error?.message || 'Failed to update product active state',
      ERROR_CODES.DB_ERROR,
      500,
      { operation: 'setProductActiveState', productId, isActive }
    );
    logError(appError, appError.context);
    throw appError;
  }
};

/**
 * Create a new product with optional initial inventory
 * @param {Object} productData - Product creation data
 * @throws {AppError} If validation fails or database operation fails
 * @returns {Promise<Object>} Created product with inventory
 */
export const createProduct = async (productData) => {
  try {
    // Validate required fields
    if (!productData.name_es) {
      throw createValidationError(
        { name_es: 'Product name in Spanish is required' },
        'Missing required product fields'
      );
    }

    if (!productData.basePrice || isNaN(parseFloat(productData.basePrice))) {
      throw createValidationError(
        { basePrice: 'Valid base price is required' },
        'Invalid product price'
      );
    }

    if (!productData.category_id) {
      throw createValidationError(
        { category_id: 'Category selection is required' },
        'Missing product category'
      );
    }

    logError(
      { message: 'Creating product' },
      { operation: 'createProduct', productName: productData.name_es }
    );

    const { data, error } = await supabase
      .from('products')
      .insert([{
        sku: productData.sku || `SKU-${Date.now()}`,
        name_es: productData.name_es,
        name_en: productData.name_en || productData.name_es,
        description_es: productData.description_es || '',
        description_en: productData.description_en || '',
        category_id: productData.category_id,
        base_price: parseFloat(productData.basePrice),
        base_currency_id: productData.base_currency_id,
        profit_margin: parseFloat(productData.profitMargin || DEFAULTS.PRODUCT_PROFIT_MARGIN),
        min_stock_alert: productData.min_stock_alert ? parseInt(productData.min_stock_alert) : DEFAULTS.MIN_STOCK_ALERT,
        image_url: productData.image || null,
        image_file: productData.image || null,
        is_active: true
      }])
      .select()
      .single();

    if (error) {
      const appError = parseSupabaseError(error);
      logError(appError, { operation: 'createProduct - insert', productName: productData.name_es });
      throw appError;
    }

    // Create initial inventory record if stock is provided
    if (productData.stock && parseInt(productData.stock) > 0) {
      const inventoryData = {
        product_id: data.id,
        quantity: parseInt(productData.stock),
        batch_number: `BATCH-${Date.now()}`,
        is_active: true
      };

      if (productData.expiryDate) {
        inventoryData.expiry_date = productData.expiryDate;
      }

      const { error: invError } = await supabase
        .from('inventory')
        .insert([inventoryData]);

      if (invError) {
        // Log but don't fail - product was created successfully
        const appError = parseSupabaseError(invError);
        logError(appError, {
          operation: 'createProduct - inventory',
          productId: data.id,
          requestedStock: productData.stock
        });
      }
    }

    return data;
  } catch (error) {
    if (error.code) throw error; // Already an AppError
    const appError = handleError(error, ERROR_CODES.DB_ERROR, { operation: 'createProduct' });
    throw appError;
  }
};

/**
 * Update an existing product and optionally its inventory
 * @param {string} productId - Product ID
 * @param {Object} productData - Updated product data
 * @throws {AppError} If product not found or update fails
 * @returns {Promise<Object>} Updated product
 */
export const updateProduct = async (productId, productData) => {
  try {
    if (!productId) {
      throw createValidationError({ productId: 'Product ID is required' });
    }

    const updateData = {
      name_es: productData.name_es,
      name_en: productData.name_en || productData.name_es,
      description_es: productData.description_es || '',
      description_en: productData.description_en || '',
      category_id: productData.category_id,
      base_price: parseFloat(productData.basePrice),
      base_currency_id: productData.base_currency_id,
      profit_margin: parseFloat(productData.profitMargin || DEFAULTS.PRODUCT_PROFIT_MARGIN),
      min_stock_alert: productData.min_stock_alert !== undefined ? parseInt(productData.min_stock_alert) : DEFAULTS.MIN_STOCK_ALERT,
      updated_at: getCurrentTimestamp()
    };

    if (productData.image) {
      updateData.image_url = productData.image;
      updateData.image_file = productData.image;
    }

    const { data, error } = await supabase
      .from('products')
      .update(updateData)
      .eq('id', productId)
      .select()
      .single();

    if (error) {
      const appError = parseSupabaseError(error);
      if (!data) {
        throw createNotFoundError('Product', productId);
      }
      logError(appError, { operation: 'updateProduct', productId });
      throw appError;
    }

    // Update inventory if stock or expiry date changed
    if (productData.stock !== undefined || productData.expiryDate !== undefined) {
      try {
        const { data: inventoryRecords } = await supabase
          .from('inventory')
          .select('id')
          .eq('product_id', productId)
          .eq('is_active', true)
          .order('created_at', { ascending: false })
          .limit(1);

        const existingInventory = inventoryRecords && inventoryRecords.length > 0 ? inventoryRecords[0] : null;

        if (existingInventory) {
          const inventoryUpdate = { updated_at: getCurrentTimestamp() };

          if (productData.stock !== undefined) {
            inventoryUpdate.quantity = parseInt(productData.stock);
          }

          if (productData.expiryDate !== undefined) {
            inventoryUpdate.expiry_date = productData.expiryDate || null;
          }

          const { error: invError } = await supabase
            .from('inventory')
            .update(inventoryUpdate)
            .eq('id', existingInventory.id);

          if (invError) {
            const appError = parseSupabaseError(invError);
            logError(appError, { operation: 'updateProduct - inventory update', productId });
          }
        } else if (productData.stock !== undefined && parseInt(productData.stock) > 0) {
          const inventoryData = {
            product_id: productId,
            quantity: parseInt(productData.stock),
            batch_number: `BATCH-${Date.now()}`,
            is_active: true
          };

          if (productData.expiryDate) {
            inventoryData.expiry_date = productData.expiryDate;
          }

          const { error: invError } = await supabase
            .from('inventory')
            .insert([inventoryData]);

          if (invError) {
            const appError = parseSupabaseError(invError);
            logError(appError, { operation: 'updateProduct - inventory create', productId });
          }
        }
      } catch (invError) {
        // Don't fail product update if inventory operation fails
        logError(invError, { operation: 'updateProduct - inventory operation', productId });
      }
    }

    return data;
  } catch (error) {
    if (error.code) throw error; // Already an AppError
    const appError = handleError(error, ERROR_CODES.DB_ERROR, { operation: 'updateProduct', productId });
    throw appError;
  }
};

/**
 * Find blocking orders for a product (via inventory or combo)
 * Returns orders in BLOCKING states (pending/processing with validated payment)
 * @param {string} productId - Product ID
 * @returns {Promise<{blockingOrders: Array, safeOrders: Array, inventoryIds: Array}>}
 */
const findBlockingOrdersForProduct = async (productId) => {
  // Get inventory IDs for this product
  const { data: inventoryRecords, error: invError } = await supabase
    .from('inventory')
    .select('id')
    .eq('product_id', productId);

  if (invError) {
    console.warn('[findBlockingOrdersForProduct] Error fetching inventory:', invError);
  }

  const inventoryIds = (inventoryRecords || []).map(inv => inv.id);

  if (inventoryIds.length === 0) {
    return { blockingOrders: [], safeOrders: [], inventoryIds: [] };
  }

  // Find order_items that reference these inventory records
  const { data: orderItems, error: oiError } = await supabase
    .from('order_items')
    .select(`
      id,
      inventory_id,
      order_id,
      orders!inner(id, order_number, status, payment_status, created_at)
    `)
    .in('inventory_id', inventoryIds);

  if (oiError) {
    console.warn('[findBlockingOrdersForProduct] Error fetching order_items:', oiError);
    return { blockingOrders: [], safeOrders: [], inventoryIds };
  }

  const blockingOrders = [];
  const safeOrders = [];

  (orderItems || []).forEach(item => {
    const order = item.orders;
    if (!order) return;

    const orderInfo = {
      orderId: order.id,
      orderNumber: order.order_number,
      status: order.status,
      paymentStatus: order.payment_status,
      orderItemId: item.id,
      inventoryId: item.inventory_id
    };

    // Check if order is in blocking state
    if (BLOCKING_ORDER_STATUSES.includes(order.status)) {
      blockingOrders.push(orderInfo);
    } else if (SAFE_DELETE_ORDER_STATUSES.includes(order.status)) {
      safeOrders.push(orderInfo);
    }
  });

  return { blockingOrders, safeOrders, inventoryIds };
};

/**
 * Delete a product (hard delete - removes from database)
 * Validates no blocking orders exist before deletion
 * Deactivates combos that contain this product
 * Clears inventory references from completed/cancelled orders
 * @param {string} productId - Product ID to delete
 * @param {string} performedBy - Email or ID of user performing the action (optional)
 * @throws {AppError} If deletion fails or blocking orders exist
 * @returns {Promise<Object>} Result with deleted product info and deactivated combos
 */
export const deleteProduct = async (productId, performedBy = 'system') => {
  try {
    if (!productId) {
      throw createValidationError({ productId: 'Product ID is required' });
    }

    // Fetch product info before deletion for logging
    const { data: product, error: fetchProductError } = await supabase
      .from('products')
      .select('id, name_es, name_en, sku')
      .eq('id', productId)
      .single();

    if (fetchProductError) {
      console.warn('[deleteProduct] Error fetching product info:', fetchProductError);
    }

    const productName = product?.name_es || product?.name_en || productId;

    // ============================================
    // STEP 1: Check for blocking orders
    // ============================================
    const { blockingOrders, safeOrders, inventoryIds } = await findBlockingOrdersForProduct(productId);

    if (blockingOrders.length > 0) {
      const orderNumbers = blockingOrders.map(o => o.orderNumber).join(', ');

      throw new AppError(
        `No se puede eliminar el producto "${productName}" porque tiene órdenes activas en proceso: ${orderNumbers}. Espere a que las órdenes sean despachadas o canceladas.`,
        ERROR_CODES.CONFLICT,
        409,
        {
          productId,
          productName,
          blockingOrders,
          blockingOrderCount: blockingOrders.length
        }
      );
    }

    // ============================================
    // STEP 2: Clear inventory_id from safe orders (dispatched/delivered/completed/cancelled)
    // ============================================
    if (safeOrders.length > 0) {
      const safeOrderItemIds = safeOrders.map(o => o.orderItemId);

      const { error: clearError } = await supabase
        .from('order_items')
        .update({ inventory_id: null })
        .in('id', safeOrderItemIds);

      if (clearError) {
        console.error('[deleteProduct] Error clearing inventory_id from order_items:', clearError);
        throw new AppError(
          'Error al limpiar referencias de inventario en órdenes completadas',
          ERROR_CODES.DB_ERROR,
          500,
          { operation: 'clearOrderItemsInventory', error: clearError.message }
        );
      }
    }

    // ============================================
    // STEP 3: Find and deactivate combos containing this product
    // ============================================
    const { data: comboItems, error: findCombosError } = await supabase
      .from('combo_items')
      .select('combo_id')
      .eq('product_id', productId);

    if (findCombosError) {
      console.warn('[deleteProduct] Error finding combos containing product:', findCombosError);
    }

    const deactivatedCombos = [];

    if (comboItems && comboItems.length > 0) {
      const comboIds = [...new Set(comboItems.map(item => item.combo_id))];

      // Fetch combo info before deactivating for logging
      const { data: combos, error: fetchCombosError } = await supabase
        .from('combo_products')
        .select('id, name_es, name_en, is_active')
        .in('id', comboIds);

      if (fetchCombosError) {
        console.warn('[deleteProduct] Error fetching combo info:', fetchCombosError);
      }

      // Only deactivate active combos
      const activeCombos = (combos || []).filter(c => c.is_active);

      if (activeCombos.length > 0) {
        const activeComboIds = activeCombos.map(c => c.id);

        const { error: deactivateCombosError } = await supabase
          .from('combo_products')
          .update({ is_active: false, updated_at: getCurrentTimestamp() })
          .in('id', activeComboIds);

        if (deactivateCombosError) {
          console.warn('[deleteProduct] Error deactivating combos:', deactivateCombosError);
        } else {
          // Log each combo deactivation
          for (const combo of activeCombos) {
            const comboName = combo.name_es || combo.name_en || combo.id;
            deactivatedCombos.push({ id: combo.id, name: comboName });

            try {
              await logActivity({
                action: 'combo_deactivated',
                entityType: 'combo',
                entityId: combo.id,
                performedBy,
                description: `Combo desactivado - ${comboName} (producto eliminado: ${productName})`,
                metadata: {
                  comboId: combo.id,
                  comboName,
                  reason: 'product_deleted',
                  deletedProductId: productId,
                  deletedProductName: productName
                }
              });
            } catch (logErr) {
              console.warn('[deleteProduct] Failed to log combo deactivation:', logErr);
            }
          }
        }
      }
    }

    // ============================================
    // STEP 4: Delete combo_items references (FK constraint)
    // ============================================
    const { error: comboItemsError } = await supabase
      .from('combo_items')
      .delete()
      .eq('product_id', productId);

    if (comboItemsError) {
      console.error('[deleteProduct] Error deleting combo_items:', comboItemsError);
      throw new AppError(
        'Error al eliminar referencias en combos',
        ERROR_CODES.DB_ERROR,
        500,
        { operation: 'deleteComboItems', error: comboItemsError.message }
      );
    }

    // ============================================
    // STEP 5: Get inventory IDs and delete inventory_movements first
    // ============================================
    const { data: inventoryRecords, error: invFetchError } = await supabase
      .from('inventory')
      .select('id')
      .eq('product_id', productId);

    if (invFetchError) {
      console.warn('[deleteProduct] Error fetching inventory IDs:', invFetchError);
    }

    const productInventoryIds = (inventoryRecords || []).map(inv => inv.id);

    if (productInventoryIds.length > 0) {
      // Delete inventory_movements that reference these inventory records
      const { error: movementsError } = await supabase
        .from('inventory_movements')
        .delete()
        .in('inventory_id', productInventoryIds);

      if (movementsError) {
        console.error('[deleteProduct] Error deleting inventory_movements:', movementsError);
        throw new AppError(
          'Error al eliminar movimientos de inventario',
          ERROR_CODES.DB_ERROR,
          500,
          { operation: 'deleteInventoryMovements', error: movementsError.message }
        );
      }
    }

    // ============================================
    // STEP 6: Delete inventory records (now safe - no FK references)
    // ============================================
    const { error: inventoryError } = await supabase
      .from('inventory')
      .delete()
      .eq('product_id', productId);

    if (inventoryError) {
      console.error('[deleteProduct] Error deleting inventory:', inventoryError);
      throw new AppError(
        'Error al eliminar registros de inventario',
        ERROR_CODES.DB_ERROR,
        500,
        { operation: 'deleteInventory', error: inventoryError.message }
      );
    }

    // ============================================
    // STEP 7: Delete the product
    // ============================================
    const { error } = await supabase
      .from('products')
      .delete()
      .eq('id', productId);

    if (error) {
      const appError = parseSupabaseError(error);
      logError(appError, { operation: 'deleteProduct', productId });
      throw appError;
    }

    // Log the product deletion
    try {
      await logActivity({
        action: 'product_deleted',
        entityType: 'product',
        entityId: productId,
        performedBy,
        description: `Producto eliminado - ${productName}`,
        metadata: {
          productId,
          productName,
          productSku: product?.sku,
          clearedOrderItems: safeOrders.length,
          deactivatedCombos: deactivatedCombos.map(c => c.name),
          deactivatedCombosCount: deactivatedCombos.length
        }
      });
    } catch (logErr) {
      console.warn('[deleteProduct] Failed to log product deletion:', logErr);
    }

    return {
      success: true,
      deletedProduct: {
        id: productId,
        name: productName
      },
      deactivatedCombos,
      clearedOrderItems: safeOrders.length
    };
  } catch (error) {
    if (error.code) throw error; // Already an AppError
    const appError = handleError(error, ERROR_CODES.DB_ERROR, { operation: 'deleteProduct', productId });
    throw appError;
  }
};

/**
 * Get all active product categories
 * @throws {AppError} If database query fails
 * @returns {Promise<Array>} Array of active categories
 */
export const getCategories = async () => {
  try {
    const { data, error } = await supabase
      .from('product_categories')
      .select('id, slug, name_es, name_en, description_es, description_en, display_order, is_active')
      .eq('is_active', true)
      .order('display_order', { ascending: true });

    if (error) {
      const appError = parseSupabaseError(error);
      logError(appError, { operation: 'getCategories' });
      throw appError;
    }

    return data || [];
  } catch (error) {
    if (error.code) throw error; // Already an AppError
    const appError = handleError(error, ERROR_CODES.DB_ERROR, { operation: 'getCategories' });
    throw appError;
  }
};

/**
 * Create a new product category
 * @param {Object} categoryData - Category data with es and en names
 * @throws {AppError} If validation fails or creation fails
 * @returns {Promise<Object>} Created category
 */
export const createCategory = async (categoryData, performedBy = 'system') => {
  try {
    if (!categoryData.es || !categoryData.en) {
      throw createValidationError(
        { categoryName: 'Category name in Spanish and English is required' },
        'Missing required category fields'
      );
    }

    const { data, error } = await supabase
      .from('product_categories')
      .insert([{
        name_es: categoryData.es,
        name_en: categoryData.en,
        description_es: categoryData.description_es || '',
        description_en: categoryData.description_en || '',
        slug: generateSlug(categoryData.es),
        is_active: true,
        display_order: DEFAULTS.DISPLAY_ORDER
      }])
      .select()
      .single();

    if (error) {
      const appError = parseSupabaseError(error);
      logError(appError, { operation: 'createCategory', categoryName: categoryData.es });
      throw appError;
    }

    // Log the category creation
    try {
      await logActivity({
        action: 'category_created',
        entityType: 'category',
        entityId: data?.id,
        performedBy,
        description: `Categoría creada - ${categoryData.es}`,
        metadata: {
          categoryId: data?.id,
          categoryName: categoryData.es,
          categoryNameEn: categoryData.en,
          categorySlug: data?.slug
        }
      });
    } catch (logErr) {
      console.warn('[createCategory] Failed to log category creation:', logErr);
    }

    return data;
  } catch (error) {
    if (error.code) throw error; // Already an AppError
    const appError = handleError(error, ERROR_CODES.DB_ERROR, { operation: 'createCategory' });
    throw appError;
  }
};

/**
 * Update a product category
 * @param {string} categoryId - Category ID
 * @param {Object} categoryData - Updated category data
 * @throws {AppError} If category not found or update fails
 * @returns {Promise<Object>} Updated category
 */
export const updateCategory = async (categoryId, categoryData, performedBy = 'system') => {
  try {
    if (!categoryId) {
      throw createValidationError({ categoryId: 'Category ID is required' });
    }

    if (!categoryData.es || !categoryData.en) {
      throw createValidationError(
        { categoryName: 'Category name in Spanish and English is required' },
        'Missing required category fields'
      );
    }

    const { data, error } = await supabase
      .from('product_categories')
      .update({
        name_es: categoryData.es,
        name_en: categoryData.en,
        description_es: categoryData.description_es || '',
        description_en: categoryData.description_en || '',
        slug: generateSlug(categoryData.es),
        updated_at: getCurrentTimestamp()
      })
      .eq('id', categoryId)
      .select()
      .single();

    if (error) {
      const appError = parseSupabaseError(error);
      if (!data) {
        throw createNotFoundError('Category', categoryId);
      }
      logError(appError, { operation: 'updateCategory', categoryId });
      throw appError;
    }

    // Log the category update
    try {
      await logActivity({
        action: 'category_updated',
        entityType: 'category',
        entityId: categoryId,
        performedBy,
        description: `Categoría actualizada - ${categoryData.es}`,
        metadata: {
          categoryId,
          categoryName: categoryData.es,
          categoryNameEn: categoryData.en,
          categorySlug: data?.slug
        }
      });
    } catch (logErr) {
      console.warn('[updateCategory] Failed to log category update:', logErr);
    }

    return data;
  } catch (error) {
    if (error.code) throw error; // Already an AppError
    const appError = handleError(error, ERROR_CODES.DB_ERROR, { operation: 'updateCategory', categoryId });
    throw appError;
  }
};

/**
 * Delete a product category (hard delete - removes from database)
 * Validates no products are using this category before deletion
 * @param {string} categoryId - Category ID to delete
 * @param {string} performedBy - Email or ID of user performing the action (optional)
 * @throws {AppError} If deletion fails or products exist with this category
 * @returns {Promise<Object>} Result with deleted category info
 */
export const deleteCategory = async (categoryId, performedBy = 'system') => {
  try {
    if (!categoryId) {
      throw createValidationError({ categoryId: 'Category ID is required' });
    }

    // Fetch category info before deletion for logging
    const { data: category, error: fetchCategoryError } = await supabase
      .from('product_categories')
      .select('id, name_es, name_en, slug')
      .eq('id', categoryId)
      .single();

    if (fetchCategoryError) {
      const appError = parseSupabaseError(fetchCategoryError);
      logError(appError, { operation: 'deleteCategory - fetch', categoryId });
      throw appError;
    }

    const categoryName = category?.name_es || category?.name_en || categoryId;

    // Check if any products are using this category
    const { data: productsWithCategory, error: checkProductsError } = await supabase
      .from('products')
      .select('id, name_es, name_en')
      .eq('category_id', categoryId);

    if (checkProductsError) {
      console.warn('[deleteCategory] Error checking products:', checkProductsError);
    }

    // If products exist with this category, throw error with product names
    if (productsWithCategory && productsWithCategory.length > 0) {
      const productNames = productsWithCategory
        .map(p => p.name_es || p.name_en || p.id)
        .slice(0, 10); // Limit to first 10 for readability

      const moreCount = productsWithCategory.length > 10
        ? ` y ${productsWithCategory.length - 10} más`
        : '';

      throw new AppError(
        `No se puede eliminar la categoría "${categoryName}" porque tiene ${productsWithCategory.length} producto(s) asociado(s): ${productNames.join(', ')}${moreCount}`,
        ERROR_CODES.CONFLICT,
        409,
        {
          categoryId,
          categoryName,
          productCount: productsWithCategory.length,
          productNames: productNames
        }
      );
    }

    // No products - safe to delete
    const { error } = await supabase
      .from('product_categories')
      .delete()
      .eq('id', categoryId);

    if (error) {
      const appError = parseSupabaseError(error);
      logError(appError, { operation: 'deleteCategory', categoryId });
      throw appError;
    }

    // Log the category deletion
    try {
      await logActivity({
        action: 'category_deleted',
        entityType: 'category',
        entityId: categoryId,
        performedBy,
        description: `Categoría eliminada - ${categoryName}`,
        metadata: {
          categoryId,
          categoryName,
          categorySlug: category?.slug,
          deletedAt: new Date().toISOString()
        }
      });
    } catch (logErr) {
      console.warn('[deleteCategory] Failed to log category deletion:', logErr);
    }

    return {
      success: true,
      deletedCategory: {
        id: categoryId,
        name: categoryName
      }
    };
  } catch (error) {
    if (error.code) throw error; // Already an AppError
    const appError = handleError(error, ERROR_CODES.DB_ERROR, { operation: 'deleteCategory', categoryId });
    throw appError;
  }
};

/**
 * Import path:
 * import { getProducts, createProduct, updateProduct, deleteProduct, getCategories, createCategory, updateCategory, deleteCategory } from '@/lib/productService';
 *
 * Usage examples:
 *
 * // Fetch all products with inventory
 * try {
 *   const products = await getProducts();
 * } catch (error) {
 *   if (error.code === 'DB_ERROR') {
 *     // Handle database error
 *   }
 * }
 *
 * // Create product with validation
 * try {
 *   const newProduct = await createProduct({
 *     name: 'Product Name',
 *     basePrice: 99.99,
 *     category_id: 'cat-123',
 *     stock: 100
 *   });
 * } catch (error) {
 *   if (error.code === 'VALIDATION_FAILED') {
 *     console.log(error.context.fieldErrors);
 *   }
 * }
 *
 * // Get categories
 * const categories = await getCategories();
 */
