/**
 * Business Status Service
 * Manages business open/closed status and global pricing configuration
 * Only super_admin can modify these settings
 */

import { supabase } from './supabase';
import {
  handleError,
  logError,
  createValidationError,
  parseSupabaseError,
  ERROR_CODES
} from './errorHandler';

// Cache for business status (short TTL since it's critical)
let businessStatusCache = null;
let businessStatusCacheTime = 0;
const CACHE_TTL = 30000; // 30 seconds

// Cache for global pricing
let globalPricingCache = null;
let globalPricingCacheTime = 0;

/**
 * Get current business status
 * Automatically reopens if expected_reopen_at has passed and auto_reopen is true
 * @returns {Promise<Object>} Business status object
 */
export const getBusinessStatus = async () => {
  try {
    // Check cache first
    if (businessStatusCache && Date.now() - businessStatusCacheTime < CACHE_TTL) {
      // Even with cache, check for auto-reopen
      const status = businessStatusCache;
      if (status && !status.is_open && status.auto_reopen && status.expected_reopen_at) {
        const reopenTime = new Date(status.expected_reopen_at).getTime();
        if (Date.now() >= reopenTime) {
          // Time to auto-reopen - trigger it
          await triggerAutoReopen();
          // Clear cache to get fresh status
          businessStatusCache = null;
        } else {
          return status;
        }
      } else {
        return status;
      }
    }

    const { data, error } = await supabase
      .from('system_config')
      .select('value_json')
      .eq('key', 'business_status')
      .single();

    if (error) {
      // If not found, return default (open)
      if (error.code === 'PGRST116') {
        return {
          is_open: true,
          closed_message_es: 'Estamos temporalmente cerrados.',
          closed_message_en: 'We are temporarily closed.',
          closed_by: null,
          closed_at: null,
          expected_reopen_at: null,
          auto_reopen: false
        };
      }
      throw parseSupabaseError(error);
    }

    const status = data?.value_json || { is_open: true };

    // Check if we need to auto-reopen
    if (!status.is_open && status.auto_reopen && status.expected_reopen_at) {
      const reopenTime = new Date(status.expected_reopen_at).getTime();
      if (Date.now() >= reopenTime) {
        // Time to auto-reopen
        await triggerAutoReopen();
        // Fetch fresh status after reopen
        const { data: freshData } = await supabase
          .from('system_config')
          .select('value_json')
          .eq('key', 'business_status')
          .single();

        businessStatusCache = freshData?.value_json || { is_open: true };
        businessStatusCacheTime = Date.now();
        return businessStatusCache;
      }
    }

    businessStatusCache = status;
    businessStatusCacheTime = Date.now();

    return businessStatusCache;
  } catch (error) {
    if (error.code) throw error;
    const appError = handleError(error, ERROR_CODES.DB_ERROR, { operation: 'getBusinessStatus' });
    logError(appError, { operation: 'getBusinessStatus' });
    throw appError;
  }
};

/**
 * Trigger automatic reopening of the business
 * Called when expected_reopen_at time has passed
 */
const triggerAutoReopen = async () => {
  try {
    // Update directly without RPC (auto-reopen doesn't need super_admin check)
    const { error } = await supabase
      .from('system_config')
      .update({
        value_json: {
          is_open: true,
          closed_message_es: businessStatusCache?.closed_message_es || 'Estamos temporalmente cerrados.',
          closed_message_en: businessStatusCache?.closed_message_en || 'We are temporarily closed.',
          closed_by: null,
          closed_at: null,
          expected_reopen_at: null,
          auto_reopen: false,
          auto_reopened_at: new Date().toISOString()
        },
        updated_at: new Date().toISOString()
      })
      .eq('key', 'business_status');

    if (error) {
      logError(error, { operation: 'triggerAutoReopen' });
    }
  } catch (error) {
    logError(error, { operation: 'triggerAutoReopen' });
  }
};

/**
 * Check if business is currently open
 * @returns {Promise<boolean>} True if business is open
 */
export const isBusinessOpen = async () => {
  try {
    const status = await getBusinessStatus();
    return status?.is_open !== false;
  } catch (error) {
    // Default to open if we can't determine status
    logError(error, { operation: 'isBusinessOpen' });
    return true;
  }
};

/**
 * Set business status (SUPER_ADMIN ONLY)
 * @param {boolean} isOpen - Whether business is open
 * @param {Object} options - Additional options
 * @param {string} [options.messageEs] - Spanish closed message
 * @param {string} [options.messageEn] - English closed message
 * @param {Date} [options.expectedReopenAt] - Expected reopen time
 * @param {boolean} [options.autoReopen] - Auto-reopen when expectedReopenAt is reached
 * @returns {Promise<Object>} Updated business status
 */
export const setBusinessStatus = async (isOpen, options = {}) => {
  try {
    // Determine auto_reopen: true if closing with a reopen time set
    const autoReopen = !isOpen && options.expectedReopenAt ? (options.autoReopen !== false) : false;

    const { data, error } = await supabase.rpc('set_business_status', {
      p_is_open: isOpen,
      p_message_es: options.messageEs || null,
      p_message_en: options.messageEn || null,
      p_expected_reopen_at: options.expectedReopenAt || null,
      p_auto_reopen: autoReopen
    });

    if (error) {
      throw parseSupabaseError(error);
    }

    // Clear cache
    businessStatusCache = null;
    businessStatusCacheTime = 0;

    return data;
  } catch (error) {
    if (error.code) throw error;
    const appError = handleError(error, ERROR_CODES.DB_ERROR, {
      operation: 'setBusinessStatus',
      isOpen
    });
    logError(appError, { operation: 'setBusinessStatus', isOpen });
    throw appError;
  }
};

/**
 * Get global pricing configuration
 * @returns {Promise<Object>} Global pricing config
 */
export const getGlobalPricing = async () => {
  try {
    // Check cache first
    if (globalPricingCache && Date.now() - globalPricingCacheTime < CACHE_TTL) {
      return globalPricingCache;
    }

    const { data, error } = await supabase
      .from('system_config')
      .select('value_json')
      .eq('key', 'global_pricing')
      .single();

    if (error) {
      // If not found, return default (1.0 multiplier)
      if (error.code === 'PGRST116') {
        return {
          price_multiplier: 1.0,
          applies_to_orders: true,
          applies_to_combos: true,
          last_updated_by: null,
          last_updated_at: null,
          history: []
        };
      }
      throw parseSupabaseError(error);
    }

    globalPricingCache = data?.value_json || { price_multiplier: 1.0 };
    globalPricingCacheTime = Date.now();

    return globalPricingCache;
  } catch (error) {
    if (error.code) throw error;
    const appError = handleError(error, ERROR_CODES.DB_ERROR, { operation: 'getGlobalPricing' });
    logError(appError, { operation: 'getGlobalPricing' });
    throw appError;
  }
};

/**
 * Get global price multiplier
 * @returns {Promise<number>} Price multiplier (default 1.0)
 */
export const getGlobalPriceMultiplier = async () => {
  try {
    const pricing = await getGlobalPricing();
    return parseFloat(pricing?.price_multiplier) || 1.0;
  } catch (error) {
    logError(error, { operation: 'getGlobalPriceMultiplier' });
    return 1.0;
  }
};

/**
 * Set global price multiplier (SUPER_ADMIN ONLY)
 * @param {number} multiplier - Price multiplier (e.g., 1.1 for 10% increase)
 * @param {Object} options - Additional options
 * @param {boolean} [options.appliesToOrders=true] - Apply to orders
 * @param {boolean} [options.appliesToCombos=true] - Apply to combos
 * @returns {Promise<Object>} Updated pricing config
 */
export const setGlobalPriceMultiplier = async (multiplier, options = {}) => {
  try {
    if (multiplier <= 0) {
      throw createValidationError(
        { multiplier: 'Price multiplier must be greater than 0' },
        'Invalid multiplier'
      );
    }

    const { data, error } = await supabase.rpc('set_global_price_multiplier', {
      p_multiplier: multiplier,
      p_applies_to_orders: options.appliesToOrders !== false,
      p_applies_to_combos: options.appliesToCombos !== false
    });

    if (error) {
      throw parseSupabaseError(error);
    }

    // Clear cache
    globalPricingCache = null;
    globalPricingCacheTime = 0;

    return data;
  } catch (error) {
    if (error.code) throw error;
    const appError = handleError(error, ERROR_CODES.DB_ERROR, {
      operation: 'setGlobalPriceMultiplier',
      multiplier
    });
    logError(appError, { operation: 'setGlobalPriceMultiplier', multiplier });
    throw appError;
  }
};

/**
 * Apply global price multiplier to a price
 * Use this when calculating order prices
 * @param {number} price - Original price
 * @param {number} [multiplier] - Optional multiplier (will fetch if not provided)
 * @returns {Promise<number>} Price with multiplier applied
 */
export const applyGlobalPriceMultiplier = async (price, multiplier = null) => {
  try {
    if (!price || isNaN(price)) return 0;

    const mult = multiplier || await getGlobalPriceMultiplier();
    return parseFloat((parseFloat(price) * mult).toFixed(2));
  } catch (error) {
    logError(error, { operation: 'applyGlobalPriceMultiplier', price });
    return parseFloat(price) || 0;
  }
};

/**
 * Synchronous version using cached multiplier
 * Use this in render functions where async is not possible
 * @param {number} price - Original price
 * @returns {number} Price with cached multiplier applied
 */
export const applyGlobalPriceMultiplierSync = (price) => {
  if (!price || isNaN(price)) return 0;
  const mult = globalPricingCache?.price_multiplier || 1.0;
  return parseFloat((parseFloat(price) * mult).toFixed(2));
};

/**
 * Clear all caches (use after admin changes settings)
 */
export const clearBusinessStatusCache = () => {
  businessStatusCache = null;
  businessStatusCacheTime = 0;
  globalPricingCache = null;
  globalPricingCacheTime = 0;
};

/**
 * Subscribe to business status changes (realtime)
 * @param {Function} callback - Called when status changes
 * @returns {Function} Unsubscribe function
 */
export const subscribeToBusinessStatus = (callback) => {
  const channel = supabase
    .channel('business-status-changes')
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'system_config',
        filter: "key=eq.business_status"
      },
      (payload) => {
        // Clear cache and notify
        businessStatusCache = payload.new?.value_json;
        businessStatusCacheTime = Date.now();
        callback(payload.new?.value_json);
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
};

/**
 * Subscribe to global pricing changes (realtime)
 * @param {Function} callback - Called when pricing changes
 * @returns {Function} Unsubscribe function
 */
export const subscribeToGlobalPricing = (callback) => {
  const channel = supabase
    .channel('global-pricing-changes')
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'system_config',
        filter: "key=eq.global_pricing"
      },
      (payload) => {
        // Clear cache and notify
        globalPricingCache = payload.new?.value_json;
        globalPricingCacheTime = Date.now();
        callback(payload.new?.value_json);
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
};
