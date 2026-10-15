/**
 * Product Service
 * Handles all product-related database operations
 * Uses standardized error handling with AppError class
 */

import { supabase } from './supabase';
import { withCatalogInvalidation } from './catalogCache';
import { resolveImageUrl } from './imageStorage';
import { generateSlug, getCurrentTimestamp } from './queryHelpers';
import { DEFAULTS } from './constants';
import { validateMarginPercent, MARGIN_MIN, MARGIN_MAX } from './marginResolver';
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
import { isStockBelowReservedError } from './stockErrors';

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
// Explicit projection: `select('*')` also pulled `image_file`, a byte-identical
// copy of the base64 `image_url` (doubling the payload). Consumers fall back
// `image_url || image_file`, so omitting it is safe.
const PRODUCT_COLUMNS = [
  'id', 'sku', 'name_es', 'name_en', 'description_es', 'description_en',
  'category_id', 'base_price', 'base_currency_id', 'cost_price', 'profit_margin',
  'final_price', 'weight', 'dimensions', 'image_url', 'requires_expiry',
  'min_stock_alert', 'is_active', 'is_featured', 'tags', 'created_at', 'updated_at'
].join(', ');

/**
 * Heavy part of the catalog: product rows (with category), without inventory.
 * Safe to cache; stock must be fetched separately via getProductStock.
 */
export const getProductRows = async (includeInactive = false) => {
  let query = supabase
    .from('products')
    .select(`
      ${PRODUCT_COLUMNS},
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

  return data || [];
};

/**
 * Light, always-fresh part: summed available stock and latest expiry per product.
 * @throws {AppError} so callers can keep their previous values on failure
 * @returns {Promise<{stock: Object, expiry: Object}>}
 */
export const getProductStock = async () => {
  const { data, error } = await supabase
    .from('inventory')
    .select('product_id, quantity, available_quantity, expiry_date')
    .eq('is_active', true)
    .order('created_at', { ascending: false });

  if (error) {
    const appError = parseSupabaseError(error);
    logError(appError, { operation: 'getProductStock' });
    throw appError;
  }

  const stock = {};
  const expiry = {};
  (data || []).forEach(inv => {
    stock[inv.product_id] = (stock[inv.product_id] || 0) + (inv.available_quantity || 0);

    // Keep the most recent expiry_date (first one due to order by created_at desc)
    if (!expiry[inv.product_id] && inv.expiry_date) {
      expiry[inv.product_id] = inv.expiry_date;
    }
  });

  return { stock, expiry };
};

/** Attach stock/expiry (from getProductStock) to product rows. */
export const mergeProductStock = (rows, { stock, expiry }) =>
  rows.map(product => ({
    ...product,
    stock: stock[product.id] || 0,
    expiry_date: expiry[product.id] || null
  }));

export const getProducts = async (includeInactive = false) => {
  try {
    // Inventory runs in parallel with products; an inventory failure never
    // fails the catalog (products simply show stock 0).
    const [rows, stockData] = await Promise.all([
      getProductRows(includeInactive),
      getProductStock().catch(() => ({ stock: {}, expiry: {} }))
    ]);

    if (rows.length === 0) {
      return [];
    }

    return mergeProductStock(rows, stockData);
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
/**
 * Set (or clear with null) a product's image URL
 * @throws {AppError} If the update fails
 */
export const setProductImageUrl = withCatalogInvalidation(async (productId, imageUrl) => {
  const { error } = await supabase
    .from('products')
    .update({ image_url: imageUrl })
    .eq('id', productId);

  if (error) {
    const appError = parseSupabaseError(error);
    logError(appError, { operation: 'setProductImageUrl', productId });
    throw appError;
  }
});

export const setProductActiveState = withCatalogInvalidation(async (productId, isActive) => {
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
});

/**
 * Create a new product with optional initial inventory
 * @param {Object} productData - Product creation data
 * @throws {AppError} If validation fails or database operation fails
 * @returns {Promise<Object>} Created product with inventory
 */
export const createProduct = withCatalogInvalidation(async (productData) => {
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

    // Upload first: if it fails nothing is saved (no base64 fallback)
    const imageUrl = await resolveImageUrl(productData.image, {
      folder: 'products',
      id: crypto.randomUUID()
    });

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
        image_url: imageUrl || null,
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
});

/**
 * Update an existing product and optionally its inventory
 * @param {string} productId - Product ID
 * @param {Object} productData - Updated product data
 * @throws {AppError} If product not found or update fails
 * @returns {Promise<Object>} Updated product
 */
export const updateProduct = withCatalogInvalidation(async (productId, productData) => {
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
      updateData.image_url = await resolveImageUrl(productData.image, {
        folder: 'products',
        id: productId
      });
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
            if (invError.code === '23514' && String(invError.message).includes('inventory_reserved_lte_quantity')) {
              // New stock is below the units reserved by open orders: the admin must know, not guess
              throw new AppError(
                'Stock cannot be lower than the units reserved by open orders',
                ERROR_CODES.INVALID_OPERATION,
                409,
                { reason: 'stock_below_reserved', productId }
              );
            }
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
        if (isStockBelowReservedError(invError)) throw invError;
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
});

/**
 * Maps the blockers returned by the database predicate (get_product_blockers /
 * get_combo_blockers) to the shape the UI already consumes.
 */
const mapBlockers = (rows) =>
  (rows || []).map((row) => ({
    orderId: row.order_id,
    orderNumber: row.order_number,
    status: row.status,
    paymentStatus: row.payment_status,
    via: row.via
  }));

/**
 * Delete a product (hard delete) through ONE database transaction (delete_product).
 * The database decides (same predicate as the preview and the bulk delete, taken under row
 * locks): open orders referencing the product - directly, via a combo or via inventory - and
 * orders still holding a reserved allocation block it. Consumed allocations never block.
 * It also deactivates combos that contain the product, removes the combo links, snapshots the
 * ledger sums and deletes movements, batches and the product atomically. Fails CLOSED.
 * @param {string} productId - Product ID to delete
 * @throws {AppError} CONFLICT (409) with context.blockingOrders when blocked, NOT_FOUND, or a DB error
 * @returns {Promise<Object>} { success, deletedProduct: {id, name}, deactivatedCombos: [{id, name}] }
 */
export const deleteProduct = withCatalogInvalidation(async (productId) => {
  try {
    if (!productId) {
      throw createValidationError({ productId: 'Product ID is required' });
    }

    const { data, error } = await supabase.rpc('delete_product', { p_product_id: productId });

    if (error) {
      const appError = parseSupabaseError(error);
      logError(appError, { operation: 'deleteProduct', productId });
      throw appError;
    }

    const result = data || {};

    if (!result.ok) {
      if (result.reason === 'blocking_orders') {
        const blockingOrders = mapBlockers(result.blockers);
        const productName = result.product_name || productId;
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
      if (result.reason === 'not_found') {
        throw createNotFoundError('Product', productId);
      }
      throw new AppError(
        `Product delete refused: ${result.reason || 'unknown'}`,
        ERROR_CODES.INVALID_OPERATION,
        409,
        { productId, reason: result.reason || 'unknown' }
      );
    }

    return {
      success: true,
      deletedProduct: {
        id: productId,
        name: result.product_name || productId
      },
      deactivatedCombos: result.deactivated_combos || []
    };
  } catch (error) {
    if (error.code) throw error; // Already an AppError
    const appError = handleError(error, ERROR_CODES.DB_ERROR, { operation: 'deleteProduct', productId });
    throw appError;
  }
});

/**
 * Get all active product categories
 * @throws {AppError} If database query fails
 * @returns {Promise<Array>} Array of active categories
 */
export const getCategories = async ({ includeMargin = false } = {}) => {
  try {
    // profit_margin is internal business data: only admin callers ask for it
    const publicColumns = 'id, slug, name_es, name_en, description_es, description_en, display_order, is_active';
    const { data, error } = await supabase
      .from('product_categories')
      .select(includeMargin ? `${publicColumns}, profit_margin` : publicColumns)
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
 * Normalize an optional category margin: empty -> null (no category margin),
 * otherwise a number within 0..999.99 (matches the DB CHECK).
 * @param {unknown} raw
 * @returns {number|null}
 */
const normalizeCategoryMargin = (raw) => {
  if (raw === null || raw === undefined || (typeof raw === 'string' && raw.trim() === '')) {
    return null;
  }
  if (!validateMarginPercent(raw)) {
    throw createValidationError(
      { profit_margin: `Margin must be a number between ${MARGIN_MIN} and ${MARGIN_MAX}` },
      'Invalid category profit margin'
    );
  }
  return Number(raw);
};

/**
 * Create a new product category
 * @param {Object} categoryData - Category data with es and en names
 * @throws {AppError} If validation fails or creation fails
 * @returns {Promise<Object>} Created category
 */
export const createCategory = withCatalogInvalidation(async (categoryData, performedBy = 'system') => {
  try {
    if (!categoryData.es || !categoryData.en) {
      throw createValidationError(
        { categoryName: 'Category name in Spanish and English is required' },
        'Missing required category fields'
      );
    }

    const profitMargin = normalizeCategoryMargin(categoryData.profit_margin);

    const { data, error } = await supabase
      .from('product_categories')
      .insert([{
        name_es: categoryData.es,
        name_en: categoryData.en,
        description_es: categoryData.description_es || '',
        description_en: categoryData.description_en || '',
        profit_margin: profitMargin,
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
});

/**
 * Update a product category
 * @param {string} categoryId - Category ID
 * @param {Object} categoryData - Updated category data
 * @throws {AppError} If category not found or update fails
 * @returns {Promise<Object>} Updated category
 */
export const updateCategory = withCatalogInvalidation(async (categoryId, categoryData, performedBy = 'system') => {
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

    // Only touch the margin when the caller provides the field (undefined = leave as is)
    const marginPatch = categoryData.profit_margin === undefined
      ? {}
      : { profit_margin: normalizeCategoryMargin(categoryData.profit_margin) };

    const { data, error } = await supabase
      .from('product_categories')
      .update({
        name_es: categoryData.es,
        name_en: categoryData.en,
        description_es: categoryData.description_es || '',
        description_en: categoryData.description_en || '',
        ...marginPatch,
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
});

/**
 * Delete a product category (hard delete - removes from database)
 * Validates no products are using this category before deletion
 * @param {string} categoryId - Category ID to delete
 * @param {string} performedBy - Email or ID of user performing the action (optional)
 * @throws {AppError} If deletion fails or products exist with this category
 * @returns {Promise<Object>} Result with deleted category info
 */
export const deleteCategory = withCatalogInvalidation(async (categoryId, performedBy = 'system') => {
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
});

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
