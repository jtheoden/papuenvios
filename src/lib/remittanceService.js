/**
 * Remittance Service
 * Manages remittance types, remittance orders, and all related operations
 * Uses standardized error handling with AppError class
 */

import { supabase } from '@/lib/supabase';
import { logActivity } from '@/lib/activityLogger';
import { recordOfferUsage } from '@/lib/orderDiscountService';
import {
  handleError,
  logError,
  createValidationError,
  createNotFoundError,
  parseSupabaseError,
  createPermissionError,
  ERROR_CODES
} from './errorHandler';
import {
  notifyAdminNewPaymentProof,
  notifyUserPaymentValidated,
  notifyUserPaymentRejected,
  notifyUserRemittanceDelivered
} from '@/lib/whatsappService';
import { getFreshWhatsappRecipient } from '@/lib/notificationSettingsService';
import {
  getAvailableZelleAccount,
  registerZelleTransaction,
  upsertZelleTransactionStatus,
  ZELLE_STATUS,
  ZELLE_TRANSACTION_TYPES
} from '@/lib/zelleService';
import { getExchangeRate as getCurrencyExchangeRate } from '@/lib/currencyService';

/**
 * Extract file path from a Supabase storage URL or return path as-is
 * Handles backwards compatibility where some records may store full URLs
 * @param {string} urlOrPath - Either a full Supabase storage URL or just the file path
 * @param {string} bucketName - The bucket name to extract path from
 * @returns {string} The file path only
 */
const extractPathFromUrl = (urlOrPath, bucketName) => {
  if (!urlOrPath) return urlOrPath;

  // Check if it's a full URL containing the bucket name
  const publicUrlPattern = `/storage/v1/object/public/${bucketName}/`;
  const signedUrlPattern = `/storage/v1/object/sign/${bucketName}/`;

  if (urlOrPath.includes(publicUrlPattern)) {
    // Extract path after the bucket portion
    const parts = urlOrPath.split(publicUrlPattern);
    return parts[1] || urlOrPath;
  }

  if (urlOrPath.includes(signedUrlPattern)) {
    // Extract path from signed URL (before query params)
    const parts = urlOrPath.split(signedUrlPattern);
    const pathWithParams = parts[1] || urlOrPath;
    return pathWithParams.split('?')[0];
  }

  // Already a path, return as-is
  return urlOrPath;
};

/**
 * Generate a signed URL for accessing a proof from private storage
 * Signed URLs are valid for 1 hour and work with private buckets
 * @param {string} proofFilePath - File path in the storage bucket (e.g., "user-id/REM-2025-0001.jpg") or full URL
 * @param {string} bucketName - Optional bucket name (defaults to 'remittance-proofs' for payment proofs)
 * @returns {Promise<{success: boolean, signedUrl?: string, error?: string}>} Result object with signed URL or error
 */
export const generateProofSignedUrl = async (proofFilePath, bucketName = 'remittance-proofs') => {
  try {
    if (!proofFilePath) {
      return {
        success: false,
        error: 'File path is required'
      };
    }

    // Extract path from URL if a full URL was provided (backwards compatibility)
    const filePath = extractPathFromUrl(proofFilePath, bucketName);

    // Generate signed URL valid for 1 hour (3600 seconds)
    const { data, error } = await supabase.storage
      .from(bucketName)
      .createSignedUrl(filePath, 3600);

    if (error) {
      const appError = parseSupabaseError(error);
      logError(appError, { operation: 'generateProofSignedUrl', proofFilePath });
      return {
        success: false,
        error: appError.message || 'Failed to generate signed URL'
      };
    }

    if (!data?.signedUrl) {
      return {
        success: false,
        error: 'No signed URL returned from storage'
      };
    }

    return {
      success: true,
      signedUrl: data.signedUrl
    };
  } catch (error) {
    logError(error, { operation: 'generateProofSignedUrl', proofFilePath });
    return {
      success: false,
      error: error?.message || 'Unknown error generating signed URL'
    };
  }
};

// ============================================================================
// CONSTANTES
// ============================================================================

export const REMITTANCE_STATUS = {
  PAYMENT_PENDING: 'payment_pending',
  PAYMENT_PROOF_UPLOADED: 'payment_proof_uploaded',
  PAYMENT_VALIDATED: 'payment_validated',
  PAYMENT_REJECTED: 'payment_rejected',
  PROCESSING: 'processing',
  DELIVERED: 'delivered',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled'
};

const logRemittancePaymentActivity = async ({ action, remittance, performedBy, description, metadata = {} }) => {
  try {
    const paymentMetadata = {
      paymentType: 'remittance',
      remittanceId: remittance?.id,
      remittanceNumber: remittance?.remittance_number,
      remittanceType: remittance?.remittance_types?.name,
      status: remittance?.status,
      amountToDeliver: remittance?.amount_to_deliver,
      currencySent: remittance?.currency_sent,
      currencyDelivered: remittance?.currency_delivered,
      paymentReference: remittance?.payment_reference || null,
      ...metadata
    };

    return await logActivity({
      action,
      entityType: 'remittance',
      entityId: remittance?.id || null,
      performedBy,
      description,
      metadata: paymentMetadata
    });
  } catch (error) {
    console.warn('[remittanceService] Failed to log payment activity', error);
    return { status: 'error', error };
  }
};

export const DELIVERY_METHODS = {
  CASH: 'cash',
  TRANSFER: 'transfer',
  CARD: 'card'
};

// recipient_bank_account_id column now exists in remittances table (added 2026-01-19)

// ============================================================================
// EXCHANGE RATE HELPERS - Get rate from exchange_rates table with fallback
// ============================================================================

/**
 * Get exchange rate for remittance from exchange_rates table
 * Uses the rate configured in financial settings (exchange_rates table)
 * Falls back to remittance_type.exchange_rate if no configured rate exists
 *
 * @param {string} fromCurrencyCode - Source currency code (e.g., 'USD')
 * @param {string} toCurrencyCode - Target currency code (e.g., 'CUP')
 * @param {number} fallbackRate - Fallback rate from remittance_type if not found
 * @returns {Promise<{rate: number, source: 'configured'|'fallback'}>} Exchange rate and its source
 */
export const getRemittanceExchangeRate = async (fromCurrencyCode, toCurrencyCode, typeRate) => {
  try {
    // Same currency = 1:1 rate
    if (fromCurrencyCode === toCurrencyCode) {
      return { rate: 1, source: 'configured' };
    }

    // The type's exchange_rate is authoritative when set (admin configured it explicitly)
    if (typeRate && typeRate > 0) {
      return { rate: typeRate, source: 'type' };
    }

    // Fallback to exchange_rates table when the type doesn't have its own rate
    const configuredRate = await getCurrencyExchangeRate(fromCurrencyCode, toCurrencyCode);

    if (configuredRate && configuredRate > 0) {
      return { rate: configuredRate, source: 'configured' };
    }

    console.warn(`[getRemittanceExchangeRate] No rate found for ${fromCurrencyCode}→${toCurrencyCode}, using 1`);
    return { rate: 1, source: 'fallback' };
  } catch (error) {
    // If any error, use type rate or 1
    console.warn(`[getRemittanceExchangeRate] Error getting rate for ${fromCurrencyCode}→${toCurrencyCode}`, error);
    return { rate: typeRate || 1, source: 'fallback' };
  }
};

// ============================================================================
// GESTIÓN DE TIPOS DE REMESAS (ADMIN)
// ============================================================================

/**
 * Get all remittance types (Admin)
 * @throws {AppError} If database query fails
 * @returns {Promise<Array>} Array of remittance types
 */
export const getAllRemittanceTypes = async () => {
  try {
    const { data, error } = await supabase
      .from('remittance_types')
      .select('*')
      .order('display_order', { ascending: true });

    if (error) {
      const appError = parseSupabaseError(error);
      logError(appError, { operation: 'getAllRemittanceTypes' });
      throw appError;
    }

    return data || [];
  } catch (error) {
    if (error.code) throw error;
    const appError = handleError(error, ERROR_CODES.DB_ERROR, { operation: 'getAllRemittanceTypes' });
    throw appError;
  }
};

/**
 * Get active remittance types (User)
 * @throws {AppError} If database query fails
 * @returns {Promise<Array>} Array of active remittance types
 */
export const getActiveRemittanceTypes = async () => {
  try {

    const { data, error } = await supabase
      .from('remittance_types')
      .select('*')
      .or('is_active.eq.true,is_active.is.null')
      .order('display_order', { ascending: true });

    if (error) {
      console.error('[getActiveRemittanceTypes] Database error:', error);
      const appError = parseSupabaseError(error);
      logError(appError, { operation: 'getActiveRemittanceTypes' });
      throw appError;
    }

    return data || [];
  } catch (error) {
    console.error('[getActiveRemittanceTypes] Fatal error:', error);
    if (error.code) throw error;
    const appError = handleError(error, ERROR_CODES.DB_ERROR, { operation: 'getActiveRemittanceTypes' });
    throw appError;
  }
};

/**
 * Get a specific remittance type by ID
 * @param {string} typeId - Remittance type ID
 * @throws {AppError} If type not found or query fails
 * @returns {Promise<Object>} Remittance type details
 */
export const getRemittanceTypeById = async (typeId) => {
  try {
    if (!typeId) {
      throw createValidationError({ typeId: 'Type ID is required' });
    }

    const { data, error } = await supabase
      .from('remittance_types')
      .select('*')
      .eq('id', typeId)
      .single();

    if (error) {
      const appError = parseSupabaseError(error);
      if (!data) {
        throw createNotFoundError('Remittance type', typeId);
      }
      logError(appError, { operation: 'getRemittanceTypeById', typeId });
      throw appError;
    }

    return data;
  } catch (error) {
    if (error.code) throw error;
    const appError = handleError(error, ERROR_CODES.DB_ERROR, { operation: 'getRemittanceTypeById', typeId });
    throw appError;
  }
};

/**
 * Create a new remittance type (Admin)
 * @param {Object} typeData - Type creation data
 * @throws {AppError} If validation fails or creation fails
 * @returns {Promise<Object>} Created remittance type
 */
export const createRemittanceType = async (typeData) => {
  try {
    // Validate required fields
    if (!typeData.name || !typeData.currency_code || !typeData.delivery_currency) {
      throw createValidationError({
        name: !typeData.name ? 'Name is required' : undefined,
        currency_code: !typeData.currency_code ? 'Currency code is required' : undefined,
        delivery_currency: !typeData.delivery_currency ? 'Delivery currency is required' : undefined
      }, 'Missing required remittance type fields');
    }

    // Validate numeric fields
    if (!typeData.exchange_rate || parseFloat(typeData.exchange_rate) <= 0) {
      throw createValidationError({ exchange_rate: 'Exchange rate must be greater than 0' });
    }

    if (!typeData.min_amount || parseFloat(typeData.min_amount) <= 0) {
      throw createValidationError({ min_amount: 'Minimum amount must be greater than 0' });
    }

    if (typeData.max_amount && parseFloat(typeData.max_amount) < parseFloat(typeData.min_amount)) {
      throw createValidationError({ max_amount: 'Maximum amount must be greater than minimum' });
    }

    const { data, error } = await supabase
      .from('remittance_types')
      .insert([typeData])
      .select()
      .single();

    if (error) {
      const appError = parseSupabaseError(error);
      logError(appError, { operation: 'createRemittanceType', typeName: typeData.name });
      throw appError;
    }

    return data;
  } catch (error) {
    if (error.code) throw error;
    const appError = handleError(error, ERROR_CODES.DB_ERROR, { operation: 'createRemittanceType' });
    throw appError;
  }
};

/**
 * Update a remittance type (Admin)
 * @param {string} typeId - Remittance type ID
 * @param {Object} updates - Fields to update
 * @throws {AppError} If type not found or update fails
 * @returns {Promise<Object>} Updated remittance type
 */
export const updateRemittanceType = async (typeId, updates) => {
  try {
    if (!typeId) {
      throw createValidationError({ typeId: 'Type ID is required' });
    }

    // Validate numeric fields if provided
    if (updates.exchange_rate !== undefined && parseFloat(updates.exchange_rate) <= 0) {
      throw createValidationError({ exchange_rate: 'Exchange rate must be greater than 0' });
    }

    if (updates.min_amount !== undefined && parseFloat(updates.min_amount) <= 0) {
      throw createValidationError({ min_amount: 'Minimum amount must be greater than 0' });
    }

    if (updates.max_amount && updates.min_amount && parseFloat(updates.max_amount) < parseFloat(updates.min_amount)) {
      throw createValidationError({ max_amount: 'Maximum amount must be greater than minimum' });
    }

    const { data, error } = await supabase
      .from('remittance_types')
      .update(updates)
      .eq('id', typeId)
      .select()
      .single();

    if (error) {
      const appError = parseSupabaseError(error);
      if (!data) {
        throw createNotFoundError('Remittance type', typeId);
      }
      logError(appError, { operation: 'updateRemittanceType', typeId });
      throw appError;
    }

    return data;
  } catch (error) {
    if (error.code) throw error;
    const appError = handleError(error, ERROR_CODES.DB_ERROR, { operation: 'updateRemittanceType', typeId });
    throw appError;
  }
};

/**
 * Delete a remittance type (Super Admin)
 * @param {string} typeId - Remittance type ID to delete
 * @throws {AppError} If type has associated remittances or deletion fails
 * @returns {Promise<boolean>} True if deletion successful
 */
export const deleteRemittanceType = async (typeId) => {
  try {
    if (!typeId) {
      throw createValidationError({ typeId: 'Type ID is required' });
    }

    // Check if there are associated remittances
    const { data: remittances, error: checkError } = await supabase
      .from('remittances')
      .select('id')
      .eq('remittance_type_id', typeId)
      .limit(1);

    if (checkError) {
      const appError = parseSupabaseError(checkError);
      logError(appError, { operation: 'deleteRemittanceType - check', typeId });
      throw appError;
    }

    if (remittances && remittances.length > 0) {
      throw new Error('Cannot delete. There are remittances associated with this type.');
    }

    const { error } = await supabase
      .from('remittance_types')
      .delete()
      .eq('id', typeId);

    if (error) {
      const appError = parseSupabaseError(error);
      logError(appError, { operation: 'deleteRemittanceType', typeId });
      throw appError;
    }

    return true;
  } catch (error) {
    if (error.code) throw error;
    const appError = handleError(error, ERROR_CODES.DB_ERROR, { operation: 'deleteRemittanceType', typeId });
    throw appError;
  }
};

/**
 * Get count of pending remittances for a given type (Admin)
 * Used to warn admin when changing rates that affect in-flight remittances
 * @param {string} typeId - Remittance type ID
 * @returns {Promise<number>} Count of pending remittances
 */
export const getPendingRemittancesCountByType = async (typeId) => {
  try {
    const { count, error } = await supabase
      .from('remittances')
      .select('id', { count: 'exact', head: true })
      .eq('remittance_type_id', typeId)
      .in('status', [
        REMITTANCE_STATUS.PAYMENT_PENDING,
        REMITTANCE_STATUS.PAYMENT_PROOF_UPLOADED,
        REMITTANCE_STATUS.PAYMENT_VALIDATED,
        REMITTANCE_STATUS.PROCESSING
      ]);

    if (error) {
      console.warn('[getPendingRemittancesCountByType] Error:', error);
      return 0;
    }
    return count || 0;
  } catch (error) {
    console.warn('[getPendingRemittancesCountByType] Exception:', error);
    return 0;
  }
};

/**
 * Recalculate a payment_pending remittance at the current type rate
 * Only works for payment_pending status (user hasn't paid yet)
 * @param {string} remittanceId - Remittance ID
 * @throws {AppError} If remittance not found, wrong status, or update fails
 * @returns {Promise<Object>} Updated remittance with new rate and amounts
 */
export const recalculateRemittanceAtCurrentRate = async (remittanceId) => {
  try {
    if (!remittanceId) {
      throw createValidationError({ remittanceId: 'Remittance ID is required' });
    }

    // 1. Fetch remittance with type join
    const remittance = await getRemittanceDetails(remittanceId);
    if (!remittance) {
      throw createNotFoundError('Remittance', remittanceId);
    }

    // 2. Guard: only payment_pending and payment_rejected can be recalculated
    if (remittance.status !== REMITTANCE_STATUS.PAYMENT_PENDING &&
        remittance.status !== REMITTANCE_STATUS.PAYMENT_REJECTED) {
      throw createValidationError(
        { status: 'Only payment_pending or payment_rejected remittances can be recalculated' },
        'Cannot recalculate at this status'
      );
    }

    // 3. Get current type config
    const type = remittance.remittance_types;
    if (!type) {
      throw createNotFoundError('Remittance type', remittance.remittance_type_id);
    }

    // 4. Resolve current exchange rate (same logic as creation)
    const { rate: currentRate } = await getRemittanceExchangeRate(
      remittance.currency_sent,
      remittance.currency_delivered,
      type.exchange_rate
    );
    const currentCommPct = type.commission_percentage || 0;
    const currentCommFixed = type.commission_fixed || 0;

    // 5. Recalculate using the standard formula
    const commissionTotal = (remittance.amount_sent * currentCommPct / 100) + currentCommFixed;
    const amountToDeliver = (remittance.amount_sent - commissionTotal) * currentRate;

    // 6. Update remittance record (double-check status in WHERE clause)
    const { data, error } = await supabase
      .from('remittances')
      .update({
        exchange_rate: currentRate,
        commission_percentage: currentCommPct,
        commission_fixed: currentCommFixed,
        commission_total: parseFloat(commissionTotal.toFixed(2)),
        amount_to_deliver: parseFloat(amountToDeliver.toFixed(2))
      })
      .eq('id', remittanceId)
      .in('status', [REMITTANCE_STATUS.PAYMENT_PENDING, REMITTANCE_STATUS.PAYMENT_REJECTED])
      .select('*, remittance_types(*)')
      .single();

    if (error) {
      throw parseSupabaseError(error);
    }

    return data;
  } catch (error) {
    if (error.code) throw error;
    const appError = handleError(error, ERROR_CODES.DB_ERROR, {
      operation: 'recalculateRemittanceAtCurrentRate',
      remittanceId
    });
    throw appError;
  }
};

// ============================================================================
// GESTIÓN DE REMESAS (USUARIO)
// ============================================================================

/**
 * Calculate remittance details including exchange rate, commissions, and delivery amount
 * Uses exchange rate from exchange_rates table (financial settings) when available,
 * falls back to remittance_type.exchange_rate if not configured
 *
 * @param {string} typeId - Remittance type ID
 * @param {number} amount - Amount to send
 * @throws {AppError} If type not found, amount invalid, or calculation fails
 * @returns {Promise<Object>} Calculation details with commission and delivery amount
 */
export const calculateRemittance = async (typeId, amount, offer = null) => {
  try {
    if (!typeId || amount === undefined || amount === null) {
      throw createValidationError(
        { typeId: !typeId ? 'Type ID is required' : undefined, amount: !amount ? 'Amount is required' : undefined },
        'Missing calculation parameters'
      );
    }

    if (parseFloat(amount) <= 0) {
      throw createValidationError({ amount: 'Amount must be greater than 0' });
    }

    const { data: type, error } = await supabase
      .from('remittance_types')
      .select('*')
      .eq('id', typeId)
      .or('is_active.eq.true,is_active.is.null')
      .single();

    if (error) {
      const appError = parseSupabaseError(error);
      if (!type) {
        throw createNotFoundError('Remittance type', typeId);
      }
      logError(appError, { operation: 'calculateRemittance', typeId, amount });
      throw appError;
    }

    if (!type) {
      throw createNotFoundError('Remittance type', typeId);
    }

    // Validate amount limits
    if (amount < type.min_amount) {
      throw createValidationError(
        { amount: `Minimum amount is ${type.min_amount} ${type.currency_code}` },
        'Amount below minimum'
      );
    }

    if (type.max_amount && amount > type.max_amount) {
      throw createValidationError(
        { amount: `Maximum amount is ${type.max_amount} ${type.currency_code}` },
        'Amount exceeds maximum'
      );
    }

    // Get exchange rate from configured rates (exchange_rates table) or fallback to type rate
    const { rate: exchangeRate, source: rateSource } = await getRemittanceExchangeRate(
      type.currency_code,
      type.delivery_currency,
      type.exchange_rate
    );

    // Calculate commission - single source of truth formula
    const commissionPercentage = (amount * (type.commission_percentage || 0)) / 100;
    const commissionFixed = type.commission_fixed || 0;
    const totalCommission = commissionPercentage + commissionFixed;

    // Apply offer discount to commission if present
    let discountAmount = 0;
    if (offer && offer.discount_type && offer.discount_value) {
      if (offer.discount_type === 'percentage') {
        discountAmount = totalCommission * (offer.discount_value / 100);
      } else if (offer.discount_type === 'fixed') {
        discountAmount = Math.min(offer.discount_value, totalCommission);
      }
      discountAmount = Math.round(discountAmount * 100) / 100;
    }

    const effectiveCommission = Math.max(0, totalCommission - discountAmount);

    // Calculate delivery amount using the resolved exchange rate
    const amountToDeliver = (amount * exchangeRate) - (effectiveCommission * exchangeRate);

    return {
      amount,
      exchangeRate,
      exchangeRateSource: rateSource,
      commissionPercentage: type.commission_percentage || 0,
      commissionFixed: type.commission_fixed || 0,
      totalCommission: effectiveCommission,
      originalCommission: totalCommission,
      discountAmount,
      amountToDeliver,
      currency: type.currency_code,
      deliveryCurrency: type.delivery_currency,
      deliveryMethod: type.delivery_method
    };
  } catch (error) {
    if (error.code) throw error;
    const appError = handleError(error, ERROR_CODES.DB_ERROR, { operation: 'calculateRemittance', typeId, amount });
    throw appError;
  }
};

/**
 * Calculate remittance in REVERSE mode (from desired receive amount)
 * Given how much recipient should receive, calculate how much sender needs to send
 * Uses exchange rate from exchange_rates table (financial settings) when available,
 * falls back to remittance_type.exchange_rate if not configured
 *
 * @param {string} typeId - Remittance type UUID
 * @param {number} desiredReceiveAmount - Amount recipient should receive (in delivery currency)
 * @returns {Promise<Object>} Calculation details including amount to send
 */
export const calculateReverseRemittance = async (typeId, desiredReceiveAmount) => {
  try {
    if (!typeId || desiredReceiveAmount === undefined || desiredReceiveAmount === null) {
      throw createValidationError(
        { typeId: !typeId ? 'Type ID is required' : undefined, amount: !desiredReceiveAmount ? 'Amount is required' : undefined },
        'Missing calculation parameters'
      );
    }

    if (parseFloat(desiredReceiveAmount) <= 0) {
      throw createValidationError({ amount: 'Amount must be greater than 0' });
    }

    const { data: type, error } = await supabase
      .from('remittance_types')
      .select('*')
      .eq('id', typeId)
      .or('is_active.eq.true,is_active.is.null')
      .single();

    if (error) {
      const appError = parseSupabaseError(error);
      if (!type) {
        throw createNotFoundError('Remittance type', typeId);
      }
      logError(appError, { operation: 'calculateReverseRemittance', typeId, desiredReceiveAmount });
      throw appError;
    }

    if (!type) {
      throw createNotFoundError('Remittance type', typeId);
    }

    // Reverse formula:
    // Normal: amountToDeliver = (amount - totalCommission) * exchange_rate
    // Where: totalCommission = (amount * commission_percentage / 100) + commission_fixed
    //
    // Solving for amount:
    // desiredReceive = (amount - (amount * commPct / 100) - commFixed) * exchangeRate
    // desiredReceive / exchangeRate = amount * (1 - commPct/100) - commFixed
    // (desiredReceive / exchangeRate) + commFixed = amount * (1 - commPct/100)
    // amount = ((desiredReceive / exchangeRate) + commFixed) / (1 - commPct/100)

    // Get exchange rate from configured rates (exchange_rates table) or fallback to type rate
    const { rate: exchangeRate, source: rateSource } = await getRemittanceExchangeRate(
      type.currency_code,
      type.delivery_currency,
      type.exchange_rate || 1
    );

    const commissionPercentage = type.commission_percentage || 0;
    const commissionFixed = type.commission_fixed || 0;

    // Calculate amount to send
    const denominator = 1 - (commissionPercentage / 100);
    if (denominator <= 0) {
      throw createValidationError({ commission: 'Commission percentage cannot be 100% or more' });
    }

    const amountToSend = ((desiredReceiveAmount / exchangeRate) + commissionFixed) / denominator;

    // Validate against limits
    if (amountToSend < type.min_amount) {
      throw createValidationError(
        { amount: `Amount to send (${amountToSend.toFixed(2)}) is below minimum ${type.min_amount} ${type.currency_code}` },
        'Amount below minimum'
      );
    }

    if (type.max_amount && amountToSend > type.max_amount) {
      throw createValidationError(
        { amount: `Amount to send (${amountToSend.toFixed(2)}) exceeds maximum ${type.max_amount} ${type.currency_code}` },
        'Amount exceeds maximum'
      );
    }

    // Recalculate commission for display
    const totalCommissionPercentage = (amountToSend * commissionPercentage) / 100;
    const totalCommission = totalCommissionPercentage + commissionFixed;

    return {
      amountToSend: Math.round(amountToSend * 100) / 100, // Round to 2 decimals
      desiredReceiveAmount,
      exchangeRate,
      exchangeRateSource: rateSource,
      commissionPercentage,
      commissionFixed,
      totalCommission: Math.round(totalCommission * 100) / 100,
      currency: type.currency_code,
      deliveryCurrency: type.delivery_currency,
      deliveryMethod: type.delivery_method,
      minAmount: type.min_amount,
      maxAmount: type.max_amount
    };
  } catch (error) {
    if (error.code) throw error;
    const appError = handleError(error, ERROR_CODES.DB_ERROR, { operation: 'calculateReverseRemittance', typeId, desiredReceiveAmount });
    throw appError;
  }
};

/**
 * Create a new remittance (User)
 * @param {Object} remittanceData - Remittance creation data
 * @throws {AppError} If validation fails or creation fails
 * @returns {Promise<Object>} Created remittance
 */
export const createRemittance = async (remittanceData) => {

  try {
    const {
      remittance_type_id,
      amount,
      recipient_name,
      recipient_phone,
      recipient_address,
      recipient_city,
      recipient_province,
      recipient_municipality,
      recipient_id_number,
      notes,
      zelle_account_id,
      recipient_id,
      recipient_address_id,
      recipient_bank_account_id,
      offer_id,
      discount_amount: passedDiscountAmount
    } = remittanceData;

    // Validate required fields
    if (!remittance_type_id || !amount || !recipient_name || !recipient_phone) {
      console.error('[createRemittance] VALIDATION ERROR - Missing fields:', {
        remittance_type_id: !!remittance_type_id,
        amount: !!amount,
        recipient_name: !!recipient_name,
        recipient_phone: !!recipient_phone
      });
      throw createValidationError({
        remittance_type_id: !remittance_type_id ? 'Remittance type is required' : undefined,
        amount: !amount ? 'Amount is required' : undefined,
        recipient_name: !recipient_name ? 'Recipient name is required' : undefined,
        recipient_phone: !recipient_phone ? 'Recipient phone is required' : undefined
      }, 'Missing required remittance fields');
    }

    // If offer_id provided, fetch offer for calculation
    let offerForCalc = null;
    if (offer_id) {
      const { data: offerData } = await supabase
        .from('offers')
        .select('discount_type, discount_value')
        .eq('id', offer_id)
        .single();
      if (offerData) offerForCalc = offerData;
    }

    // Calculate using single source of truth (with optional offer discount)
    const calculation = await calculateRemittance(remittance_type_id, amount, offerForCalc);
    const {
      commissionPercentage,
      commissionFixed,
      totalCommission,
      discountAmount: calcDiscountAmount,
      amountToDeliver,
      exchangeRate,
      currency: currencyCode,
      deliveryCurrency,
      deliveryMethod
    } = calculation;

    // Get authenticated user
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError) {
      console.error('[createRemittance] AUTH ERROR:', userError);
      const appError = parseSupabaseError(userError);
      logError(appError, { operation: 'createRemittance - auth' });
      throw appError;
    }

    if (!user) {
      console.error('[createRemittance] AUTH ERROR: User not authenticated');
      throw new Error('Not authenticated');
    }

    // Check if user has admin privileges to create backend transfer records
    let isAdminUser = false;
    try {
      const { data: profile } = await supabase
        .from('user_profiles')
        .select('role')
        .eq('user_id', user.id)
        .single();

      isAdminUser = profile && ['admin', 'super_admin'].includes(profile.role);
    } catch (roleError) {
      console.warn('[createRemittance] Unable to verify admin role, continuing as standard user', roleError);
    }

    // Get or find available Zelle account
    let selectedZelleAccountId = zelle_account_id;
    if (!selectedZelleAccountId) {
      const zelleResult = await getAvailableZelleAccount('remittance', amount);
      if (!zelleResult.success) {
        console.error('[createRemittance] ZELLE ERROR: No accounts available');
        throw new Error('No Zelle accounts available. Please try again later.');
      }
      selectedZelleAccountId = zelleResult.account.id;
    } else {
    }

    // Create remittance with calculated values (single source of truth)
    const insertData = {
      user_id: user.id,
      remittance_type_id,
      amount_sent: amount,
      exchange_rate: exchangeRate,
      commission_percentage: commissionPercentage,
      commission_fixed: commissionFixed,
      commission_total: totalCommission,
      amount_to_deliver: amountToDeliver,
      currency_sent: currencyCode,
      currency_delivered: deliveryCurrency,
      recipient_name,
      recipient_phone,
      recipient_address,
      recipient_province: recipient_province || recipient_city || null,
      recipient_municipality: recipient_municipality || recipient_city || null,
      recipient_id_number,
      delivery_notes: notes,
      status: REMITTANCE_STATUS.PAYMENT_PENDING,
      zelle_account_id: selectedZelleAccountId
    };

    if (recipient_bank_account_id) {
      insertData.recipient_bank_account_id = recipient_bank_account_id;
    }

    if (recipient_id) {
      insertData.recipient_id = recipient_id;
    }

    if (offer_id) {
      insertData.offer_id = offer_id;
      insertData.discount_amount = calcDiscountAmount || passedDiscountAmount || 0;
    }

    if (recipient_address_id) {
      insertData.recipient_address_id = recipient_address_id;
    }

    const performInsert = async (payload) => supabase
      .from('remittances')
      .insert([payload])
      .select('*, zelle_accounts(*)')
      .single();

    const { data, error } = await performInsert(insertData);

    if (error) {
      console.error('[createRemittance] DATABASE INSERT ERROR:', error);
      const appError = parseSupabaseError(error);
      logError(appError, { operation: 'createRemittance - insert', amount, recipientName: recipient_name });
      throw appError;
    }

    // Register Zelle transaction (graceful fallback if fails)
    try {
      await registerZelleTransaction({
        zelle_account_id: selectedZelleAccountId,
        transaction_type: ZELLE_TRANSACTION_TYPES.REMITTANCE,
        reference_id: data.id,
        amount: amount,
        notes: `Remesa ${data.remittance_number}`
      });
    } catch (zelleError) {
      console.error('[createRemittance] Zelle registration error (non-fatal):', zelleError);
      logError(zelleError, { operation: 'createRemittance - Zelle registration', remittanceId: data.id });
      // Don't fail remittance creation if Zelle registration fails
    }

    // Record offer usage if an offer was applied (graceful fallback)
    if (offer_id) {
      try {
        await recordOfferUsage(offer_id, user.id, null);
        // Also update offer_usage with remittance_id
        await supabase
          .from('offer_usage')
          .update({ remittance_id: data.id })
          .eq('offer_id', offer_id)
          .eq('user_id', user.id)
          .is('remittance_id', null)
          .order('created_at', { ascending: false })
          .limit(1);
      } catch (offerError) {
        console.error('[createRemittance] Offer usage recording error (non-fatal):', offerError);
      }
    }

    // Create bank transfer for off-cash methods (graceful fallback if fails)
    if (deliveryMethod !== 'cash' && recipient_bank_account_id) {
      if (isAdminUser) {
        try {
          await createBankTransfer(
            data.id,
            recipient_bank_account_id,
            { amount_transferred: amountToDeliver }
          );
        } catch (bankError) {
          console.error('[createRemittance] Bank transfer creation error (non-fatal):', bankError);
          logError(bankError, { operation: 'createRemittance - bank transfer', remittanceId: data.id });
          // Don't fail remittance creation if bank transfer creation fails
        }
      } else {
      }
    } else {
    }

    return data;
  } catch (error) {
    console.error('[createRemittance] FATAL ERROR:', error);
    console.error('[createRemittance] Error details:', {
      message: error?.message,
      code: error?.code,
      details: error?.details,
      hint: error?.hint,
      stack: error?.stack
    });
    if (error.code) throw error;
    const appError = handleError(error, ERROR_CODES.DB_ERROR, { operation: 'createRemittance' });
    throw appError;
  }
};

/**
 * Upload payment proof for a remittance (User)
 * Validates remittance state, stores proof file, updates status, notifies admin
 * @param {string} remittanceId - Remittance ID
 * @param {File} file - Proof file to upload
 * @param {string} reference - Payment reference
 * @param {string} notes - Optional payment notes
 * @throws {AppError} If validation fails, upload fails, or remittance not found
 * @returns {Promise<Object>} Updated remittance with proof details
 */
export const uploadPaymentProof = async (remittanceId, file, reference, notes = '') => {
  try {
    if (!remittanceId || !file || !reference) {
      throw createValidationError({
        remittanceId: !remittanceId ? 'Remittance ID is required' : undefined,
        file: !file ? 'Proof file is required' : undefined,
        reference: !reference ? 'Payment reference is required' : undefined
      }, 'Missing required fields for proof upload');
    }

    // Fetch remittance with its type
    const { data: remittance, error: fetchError } = await supabase
      .from('remittances')
      .select('*, remittance_types(*)')
      .eq('id', remittanceId)
      .single();

    if (fetchError) {
      const appError = parseSupabaseError(fetchError);
      logError(appError, { operation: 'uploadPaymentProof - fetch', remittanceId });
      throw appError;
    }

    if (!remittance) {
      throw createNotFoundError('Remittance', remittanceId);
    }

    // Validate remittance state - allow uploads while pending or after rejection
    const allowedStatuses = [
      REMITTANCE_STATUS.PAYMENT_PENDING,
      REMITTANCE_STATUS.PAYMENT_REJECTED
    ];

    if (!allowedStatuses.includes(remittance.status)) {
      throw createValidationError(
        { status: `Current status is ${remittance.status}, allowed: ${allowedStatuses.join(', ')}` },
        'Payment proof can only be uploaded when remittance is pending payment or was rejected'
      );
    }

    // Get authenticated user
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError) {
      const appError = parseSupabaseError(userError);
      logError(appError, { operation: 'uploadPaymentProof - getUser' });
      throw appError;
    }

    if (!user) {
      throw new Error('Not authenticated');
    }

    // Authorize - user must own the remittance
    if (remittance.user_id !== user.id) {
      throw createPermissionError('modify this remittance', 'owner');
    }

    // Prepare file for upload
    const fileExt = file.name.split('.').pop();
    const fileName = `${remittance.remittance_number}.${fileExt}`;
    const filePath = `${user.id}/${fileName}`;

    // Upload file to storage
    const { error: uploadError } = await supabase.storage
      .from('remittance-proofs')
      .upload(filePath, file, { upsert: true });

    if (uploadError) {
      const appError = parseSupabaseError(uploadError);
      logError(appError, { operation: 'uploadPaymentProof - upload', filePath });
      throw appError;
    }

    // Update remittance with proof details
    const { data: updatedRemittance, error: updateError } = await supabase
      .from('remittances')
      .update({
        payment_proof_url: filePath,
        payment_reference: reference,
        payment_proof_notes: notes,
        payment_proof_uploaded_at: new Date().toISOString(),
        status: REMITTANCE_STATUS.PAYMENT_PROOF_UPLOADED,
        updated_at: new Date().toISOString()
      })
      .eq('id', remittanceId)
      .select('*, remittance_types(*)')
      .single();

    if (updateError) {
      const appError = parseSupabaseError(updateError);
      logError(appError, { operation: 'uploadPaymentProof - update', remittanceId });
      throw appError;
    }

    // Log payment proof upload for observability
    await logRemittancePaymentActivity({
      action: 'payment_proof_uploaded',
      remittance: { ...updatedRemittance, payment_reference: reference },
      performedBy: user?.email || user?.id,
      description: `Comprobante subido - Remesa ${updatedRemittance?.remittance_number || remittanceId}`,
      metadata: {
        remittanceId,
        remittanceNumber: updatedRemittance?.remittance_number,
        paymentProofUrl: filePath,
        paymentNotes: notes
      }
    });

    // Notify admin (graceful fallback if fails - don't block remittance creation)
    // IMPORTANT: Use getFreshWhatsappRecipient to get settings from notification_settings table
    // This ensures we always use the currently configured phone/group, not stale cached values
    try {
      const whatsappRecipient = await getFreshWhatsappRecipient();

      if (whatsappRecipient) {
        const remittanceForNotify = {
          ...updatedRemittance,
          user_email: user.email,
          user_name: user.user_metadata?.full_name || user.user_metadata?.name || user.email?.split('@')[0]
        };
        await notifyAdminNewPaymentProof(remittanceForNotify, whatsappRecipient, 'es');
      } else {
        console.warn('[uploadPaymentProof] No WhatsApp recipient configured in notification_settings');
      }
    } catch (notifyError) {
      logError(notifyError, { operation: 'uploadPaymentProof - notification', remittanceId });
      // Don't fail proof upload if notification fails
    }

    return updatedRemittance;
  } catch (error) {
    if (error.code) throw error;
    const appError = handleError(error, ERROR_CODES.INTERNAL_SERVER_ERROR, {
      operation: 'uploadPaymentProof',
      remittanceId
    });
    throw appError;
  }
};

/**
 * Get user's remittances with optional filters (User)
 * Returns paginated list of remittances for authenticated user
 * @param {Object} filters - Optional filters: status, startDate, endDate
 * @throws {AppError} If user not authenticated or query fails
 * @returns {Promise<Array>} Array of user's remittances
 */
export const getMyRemittances = async (filters = {}) => {
  try {
    const { data: { user }, error: userError } = await supabase.auth.getUser();

    if (userError) {
      const appError = parseSupabaseError(userError);
      logError(appError, { operation: 'getMyRemittances - auth' });
      throw appError;
    }

    if (!user) {
      throw new Error('Not authenticated');
    }

    let query = supabase
      .from('remittances')
      .select('*, remittance_types(*)')
      .eq('user_id', user.id);

    // Apply optional filters
    if (filters.status) {
      query = query.eq('status', filters.status);
    }

    if (filters.startDate) {
      query = query.gte('created_at', filters.startDate);
    }

    if (filters.endDate) {
      query = query.lte('created_at', filters.endDate);
    }

    // Sort by most recent
    query = query.order('created_at', { ascending: false });

    const { data, error } = await query;

    if (error) {
      const appError = parseSupabaseError(error);
      logError(appError, { operation: 'getMyRemittances', userId: user.id, filters });
      throw appError;
    }

    return data || [];
  } catch (error) {
    if (error.code) throw error;
    const appError = handleError(error, ERROR_CODES.DB_ERROR, { operation: 'getMyRemittances' });
    throw appError;
  }
};

/**
 * Get remittance details with status history (User/Admin)
 * Retrieves complete remittance data including state change history
 * @param {string} remittanceId - Remittance ID
 * @throws {AppError} If remittance not found or query fails
 * @returns {Promise<Object>} Remittance with history array
 */
export const getRemittanceDetails = async (remittanceId) => {
  try {
    if (!remittanceId) {
      throw createValidationError({ remittanceId: 'Remittance ID is required' });
    }

    const { data: remittance, error: fetchError } = await supabase
      .from('remittances')
      .select('*, remittance_types(*)')
      .eq('id', remittanceId)
      .single();

    if (fetchError) {
      const appError = parseSupabaseError(fetchError);
      logError(appError, { operation: 'getRemittanceDetails - fetch', remittanceId });
      throw appError;
    }

    if (!remittance) {
      throw createNotFoundError('Remittance', remittanceId);
    }

    // Fetch status history (graceful fallback if fails)
    let history = [];
    try {
      const { data: historyData, error: historyError } = await supabase
        .from('remittance_status_history')
        .select('*')
        .eq('remittance_id', remittanceId)
        .order('created_at', { ascending: true });

      if (historyError) {
        logError(parseSupabaseError(historyError), { operation: 'getRemittanceDetails - history', remittanceId });
      } else {
        history = historyData || [];
      }
    } catch (historyFetchError) {
      logError(historyFetchError, { operation: 'getRemittanceDetails - history fetch', remittanceId });
    }

    return {
      ...remittance,
      history
    };
  } catch (error) {
    if (error.code) throw error;
    const appError = handleError(error, ERROR_CODES.DB_ERROR, { operation: 'getRemittanceDetails', remittanceId });
    throw appError;
  }
};

/**
 * Cancel a remittance (User)
 * Only allows cancellation in early states (payment pending, payment rejected)
 * @param {string} remittanceId - Remittance ID to cancel
 * @param {string} reason - Cancellation reason
 * @throws {AppError} If remittance not found, invalid state, or user not authorized
 * @returns {Promise<Object>} Updated cancelled remittance
 */
export const cancelRemittance = async (remittanceId, reason = '') => {
  try {
    if (!remittanceId) {
      throw createValidationError({ remittanceId: 'Remittance ID is required' });
    }

    // Fetch remittance
    const { data: remittance, error: fetchError } = await supabase
      .from('remittances')
      .select('*')
      .eq('id', remittanceId)
      .single();

    if (fetchError) {
      const appError = parseSupabaseError(fetchError);
      logError(appError, { operation: 'cancelRemittance - fetch', remittanceId });
      throw appError;
    }

    if (!remittance) {
      throw createNotFoundError('Remittance', remittanceId);
    }

    // Check cancellation eligibility - cannot cancel completed, delivered, or already cancelled
    const nonCancellableStatuses = [
      REMITTANCE_STATUS.DELIVERED,
      REMITTANCE_STATUS.COMPLETED,
      REMITTANCE_STATUS.CANCELLED
    ];

    if (nonCancellableStatuses.includes(remittance.status)) {
      throw createValidationError(
        { status: `Cannot cancel remittance in ${remittance.status} state` },
        'Remittance cannot be cancelled in its current state'
      );
    }

    // Get authenticated user
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError) {
      const appError = parseSupabaseError(userError);
      logError(appError, { operation: 'cancelRemittance - getUser' });
      throw appError;
    }

    if (!user) {
      throw new Error('Not authenticated');
    }

    // Authorize - user must own remittance
    if (remittance.user_id !== user.id) {
      throw createPermissionError('cancel this remittance', 'owner');
    }

    // Update to cancelled state
    const { data: updatedRemittance, error: updateError } = await supabase
      .from('remittances')
      .update({
        status: REMITTANCE_STATUS.CANCELLED,
        cancelled_at: new Date().toISOString(),
        cancellation_reason: reason,
        updated_at: new Date().toISOString()
      })
      .eq('id', remittanceId)
      .select('*, remittance_types(*)')
      .single();

    if (updateError) {
      const appError = parseSupabaseError(updateError);
      logError(appError, { operation: 'cancelRemittance - update', remittanceId });
      throw appError;
    }

    return updatedRemittance;
  } catch (error) {
    if (error.code) throw error;
    const appError = handleError(error, ERROR_CODES.DB_ERROR, { operation: 'cancelRemittance', remittanceId });
    throw appError;
  }
};

// ============================================================================
// GESTIÓN DE REMESAS (ADMIN) - MANAGEMENT & WORKFLOW
// ============================================================================

/**
 * Get all remittances with filters (Admin)
 * Returns all system remittances with advanced filtering and sorting
 * @param {Object} filters - Optional filters: status, startDate, endDate, search, orderBy, ascending
 * @throws {AppError} If query fails
 * @returns {Promise<Array>} Array of remittances
 */
export const getAllRemittances = async (filters = {}) => {
  try {
    let query = supabase
      .from('remittances')
      .select('*, remittance_types(*)');

    // Apply optional filters
    if (filters.status) {
      query = query.eq('status', filters.status);
    }

    if (filters.startDate) {
      query = query.gte('created_at', filters.startDate);
    }

    if (filters.endDate) {
      query = query.lte('created_at', filters.endDate);
    }

    if (filters.search) {
      query = query.or(`remittance_number.ilike.%${filters.search}%,recipient_name.ilike.%${filters.search}%,recipient_phone.ilike.%${filters.search}%`);
    }

    // Apply ordering
    const orderBy = filters.orderBy || 'created_at';
    const ascending = filters.ascending ?? false;
    query = query.order(orderBy, { ascending });

    const { data, error } = await query;

    if (error) {
      const appError = parseSupabaseError(error);
      logError(appError, { operation: 'getAllRemittances', filters });
      throw appError;
    }

    return data || [];
  } catch (error) {
    if (error.code) throw error;
    const appError = handleError(error, ERROR_CODES.DB_ERROR, { operation: 'getAllRemittances' });
    throw appError;
  }
};

/**
 * Get bank account details for a remittance
 * @param {string} recipientBankAccountId - Recipient bank account ID
 * @returns {Promise<Object>} Bank account details
 */
export const getRemittanceBankAccountDetails = async (recipientBankAccountId) => {
  try {
    if (!recipientBankAccountId) {
      return null;
    }

    const { data, error } = await supabase
      .from('recipient_bank_accounts')
      .select(`
        id,
        is_default,
        bank_accounts!bank_account_id(
          id,
          account_number_last4,
          account_number_hash,
          account_number_full,
          account_holder_name,
          banks!bank_id(name, swift_code),
          account_types!account_type_id(name),
          currencies!currency_id(code, name_es, name_en)
        )
      `)
      .eq('id', recipientBankAccountId)
      .single();

    if (error) {
      console.error('[getRemittanceBankAccountDetails] Error:', error);
      return null;
    }

    return data;
  } catch (error) {
    console.error('[getRemittanceBankAccountDetails] Exception:', error);
    return null;
  }
};

/**
 * Get bank account details by recipient ID (fallback when recipient_bank_account_id is not set)
 * Returns the default bank account for the recipient, or the first one if none is default
 * @param {string} recipientId - Recipient ID
 * @returns {Promise<Object|null>} Bank account details or null
 */
export const getBankAccountByRecipientId = async (recipientId) => {
  try {
    if (!recipientId) {
      return null;
    }

    const { data, error } = await supabase
      .from('recipient_bank_accounts')
      .select(`
        id,
        is_default,
        bank_accounts!bank_account_id(
          id,
          account_number_last4,
          account_number_hash,
          account_number_full,
          account_holder_name,
          banks!bank_id(name, swift_code),
          account_types!account_type_id(name),
          currencies!currency_id(code, name_es, name_en)
        )
      `)
      .eq('recipient_id', recipientId)
      .eq('is_active', true)
      .order('is_default', { ascending: false })
      .limit(1)
      .single();

    if (error) {
      console.error('[getBankAccountByRecipientId] Error:', error);
      return null;
    }

    return data;
  } catch (error) {
    console.error('[getBankAccountByRecipientId] Exception:', error);
    return null;
  }
};

/**
 * Validate payment for a remittance (Admin)
 * Confirms payment and transitions remittance to PAYMENT_VALIDATED state
 * @param {string} remittanceId - Remittance ID
 * @param {string} notes - Optional validation notes
 * @throws {AppError} If remittance not found, invalid state, or update fails
 * @returns {Promise<Object>} Updated remittance
 */
export const validatePayment = async (remittanceId, notes = '') => {
  try {
    if (!remittanceId) {
      throw createValidationError({ remittanceId: 'Remittance ID is required' });
    }

    // Fetch remittance
    const { data: remittance, error: fetchError } = await supabase
      .from('remittances')
      .select('*, remittance_types(*)')
      .eq('id', remittanceId)
      .single();

    if (fetchError) {
      const appError = parseSupabaseError(fetchError);
      logError(appError, { operation: 'validatePayment - fetch', remittanceId });
      throw appError;
    }

    if (!remittance) {
      throw createNotFoundError('Remittance', remittanceId);
    }

    // Validate state - can only validate when proof is uploaded
    if (remittance.status !== REMITTANCE_STATUS.PAYMENT_PROOF_UPLOADED) {
      throw createValidationError(
        { status: `Current status is ${remittance.status}, but PAYMENT_PROOF_UPLOADED is required` },
        'Payment can only be validated when proof has been uploaded'
      );
    }

    // Get authenticated admin user
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError) {
      const appError = parseSupabaseError(userError);
      logError(appError, { operation: 'validatePayment - getUser' });
      throw appError;
    }

    if (!user) {
      throw new Error('Not authenticated');
    }

    // Update remittance to payment validated
    const { data: updatedRemittance, error: updateError } = await supabase
      .from('remittances')
      .update({
        status: REMITTANCE_STATUS.PAYMENT_VALIDATED,
        payment_validated: true,
        payment_validated_at: new Date().toISOString(),
        payment_validated_by: user.id,
        updated_at: new Date().toISOString()
      })
      .eq('id', remittanceId)
      .select('*, remittance_types(*)')
      .single();

    if (updateError) {
      const appError = parseSupabaseError(updateError);
      logError(appError, { operation: 'validatePayment - update', remittanceId });
      throw appError;
    }

    const activityResult = await logRemittancePaymentActivity({
      action: 'payment_validated',
      remittance: updatedRemittance,
      performedBy: user?.email || user?.id,
      description: `Pago validado - Remesa ${updatedRemittance?.remittance_number || remittanceId}`,
      metadata: {
        remittanceId,
        remittanceNumber: updatedRemittance?.remittance_number,
        validationNotes: notes || null,
        validatedAt: updatedRemittance?.payment_validated_at,
        validatedBy: user?.id
      }
    });

    // Sync Zelle transaction history (graceful fallback)
    if (remittance.zelle_account_id && activityResult?.status === 'inserted') {
      try {
        await upsertZelleTransactionStatus({
          referenceId: remittanceId,
          transactionType: ZELLE_TRANSACTION_TYPES.REMITTANCE,
          status: ZELLE_STATUS.VALIDATED,
          amount: remittance.amount || remittance.amount_to_deliver || 0,
          zelleAccountId: remittance.zelle_account_id,
          validatedBy: user.id
        });
      } catch (zelleError) {
        logError(zelleError, { operation: 'validatePayment - zelle sync', remittanceId });
      }
    }

    // Send notification to user (graceful fallback if fails)
    try {
      await notifyUserPaymentValidated(updatedRemittance, 'es');
    } catch (notifyError) {
      logError(notifyError, { operation: 'validatePayment - notification', remittanceId });
      // Don't fail validation if notification fails
    }

    if (notes) {
      console.info('[validatePayment] Validation notes provided', { remittanceId, notes });
    }

    return updatedRemittance;
  } catch (error) {
    if (error.code) throw error;
    const appError = handleError(error, ERROR_CODES.DB_ERROR, { operation: 'validatePayment', remittanceId });
    throw appError;
  }
};

/**
 * Reject payment for a remittance (Admin)
 * Rejects payment and returns remittance to payment pending state
 * @param {string} remittanceId - Remittance ID
 * @param {string} reason - Rejection reason (required)
 * @throws {AppError} If validation fails, remittance not found, or update fails
 * @returns {Promise<Object>} Updated remittance
 */
export const rejectPayment = async (remittanceId, reason) => {
  try {
    if (!remittanceId || !reason) {
      throw createValidationError({
        remittanceId: !remittanceId ? 'Remittance ID is required' : undefined,
        reason: !reason ? 'Rejection reason is required' : undefined
      }, 'Missing required fields for payment rejection');
    }

    // Fetch remittance
    const { data: remittance, error: fetchError } = await supabase
      .from('remittances')
      .select('*, remittance_types(*)')
      .eq('id', remittanceId)
      .single();

    if (fetchError) {
      const appError = parseSupabaseError(fetchError);
      logError(appError, { operation: 'rejectPayment - fetch', remittanceId });
      throw appError;
    }

    if (!remittance) {
      throw createNotFoundError('Remittance', remittanceId);
    }

    // Validate state - can only reject when proof is uploaded
    if (remittance.status !== REMITTANCE_STATUS.PAYMENT_PROOF_UPLOADED) {
      throw createValidationError(
        { status: `Current status is ${remittance.status}, but PAYMENT_PROOF_UPLOADED is required` },
        'Payment can only be rejected when proof has been uploaded'
      );
    }

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError) {
      const appError = parseSupabaseError(userError);
      logError(appError, { operation: 'rejectPayment - getUser' });
      throw appError;
    }

    if (!user) {
      throw new Error('Not authenticated');
    }

    // Update remittance to payment rejected
    // Note: payment_rejected_at column does not exist in DB schema
    // Using updated_at as the rejection timestamp
    const rejectionTimestamp = new Date().toISOString();
    const { data: updatedRemittance, error: updateError } = await supabase
      .from('remittances')
      .update({
        status: REMITTANCE_STATUS.PAYMENT_REJECTED,
        payment_rejection_reason: reason,
        updated_at: rejectionTimestamp
      })
      .eq('id', remittanceId)
      .select('*, remittance_types(*)')
      .single();

    if (updateError) {
      const appError = parseSupabaseError(updateError);
      logError(appError, { operation: 'rejectPayment - update', remittanceId });
      throw appError;
    }

    // Notify user (graceful fallback if fails)
    try {
      await notifyUserPaymentRejected(updatedRemittance, 'es');
    } catch (notifyError) {
      logError(notifyError, { operation: 'rejectPayment - notification', remittanceId });
      // Don't fail rejection if notification fails
    }

    const activityResult = await logRemittancePaymentActivity({
      action: 'payment_rejected',
      remittance: updatedRemittance,
      performedBy: user?.email || user?.id,
      description: `Pago rechazado - Remesa ${updatedRemittance?.remittance_number || remittanceId}`,
      metadata: {
        remittanceId,
        remittanceNumber: updatedRemittance?.remittance_number,
        rejectionReason: reason,
        rejectedAt: rejectionTimestamp,
        rejectedBy: user?.id
      }
    });

    // Sync Zelle transaction history (graceful fallback)
    if (remittance.zelle_account_id && activityResult?.status === 'inserted') {
      try {
        await upsertZelleTransactionStatus({
          referenceId: remittanceId,
          transactionType: ZELLE_TRANSACTION_TYPES.REMITTANCE,
          status: ZELLE_STATUS.REJECTED,
          amount: remittance.amount || remittance.amount_to_deliver || 0,
          zelleAccountId: remittance.zelle_account_id,
          validatedBy: user.id
        });
      } catch (zelleError) {
        logError(zelleError, { operation: 'rejectPayment - zelle sync', remittanceId });
      }
    }

    return updatedRemittance;
  } catch (error) {
    if (error.code) throw error;
    const appError = handleError(error, ERROR_CODES.DB_ERROR, { operation: 'rejectPayment', remittanceId });
    throw appError;
  }
};

/**
 * Start processing a remittance (Admin)
 * Transitions validated payment to processing state for delivery preparation
 * @param {string} remittanceId - Remittance ID
 * @param {string} notes - Optional processing notes
 * @throws {AppError} If remittance not found, invalid state, or update fails
 * @returns {Promise<Object>} Updated remittance
 */
export const startProcessing = async (remittanceId, notes = '') => {
  try {
    if (!remittanceId) {
      throw createValidationError({ remittanceId: 'Remittance ID is required' });
    }

    // Fetch remittance
    const { data: remittance, error: fetchError } = await supabase
      .from('remittances')
      .select('*, remittance_types(*)')
      .eq('id', remittanceId)
      .single();

    if (fetchError) {
      const appError = parseSupabaseError(fetchError);
      logError(appError, { operation: 'startProcessing - fetch', remittanceId });
      throw appError;
    }

    if (!remittance) {
      throw createNotFoundError('Remittance', remittanceId);
    }

    // Validate state - can only process when payment is validated
    if (remittance.status !== REMITTANCE_STATUS.PAYMENT_VALIDATED) {
      throw createValidationError(
        { status: `Current status is ${remittance.status}, but PAYMENT_VALIDATED is required` },
        'Processing can only start when payment has been validated'
      );
    }

    // Update remittance to processing
    const { data: updatedRemittance, error: updateError } = await supabase
      .from('remittances')
      .update({
        status: REMITTANCE_STATUS.PROCESSING,
        processing_started_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('id', remittanceId)
      .select('*, remittance_types(*)')
      .single();

    if (updateError) {
      const appError = parseSupabaseError(updateError);
      logError(appError, { operation: 'startProcessing - update', remittanceId });
      throw appError;
    }

    if (notes) {
      console.info('[startProcessing] Processing notes provided', { remittanceId, notes });
    }

    return updatedRemittance;
  } catch (error) {
    if (error.code) throw error;
    const appError = handleError(error, ERROR_CODES.DB_ERROR, { operation: 'startProcessing', remittanceId });
    throw appError;
  }
};

/**
 * Confirm delivery of a remittance (Admin)
 * Marks remittance as delivered with delivery proof. Requires proof file or existing proof.
 * @param {string} remittanceId - Remittance ID
 * @param {File} proofFile - Optional new delivery proof file
 * @param {string} notes - Optional delivery notes
 * @throws {AppError} If validation fails, no proof provided, or update fails
 * @returns {Promise<Object>} Updated remittance
 */
export const confirmDelivery = async (remittanceId, proofFile = null, notes = '') => {
  try {
    if (!remittanceId) {
      throw createValidationError({ remittanceId: 'Remittance ID is required' });
    }

    // Fetch remittance
    const { data: remittance, error: fetchError } = await supabase
      .from('remittances')
      .select('*, remittance_types(*)')
      .eq('id', remittanceId)
      .single();

    if (fetchError) {
      const appError = parseSupabaseError(fetchError);
      logError(appError, { operation: 'confirmDelivery - fetch', remittanceId });
      throw appError;
    }

    if (!remittance) {
      throw createNotFoundError('Remittance', remittanceId);
    }

    // Validate state - can only confirm delivery when processing
    if (remittance.status !== REMITTANCE_STATUS.PROCESSING) {
      throw createValidationError(
        { status: `Current status is ${remittance.status}, but PROCESSING is required` },
        'Delivery can only be confirmed when remittance is being processed'
      );
    }

    // CRITICAL: Require delivery proof - either new file or existing proof
    const hasExistingProof = remittance.delivery_proof_url && remittance.delivery_proof_url.trim() !== '';
    if (!proofFile && !hasExistingProof) {
      throw new Error('Delivery proof required. Please provide a photo or document as evidence.');
    }

    let deliveryProofUrl = remittance.delivery_proof_url; // Keep existing proof if not updating

    // Upload new delivery proof if provided
    if (proofFile) {
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError) {
        const appError = parseSupabaseError(userError);
        logError(appError, { operation: 'confirmDelivery - getUser' });
        throw appError;
      }

      if (!user) {
        throw new Error('Not authenticated');
      }

      // Prepare file for upload
      const fileExt = proofFile.name.split('.').pop();
      const fileName = `${remittance.remittance_number}_delivery.${fileExt}`;
      const filePath = `${user.id}/delivery/${fileName}`;

      // Upload file
      const { error: uploadError } = await supabase.storage
        .from('remittance-proofs')
        .upload(filePath, proofFile, { upsert: true });

      if (uploadError) {
        const appError = parseSupabaseError(uploadError);
        logError(appError, { operation: 'confirmDelivery - upload', filePath });
        throw appError;
      }

      deliveryProofUrl = filePath;
    }

    // Update remittance to delivered
    // CRITICAL: Ensure delivery_proof_url is valid and persisted
    const trimmedProofUrl = deliveryProofUrl?.trim();

    if (!trimmedProofUrl) {
      throw createValidationError(
        { delivery_proof_url: 'Delivery proof URL is required but is empty or invalid' },
        'Cannot confirm delivery without valid proof URL. This should not happen - proof validation failed.'
      );
    }

    const updateData = {
      status: REMITTANCE_STATUS.DELIVERED,
      delivered_at: new Date().toISOString(),
      delivery_notes_admin: notes,
      delivery_proof_url: trimmedProofUrl,  // ✅ ALWAYS include valid proof URL
      updated_at: new Date().toISOString()
    };

    const { data: updatedRemittance, error: updateError } = await supabase
      .from('remittances')
      .update(updateData)
      .eq('id', remittanceId)
      .select('*, remittance_types(*)')
      .single();

    if (updateError) {
      const appError = parseSupabaseError(updateError);
      logError(appError, { operation: 'confirmDelivery - update', remittanceId });
      throw appError;
    }

    // Notify user (graceful fallback if fails)
    try {
      await notifyUserRemittanceDelivered(updatedRemittance, 'es');
    } catch (notifyError) {
      logError(notifyError, { operation: 'confirmDelivery - notification', remittanceId });
      // Don't fail delivery confirmation if notification fails
    }

    return updatedRemittance;
  } catch (error) {
    if (error.code) throw error;
    const appError = handleError(error, ERROR_CODES.DB_ERROR, { operation: 'confirmDelivery', remittanceId });
    throw appError;
  }
};

/**
 * Complete a remittance (Admin)
 * Marks remittance as completed after delivery confirmation
 * @param {string} remittanceId - Remittance ID
 * @param {string} notes - Optional completion notes
 * @throws {AppError} If remittance not found, invalid state, or update fails
 * @returns {Promise<Object>} Updated remittance
 */
export const completeRemittance = async (remittanceId, notes = '') => {
  try {
    if (!remittanceId) {
      throw createValidationError({ remittanceId: 'Remittance ID is required' });
    }

    // Fetch remittance
    const { data: remittance, error: fetchError } = await supabase
      .from('remittances')
      .select('*, remittance_types(*)')
      .eq('id', remittanceId)
      .single();

    if (fetchError) {
      const appError = parseSupabaseError(fetchError);
      logError(appError, { operation: 'completeRemittance - fetch', remittanceId });
      throw appError;
    }

    if (!remittance) {
      throw createNotFoundError('Remittance', remittanceId);
    }

    // Validate state - can only complete when delivered
    if (remittance.status !== REMITTANCE_STATUS.DELIVERED) {
      throw createValidationError(
        { status: `Current status is ${remittance.status}, but DELIVERED is required` },
        'Remittance can only be completed after delivery'
      );
    }

    // Update remittance to completed
    const updateData = {
      status: REMITTANCE_STATUS.COMPLETED,
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    if (notes) {
      updateData.delivery_notes_admin = notes;
    }

    const { data: updatedRemittance, error: updateError } = await supabase
      .from('remittances')
      .update(updateData)
      .eq('id', remittanceId)
      .select('*, remittance_types(*)')
      .single();

    if (updateError) {
      const appError = parseSupabaseError(updateError);
      logError(appError, { operation: 'completeRemittance - update', remittanceId });
      throw appError;
    }

    return updatedRemittance;
  } catch (error) {
    if (error.code) throw error;
    const appError = handleError(error, ERROR_CODES.DB_ERROR, { operation: 'completeRemittance', remittanceId });
    throw appError;
  }
};

// ============================================================================
// FUNCIONES AUXILIARES - HELPER FUNCTIONS
// ============================================================================

/**
 * Calculate delivery alert status based on time remaining
 * Pure helper function that doesn't interact with database
 * @param {Object} remittance - Remittance object with timestamps
 * @returns {Object} Alert object with level and message
 */
export const calculateDeliveryAlert = (remittance) => {
  // Not validated yet - no alert needed
  if (!remittance?.payment_validated_at || !remittance?.max_delivery_date) {
    return { level: 'info', message: 'Pending validation' };
  }

  const now = new Date();
  const validatedAt = new Date(remittance.payment_validated_at);
  const maxDeliveryDate = new Date(remittance.max_delivery_date);
  const hoursRemaining = (maxDeliveryDate - now) / (1000 * 60 * 60);

  // Already delivered or completed
  if ([REMITTANCE_STATUS.DELIVERED, REMITTANCE_STATUS.COMPLETED].includes(remittance.status)) {
    return { level: 'success', message: 'Delivered' };
  }

  // Delivery deadline passed
  if (hoursRemaining < 0) {
    return { level: 'error', message: 'Delivery overdue' };
  }

  // Less than 24 hours remaining
  if (hoursRemaining < 24) {
    return { level: 'error', message: `${Math.round(hoursRemaining)} hours remaining` };
  }

  // Less than 48 hours remaining
  if (hoursRemaining < 48) {
    return { level: 'warning', message: `${Math.round(hoursRemaining / 24)} day remaining` };
  }

  // More than 48 hours remaining
  return { level: 'info', message: `${Math.round(hoursRemaining / 24)} days remaining` };
};

/**
 * Get remittance statistics (Admin)
 * Calculates aggregate statistics for dashboard and reporting
 * @param {Object} filters - Optional date filters: startDate, endDate
 * @throws {AppError} If query fails
 * @returns {Promise<Object>} Statistics object with totals, breakdowns, and averages
 */
export const getRemittanceStats = async (filters = {}) => {
  try {
    let query = supabase
      .from('remittances')
      .select('status, amount_sent, currency_sent, created_at, completed_at');

    // Apply date filters
    if (filters.startDate) {
      query = query.gte('created_at', filters.startDate);
    }

    if (filters.endDate) {
      query = query.lte('created_at', filters.endDate);
    }

    const { data, error } = await query;

    if (error) {
      const appError = parseSupabaseError(error);
      logError(appError, { operation: 'getRemittanceStats', filters });
      throw appError;
    }

    // Calculate aggregate statistics
    const stats = {
      total: data.length,
      byStatus: {},
      totalAmount: 0,
      completedAmount: 0,
      avgProcessingTime: 0
    };

    let totalProcessingTime = 0;
    let completedCount = 0;

    data.forEach(remittance => {
      // Count by status
      stats.byStatus[remittance.status] = (stats.byStatus[remittance.status] || 0) + 1;

      // Sum total amount
      stats.totalAmount += parseFloat(remittance.amount_sent || 0);

      // Calculate completed statistics
      if (remittance.status === REMITTANCE_STATUS.COMPLETED) {
        stats.completedAmount += parseFloat(remittance.amount_sent || 0);
        completedCount++;

        // Calculate processing time for completed remittances
        if (remittance.completed_at && remittance.created_at) {
          const processingTime = new Date(remittance.completed_at) - new Date(remittance.created_at);
          totalProcessingTime += processingTime;
        }
      }
    });

    // Calculate average processing time in hours
    if (completedCount > 0) {
      stats.avgProcessingTime = (totalProcessingTime / completedCount) / (1000 * 60 * 60);
    }

    return stats;
  } catch (error) {
    if (error.code) throw error;
    const appError = handleError(error, ERROR_CODES.DB_ERROR, { operation: 'getRemittanceStats' });
    throw appError;
  }
};

/**
 * Check if user has admin permissions (Helper)
 * Determines if authenticated user has admin or super_admin role
 * @throws {AppError} If profile query fails
 * @returns {Promise<boolean>} True if user is admin or super_admin
 */
export const checkAdminPermissions = async () => {
  try {
    const { data: { user }, error: userError } = await supabase.auth.getUser();

    if (userError) {
      const appError = parseSupabaseError(userError);
      logError(appError, { operation: 'checkAdminPermissions - getUser' });
      throw appError;
    }

    if (!user) {
      return false; // Not authenticated
    }

    const { data: profile, error: profileError } = await supabase
      .from('user_profiles')
      .select('role')
      .eq('user_id', user.id)
      .single();

    if (profileError) {
      const appError = parseSupabaseError(profileError);
      logError(appError, { operation: 'checkAdminPermissions - profile', userId: user.id });
      throw appError;
    }

    return profile && ['admin', 'super_admin'].includes(profile.role);
  } catch (error) {
    if (error.code) throw error;
    const appError = handleError(error, ERROR_CODES.DB_ERROR, { operation: 'checkAdminPermissions' });
    throw appError;
  }
};

/**
 * Get remittances needing delivery alert (Admin)
 * Returns remittances within 24 hours of delivery deadline
 * @throws {AppError} If query fails
 * @returns {Promise<Array>} Array of remittances requiring attention
 */
export const getRemittancesNeedingAlert = async () => {
  try {
    const now = new Date();
    const alertThreshold = new Date(now.getTime() + (24 * 60 * 60 * 1000)); // 24 hours from now

    const { data, error } = await supabase
      .from('remittances')
      .select('*, remittance_types(*)')
      .in('status', [
        REMITTANCE_STATUS.PAYMENT_VALIDATED,
        REMITTANCE_STATUS.PROCESSING
      ])
      .lte('max_delivery_date', alertThreshold.toISOString())
      .order('max_delivery_date', { ascending: true });

    if (error) {
      const appError = parseSupabaseError(error);
      logError(appError, { operation: 'getRemittancesNeedingAlert' });
      throw appError;
    }

    return data || [];
  } catch (error) {
    if (error.code) throw error;
    const appError = handleError(error, ERROR_CODES.DB_ERROR, { operation: 'getRemittancesNeedingAlert' });
    throw appError;
  }
};

// ============================================================================
// BANK TRANSFER OPERATIONS - Functions for bank transfer tracking
// ============================================================================

/**
 * Create a bank transfer record for a remittance (Admin)
 * Tracks bank transfer details for non-cash delivery methods
 * @param {string} remittanceId - Remittance ID
 * @param {string} recipientBankAccountId - Recipient bank account ID
 * @param {Object} transferData - Optional data: processedByUserId, amountTransferred
 * @throws {AppError} If remittance or account not found, or creation fails
 * @returns {Promise<Object>} Created bank transfer record
 */
export const createBankTransfer = async (remittanceId, recipientBankAccountId, transferData = {}) => {
  try {
    if (!remittanceId || !recipientBankAccountId) {
      throw createValidationError({
        remittanceId: !remittanceId ? 'Remittance ID is required' : undefined,
        recipientBankAccountId: !recipientBankAccountId ? 'Recipient bank account ID is required' : undefined
      }, 'Missing required fields for bank transfer');
    }

    const { processedByUserId = null, amountTransferred = null } = transferData;

    const { data, error } = await supabase
      .from('remittance_bank_transfers')
      .insert([{
        remittance_id: remittanceId,
        recipient_bank_account_id: recipientBankAccountId,
        status: 'pending',
        processed_by_user_id: processedByUserId,
        amount_transferred: amountTransferred
      }])
      .select()
      .single();

    if (error) {
      const appError = parseSupabaseError(error);
      logError(appError, { operation: 'createBankTransfer', remittanceId, recipientBankAccountId });
      throw appError;
    }

    return data;
  } catch (error) {
    if (error.code) throw error;
    const appError = handleError(error, ERROR_CODES.DB_ERROR, { operation: 'createBankTransfer', remittanceId });
    throw appError;
  }
};

/**
 * Update bank transfer status (Admin)
 * Tracks progression of bank transfer through various states
 * @param {string} transferId - Bank transfer ID
 * @param {string} status - New status: pending, confirmed, transferred, failed, reversed
 * @param {Object} additionalData - Optional: processedByUserId, processedAt, errorMessage
 * @throws {AppError} If transfer not found, invalid status, or update fails
 * @returns {Promise<Object>} Updated bank transfer record
 */
export const updateBankTransferStatus = async (transferId, status, additionalData = {}) => {
  try {
    if (!transferId || !status) {
      throw createValidationError({
        transferId: !transferId ? 'Transfer ID is required' : undefined,
        status: !status ? 'Status is required' : undefined
      }, 'Missing required fields for status update');
    }

    const validStatuses = ['pending', 'confirmed', 'transferred', 'failed', 'reversed'];
    if (!validStatuses.includes(status)) {
      throw createValidationError({ status: `Status must be one of: ${validStatuses.join(', ')}` });
    }

    const updateData = {
      status,
      updated_at: new Date().toISOString(),
      ...additionalData
    };

    // Auto-set processed_at if not provided and status is terminal
    if (['confirmed', 'transferred'].includes(status) && !additionalData.processedAt) {
      updateData.processed_at = new Date().toISOString();
    }

    const { data, error } = await supabase
      .from('remittance_bank_transfers')
      .update(updateData)
      .eq('id', transferId)
      .select()
      .single();

    if (error) {
      const appError = parseSupabaseError(error);
      logError(appError, { operation: 'updateBankTransferStatus', transferId, status });
      throw appError;
    }

    return data;
  } catch (error) {
    if (error.code) throw error;
    const appError = handleError(error, ERROR_CODES.DB_ERROR, { operation: 'updateBankTransferStatus', transferId });
    throw appError;
  }
};

/**
 * Get bank transfer history for a remittance (Admin/User)
 * Retrieves complete transfer tracking history with related data
 * @param {string} remittanceId - Remittance ID
 * @throws {AppError} If query fails
 * @returns {Promise<Array>} Array of bank transfer records
 */
export const getBankTransferHistory = async (remittanceId) => {
  try {
    if (!remittanceId) {
      throw createValidationError({ remittanceId: 'Remittance ID is required' });
    }

    const { data, error } = await supabase
      .from('remittance_bank_transfers')
      .select(`
        id,
        status,
        amount_transferred,
        processed_at,
        created_at,
        error_message,
        recipient_bank_account:recipient_bank_account_id(
          id,
          is_default,
          bank_accounts(
            id,
            account_number_last4,
            account_holder_name,
            banks(name),
            currencies(code)
          )
        )
      `)
      .eq('remittance_id', remittanceId)
      .order('created_at', { ascending: false });

    if (error) {
      const appError = parseSupabaseError(error);
      logError(appError, { operation: 'getBankTransferHistory', remittanceId });
      throw appError;
    }

    return data || [];
  } catch (error) {
    if (error.code) throw error;
    const appError = handleError(error, ERROR_CODES.DB_ERROR, { operation: 'getBankTransferHistory', remittanceId });
    throw appError;
  }
};

/**
 * Get pending bank transfers (Admin)
 * Returns all pending transfers awaiting admin action
 * @param {Object} filters - Optional filters: status
 * @throws {AppError} If query fails
 * @returns {Promise<Array>} Array of pending bank transfers
 */
export const getPendingBankTransfers = async (filters = {}) => {
  try {
    let query = supabase
      .from('remittance_bank_transfers')
      .select(`
        id,
        status,
        amount_transferred,
        created_at,
        remittances(id, remittance_number),
        recipient_bank_account:recipient_bank_account_id(
          recipient_id,
          bank_accounts(account_number_last4, account_holder_name)
        )
      `)
      .eq('status', 'pending');

    // Apply optional status filter (overrides default)
    if (filters.status) {
      query = query.eq('status', filters.status);
    }

    const { data, error } = await query.order('created_at', { ascending: true });

    if (error) {
      const appError = parseSupabaseError(error);
      logError(appError, { operation: 'getPendingBankTransfers', filters });
      throw appError;
    }

    return data || [];
  } catch (error) {
    if (error.code) throw error;
    const appError = handleError(error, ERROR_CODES.DB_ERROR, { operation: 'getPendingBankTransfers' });
    throw appError;
  }
};
