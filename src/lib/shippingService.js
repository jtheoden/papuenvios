/**
 * Shipping Zone Management Service
 * Handles province-based shipping cost configuration for Cuba
 * Zone-based rules with validation and cost calculations
 */

import { supabase } from './supabase';
import {
  handleError, logError, createValidationError,
  createNotFoundError, parseSupabaseError, ERROR_CODES
} from './errorHandler';

/**
 * Get all active shipping zones
 * @returns {Promise<Array>} List of active shipping zones
 * @throws {AppError} DB_ERROR if query fails
 */
export const getActiveShippingZones = async () => {
  try {
    const { data, error } = await supabase
      .from('shipping_zones')
      .select('*')
      .eq('is_active', true)
      .order('province_name', { ascending: true });

    if (error) {
      throw parseSupabaseError(error);
    }

    return data || [];
  } catch (error) {
    if (error.code) throw error;
    const appError = handleError(error, ERROR_CODES.DB_ERROR, { operation: 'getActiveShippingZones' });
    logError(appError, { operation: 'getActiveShippingZones' });
    throw appError;
  }
};

/**
 * Get all shipping zones (admin only)
 * @returns {Promise<Array>} List of all shipping zones
 * @throws {AppError} DB_ERROR if query fails
 */
export const getAllShippingZones = async () => {
  try {
    const { data, error } = await supabase
      .from('shipping_zones')
      .select('*')
      .order('province_name', { ascending: true });

    if (error) {
      throw parseSupabaseError(error);
    }

    return data || [];
  } catch (error) {
    if (error.code) throw error;
    const appError = handleError(error, ERROR_CODES.DB_ERROR, { operation: 'getAllShippingZones' });
    logError(appError, { operation: 'getAllShippingZones' });
    throw appError;
  }
};

/**
 * Get shipping zone by ID
 * @param {string} zoneId - Shipping zone ID
 * @returns {Promise<Object>} Shipping zone details
 * @throws {AppError} VALIDATION_FAILED if zoneId missing, NOT_FOUND if not found, DB_ERROR on failure
 */
export const getShippingZoneById = async (zoneId) => {
  try {
    if (!zoneId) {
      throw createValidationError({ zoneId: 'Zone ID is required' }, 'Missing zone ID');
    }

    const { data, error } = await supabase
      .from('shipping_zones')
      .select('*')
      .eq('id', zoneId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        throw createNotFoundError('Shipping zone', zoneId);
      }
      throw parseSupabaseError(error);
    }

    return data;
  } catch (error) {
    if (error.code) throw error;
    const appError = handleError(error, ERROR_CODES.DB_ERROR, { operation: 'getShippingZoneById', zoneId });
    logError(appError, { operation: 'getShippingZoneById', zoneId });
    throw appError;
  }
};

/**
 * Get shipping zone by province name
 * @param {string} provinceName - Province name
 * @returns {Promise<Object>} Shipping zone details
 * @throws {AppError} VALIDATION_FAILED if provinceName missing, NOT_FOUND if not found, DB_ERROR on failure
 */
export const getShippingZoneByProvince = async (provinceName) => {
  try {
    if (!provinceName) {
      throw createValidationError({ provinceName: 'Province name is required' }, 'Missing province name');
    }

    const { data, error } = await supabase
      .from('shipping_zones')
      .select('*')
      .eq('province_name', provinceName)
      .eq('is_active', true)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        throw createNotFoundError('Shipping zone', provinceName);
      }
      throw parseSupabaseError(error);
    }

    return data;
  } catch (error) {
    if (error.code) throw error;
    const appError = handleError(error, ERROR_CODES.DB_ERROR, { operation: 'getShippingZoneByProvince', provinceName });
    logError(appError, { operation: 'getShippingZoneByProvince', provinceName });
    throw appError;
  }
};

/**
 * Calculate shipping cost for province
 * @param {string} provinceName - Province name
 * @param {number} cartTotal - Cart subtotal (for free shipping checks)
 * @returns {Promise<Object>} Shipping cost details with cost, freeShipping flag, and zone info
 * @throws {AppError} VALIDATION_FAILED if provinceName missing, NOT_FOUND if province not found, DB_ERROR on failure
 */
export const calculateShippingCost = async (provinceName, cartTotal = 0) => {
  try {
    if (!provinceName) {
      throw createValidationError({ provinceName: 'Province name is required' }, 'Missing province name');
    }

    const zone = await getShippingZoneByProvince(provinceName);

    // Check if shipping is free for this zone
    if (zone.free_shipping) {
      return {
        cost: 0,
        freeShipping: true,
        zone
      };
    }

    return {
      cost: parseFloat(zone.shipping_cost),
      freeShipping: false,
      zone
    };
  } catch (error) {
    if (error.code) throw error;
    const appError = handleError(error, ERROR_CODES.DB_ERROR, { operation: 'calculateShippingCost', provinceName });
    logError(appError, { operation: 'calculateShippingCost', provinceName });
    throw appError;
  }
};

/**
 * Create new shipping zone (admin only)
 * @param {Object} zoneData - Shipping zone information
 * @param {string} zoneData.provinceName - Province name (required)
 * @param {number} zoneData.shippingCost - Base shipping cost
 * @param {boolean} zoneData.isActive - Whether zone is active
 * @param {boolean} zoneData.freeShipping - Whether shipping is free
 * @returns {Promise<Object>} Created shipping zone
 * @throws {AppError} VALIDATION_FAILED if provinceName missing, DB_ERROR on failure
 */
export const createShippingZone = async (zoneData) => {
  try {
    if (!zoneData || !zoneData.provinceName) {
      throw createValidationError({ provinceName: 'Province name is required' }, 'Missing province name');
    }

    const zone = {
      province_name: zoneData.provinceName,
      shipping_cost: parseFloat(zoneData.shippingCost || 0),
      is_active: zoneData.isActive !== undefined ? zoneData.isActive : true,
      free_shipping: zoneData.freeShipping || false
    };

    const { data, error } = await supabase
      .from('shipping_zones')
      .insert(zone)
      .select()
      .single();

    if (error) {
      throw parseSupabaseError(error);
    }

    return data;
  } catch (error) {
    if (error.code) throw error;
    const appError = handleError(error, ERROR_CODES.DB_ERROR, { operation: 'createShippingZone', provinceName: zoneData?.provinceName });
    logError(appError, { operation: 'createShippingZone', provinceName: zoneData?.provinceName });
    throw appError;
  }
};

/**
 * Update shipping zone (admin only)
 * @param {string} zoneId - Shipping zone ID
 * @param {Object} updates - Fields to update
 * @returns {Promise<Object>} Updated shipping zone
 * @throws {AppError} VALIDATION_FAILED if zoneId missing, NOT_FOUND if zone not found, DB_ERROR on failure
 */
export const updateShippingZone = async (zoneId, updates) => {
  try {
    if (!zoneId) {
      throw createValidationError({ zoneId: 'Zone ID is required' }, 'Missing zone ID');
    }

    if (!updates || typeof updates !== 'object') {
      throw createValidationError({ updates: 'Updates must be an object' }, 'Invalid updates');
    }

    const updateData = {};

    if (updates.provinceName !== undefined) {
      updateData.province_name = updates.provinceName;
    }
    if (updates.shippingCost !== undefined) {
      updateData.shipping_cost = parseFloat(updates.shippingCost);
    }
    if (updates.isActive !== undefined) {
      updateData.is_active = updates.isActive;
    }
    if (updates.freeShipping !== undefined) {
      updateData.free_shipping = updates.freeShipping;
    }
    // Phase 2 fields
    if (updates.deliveryDays !== undefined) {
      updateData.delivery_days = parseInt(updates.deliveryDays);
    }
    if (updates.transportCost !== undefined) {
      updateData.transport_cost = parseFloat(updates.transportCost);
    }
    if (updates.deliveryNote !== undefined) {
      updateData.delivery_note = updates.deliveryNote;
    }

    updateData.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from('shipping_zones')
      .update(updateData)
      .eq('id', zoneId)
      .select()
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        throw createNotFoundError('Shipping zone', zoneId);
      }
      throw parseSupabaseError(error);
    }

    return data;
  } catch (error) {
    if (error.code) throw error;
    const appError = handleError(error, ERROR_CODES.DB_ERROR, { operation: 'updateShippingZone', zoneId });
    logError(appError, { operation: 'updateShippingZone', zoneId });
    throw appError;
  }
};

/**
 * Toggle shipping zone active status (admin only)
 * @param {string} zoneId - Shipping zone ID
 * @returns {Promise<Object>} Updated shipping zone
 * @throws {AppError} VALIDATION_FAILED if zoneId missing, NOT_FOUND if zone not found, DB_ERROR on failure
 */
export const toggleShippingZoneStatus = async (zoneId) => {
  try {
    if (!zoneId) {
      throw createValidationError({ zoneId: 'Zone ID is required' }, 'Missing zone ID');
    }

    // Get current status
    const { data: zone, error: fetchError } = await supabase
      .from('shipping_zones')
      .select('is_active')
      .eq('id', zoneId)
      .single();

    if (fetchError) {
      if (fetchError.code === 'PGRST116') {
        throw createNotFoundError('Shipping zone', zoneId);
      }
      throw parseSupabaseError(fetchError);
    }

    // Toggle status
    const { data, error } = await supabase
      .from('shipping_zones')
      .update({
        is_active: !zone.is_active,
        updated_at: new Date().toISOString()
      })
      .eq('id', zoneId)
      .select()
      .single();

    if (error) {
      throw parseSupabaseError(error);
    }

    return data;
  } catch (error) {
    if (error.code) throw error;
    const appError = handleError(error, ERROR_CODES.DB_ERROR, { operation: 'toggleShippingZoneStatus', zoneId });
    logError(appError, { operation: 'toggleShippingZoneStatus', zoneId });
    throw appError;
  }
};

/**
 * Delete shipping zone (admin only)
 * @param {string} zoneId - Shipping zone ID
 * @returns {Promise<void>} Deletion success (returns nothing)
 * @throws {AppError} VALIDATION_FAILED if zoneId missing, DB_ERROR on failure
 */
export const deleteShippingZone = async (zoneId) => {
  try {
    if (!zoneId) {
      throw createValidationError({ zoneId: 'Zone ID is required' }, 'Missing zone ID');
    }

    const { error } = await supabase
      .from('shipping_zones')
      .delete()
      .eq('id', zoneId);

    if (error) {
      throw parseSupabaseError(error);
    }
  } catch (error) {
    if (error.code) throw error;
    const appError = handleError(error, ERROR_CODES.DB_ERROR, { operation: 'deleteShippingZone', zoneId });
    logError(appError, { operation: 'deleteShippingZone', zoneId });
    throw appError;
  }
};

/**
 * Bulk update shipping costs (admin only)
 * @param {Array} updates - Array of {id, shippingCost}
 * @returns {Promise<Object>} Update result with updatedCount
 * @throws {AppError} VALIDATION_FAILED if updates invalid, DB_ERROR on failure
 */
export const bulkUpdateShippingCosts = async (updates) => {
  try {
    if (!Array.isArray(updates) || updates.length === 0) {
      throw createValidationError({ updates: 'Updates must be a non-empty array' }, 'Invalid updates array');
    }

    const promises = updates.map(update =>
      supabase
        .from('shipping_zones')
        .update({
          shipping_cost: parseFloat(update.shippingCost),
          updated_at: new Date().toISOString()
        })
        .eq('id', update.id)
    );

    const results = await Promise.all(promises);

    // Check for errors
    const errors = results.filter(r => r.error);
    if (errors.length > 0) {
      throw new Error(`Failed to update ${errors.length} zones`);
    }

    return {
      updatedCount: updates.length
    };
  } catch (error) {
    if (error.code) throw error;
    const appError = handleError(error, ERROR_CODES.DB_ERROR, { operation: 'bulkUpdateShippingCosts', count: updates?.length });
    logError(appError, { operation: 'bulkUpdateShippingCosts', count: updates?.length });
    throw appError;
  }
};

/**
 * Set free shipping for province (admin only)
 * @param {string} zoneId - Shipping zone ID
 * @param {boolean} freeShipping - Whether to enable free shipping
 * @returns {Promise<Object>} Updated shipping zone
 * @throws {AppError} VALIDATION_FAILED if zoneId missing, NOT_FOUND if zone not found, DB_ERROR on failure
 */
export const setFreeShipping = async (zoneId, freeShipping) => {
  try {
    if (!zoneId) {
      throw createValidationError({ zoneId: 'Zone ID is required' }, 'Missing zone ID');
    }

    const { data, error } = await supabase
      .from('shipping_zones')
      .update({
        free_shipping: freeShipping,
        updated_at: new Date().toISOString()
      })
      .eq('id', zoneId)
      .select()
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        throw createNotFoundError('Shipping zone', zoneId);
      }
      throw parseSupabaseError(error);
    }

    return data;
  } catch (error) {
    if (error.code) throw error;
    const appError = handleError(error, ERROR_CODES.DB_ERROR, { operation: 'setFreeShipping', zoneId });
    logError(appError, { operation: 'setFreeShipping', zoneId });
    throw appError;
  }
};

/**
 * Get provinces with free shipping
 * @returns {Promise<Array>} List of provinces with free shipping
 * @throws {AppError} DB_ERROR if query fails
 */
export const getFreeShippingProvinces = async () => {
  try {
    const { data, error } = await supabase
      .from('shipping_zones')
      .select('*')
      .eq('is_active', true)
      .eq('free_shipping', true)
      .order('province_name', { ascending: true });

    if (error) {
      throw parseSupabaseError(error);
    }

    return data || [];
  } catch (error) {
    if (error.code) throw error;
    const appError = handleError(error, ERROR_CODES.DB_ERROR, { operation: 'getFreeShippingProvinces' });
    logError(appError, { operation: 'getFreeShippingProvinces' });
    throw appError;
  }
};

/**
 * Get shipping statistics (admin only)
 * @returns {Promise<Object>} Shipping statistics with zone counts and cost analysis
 * @throws {AppError} DB_ERROR if query fails
 */
export const getShippingStatistics = async () => {
  try {
    const { data, error } = await supabase
      .from('shipping_zones')
      .select('shipping_cost, free_shipping, is_active');

    if (error) {
      throw parseSupabaseError(error);
    }

    const stats = {
      totalZones: data.length,
      activeZones: data.filter(z => z.is_active).length,
      freeShippingZones: data.filter(z => z.free_shipping && z.is_active).length,
      averageCost: 0,
      minCost: 0,
      maxCost: 0
    };

    // Calculate average, min, max for paid shipping zones
    const paidZones = data.filter(z => !z.free_shipping && z.is_active);
    if (paidZones.length > 0) {
      const costs = paidZones.map(z => parseFloat(z.shipping_cost));
      stats.averageCost = costs.reduce((a, b) => a + b, 0) / costs.length;
      stats.minCost = Math.min(...costs);
      stats.maxCost = Math.max(...costs);
    }

    return stats;
  } catch (error) {
    if (error.code) throw error;
    const appError = handleError(error, ERROR_CODES.DB_ERROR, { operation: 'getShippingStatistics' });
    logError(appError, { operation: 'getShippingStatistics' });
    throw appError;
  }
};

/**
 * Validate province name exists in shipping zones
 * @param {string} provinceName - Province name to validate
 * @returns {Promise<Object>} Validation result with exists flag
 * @throws {AppError} VALIDATION_FAILED if provinceName missing, DB_ERROR on failure
 */
export const validateProvinceName = async (provinceName) => {
  try {
    if (!provinceName) {
      throw createValidationError({ provinceName: 'Province name is required' }, 'Missing province name');
    }

    const { data, error } = await supabase
      .from('shipping_zones')
      .select('id')
      .eq('province_name', provinceName)
      .eq('is_active', true)
      .single();

    // PGRST116 means no rows found - that's OK for validation
    if (error && error.code !== 'PGRST116') {
      throw parseSupabaseError(error);
    }

    return {
      exists: !!data
    };
  } catch (error) {
    if (error.code) throw error;
    const appError = handleError(error, ERROR_CODES.DB_ERROR, { operation: 'validateProvinceName', provinceName });
    logError(appError, { operation: 'validateProvinceName', provinceName });
    throw appError;
  }
};
