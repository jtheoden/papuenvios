/**
 * Recipient Service
 * Gestión de destinatarios y sus direcciones
 * User-owned data with authorization checks and bank account management
 */

import { supabase } from '@/lib/supabase';
import {
  AppError,
  handleError, logError, createValidationError,
  createNotFoundError, createPermissionError, parseSupabaseError, ERROR_CODES
} from './errorHandler';
import { encryptData } from '@/lib/encryption';

const formatServiceError = (error, context = {}, defaultCode = ERROR_CODES.DB_ERROR) => {
  const parsedError = error instanceof AppError ? error : (parseSupabaseError(error) || error);
  return handleError(parsedError, parsedError?.code || defaultCode, context);
};

// ============================================================================
// DESTINATARIOS
// ============================================================================

/**
 * Get all recipients for authenticated user
 * @returns {Promise<Array>} Array of recipient objects with addresses
 * @throws {AppError} AUTH_REQUIRED if not authenticated, DB_ERROR on failure
 */
export const getMyRecipients = async () => {
  try {
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      throw new Error('Not authenticated');
    }

    const { data, error } = await supabase
      .from('recipients')
      .select(`
        *,
        addresses:recipient_addresses(*)
      `)
      .eq('user_id', user.id)
      .order('is_favorite', { ascending: false })
      .order('created_at', { ascending: false });

    if (error) {
      throw parseSupabaseError(error);
    }

    return data || [];
  } catch (error) {
    if (error.code) throw error;
    const appError = handleError(error, ERROR_CODES.DB_ERROR, { operation: 'getMyRecipients' });
    logError(appError, { operation: 'getMyRecipients' });
    throw appError;
  }
};

/**
 * Get recipient by ID with authorization check
 * @param {string} recipientId - Recipient UUID
 * @returns {Promise<Object>} Recipient object with addresses
 * @throws {AppError} NOT_FOUND if recipient not found, FORBIDDEN if not owner, DB_ERROR on failure
 */
export const getRecipientById = async (recipientId) => {
  try {
    if (!recipientId) {
      throw createValidationError({ recipientId: 'Recipient ID required' }, 'Missing recipient ID');
    }

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      throw new Error('Not authenticated');
    }

    const { data, error } = await supabase
      .from('recipients')
      .select(`
        *,
        addresses:recipient_addresses(*)
      `)
      .eq('id', recipientId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        throw createNotFoundError('Recipient', recipientId);
      }
      throw parseSupabaseError(error);
    }

    // Authorization check: user can only access their own recipients
    if (data.user_id !== user.id) {
      throw createPermissionError('access this recipient', 'owner');
    }

    return data;
  } catch (error) {
    if (error.code) throw error;
    const appError = handleError(error, ERROR_CODES.DB_ERROR, {
      operation: 'getRecipientById',
      recipientId
    });
    logError(appError, { operation: 'getRecipientById', recipientId });
    throw appError;
  }
};

/**
 * Create new recipient for authenticated user
 * @param {Object} recipientData - Recipient data
 * @returns {Promise<Object>} Created recipient object
 * @throws {AppError} AUTH_REQUIRED if not authenticated, VALIDATION_FAILED if invalid data, DB_ERROR on failure
 */
export const createRecipient = async (recipientData) => {
  try {
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      throw new Error('Not authenticated');
    }

    // Basic validation
    if (!recipientData || typeof recipientData !== 'object') {
      throw createValidationError({ recipientData: 'Valid recipient data required' }, 'Invalid recipient data');
    }

    const { data, error } = await supabase
      .from('recipients')
      .insert([{
        user_id: user.id,
        ...recipientData
      }])
      .select()
      .single();

    if (error) {
      throw parseSupabaseError(error);
    }

    return {
      success: true,
      recipient: data
    };
  } catch (error) {
    return formatServiceError(error, { operation: 'createRecipient' });
  }
};

/**
 * Update recipient with authorization check
 * @param {string} recipientId - Recipient UUID
 * @param {Object} updates - Fields to update
 * @returns {Promise<Object>} Updated recipient object
 * @throws {AppError} NOT_FOUND if recipient not found, FORBIDDEN if not owner, DB_ERROR on failure
 */
export const updateRecipient = async (recipientId, updates) => {
  try {
    if (!recipientId) {
      throw createValidationError({ recipientId: 'Recipient ID required' }, 'Missing recipient ID');
    }

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      throw new Error('Not authenticated');
    }

    // Verify ownership before updating
    const { data: recipient, error: checkError } = await supabase
      .from('recipients')
      .select('user_id')
      .eq('id', recipientId)
      .single();

    if (checkError || !recipient) {
      throw createNotFoundError('Recipient', recipientId);
    }

    if (recipient.user_id !== user.id) {
      throw createPermissionError('update this recipient', 'owner');
    }

    const { data, error } = await supabase
      .from('recipients')
      .update(updates)
      .eq('id', recipientId)
      .select()
      .single();

    if (error) {
      throw parseSupabaseError(error);
    }

    return {
      success: true,
      recipient: data
    };
  } catch (error) {
    return formatServiceError(error, { operation: 'updateRecipient', recipientId });
  }
};

/**
 * Delete recipient with authorization check
 * @param {string} recipientId - Recipient UUID
 * @returns {Promise<boolean>} True if successful
 * @throws {AppError} NOT_FOUND if recipient not found, FORBIDDEN if not owner, DB_ERROR on failure
 */
export const deleteRecipient = async (recipientId) => {
  try {
    if (!recipientId) {
      throw createValidationError({ recipientId: 'Recipient ID required' }, 'Missing recipient ID');
    }

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      throw new Error('Not authenticated');
    }

    // Verify ownership before deleting
    const { data: recipient, error: checkError } = await supabase
      .from('recipients')
      .select('user_id')
      .eq('id', recipientId)
      .single();

    if (checkError || !recipient) {
      throw createNotFoundError('Recipient', recipientId);
    }

    if (recipient.user_id !== user.id) {
      throw createPermissionError('delete this recipient', 'owner');
    }

    const { error } = await supabase
      .from('recipients')
      .delete()
      .eq('id', recipientId);

    if (error) {
      throw parseSupabaseError(error);
    }

    return {
      success: true
    };
  } catch (error) {
    return formatServiceError(error, { operation: 'deleteRecipient', recipientId });
  }
};

// ============================================================================
// DIRECCIONES DE DESTINATARIOS
// ============================================================================

/**
 * Add address to recipient with default address management
 * @param {Object} addressData - Address data
 * @param {string} addressData.recipient_id - Recipient UUID (required)
 * @param {boolean} [addressData.is_default] - Mark as default address
 * @returns {Promise<Object>} Created address object
 * @throws {AppError} VALIDATION_FAILED if recipient_id missing, DB_ERROR on failure
 */
export const addRecipientAddress = async (addressData) => {
  try {
    if (!addressData || !addressData.recipient_id) {
      throw createValidationError(
        { recipient_id: 'Recipient ID is required' },
        'Missing recipient ID'
      );
    }

    // If marking as default, unset others
    if (addressData.is_default) {
      const { error: updateError } = await supabase
        .from('recipient_addresses')
        .update({ is_default: false })
        .eq('recipient_id', addressData.recipient_id);

      if (updateError) {
        logError(parseSupabaseError(updateError), {
          operation: 'addRecipientAddress - unset other defaults',
          recipientId: addressData.recipient_id
        });
        // Continue despite error in non-critical operation
      }
    }

    const { data, error } = await supabase
      .from('recipient_addresses')
      .insert([addressData])
      .select()
      .single();

    if (error) {
      throw parseSupabaseError(error);
    }

    return {
      success: true,
      address: data
    };
  } catch (error) {
    return formatServiceError(error, {
      operation: 'addRecipientAddress',
      recipientId: addressData?.recipient_id
    });
  }
};

/**
 * Update recipient address with default address management
 * @param {string} addressId - Address UUID
 * @param {Object} updates - Fields to update
 * @returns {Promise<Object>} Updated address object
 * @throws {AppError} NOT_FOUND if address not found, DB_ERROR on failure
 */
export const updateRecipientAddress = async (addressId, updates) => {
  try {
    if (!addressId) {
      throw createValidationError({ addressId: 'Address ID required' }, 'Missing address ID');
    }

    // If marking as default, unset others
    if (updates.is_default) {
      const { data: address, error: fetchError } = await supabase
        .from('recipient_addresses')
        .select('recipient_id')
        .eq('id', addressId)
        .single();

      if (address) {
        const { error: updateError } = await supabase
          .from('recipient_addresses')
          .update({ is_default: false })
          .eq('recipient_id', address.recipient_id);

        if (updateError) {
          logError(parseSupabaseError(updateError), {
            operation: 'updateRecipientAddress - unset other defaults',
            recipientId: address.recipient_id
          });
          // Continue despite error in non-critical operation
        }
      }
    }

    const { data, error } = await supabase
      .from('recipient_addresses')
      .update(updates)
      .eq('id', addressId)
      .select()
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        throw createNotFoundError('Address', addressId);
      }
      throw parseSupabaseError(error);
    }

    return {
      success: true,
      address: data
    };
  } catch (error) {
    return formatServiceError(error, { operation: 'updateRecipientAddress', addressId });
  }
};

/**
 * Delete recipient address
 * @param {string} addressId - Address UUID
 * @returns {Promise<boolean>} True if successful
 * @throws {AppError} NOT_FOUND if address not found, DB_ERROR on failure
 */
export const deleteRecipientAddress = async (addressId) => {
  try {
    if (!addressId) {
      throw createValidationError({ addressId: 'Address ID required' }, 'Missing address ID');
    }

    const { error } = await supabase
      .from('recipient_addresses')
      .delete()
      .eq('id', addressId);

    if (error) {
      throw parseSupabaseError(error);
    }

    return {
      success: true
    };
  } catch (error) {
    return formatServiceError(error, { operation: 'deleteRecipientAddress', addressId });
  }
};

// ============================================================================
// LOCALIDADES DE CUBA
// ============================================================================

/**
 * Get all Cuban provinces with delivery available
 * @returns {Promise<Array>} Array of province names sorted alphabetically
 * @throws {AppError} DB_ERROR if query fails
 */
export const getCubanProvinces = async () => {
  try {
    const { data, error } = await supabase
      .from('cuban_municipalities')
      .select('province')
      .eq('delivery_available', true);

    if (error) {
      throw parseSupabaseError(error);
    }

    // Remove duplicates and sort
    const provinces = [...new Set((data || []).map(item => item.province))].sort();
    return provinces;
  } catch (error) {
    if (error.code) throw error;
    const appError = handleError(error, ERROR_CODES.DB_ERROR, { operation: 'getCubanProvinces' });
    logError(appError, { operation: 'getCubanProvinces' });
    throw appError;
  }
};

/**
 * Get municipalities by province with delivery available
 * @param {string} province - Province name
 * @returns {Promise<Array>} Array of municipality objects sorted by name
 * @throws {AppError} DB_ERROR if query fails
 */
export const getMunicipalitiesByProvince = async (province) => {
  try {
    if (!province) {
      throw createValidationError({ province: 'Province name required' }, 'Missing province');
    }

    const { data, error } = await supabase
      .from('cuban_municipalities')
      .select('*')
      .eq('province', province)
      .eq('delivery_available', true)
      .order('municipality');

    if (error) {
      throw parseSupabaseError(error);
    }

    return data || [];
  } catch (error) {
    if (error.code) throw error;
    const appError = handleError(error, ERROR_CODES.DB_ERROR, {
      operation: 'getMunicipalitiesByProvince',
      province
    });
    logError(appError, { operation: 'getMunicipalitiesByProvince', province });
    throw appError;
  }
};

// ============================================================================
// BANK ACCOUNT MANAGEMENT - Functions for bank account operations
// ============================================================================

/**
 * Create bank account for user with automatic currency/account type detection
 * Supports currency code → UUID auto-conversion
 * Supports automatic account type selection based on currency
 *
 * @param {string} userId - User UUID
 * @param {Object} bankData - Bank account data
 * @param {string} bankData.bankId - Bank UUID (required)
 * @param {string} [bankData.accountTypeId] - Account type UUID (auto-detect if null)
 * @param {string} bankData.currencyId - Currency UUID or code (required)
 * @param {string} bankData.accountNumber - Full account number (hashed for security)
 * @param {string} bankData.accountHolderName - Account holder name
 * @returns {Promise<Object>} Created bank account object
 * @throws {AppError} VALIDATION_FAILED if required fields missing, DB_ERROR on failure
 */
export const createBankAccount = async (userId, bankData) => {
  try {

    const { bankId, accountTypeId, currencyId, accountNumber, accountHolderName } = bankData;

    // Validate required inputs
    if (!userId || !bankId || !currencyId || !accountNumber || !accountHolderName) {
      throw createValidationError({
        userId: !userId ? 'User ID required' : null,
        bankId: !bankId ? 'Bank ID required' : null,
        currencyId: !currencyId ? 'Currency ID required' : null,
        accountNumber: !accountNumber ? 'Account number required' : null,
        accountHolderName: !accountHolderName ? 'Account holder name required' : null
      }, 'Missing required bank account fields');
    }

    let finalCurrencyId = currencyId;
    let finalAccountTypeId = accountTypeId;

    // Auto-convert currency code (e.g., 'USD', 'MLC') to UUID if needed
    if (typeof currencyId === 'string' && currencyId.length <= 4) {
      try {
        const { getCurrencyByCode } = await import('@/lib/bankService');
        const currencyData = await getCurrencyByCode(currencyId);
        finalCurrencyId = currencyData.id;
      } catch (error) {
        console.error('[createBankAccount] Currency lookup failed:', error);
        throw new Error(`La moneda '${currencyId}' no está disponible en el sistema. Por favor, contacta al administrador para agregar esta moneda.`);
      }
    }

    // Auto-detect account type based on currency if not provided
    if (!accountTypeId) {
      try {
        const { getDefaultAccountTypeForCurrency } = await import('@/lib/bankService');
        const accountTypeData = await getDefaultAccountTypeForCurrency(currencyId);
        finalAccountTypeId = accountTypeData.id;
      } catch (error) {
        console.error('[createBankAccount] Account type lookup failed:', error);
        throw new Error(`No se encontró un tipo de cuenta para la moneda '${currencyId}'. Por favor, contacta al administrador.`);
      }
    }

    if (!finalAccountTypeId) {
      throw new Error('Account type could not be determined');
    }

    // Hash account number for security (for duplicate detection)
    const encoder = new TextEncoder();
    const dataToHash = encoder.encode(accountNumber + userId);
    const hashBuffer = await crypto.subtle.digest('SHA-256', dataToHash);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const accountNumberHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    const accountNumberLast4 = accountNumber.slice(-4);

    // Encrypt full account number for admin access
    const encryptedAccountNumber = await encryptData(accountNumber);

    // Check if account already exists (including soft-deleted ones)
    const { data: existingAccount } = await supabase
      .from('bank_accounts')
      .select('id, is_active, deleted_at')
      .eq('account_number_hash', accountNumberHash)
      .eq('user_id', userId)
      .single();

    // If account exists and is soft-deleted, reactivate it
    if (existingAccount && existingAccount.deleted_at) {
      const { data: reactivatedAccount, error: reactivateError } = await supabase
        .from('bank_accounts')
        .update({
          is_active: true,
          deleted_at: null,
          updated_at: new Date().toISOString()
        })
        .eq('id', existingAccount.id)
        .select()
        .single();

      if (reactivateError) {
        throw parseSupabaseError(reactivateError);
      }

      return reactivatedAccount;
    }

    // If account exists and is active, return error
    if (existingAccount && !existingAccount.deleted_at) {
      console.warn('[createBankAccount] Account already exists:', existingAccount.id);
      throw createValidationError(
        { accountNumber: 'Esta cuenta bancaria ya está registrada para este usuario' },
        'Duplicate bank account'
      );
    }

    // Create new account
    const { data, error } = await supabase
      .from('bank_accounts')
      .insert([
        {
          user_id: userId,
          bank_id: bankId,
          account_type_id: finalAccountTypeId,
          currency_id: finalCurrencyId,
          account_number_last4: accountNumberLast4,
          account_number_hash: accountNumberHash,
          account_number_full: encryptedAccountNumber,
          account_holder_name: accountHolderName,
          is_active: true
        }
      ])
      .select()
      .single();

    if (error) {
      throw parseSupabaseError(error);
    }

    return data;
  } catch (error) {
    if (error.code) throw error;
    const appError = handleError(error, ERROR_CODES.DB_ERROR, {
      operation: 'createBankAccount',
      userId
    });
    logError(appError, { operation: 'createBankAccount', userId });
    throw appError;
  }
};

/**
 * Get bank accounts for user with optional filtering
 * @param {string} userId - User UUID
 * @param {boolean} [activeOnly=true] - Return only active accounts
 * @returns {Promise<Array>} Array of bank account objects with relationships
 * @throws {AppError} DB_ERROR if query fails
 */
export const getBankAccountsByUser = async (userId, activeOnly = true) => {
  try {
    if (!userId) {
      throw createValidationError({ userId: 'User ID required' }, 'Missing user ID');
    }

    let query = supabase
      .from('bank_accounts')
      .select(`
        id,
        account_number_last4,
        account_holder_name,
        is_active,
        created_at,
        banks(name, swift_code),
        account_types(name),
        currencies(code, name)
      `)
      .eq('user_id', userId);

    if (activeOnly) {
      query = query.eq('is_active', true).is('deleted_at', null);
    }

    const { data, error } = await query.order('created_at', { ascending: false });

    if (error) {
      throw parseSupabaseError(error);
    }

    return data || [];
  } catch (error) {
    if (error.code) throw error;
    const appError = handleError(error, ERROR_CODES.DB_ERROR, {
      operation: 'getBankAccountsByUser',
      userId
    });
    logError(appError, { operation: 'getBankAccountsByUser', userId });
    throw appError;
  }
};

/**
 * Update bank account with timestamp management
 * @param {string} accountId - Bank account UUID
 * @param {Object} updates - Fields to update
 * @returns {Promise<Object>} Updated bank account object
 * @throws {AppError} NOT_FOUND if account not found, DB_ERROR on failure
 */
export const updateBankAccount = async (accountId, updates) => {
  try {
    if (!accountId) {
      throw createValidationError({ accountId: 'Account ID required' }, 'Missing account ID');
    }

    const { data, error } = await supabase
      .from('bank_accounts')
      .update({
        ...updates,
        updated_at: new Date().toISOString()
      })
      .eq('id', accountId)
      .select()
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        throw createNotFoundError('Bank account', accountId);
      }
      throw parseSupabaseError(error);
    }

    return data;
  } catch (error) {
    if (error.code) throw error;
    const appError = handleError(error, ERROR_CODES.DB_ERROR, {
      operation: 'updateBankAccount',
      accountId
    });
    logError(appError, { operation: 'updateBankAccount', accountId });
    throw appError;
  }
};

/**
 * Soft delete bank account with deletion tracking
 * @param {string} accountId - Bank account UUID
 * @param {string} deletedByUserId - User UUID performing deletion
 * @returns {Promise<Object>} Updated bank account object
 * @throws {AppError} NOT_FOUND if account not found, DB_ERROR on failure
 */
export const deleteBankAccount = async (accountId, deletedByUserId) => {
  try {
    if (!accountId || !deletedByUserId) {
      throw createValidationError({
        accountId: !accountId ? 'Account ID required' : null,
        deletedByUserId: !deletedByUserId ? 'Deleted by user ID required' : null
      }, 'Missing deletion parameters');
    }

    const { data, error } = await supabase
      .from('bank_accounts')
      .update({
        deleted_at: new Date().toISOString(),
        deleted_by_user_id: deletedByUserId,
        is_active: false,
        updated_at: new Date().toISOString()
      })
      .eq('id', accountId)
      .select()
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        throw createNotFoundError('Bank account', accountId);
      }
      throw parseSupabaseError(error);
    }

    return data;
  } catch (error) {
    if (error.code) throw error;
    const appError = handleError(error, ERROR_CODES.DB_ERROR, {
      operation: 'deleteBankAccount',
      accountId
    });
    logError(appError, { operation: 'deleteBankAccount', accountId });
    throw appError;
  }
};

/**
 * Link bank account to recipient with default account management
 * @param {string} recipientId - Recipient UUID
 * @param {string} bankAccountId - Bank account UUID
 * @param {boolean} [isDefault=false] - Mark as default account for recipient
 * @returns {Promise<Object>} Created link object
 * @throws {AppError} VALIDATION_FAILED if IDs missing, DB_ERROR on failure
 */
export const linkBankAccountToRecipient = async (recipientId, bankAccountId, isDefault = false) => {
  try {
    if (!recipientId || !bankAccountId) {
      throw createValidationError({
        recipientId: !recipientId ? 'Recipient ID required' : null,
        bankAccountId: !bankAccountId ? 'Bank account ID required' : null
      }, 'Missing link parameters');
    }

    // If setting as default, unset other defaults
    if (isDefault) {
      const { error: updateError } = await supabase
        .from('recipient_bank_accounts')
        .update({ is_default: false })
        .eq('recipient_id', recipientId);

      if (updateError) {
        logError(parseSupabaseError(updateError), {
          operation: 'linkBankAccountToRecipient - unset other defaults',
          recipientId
        });
        // Continue despite error in non-critical operation
      }
    }

    const { data, error } = await supabase
      .from('recipient_bank_accounts')
      .insert([
        {
          recipient_id: recipientId,
          bank_account_id: bankAccountId,
          is_default: isDefault,
          is_active: true
        }
      ])
      .select()
      .single();

    if (error) {
      throw parseSupabaseError(error);
    }

    return data;
  } catch (error) {
    if (error.code) throw error;
    const appError = handleError(error, ERROR_CODES.DB_ERROR, {
      operation: 'linkBankAccountToRecipient',
      recipientId,
      bankAccountId
    });
    logError(appError, {
      operation: 'linkBankAccountToRecipient',
      recipientId,
      bankAccountId
    });
    throw appError;
  }
};

/**
 * Get bank accounts for recipient with full relationships
 * @param {string} recipientId - Recipient UUID
 * @returns {Promise<Array>} Array of linked bank accounts with bank/currency details
 * @throws {AppError} DB_ERROR if query fails
 */
export const getBankAccountsForRecipient = async (recipientId) => {
  try {
    if (!recipientId) {
      throw createValidationError({ recipientId: 'Recipient ID required' }, 'Missing recipient ID');
    }

    const { data, error } = await supabase
      .from('recipient_bank_accounts')
      .select(`
        id,
        is_default,
        created_at,
        bank_account:bank_accounts!bank_account_id(
          id,
          account_number_last4,
          account_holder_name,
          is_active,
          bank:banks!bank_id(name, swift_code, logo_filename),
          account_type:account_types!account_type_id(name),
          currency:currencies!currency_id(code, name_es, name_en)
        )
      `)
      .eq('recipient_id', recipientId)
      .eq('is_active', true);

    if (error) {
      throw parseSupabaseError(error);
    }

    return data || [];
  } catch (error) {
    if (error.code) throw error;
    const appError = handleError(error, ERROR_CODES.DB_ERROR, {
      operation: 'getBankAccountsForRecipient',
      recipientId
    });
    logError(appError, { operation: 'getBankAccountsForRecipient', recipientId });
    throw appError;
  }
};

// ============================================================================
// END BANK ACCOUNT MANAGEMENT
// ============================================================================
