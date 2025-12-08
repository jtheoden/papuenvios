/**
 * Combo Service
 * Handles all combo-related database operations
 * Uses standardized error handling with AppError class
 */

import { supabase } from './supabase';
import { executeQuery, getCurrentTimestamp } from './queryHelpers';
import { DEFAULTS } from './constants';
import {
  handleError,
  logError,
  createValidationError,
  createNotFoundError,
  parseSupabaseError,
  ERROR_CODES
} from './errorHandler';

/**
 * Get all combos with their products
 * @param {boolean} includeInactive - If true, returns all combos (active and inactive). Default: false
 * @throws {AppError} If database query fails
 * @returns {Promise<Array>} Array of combos with items and product details
 */
export const getCombos = async (includeInactive = false) => {
  try {
    // Get combos
    let comboQuery = supabase
      .from('combo_products')
      .select('*');

    if (!includeInactive) {
      comboQuery = comboQuery.eq('is_active', true);
    }

    const combosResult = await comboQuery.order('created_at', { ascending: false });

    if (combosResult.error) {
      const appError = parseSupabaseError(combosResult.error);
      logError(appError, { operation: 'getCombos', includeInactive });
      throw appError;
    }

    if (!combosResult.data || combosResult.data.length === 0) {
      return [];
    }

    // Get combo IDs to fetch their items
    const comboIds = combosResult.data.map(c => c.id);

    // Get combo items with product details
    const { data: itemsData, error: itemsError } = await supabase
      .from('combo_items')
      .select('combo_id, quantity, products(id, name_es, name_en, base_price)')
      .in('combo_id', comboIds);

    if (itemsError) {
      const appError = parseSupabaseError(itemsError);
      logError(appError, {
        operation: 'getCombos - items fetch',
        comboCount: comboIds.length
      });
      // Don't fail - return combos without item details
    }

    // Create items map: combo_id -> array of items
    const itemsMap = {};
    (itemsData || []).forEach(item => {
      if (!itemsMap[item.combo_id]) {
        itemsMap[item.combo_id] = [];
      }
      itemsMap[item.combo_id].push({
        quantity: item.quantity,
        product: item.products
      });
    });

    // Attach items to combos
    const combosWithItems = combosResult.data.map(combo => ({
      ...combo,
      items: itemsMap[combo.id] || []
    }));

    return combosWithItems;
  } catch (error) {
    if (error.code) throw error; // Already an AppError
    const appError = handleError(error, ERROR_CODES.DB_ERROR, {
      operation: 'getCombos',
      includeInactive
    });
    throw appError;
  }
};

/**
 * Create a new combo with items
 * @param {Object} comboData - Combo creation data with productsWithQuantities
 * @throws {AppError} If validation fails or creation fails
 * @returns {Promise<Object>} Created combo
 */
export const createCombo = async (comboData) => {
  try {
    if (!comboData.name) {
      throw createValidationError({ name: 'Combo name is required' });
    }

    if (!comboData.productsWithQuantities || comboData.productsWithQuantities.length === 0) {
      throw createValidationError(
        { productsWithQuantities: 'At least one product is required' },
        'Combo must have products'
      );
    }

    // Calculate base total price from selected products with quantities
    let baseTotalPrice = 0;
    const productIds = comboData.productsWithQuantities.map(item => item.productId);
    const { data: productPrices } = await supabase
      .from('products')
      .select('id, base_price')
      .in('id', productIds);

    if (productPrices) {
      baseTotalPrice = comboData.productsWithQuantities.reduce((sum, item) => {
        const product = productPrices.find(p => p.id === item.productId);
        if (product) {
          return sum + (parseFloat(product.base_price) * item.quantity);
        }
        return sum;
      }, 0);
    }

    // Create combo
    const { data: combo, error: comboError } = await supabase
      .from('combo_products')
      .insert([{
        name_es: comboData.name,
        name_en: comboData.name,
        description_es: comboData.description || '',
        description_en: comboData.description || '',
        image_url: comboData.image || null,
        base_total_price: baseTotalPrice,
        profit_margin: parseFloat(comboData.profitMargin || DEFAULTS.COMBO_PROFIT_MARGIN),
        is_active: true
      }])
      .select()
      .single();

    if (comboError) {
      const appError = parseSupabaseError(comboError);
      logError(appError, { operation: 'createCombo', comboName: comboData.name });
      throw appError;
    }

    // Create combo items with quantities
    const comboItems = comboData.productsWithQuantities.map(item => ({
      combo_id: combo.id,
      product_id: item.productId,
      quantity: item.quantity
    }));

    const { error: itemsError } = await supabase
      .from('combo_items')
      .insert(comboItems);

    if (itemsError) {
      const appError = parseSupabaseError(itemsError);
      logError(appError, {
        operation: 'createCombo - items',
        comboId: combo.id,
        itemCount: comboItems.length
      });
      // Don't fail combo creation if items fail
    }

    return combo;
  } catch (error) {
    if (error.code) throw error; // Already an AppError
    const appError = handleError(error, ERROR_CODES.DB_ERROR, { operation: 'createCombo' });
    throw appError;
  }
};

/**
 * Update an existing combo and its items
 * @param {string} comboId - Combo ID
 * @param {Object} comboData - Updated combo data
 * @throws {AppError} If combo not found or update fails
 * @returns {Promise<Object>} Updated combo
 */
export const updateCombo = async (comboId, comboData) => {
  try {
    if (!comboId) {
      throw createValidationError({ comboId: 'Combo ID is required' });
    }

    // Calculate new base total price if products changed
    let baseTotalPrice = undefined;
    if (comboData.productsWithQuantities && comboData.productsWithQuantities.length > 0) {
      const productIds = comboData.productsWithQuantities.map(item => item.productId);
      const { data: productPrices } = await supabase
        .from('products')
        .select('id, base_price')
        .in('id', productIds);

      if (productPrices) {
        baseTotalPrice = comboData.productsWithQuantities.reduce((sum, item) => {
          const product = productPrices.find(p => p.id === item.productId);
          if (product) {
            return sum + (parseFloat(product.base_price) * item.quantity);
          }
          return sum;
        }, 0);
      }
    }

    // Update combo
    const updateData = {
      name_es: comboData.name,
      name_en: comboData.name,
      description_es: comboData.description || '',
      description_en: comboData.description || '',
      profit_margin: parseFloat(comboData.profitMargin || DEFAULTS.COMBO_PROFIT_MARGIN),
      updated_at: getCurrentTimestamp()
    };

    if (comboData.image) {
      updateData.image_url = comboData.image;
    }

    if (baseTotalPrice !== undefined) {
      updateData.base_total_price = baseTotalPrice;
    }

    const { data: combo, error: comboError } = await supabase
      .from('combo_products')
      .update(updateData)
      .eq('id', comboId)
      .select()
      .single();

    if (comboError) {
      const appError = parseSupabaseError(comboError);
      if (!combo) {
        throw createNotFoundError('Combo', comboId);
      }
      logError(appError, { operation: 'updateCombo', comboId });
      throw appError;
    }

    // Update combo items if products changed
    if (comboData.productsWithQuantities) {
      try {
        // Delete existing items
        await supabase
          .from('combo_items')
          .delete()
          .eq('combo_id', comboId);

        // Insert new items with quantities
        if (comboData.productsWithQuantities.length > 0) {
          const comboItems = comboData.productsWithQuantities.map(item => ({
            combo_id: comboId,
            product_id: item.productId,
            quantity: item.quantity
          }));

          const { error: itemsError } = await supabase
            .from('combo_items')
            .insert(comboItems);

          if (itemsError) {
            const appError = parseSupabaseError(itemsError);
            logError(appError, {
              operation: 'updateCombo - items',
              comboId,
              itemCount: comboItems.length
            });
            // Don't fail combo update if items fail
          }
        }
      } catch (itemsError) {
        // Don't fail combo update if items operation fails
        logError(itemsError, { operation: 'updateCombo - items operation', comboId });
      }
    }

    return combo;
  } catch (error) {
    if (error.code) throw error; // Already an AppError
    const appError = handleError(error, ERROR_CODES.DB_ERROR, {
      operation: 'updateCombo',
      comboId
    });
    throw appError;
  }
};

/**
 * Toggle combo active state
 * @param {string} comboId - Combo ID
 * @param {boolean} isActive - Target active state
 * @returns {Promise<Object>} Updated combo row
 */
export const setComboActiveState = async (comboId, isActive = true) => {
  try {
    if (!comboId) {
      throw createValidationError({ comboId: 'Combo ID is required' });
    }

    const { data, error } = await supabase
      .from('combo_products')
      .update({ is_active: isActive, updated_at: getCurrentTimestamp() })
      .eq('id', comboId)
      .select()
      .single();

    if (error) {
      const appError = parseSupabaseError(error);
      if (!data) {
        throw createNotFoundError('Combo', comboId);
      }
      logError(appError, { operation: 'setComboActiveState', comboId, isActive });
      throw appError;
    }

    return data;
  } catch (error) {
    if (error.code) throw error; // Already an AppError
    const appError = handleError(error, ERROR_CODES.DB_ERROR, {
      operation: 'setComboActiveState',
      comboId,
      isActive
    });
    throw appError;
  }
};

/**
 * Delete a combo (soft delete by setting is_active to false)
 * @param {string} comboId - Combo ID to delete
 * @throws {AppError} If deletion fails
 * @returns {Promise<Object>} Deleted combo
 */
export const deleteCombo = async (comboId) => {
  try {
    if (!comboId) {
      throw createValidationError({ comboId: 'Combo ID is required' });
    }

    const { data, error } = await supabase
      .from('combo_products')
      .update({ is_active: false })
      .eq('id', comboId)
      .select()
      .single();

    if (error) {
      const appError = parseSupabaseError(error);
      if (!data) {
        throw createNotFoundError('Combo', comboId);
      }
      logError(appError, { operation: 'deleteCombo', comboId });
      throw appError;
    }

    return data;
  } catch (error) {
    if (error.code) throw error; // Already an AppError
    const appError = handleError(error, ERROR_CODES.DB_ERROR, {
      operation: 'deleteCombo',
      comboId
    });
    throw appError;
  }
};

/**
 * Import path:
 * import { getCombos, createCombo, updateCombo, deleteCombo } from '@/lib/comboService';
 *
 * Usage examples:
 *
 * // Fetch combos
 * try {
 *   const combos = await getCombos(false);  // Only active
 * } catch (error) {
 *   if (error.code === 'DB_ERROR') {
 *     // Handle database error
 *   }
 * }
 *
 * // Create combo
 * try {
 *   const newCombo = await createCombo({
 *     name: 'Combo Name',
 *     description: 'Combo description',
 *     productsWithQuantities: [
 *       { productId: 'prod-1', quantity: 2 },
 *       { productId: 'prod-2', quantity: 1 }
 *     ],
 *     profitMargin: 0.15
 *   });
 * } catch (error) {
 *   if (error.code === 'VALIDATION_FAILED') {
 *     console.log(error.context.fieldErrors);
 *   }
 * }
 */
