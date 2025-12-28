/**
 * Remittance Service
 * Manages remittance types, remittance orders, and all related operations
 * Uses standardized error handling with AppError class
 */

import { supabase } from '@/lib/supabase';
import { logActivity } from '@/lib/activityLogger';
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
import {
  getAvailableZelleAccount,
  registerZelleTransaction,
  upsertZelleTransactionStatus,
  ZELLE_STATUS,
  ZELLE_TRANSACTION_TYPES
} from '@/lib/zelleService';

/**
 * Generate a signed URL for accessing a proof from private storage
 * Signed URLs are valid for 1 hour and work with private buckets
 * @param {string} proofFilePath - File path in the storage bucket (e.g., "user-id/REM-2025-0001.jpg")
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

    // Generate signed URL valid for 1 hour (3600 seconds)
    const { data, error } = await supabase.storage
      .from(bucketName)
      .createSignedUrl(proofFilePath, 3600);

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
    console.log('[getActiveRemittanceTypes] Fetching active remittance types...');

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

    console.log('[getActiveRemittanceTypes] Types loaded:', data?.length || 0);
    console.log('[getActiveRemittanceTypes] Types:', data);

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

// ============================================================================
// GESTIÓN DE REMESAS (USUARIO)
// ============================================================================

/**
 * Calculate remittance details including exchange rate, commissions, and delivery amount
 * @param {string} typeId - Remittance type ID
 * @param {number} amount - Amount to send
 * @throws {AppError} If type not found, amount invalid, or calculation fails
 * @returns {Promise<Object>} Calculation details with commission and delivery amount
 */
export const calculateRemittance = async (typeId, amount) => {
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

    // Calculate commission - single source of truth formula
    const commissionPercentage = (amount * (type.commission_percentage || 0)) / 100;
    const commissionFixed = type.commission_fixed || 0;
    const totalCommission = commissionPercentage + commissionFixed;

    // Calculate delivery amount
    const amountToDeliver = (amount * type.exchange_rate) - (totalCommission * type.exchange_rate);

    return {
      amount,
      exchangeRate: type.exchange_rate,
      commissionPercentage: type.commission_percentage || 0,
      commissionFixed: type.commission_fixed || 0,
      totalCommission,
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
 * Create a new remittance (User)
 * @param {Object} remittanceData - Remittance creation data
 * @throws {AppError} If validation fails or creation fails
 * @returns {Promise<Object>} Created remittance
 */
export const createRemittance = async (remittanceData) => {
  console.log('[createRemittance] START - Input data:', remittanceData);

  try {
    const {
      remittance_type_id,
      amount,
      recipient_name,
      recipient_phone,
      recipient_address,
      recipient_city,
      recipient_id_number,
      notes,
      zelle_account_id,
      recipient_id,
      recipient_bank_account_id
    } = remittanceData;

    console.log('[createRemittance] STEP 1 - Extracted fields:', {
      remittance_type_id,
      amount,
      recipient_name,
      recipient_phone,
      has_zelle_account_id: !!zelle_account_id,
      has_recipient_bank_account_id: !!recipient_bank_account_id
    });

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

    console.log('[createRemittance] STEP 2 - Validation passed, calculating remittance...');

    // Calculate using single source of truth
    const calculation = await calculateRemittance(remittance_type_id, amount);
    const {
      commissionPercentage,
      commissionFixed,
      totalCommission,
      amountToDeliver,
      exchangeRate,
      currency: currencyCode,
      deliveryCurrency,
      deliveryMethod
    } = calculation;

    console.log('[createRemittance] STEP 3 - Calculation complete:', {
      commissionPercentage,
      commissionFixed,
      totalCommission,
      amountToDeliver,
      exchangeRate,
      currencyCode,
      deliveryCurrency,
      deliveryMethod
    });

    // Get authenticated user
    console.log('[createRemittance] STEP 4 - Getting authenticated user...');
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

    console.log('[createRemittance] STEP 5 - User authenticated:', { userId: user.id, email: user.email });

    // Get or find available Zelle account
    let selectedZelleAccountId = zelle_account_id;
    if (!selectedZelleAccountId) {
      console.log('[createRemittance] STEP 6a - No Zelle account provided, finding available account...');
      const zelleResult = await getAvailableZelleAccount('remittance', amount);
      console.log('[createRemittance] Zelle account result:', zelleResult);
      if (!zelleResult.success) {
        console.error('[createRemittance] ZELLE ERROR: No accounts available');
        throw new Error('No Zelle accounts available. Please try again later.');
      }
      selectedZelleAccountId = zelleResult.account.id;
      console.log('[createRemittance] Auto-assigned Zelle account:', selectedZelleAccountId);
    } else {
      console.log('[createRemittance] STEP 6b - Using provided Zelle account:', selectedZelleAccountId);
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
      recipient_province: recipient_city,
      recipient_id_number,
      delivery_notes: notes,
      status: REMITTANCE_STATUS.PAYMENT_PENDING,
      zelle_account_id: selectedZelleAccountId
    };

    if (recipient_id) {
      insertData.recipient_id = recipient_id;
    }

    console.log('[createRemittance] STEP 7 - Insert data prepared:', {
      ...insertData,
      delivery_notes: notes ? 'Present' : 'Empty'
    });

    console.log('[createRemittance] STEP 8 - Inserting into database...');
    const { data, error } = await supabase
      .from('remittances')
      .insert([insertData])
      .select('*, zelle_accounts(*)')
      .single();

    if (error) {
      console.error('[createRemittance] DATABASE INSERT ERROR:', error);
      const appError = parseSupabaseError(error);
      logError(appError, { operation: 'createRemittance - insert', amount, recipientName: recipient_name });
      throw appError;
    }

    console.log('[createRemittance] STEP 9 - Database insert successful:', {
      remittanceId: data.id,
      remittanceNumber: data.remittance_number
    });

    // Register Zelle transaction (graceful fallback if fails)
    console.log('[createRemittance] STEP 10 - Registering Zelle transaction...');
    try {
      await registerZelleTransaction({
        zelle_account_id: selectedZelleAccountId,
        transaction_type: ZELLE_TRANSACTION_TYPES.REMITTANCE,
        reference_id: data.id,
        amount: amount,
        notes: `Remesa ${data.remittance_number}`
      });
      console.log('[createRemittance] Zelle transaction registered successfully');
    } catch (zelleError) {
      console.error('[createRemittance] Zelle registration error (non-fatal):', zelleError);
      logError(zelleError, { operation: 'createRemittance - Zelle registration', remittanceId: data.id });
      // Don't fail remittance creation if Zelle registration fails
    }

    // Create bank transfer for off-cash methods (graceful fallback if fails)
    if (deliveryMethod !== 'cash' && recipient_bank_account_id) {
      console.log('[createRemittance] STEP 11 - Creating bank transfer for non-cash delivery...');
      try {
        await createBankTransfer(
          data.id,
          recipient_bank_account_id,
          { amount_transferred: amountToDeliver }
        );
        console.log('[createRemittance] Bank transfer created successfully');
      } catch (bankError) {
        console.error('[createRemittance] Bank transfer creation error (non-fatal):', bankError);
        logError(bankError, { operation: 'createRemittance - bank transfer', remittanceId: data.id });
        // Don't fail remittance creation if bank transfer creation fails
      }
    } else {
      console.log('[createRemittance] STEP 11 - Skipping bank transfer (cash delivery or no account)');
    }

    console.log('[createRemittance] SUCCESS - Remittance created:', data);
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
      description: 'Payment proof uploaded (remittance)',
      metadata: {
        paymentProofUrl: filePath,
        paymentNotes: notes
      }
    });

    // Notify admin (graceful fallback if fails - don't block remittance creation)
    try {
      const { data: settings, error: settingsError } = await supabase
        .from('system_config')
        .select('value_text')
        .eq('key', 'whatsapp_admin_phone')
        .single();

      if (!settingsError && settings?.value_text) {
        const remittanceForNotify = {
          ...updatedRemittance,
          user_email: user.email
        };
        await notifyAdminNewPaymentProof(remittanceForNotify, settings.value_text, 'es');
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
      description: 'Payment validated (remittance)',
      metadata: {
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
      logError(new Error(`Validation notes: ${notes}`), { operation: 'validatePayment - notes', remittanceId });
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
    const { data: updatedRemittance, error: updateError } = await supabase
      .from('remittances')
      .update({
        status: REMITTANCE_STATUS.PAYMENT_REJECTED,
        payment_rejected_at: new Date().toISOString(),
        payment_rejection_reason: reason,
        updated_at: new Date().toISOString()
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
      description: 'Payment rejected (remittance)',
      metadata: {
        rejectionReason: reason,
        rejectedAt: updatedRemittance?.payment_rejected_at,
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
      logError(new Error(`Processing notes: ${notes}`), { operation: 'startProcessing - notes', remittanceId });
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
