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
 * Delete a product (hard delete - removes from database)
 * Also removes related inventory records and combo_items references
 * Deactivates combos that contain this product
 * @param {string} productId - Product ID to delete
 * @param {string} performedBy - Email or ID of user performing the action (optional)
 * @throws {AppError} If deletion fails
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

    // Find combos that contain this product
    const { data: comboItems, error: findCombosError } = await supabase
      .from('combo_items')
      .select('combo_id')
      .eq('product_id', productId);

    if (findCombosError) {
      console.warn('[deleteProduct] Error finding combos containing product:', findCombosError);
    }

    const deactivatedCombos = [];

    // Deactivate combos that contain this product
    if (comboItems && comboItems.length > 0) {
      const comboIds = [...new Set(comboItems.map(item => item.combo_id))];
      console.log('[deleteProduct] Deactivating combos that contain product:', comboIds);

      // Fetch combo info before deactivating for logging
      const { data: combos, error: fetchCombosError } = await supabase
        .from('combo_products')
        .select('id, name_es, name_en')
        .in('id', comboIds)
        .eq('is_active', true);

      if (fetchCombosError) {
        console.warn('[deleteProduct] Error fetching combo info:', fetchCombosError);
      }

      const { error: deactivateCombosError } = await supabase
        .from('combo_products')
        .update({ is_active: false })
        .in('id', comboIds);

      if (deactivateCombosError) {
        console.warn('[deleteProduct] Error deactivating combos:', deactivateCombosError);
      } else if (combos && combos.length > 0) {
        // Log each combo deactivation
        for (const combo of combos) {
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
          } catch (logError) {
            console.warn('[deleteProduct] Failed to log combo deactivation:', logError);
          }
        }
      }
    }

    // Delete combo_items references (foreign key constraint)
    const { error: comboItemsError } = await supabase
      .from('combo_items')
      .delete()
      .eq('product_id', productId);

    if (comboItemsError) {
      console.warn('[deleteProduct] Error deleting combo_items references:', comboItemsError);
    }

    // Delete related inventory records (foreign key constraint)
    const { error: inventoryError } = await supabase
      .from('inventory')
      .delete()
      .eq('product_id', productId);

    if (inventoryError) {
      console.warn('[deleteProduct] Error deleting inventory records:', inventoryError);
    }

    // Now delete the product
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
      deactivatedCombos
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
export const createCategory = async (categoryData) => {
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
export const updateCategory = async (categoryId, categoryData) => {
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

    return data;
  } catch (error) {
    if (error.code) throw error; // Already an AppError
    const appError = handleError(error, ERROR_CODES.DB_ERROR, { operation: 'updateCategory', categoryId });
    throw appError;
  }
};

/**
 * Delete a product category (soft delete by setting is_active to false)
 * @param {string} categoryId - Category ID to delete
 * @throws {AppError} If deletion fails
 * @returns {Promise<boolean>} True if deletion successful
 */
export const deleteCategory = async (categoryId) => {
  try {
    if (!categoryId) {
      throw createValidationError({ categoryId: 'Category ID is required' });
    }

    const { error } = await supabase
      .from('product_categories')
      .update({ is_active: false })
      .eq('id', categoryId);

    if (error) {
      const appError = parseSupabaseError(error);
      logError(appError, { operation: 'deleteCategory', categoryId });
      throw appError;
    }

    return true;
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
