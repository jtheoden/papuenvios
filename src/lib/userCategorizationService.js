/**
 * User Categorization Service
 * Manages automatic categorization based on interaction count
 * Categories: regular (0+), pro (5+), vip (10+)
 */

import { supabase } from './supabase';
import {
  handleError, logError, parseSupabaseError,
  createValidationError, ERROR_CODES
} from './errorHandler';

/**
 * Get all category rules
 * @returns {Promise<Array>} Category rules with thresholds
 */
export const getCategoryRules = async () => {
  try {
    const { data, error } = await supabase
      .from('category_rules')
      .select('*')
      .eq('enabled', true)
      .order('interaction_threshold', { ascending: true });

    if (error) throw parseSupabaseError(error);
    return data || [];
  } catch (error) {
    if (error.code) throw error;
    const appError = handleError(error, ERROR_CODES.DB_ERROR, { operation: 'getCategoryRules' });
    logError(appError);
    throw appError;
  }
};

/**
 * Get category by name
 * @param {string} categoryName - Category name (regular, pro, vip)
 * @returns {Promise<Object>} Category object
 */
export const getCategoryByName = async (categoryName) => {
  try {
    const { data, error } = await supabase
      .from('category_rules')
      .select('*')
      .eq('category_name', categoryName)
      .single();

    if (error) throw parseSupabaseError(error);
    return data;
  } catch (error) {
    if (error.code) throw error;
    const appError = handleError(error, ERROR_CODES.DB_ERROR, { operation: 'getCategoryByName', categoryName });
    logError(appError);
    throw appError;
  }
};

/**
 * Get all discounts by category
 * @returns {Promise<Array>} All category discounts
 */
export const getCategoryDiscounts = async () => {
  try {
    const { data, error } = await supabase
      .from('category_discounts')
      .select('*')
      .order('category_name', { ascending: true });

    if (error) throw parseSupabaseError(error);
    return data || [];
  } catch (error) {
    if (error.code) throw error;
    const appError = handleError(error, ERROR_CODES.DB_ERROR, { operation: 'getCategoryDiscounts' });
    logError(appError);
    throw appError;
  }
};

/**
 * Get discount for specific category
 * @param {string} categoryName - Category name
 * @returns {Promise<Object>} Discount object
 */
export const getCategoryDiscount = async (categoryName) => {
  try {
    const { data, error } = await supabase
      .from('category_discounts')
      .select('*')
      .eq('category_name', categoryName)
      .single();

    if (error) throw parseSupabaseError(error);
    return data;
  } catch (error) {
    if (error.code) throw error;
    const appError = handleError(error, ERROR_CODES.DB_ERROR, { operation: 'getCategoryDiscount', categoryName });
    logError(appError);
    throw appError;
  }
};

/**
 * Update category discount
 * @param {string} categoryName - Category name
 * @param {Object} discountData - Discount percentage and description
 * @returns {Promise<Object>} Updated discount
 */
export const updateCategoryDiscount = async (categoryName, discountData) => {
  try {
    if (!categoryName || !discountData) {
      throw createValidationError({ categoryName, discountData: 'Required' });
    }

    const { data, error } = await supabase
      .from('category_discounts')
      .update({
        discount_percentage: discountData.discount_percentage,
        discount_description: discountData.discount_description,
        enabled: discountData.enabled !== undefined ? discountData.enabled : true,
        updated_at: new Date().toISOString()
      })
      .eq('category_name', categoryName)
      .select()
      .single();

    if (error) throw parseSupabaseError(error);
    return data;
  } catch (error) {
    if (error.code) throw error;
    const appError = handleError(error, ERROR_CODES.DB_ERROR, { operation: 'updateCategoryDiscount', categoryName });
    logError(appError);
    throw appError;
  }
};

/**
 * Count user interactions (orders + remittances)
 * @param {string} userId - User ID
 * @returns {Promise<number>} Total interaction count
 */
export const getInteractionCount = async (userId) => {
  try {
    if (!userId) {
      throw createValidationError({ userId: 'User ID is required' });
    }

    // Count orders
    const { count: orderCount, error: orderError } = await supabase
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .neq('status', 'cancelled');

    if (orderError) throw parseSupabaseError(orderError);

    // Count remittances
    const { count: remittanceCount, error: remittanceError } = await supabase
      .from('remittances')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .neq('status', 'cancelled_at');

    if (remittanceError) throw parseSupabaseError(remittanceError);

    return (orderCount || 0) + (remittanceCount || 0);
  } catch (error) {
    if (error.code) throw error;
    const appError = handleError(error, ERROR_CODES.DB_ERROR, { operation: 'getInteractionCount', userId });
    logError(appError);
    throw appError;
  }
};

/**
 * Calculate appropriate category for user based on interaction count
 * @param {number} interactionCount - Total interactions
 * @param {Array} rules - Category rules (from getCategoryRules)
 * @returns {string} Category name (regular, pro, or vip)
 */
export const calculateCategoryByInteractions = (interactionCount, rules) => {
  if (!rules || rules.length === 0) return 'regular';

  // Sort rules by threshold descending to find the highest applicable category
  const sortedRules = [...rules].sort((a, b) => b.interaction_threshold - a.interaction_threshold);

  for (const rule of sortedRules) {
    if (interactionCount >= rule.interaction_threshold) {
      return rule.category_name;
    }
  }

  return 'regular'; // Fallback
};

/**
 * Get current category for user
 * @param {string} userId - User ID
 * @returns {Promise<Object>} Current user category record
 */
export const getUserCategory = async (userId) => {
  try {
    if (!userId) {
      throw createValidationError({ userId: 'User ID is required' });
    }

    const { data, error } = await supabase
      .from('user_categories')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (error) {
      // If no category exists yet, return null (will be created)
      if (error.code === 'PGRST116') return null;
      throw parseSupabaseError(error);
    }

    return data;
  } catch (error) {
    if (error.code && error.code !== 'PGRST116') throw error;
    if (!error.code) {
      const appError = handleError(error, ERROR_CODES.DB_ERROR, { operation: 'getUserCategory', userId });
      logError(appError);
      throw appError;
    }
    return null;
  }
};

/**
 * Set user category (manual override)
 * @param {string} userId - User ID
 * @param {string} categoryName - Category name to assign
 * @param {string} assignedBy - Admin user ID who made the assignment
 * @param {string} reason - Reason for assignment
 * @returns {Promise<Object>} Updated or created category record
 */
export const setUserCategory = async (userId, categoryName, assignedBy, reason = 'manual') => {
  try {
    if (!userId || !categoryName) {
      throw createValidationError({ userId, categoryName: 'Both are required' });
    }

    // Get current category for history
    const currentCategory = await getUserCategory(userId);
    const oldCategory = currentCategory?.category_name || 'regular';

    // Upsert user category
    const { data, error } = await supabase
      .from('user_categories')
      .upsert(
        {
          user_id: userId,
          category_name: categoryName,
          assigned_at: new Date().toISOString(),
          assigned_by: assignedBy,
          assignment_reason: reason,
          effective_from: new Date().toISOString(),
          updated_at: new Date().toISOString()
        },
        { onConflict: 'user_id' }
      )
      .select()
      .single();

    if (error) throw parseSupabaseError(error);

    // Record history if category changed
    if (oldCategory !== categoryName) {
      await supabase
        .from('user_category_history')
        .insert({
          user_id: userId,
          old_category: oldCategory,
          new_category: categoryName,
          changed_by: assignedBy,
          change_reason: reason,
          changed_at: new Date().toISOString()
        });
    }

    return data;
  } catch (error) {
    if (error.code) throw error;
    const appError = handleError(error, ERROR_CODES.DB_ERROR, { operation: 'setUserCategory', userId, categoryName });
    logError(appError);
    throw appError;
  }
};

/**
 * Auto-calculate and update user category based on interaction count
 * @param {string} userId - User ID
 * @returns {Promise<Object>} Updated category record
 */
export const recalculateUserCategory = async (userId) => {
  try {
    if (!userId) {
      throw createValidationError({ userId: 'User ID is required' });
    }

    // Get rules and interaction count
    const [rules, interactionCount] = await Promise.all([
      getCategoryRules(),
      getInteractionCount(userId)
    ]);

    // Calculate appropriate category
    const newCategory = calculateCategoryByInteractions(interactionCount, rules);

    // Set the category as automatic
    const result = await setUserCategory(userId, newCategory, null, 'automatic');

    return result;
  } catch (error) {
    if (error.code) throw error;
    const appError = handleError(error, ERROR_CODES.DB_ERROR, { operation: 'recalculateUserCategory', userId });
    logError(appError);
    throw appError;
  }
};

/**
 * Recalculate all users' categories
 * Useful for bulk updates when rules change
 * @returns {Promise<Object>} Summary of results
 */
export const recalculateAllCategories = async () => {
  try {
    // Get all users
    const { data: users, error: usersError } = await supabase
      .from('user_profiles')
      .select('user_id')
      .eq('role', 'user');

    if (usersError) throw parseSupabaseError(usersError);

    const results = {
      total: users?.length || 0,
      processed: 0,
      errors: []
    };

    // Process each user
    if (users && users.length > 0) {
      for (const user of users) {
        try {
          await recalculateUserCategory(user.user_id);
          results.processed++;
        } catch (err) {
          results.errors.push({ userId: user.user_id, error: err.message });
        }
      }
    }

    return results;
  } catch (error) {
    if (error.code) throw error;
    const appError = handleError(error, ERROR_CODES.DB_ERROR, { operation: 'recalculateAllCategories' });
    logError(appError);
    throw appError;
  }
};

/**
 * Get category statistics for admin dashboard
 * @returns {Promise<Object>} Stats of users in each category
 */
export const getCategoryStats = async () => {
  try {
    const { data, error } = await supabase
      .from('user_categories')
      .select('category_name')
      .eq('assignment_reason', 'automatic');

    if (error) throw parseSupabaseError(error);

    const stats = {
      regular: 0,
      pro: 0,
      vip: 0,
      total: data?.length || 0
    };

    if (data) {
      data.forEach(item => {
        if (stats.hasOwnProperty(item.category_name)) {
          stats[item.category_name]++;
        }
      });
    }

    return stats;
  } catch (error) {
    if (error.code) throw error;
    const appError = handleError(error, ERROR_CODES.DB_ERROR, { operation: 'getCategoryStats' });
    logError(appError);
    throw appError;
  }
};
