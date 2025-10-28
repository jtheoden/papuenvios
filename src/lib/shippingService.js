/**
 * Shipping Zone Management Service
 * Handles province-based shipping cost configuration for Cuba
 */

import { supabase } from './supabase';

/**
 * Get all active shipping zones
 * @returns {Array} List of active shipping zones
 */
export const getActiveShippingZones = async () => {
  try {
    const { data, error } = await supabase
      .from('shipping_zones')
      .select('*')
      .eq('is_active', true)
      .order('province_name', { ascending: true });

    if (error) throw error;

    return {
      success: true,
      zones: data || []
    };
  } catch (error) {
    console.error('Error fetching active shipping zones:', error);
    return {
      success: false,
      error: error.message,
      zones: []
    };
  }
};

/**
 * Get all shipping zones (admin only)
 * @returns {Array} List of all shipping zones
 */
export const getAllShippingZones = async () => {
  try {
    const { data, error } = await supabase
      .from('shipping_zones')
      .select('*')
      .order('province_name', { ascending: true });

    if (error) throw error;

    return {
      success: true,
      zones: data || []
    };
  } catch (error) {
    console.error('Error fetching all shipping zones:', error);
    return {
      success: false,
      error: error.message,
      zones: []
    };
  }
};

/**
 * Get shipping zone by ID
 * @param {string} zoneId - Shipping zone ID
 * @returns {Object} Shipping zone details
 */
export const getShippingZoneById = async (zoneId) => {
  try {
    const { data, error } = await supabase
      .from('shipping_zones')
      .select('*')
      .eq('id', zoneId)
      .single();

    if (error) throw error;

    return {
      success: true,
      zone: data
    };
  } catch (error) {
    console.error('Error fetching shipping zone:', error);
    return {
      success: false,
      error: error.message
    };
  }
};

/**
 * Get shipping zone by province name
 * @param {string} provinceName - Province name
 * @returns {Object} Shipping zone details
 */
export const getShippingZoneByProvince = async (provinceName) => {
  try {
    const { data, error } = await supabase
      .from('shipping_zones')
      .select('*')
      .eq('province_name', provinceName)
      .eq('is_active', true)
      .single();

    if (error) throw error;

    return {
      success: true,
      zone: data
    };
  } catch (error) {
    console.error('Error fetching shipping zone by province:', error);
    return {
      success: false,
      error: error.message
    };
  }
};

/**
 * Calculate shipping cost for province
 * @param {string} provinceName - Province name
 * @param {number} cartTotal - Cart subtotal (for free shipping checks)
 * @returns {Object} Shipping cost details
 */
export const calculateShippingCost = async (provinceName, cartTotal = 0) => {
  try {
    const result = await getShippingZoneByProvince(provinceName);

    if (!result.success) {
      return {
        success: false,
        error: 'Province not found',
        cost: 0,
        freeShipping: false
      };
    }

    const zone = result.zone;

    // Check if shipping is free for this zone
    if (zone.free_shipping) {
      return {
        success: true,
        cost: 0,
        freeShipping: true,
        zone: zone
      };
    }

    return {
      success: true,
      cost: parseFloat(zone.shipping_cost),
      freeShipping: false,
      zone: zone
    };
  } catch (error) {
    console.error('Error calculating shipping cost:', error);
    return {
      success: false,
      error: error.message,
      cost: 0,
      freeShipping: false
    };
  }
};

/**
 * Create new shipping zone (admin only)
 * @param {Object} zoneData - Shipping zone information
 * @returns {Object} Created shipping zone
 */
export const createShippingZone = async (zoneData) => {
  try {
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

    if (error) throw error;

    return {
      success: true,
      zone: data
    };
  } catch (error) {
    console.error('Error creating shipping zone:', error);
    return {
      success: false,
      error: error.message
    };
  }
};

/**
 * Update shipping zone (admin only)
 * @param {string} zoneId - Shipping zone ID
 * @param {Object} updates - Fields to update
 * @returns {Object} Updated shipping zone
 */
export const updateShippingZone = async (zoneId, updates) => {
  try {
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
    // NEW: Phase 2 fields
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

    if (error) throw error;

    return {
      success: true,
      zone: data
    };
  } catch (error) {
    console.error('Error updating shipping zone:', error);
    return {
      success: false,
      error: error.message
    };
  }
};

/**
 * Toggle shipping zone active status (admin only)
 * @param {string} zoneId - Shipping zone ID
 * @returns {Object} Updated shipping zone
 */
export const toggleShippingZoneStatus = async (zoneId) => {
  try {
    // Get current status
    const { data: zone, error: fetchError } = await supabase
      .from('shipping_zones')
      .select('is_active')
      .eq('id', zoneId)
      .single();

    if (fetchError) throw fetchError;

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

    if (error) throw error;

    return {
      success: true,
      zone: data
    };
  } catch (error) {
    console.error('Error toggling shipping zone status:', error);
    return {
      success: false,
      error: error.message
    };
  }
};

/**
 * Delete shipping zone (admin only)
 * @param {string} zoneId - Shipping zone ID
 * @returns {Object} Deletion result
 */
export const deleteShippingZone = async (zoneId) => {
  try {
    const { error } = await supabase
      .from('shipping_zones')
      .delete()
      .eq('id', zoneId);

    if (error) throw error;

    return {
      success: true
    };
  } catch (error) {
    console.error('Error deleting shipping zone:', error);
    return {
      success: false,
      error: error.message
    };
  }
};

/**
 * Bulk update shipping costs (admin only)
 * @param {Array} updates - Array of {id, shippingCost}
 * @returns {Object} Update result
 */
export const bulkUpdateShippingCosts = async (updates) => {
  try {
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
      success: true,
      updatedCount: updates.length
    };
  } catch (error) {
    console.error('Error bulk updating shipping costs:', error);
    return {
      success: false,
      error: error.message
    };
  }
};

/**
 * Set free shipping for province (admin only)
 * @param {string} zoneId - Shipping zone ID
 * @param {boolean} freeShipping - Whether to enable free shipping
 * @returns {Object} Updated shipping zone
 */
export const setFreeShipping = async (zoneId, freeShipping) => {
  try {
    const { data, error } = await supabase
      .from('shipping_zones')
      .update({
        free_shipping: freeShipping,
        updated_at: new Date().toISOString()
      })
      .eq('id', zoneId)
      .select()
      .single();

    if (error) throw error;

    return {
      success: true,
      zone: data
    };
  } catch (error) {
    console.error('Error setting free shipping:', error);
    return {
      success: false,
      error: error.message
    };
  }
};

/**
 * Get provinces with free shipping
 * @returns {Array} List of provinces with free shipping
 */
export const getFreeShippingProvinces = async () => {
  try {
    const { data, error } = await supabase
      .from('shipping_zones')
      .select('*')
      .eq('is_active', true)
      .eq('free_shipping', true)
      .order('province_name', { ascending: true });

    if (error) throw error;

    return {
      success: true,
      provinces: data || []
    };
  } catch (error) {
    console.error('Error fetching free shipping provinces:', error);
    return {
      success: false,
      error: error.message,
      provinces: []
    };
  }
};

/**
 * Get shipping statistics (admin only)
 * @returns {Object} Shipping statistics
 */
export const getShippingStatistics = async () => {
  try {
    const { data, error } = await supabase
      .from('shipping_zones')
      .select('shipping_cost, free_shipping, is_active');

    if (error) throw error;

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

    return {
      success: true,
      statistics: stats
    };
  } catch (error) {
    console.error('Error fetching shipping statistics:', error);
    return {
      success: false,
      error: error.message
    };
  }
};

/**
 * Validate province name exists in shipping zones
 * @param {string} provinceName - Province name to validate
 * @returns {boolean} Whether province exists
 */
export const validateProvinceName = async (provinceName) => {
  try {
    const { data, error } = await supabase
      .from('shipping_zones')
      .select('id')
      .eq('province_name', provinceName)
      .eq('is_active', true)
      .single();

    if (error && error.code !== 'PGRST116') throw error;

    return {
      success: true,
      exists: !!data
    };
  } catch (error) {
    console.error('Error validating province name:', error);
    return {
      success: false,
      exists: false
    };
  }
};
