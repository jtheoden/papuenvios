/**
 * Order Discount Service
 * Handles discount logic for orders including:
 * - User category discounts
 * - Promotional offers
 * - Discount application and validation
 */

import { supabase } from './supabase';
import { calculateOrderTotal, calculateDiscount } from './priceCalculationService';
import { logActivity } from './activityLogger';

/**
 * Get user category and associated discount
 * @param {string} userId - User ID
 * @returns {object} User category and discount info
 */
export const getUserCategoryWithDiscount = async (userId) => {
  try {
    // Get user category
    const { data: categoryData, error: categoryError } = await supabase
      .from('user_categories')
      .select('category_name')
      .eq('user_id', userId)
      .maybeSingle();

    if (categoryError || !categoryData) {
      // Default to regular if not found
      return {
        category: 'regular',
        discountPercent: 0,
        categoryFound: false
      };
    }

    const category = categoryData.category_name || 'regular';

    // Get discount for this category
    const { data: discountData, error: discountError } = await supabase
      .from('category_discounts')
      .select('discount_percentage, enabled, category_name')
      .eq('category_name', category)
      .maybeSingle();

    if (discountError || !discountData) {
      return {
        category,
        discountPercent: 0,
        enabled: false,
        categoryFound: true
      };
    }

    return {
      category,
      discountPercent: discountData.enabled ? (discountData.discount_percentage || 0) : 0,
      enabled: discountData.enabled,
      categoryFound: true
    };
  } catch (error) {
    console.error('Error getting user category discount:', error);
    return {
      category: 'regular',
      discountPercent: 0,
      error: error.message
    };
  }
};

/**
 * Validate and apply promotional offer code
 * @param {string} offerCode - Offer code to validate
 * @param {number} subtotal - Current order subtotal
 * @param {string} userId - User ID (for per-user usage limits)
 * @returns {object} Offer details and validation result
 */
export const validateAndGetOffer = async (offerCode, subtotal = 0, userId = null) => {
  try {
    // Get offer by code
    const { data: offers, error: offerError } = await supabase
      .from('offers')
      .select('*')
      .eq('code', offerCode.toUpperCase())
      .eq('is_active', true)
      .single();

    if (offerError || !offers) {
      return {
        valid: false,
        reason: 'Offer code not found or inactive',
        code: offerCode
      };
    }

    // Check if offer has passed expiry date
    if (offers.valid_until && new Date(offers.valid_until) < new Date()) {
      return {
        valid: false,
        reason: 'Offer has expired',
        code: offerCode,
        expiredDate: offers.valid_until
      };
    }

    // Check minimum purchase amount
    if (offers.min_purchase_amount && subtotal < offers.min_purchase_amount) {
      return {
        valid: false,
        reason: `Minimum purchase amount required: $${offers.min_purchase_amount}`,
        requiredAmount: offers.min_purchase_amount,
        currentAmount: subtotal,
        code: offerCode
      };
    }

    const safeUsageCheck = async (queryFn) => {
      try {
        const { data, error } = await queryFn();
        if (error) {
          // Gracefully skip usage enforcement on permission errors to avoid blocking checkout
          if (['42501', 'PGRST301'].includes(error.code) || error.message?.toLowerCase().includes('permission')) {
            console.warn('[discount] Offer usage check skipped due to permission error:', error.message);
            return null;
          }
          throw error;
        }
        return data || [];
      } catch (usageErr) {
        console.warn('[discount] Offer usage check failed:', usageErr?.message || usageErr);
        return null;
      }
    };

    // Check global usage limit
    if (offers.max_usage_global) {
      const usageData = await safeUsageCheck(() => supabase
        .from('offer_usage')
        .select('id')
        .eq('offer_id', offers.id));

      if (usageData && usageData.length >= offers.max_usage_global) {
        return {
          valid: false,
          reason: 'Offer has reached its usage limit',
          code: offerCode
        };
      }
    }

    // Check per-user usage limit
    if (userId && offers.max_usage_per_user) {
      const userUsageData = await safeUsageCheck(() => supabase
        .from('offer_usage')
        .select('id')
        .eq('offer_id', offers.id)
        .eq('user_id', userId));

      if (userUsageData && userUsageData.length >= offers.max_usage_per_user) {
        return {
          valid: false,
          reason: `You have already used this offer ${userUsageData.length} times (limit: ${offers.max_usage_per_user})`,
          userUsageCount: userUsageData.length,
          code: offerCode
        };
      }
    }

    return {
      valid: true,
      offer: offers,
      code: offerCode,
      applicable: true
    };
  } catch (error) {
    console.error('Error validating offer code:', error);
    return {
      valid: false,
      reason: 'Error validating offer code',
      error: error.message,
      code: offerCode
    };
  }
};

/**
 * Record offer usage when order is created
 * @param {string} offerId - Offer ID
 * @param {string} userId - User ID
 * @param {string} orderId - Order ID
 * @returns {boolean} Success status
 */
export const recordOfferUsage = async (offerId, userId = null, orderId = null) => {
  try {
    const { error } = await supabase
      .from('offer_usage')
      .insert([
        {
          offer_id: offerId,
          user_id: userId || null,
          order_id: orderId || null,
          used_at: new Date().toISOString()
        }
      ]);

    if (error) {
      if (['42501', 'PGRST301'].includes(error.code) || error.message?.toLowerCase().includes('permission')) {
        console.warn('[discount] Offer usage recording skipped due to permission error');
        return true; // Do not block the flow
      }
      console.error('Error recording offer usage:', error);
      return false;
    }

    await logActivity({
      action: 'offer_usage_recorded',
      entityType: 'offer',
      entityId: offerId,
      performedBy: userId || 'anonymous',
      description: 'User redeemed offer during checkout',
      metadata: { orderId, userId }
    });

    return true;
  } catch (error) {
    console.error('Error recording offer usage:', error);
    return false;
  }
};

/**
 * Get all active discounts for a user (category + applicable offers)
 * @param {string} userId - User ID
 * @returns {object} All applicable discounts for the user
 */
export const getUserApplicableDiscounts = async (userId) => {
  try {
    // Get user category discount
    const categoryDiscount = await getUserCategoryWithDiscount(userId);

    // Get applicable offers for this user (this would require additional logic)
    // For now, just return category discount
    return {
      categoryDiscount,
      categoryDiscountPercent: categoryDiscount.discountPercent,
      applicableOffers: []
    };
  } catch (error) {
    console.error('Error getting applicable discounts:', error);
    return {
      categoryDiscount: {
        category: 'regular',
        discountPercent: 0,
        error: error.message
      },
      categoryDiscountPercent: 0,
      applicableOffers: []
    };
  }
};

/**
 * Calculate complete order with all discounts applied
 * This is the primary function used during checkout
 * @param {object} params - Order calculation parameters
 * @param {number} params.subtotal - Cart subtotal before discounts
 * @param {string} params.userId - User ID (for category discount)
 * @param {string} params.offerCode - Promotional offer code (optional)
 * @param {number} params.shippingCost - Shipping cost
 * @param {number} params.taxPercent - Tax percentage (optional)
 * @returns {object} Complete order calculation with all discounts
 */
export const calculateOrderWithDiscounts = async ({
  subtotal = 0,
  userId = null,
  offerCode = null,
  shippingCost = 0,
  taxPercent = 0
} = {}) => {
  try {
    let categoryDiscount = 0;
    let offerData = null;

    // Get user category discount
    if (userId) {
      const userCategoryInfo = await getUserCategoryWithDiscount(userId);
      categoryDiscount = userCategoryInfo.discountPercent || 0;
    }

    // Validate and get offer if code provided
    if (offerCode && typeof offerCode === 'string' && offerCode.trim()) {
      const offerValidation = await validateAndGetOffer(offerCode, subtotal, userId);
      if (offerValidation.valid && offerValidation.offer) {
        offerData = offerValidation.offer;
      }
    }

    // Calculate total with all discounts
    const orderCalculation = calculateOrderTotal({
      subtotal,
      categoryDiscount,
      offer: offerData,
      shippingCost,
      taxPercent
    });

    return {
      ...orderCalculation,
      categoryApplied: categoryDiscount > 0,
      offerApplied: offerData ? true : false,
      offerId: offerData ? offerData.id : null,
      userCategoryDiscount: categoryDiscount
    };
  } catch (error) {
    console.error('Error calculating order with discounts:', error);
    // Return calculation without discounts if error occurs
    return calculateOrderTotal({
      subtotal,
      categoryDiscount: 0,
      offer: null,
      shippingCost,
      taxPercent
    });
  }
};

/**
 * Get discount breakdown for display
 * Shows user what discounts they're eligible for and which are applied
 * @param {string} userId - User ID
 * @param {number} subtotal - Current subtotal
 * @returns {object} Discount breakdown for UI display
 */
export const getDiscountBreakdown = async (userId, subtotal = 0) => {
  try {
    const applicable = await getUserApplicableDiscounts(userId);

    const breakdown = {
      eligibleDiscounts: {
        categoryDiscount: {
          category: applicable.categoryDiscount.category,
          percent: applicable.categoryDiscount.discountPercent,
          amount: calculateDiscount(subtotal, applicable.categoryDiscount.discountPercent),
          enabled: applicable.categoryDiscount.discountPercent > 0
        }
      },
      totalEligibleDiscount: applicable.categoryDiscountPercent,
      potentialSavings: calculateDiscount(subtotal, applicable.categoryDiscountPercent),
      hasDiscounts: applicable.categoryDiscountPercent > 0 || (applicable.applicableOffers && applicable.applicableOffers.length > 0)
    };

    return breakdown;
  } catch (error) {
    console.error('Error getting discount breakdown:', error);
    return {
      eligibleDiscounts: {},
      totalEligibleDiscount: 0,
      potentialSavings: 0,
      hasDiscounts: false,
      error: error.message
    };
  }
};
