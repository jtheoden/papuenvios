// ============================================================================
// BANK SERVICE - Master data management for banks and account types
// ============================================================================

import { supabase } from '@/lib/supabase';
import {
  handleError, logError, createValidationError,
  createNotFoundError, parseSupabaseError, ERROR_CODES
} from './errorHandler';

/**
 * Get all banks
 * @returns {Promise<Array>} Array of bank objects sorted by name
 * @throws {AppError} DB_ERROR if query fails
 */
export const getAllBanks = async () => {
  try {
    const { data, error } = await supabase
      .from('banks')
      .select('*')
      .order('name', { ascending: true });

    if (error) {
      throw parseSupabaseError(error);
    }

    return data || [];
  } catch (error) {
    if (error.code) throw error;
    const appError = handleError(error, ERROR_CODES.DB_ERROR, { operation: 'getAllBanks' });
    logError(appError, { operation: 'getAllBanks' });
    throw appError;
  }
};

/**
 * Get all account types
 * @returns {Promise<Array>} Array of account type objects sorted by name
 * @throws {AppError} DB_ERROR if query fails
 */
export const getAllAccountTypes = async () => {
  try {
    const { data, error } = await supabase
      .from('account_types')
      .select('*')
      .order('name', { ascending: true });

    if (error) {
      throw parseSupabaseError(error);
    }

    return data || [];
  } catch (error) {
    if (error.code) throw error;
    const appError = handleError(error, ERROR_CODES.DB_ERROR, { operation: 'getAllAccountTypes' });
    logError(appError, { operation: 'getAllAccountTypes' });
    throw appError;
  }
};

/**
 * Create a new bank (ADMIN ONLY)
 * @param {Object} bankData - Bank data
 * @param {string} bankData.name - Bank name (required)
 * @param {string} [bankData.swiftCode] - SWIFT code
 * @param {string} [bankData.localCode] - Local bank code
 * @param {string} [bankData.countryCode] - Country code
 * @returns {Promise<Object>} Created bank object
 * @throws {AppError} VALIDATION_FAILED if name missing, DB_ERROR on failure
 */
export const createBank = async (bankData) => {
  try {
    const { name, swiftCode, localCode, countryCode } = bankData;

    // Input validation
    if (!name) {
      throw createValidationError({ name: 'Bank name is required' }, 'Missing bank name');
    }

    const { data, error } = await supabase
      .from('banks')
      .insert([
        {
          name,
          swift_code: swiftCode,
          local_code: localCode,
          country_code: countryCode
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
      operation: 'createBank',
      bankName: bankData.name
    });
    logError(appError, { operation: 'createBank', bankName: bankData.name });
    throw appError;
  }
};

/**
 * Get bank by ID with full details
 * @param {string} bankId - Bank UUID
 * @returns {Promise<Object>} Bank object with all details
 * @throws {AppError} NOT_FOUND if bank not found, DB_ERROR on failure
 */
export const getBankById = async (bankId) => {
  try {
    if (!bankId) {
      throw createValidationError({ bankId: 'Bank ID is required' }, 'Missing bank ID');
    }

    const { data, error } = await supabase
      .from('banks')
      .select('*')
      .eq('id', bankId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        throw createNotFoundError('Bank', bankId);
      }
      throw parseSupabaseError(error);
    }

    return data;
  } catch (error) {
    if (error.code) throw error;
    const appError = handleError(error, ERROR_CODES.DB_ERROR, {
      operation: 'getBankById',
      bankId
    });
    logError(appError, { operation: 'getBankById', bankId });
    throw appError;
  }
};

/**
 * Search banks by name or code
 * @param {string} query - Search query (minimum 2 characters)
 * @returns {Promise<Array>} Array of matching banks (max 10 results)
 * @throws {AppError} DB_ERROR if query fails
 */
export const searchBanks = async (query) => {
  try {
    // Return empty array for short queries
    if (!query || query.length < 2) {
      return [];
    }

    const { data, error } = await supabase
      .from('banks')
      .select('*')
      .or(`name.ilike.%${query}%,swift_code.ilike.%${query}%,local_code.ilike.%${query}%`)
      .limit(10);

    if (error) {
      throw parseSupabaseError(error);
    }

    return data || [];
  } catch (error) {
    if (error.code) throw error;
    const appError = handleError(error, ERROR_CODES.DB_ERROR, {
      operation: 'searchBanks',
      query
    });
    logError(appError, { operation: 'searchBanks', query });
    throw appError;
  }
};

/**
 * Get all active currencies
 * @returns {Promise<Array>} Array of active currency objects sorted by code
 * @throws {AppError} DB_ERROR if query fails
 */
export const getAllCurrencies = async () => {
  try {
    const { data, error } = await supabase
      .from('currencies')
      .select('*')
      .eq('is_active', true)
      .order('code', { ascending: true });

    if (error) {
      throw parseSupabaseError(error);
    }

    return data || [];
  } catch (error) {
    if (error.code) throw error;
    const appError = handleError(error, ERROR_CODES.DB_ERROR, { operation: 'getAllCurrencies' });
    logError(appError, { operation: 'getAllCurrencies' });
    throw appError;
  }
};

/**
 * Get account types filtered by currency
 * @param {string} currencyCode - Currency code (USD, CUP, MLC, etc.)
 * @returns {Promise<Array>} Array of account types for the currency
 * @throws {AppError} DB_ERROR if query fails
 */
export const getAccountTypesByCurrency = async (currencyCode) => {
  try {
    if (!currencyCode) {
      return getAllAccountTypes();
    }

    const { data, error } = await supabase
      .from('account_types')
      .select('*')
      .order('name', { ascending: true });

    if (error) {
      throw parseSupabaseError(error);
    }

    // Filter by currency in metadata
    const filtered = (data || []).filter(type => {
      const currency = type.metadata?.currency;
      return currency === currencyCode;
    });

    return filtered;
  } catch (error) {
    if (error.code) throw error;
    const appError = handleError(error, ERROR_CODES.DB_ERROR, {
      operation: 'getAccountTypesByCurrency',
      currencyCode
    });
    logError(appError, { operation: 'getAccountTypesByCurrency', currencyCode });
    throw appError;
  }
};

/**
 * Get currency UUID by code
 * @param {string} currencyCode - Currency code (USD, CUP, MLC, etc.)
 * @returns {Promise<Object>} Currency object with id, code, name_es, name_en
 * @throws {AppError} NOT_FOUND if currency not found, DB_ERROR on failure
 */
export const getCurrencyByCode = async (currencyCode) => {
  try {
    if (!currencyCode) {
      throw createValidationError({ currencyCode: 'Currency code is required' }, 'Missing currency code');
    }

    const { data, error } = await supabase
      .from('currencies')
      .select('id, code, name_es, name_en')
      .eq('code', currencyCode)
      .eq('is_active', true)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        throw createNotFoundError('Currency', currencyCode);
      }
      throw parseSupabaseError(error);
    }

    return data;
  } catch (error) {
    if (error.code) throw error;
    const appError = handleError(error, ERROR_CODES.DB_ERROR, {
      operation: 'getCurrencyByCode',
      currencyCode
    });
    logError(appError, { operation: 'getCurrencyByCode', currencyCode });
    throw appError;
  }
};

/**
 * Get default account type for a currency
 * Dynamically searches account_types where metadata.currency === currencyCode
 *
 * @param {string} currencyCode - Currency code (USD, CUP, MLC, etc.)
 * @returns {Promise<Object>} First matching account type object
 * @throws {AppError} NOT_FOUND if no account type found for currency, DB_ERROR on failure
 */
export const getDefaultAccountTypeForCurrency = async (currencyCode) => {

  try {
    if (!currencyCode) {
      console.error('[getDefaultAccountTypeForCurrency] ERROR: Missing currency code');
      throw createValidationError({ currencyCode: 'Currency code is required' }, 'Missing currency code');
    }

    // Load all account types
    const { data, error } = await supabase
      .from('account_types')
      .select('id, name, description, metadata')
      .order('name', { ascending: true });

    if (error) {
      console.error('[getDefaultAccountTypeForCurrency] Database error:', error);
      throw parseSupabaseError(error);
    }

    // Dynamically find matching account type by currency in metadata
    const matchingTypes = (data || []).filter(type => {
      const matches = type.metadata?.currency === currencyCode;
      return matches;
    });

    if (matchingTypes.length === 0) {
      console.error('[getDefaultAccountTypeForCurrency] ERROR: No account type found for currency:', currencyCode);
      throw new Error(
        `No account type found for currency: ${currencyCode}. ` +
        `Please configure one in account_types table with metadata.currency = '${currencyCode}'`
      );
    }

    // Return first matching type (can be enhanced with is_default flag if needed)
    const selectedType = matchingTypes[0];

    return selectedType;
  } catch (error) {
    console.error('[getDefaultAccountTypeForCurrency] FATAL ERROR:', error);
    console.error('[getDefaultAccountTypeForCurrency] Error details:', {
      message: error?.message,
      code: error?.code,
      stack: error?.stack
    });

    if (error.code) throw error;
    const appError = handleError(error, ERROR_CODES.NOT_FOUND, {
      operation: 'getDefaultAccountTypeForCurrency',
      currencyCode
    });
    logError(appError, { operation: 'getDefaultAccountTypeForCurrency', currencyCode });
    throw appError;
  }
};

// ============================================================================
// ADMIN-ONLY FUNCTIONS - Full account number access
// NOTE: These functions require running migration 20250128000002 first
// ============================================================================

/**
 * Get full bank account details for a recipient (ADMIN ONLY)
 * Includes complete account number - only accessible to admin/super_admin roles
 *
 * IMPORTANT: Requires running migration 20250128000002_add_account_full_number_and_logos.sql
 * before using this function.
 *
 * @param {string} recipientBankAccountId - ID from recipient_bank_accounts table
 * @returns {Promise<Object>} Bank account object with full account number
 * @throws {AppError} NOT_FOUND if account not found, SERVICE_UNAVAILABLE if migration not executed
 */
export const getRecipientBankAccountFull = async (recipientBankAccountId) => {
  try {
    if (!recipientBankAccountId) {
      throw createValidationError(
        { recipientBankAccountId: 'Bank account ID is required' },
        'Missing bank account ID'
      );
    }

    const { data, error } = await supabase
      .rpc('get_recipient_bank_account_full', {
        p_recipient_bank_account_id: recipientBankAccountId
      });

    if (error) {
      // Check if function doesn't exist (migration not executed)
      if (error.message.includes('function') && error.message.includes('does not exist')) {
        throw new Error(
          'Migration 20250128000002 not executed. Please run the migration first.'
        );
      }
      throw parseSupabaseError(error);
    }

    // RPC returns array, get first element
    if (data && data.length > 0) {
      return data[0];
    }

    throw createNotFoundError('Bank account', recipientBankAccountId);
  } catch (error) {
    if (error.code) throw error;
    const appError = handleError(error, ERROR_CODES.SERVICE_UNAVAILABLE, {
      operation: 'getRecipientBankAccountFull',
      recipientBankAccountId
    });
    logError(appError, { operation: 'getRecipientBankAccountFull', recipientBankAccountId });
    throw appError;
  }
};

/**
 * Get all bank accounts for a remittance with full details (ADMIN ONLY)
 * Includes complete account numbers - only accessible to admin/super_admin roles
 *
 * IMPORTANT: Requires running migration 20250128000002_add_account_full_number_and_logos.sql
 * before using this function.
 *
 * @param {string} remittanceId - Remittance UUID
 * @returns {Promise<Array>} Array of bank account objects with full details
 * @throws {AppError} SERVICE_UNAVAILABLE if migration not executed, DB_ERROR on failure
 */
export const getRemittanceBankAccountsAdmin = async (remittanceId) => {
  try {
    if (!remittanceId) {
      throw createValidationError({ remittanceId: 'Remittance ID is required' }, 'Missing remittance ID');
    }

    const { data, error } = await supabase
      .rpc('get_remittance_bank_accounts_admin', {
        p_remittance_id: remittanceId
      });

    if (error) {
      // Check if function doesn't exist (migration not executed)
      if (error.message.includes('function') && error.message.includes('does not exist')) {
        throw new Error(
          'Migration 20250128000002 not executed. Please run the migration first.'
        );
      }
      throw parseSupabaseError(error);
    }

    return data || [];
  } catch (error) {
    if (error.code) throw error;
    const appError = handleError(error, ERROR_CODES.SERVICE_UNAVAILABLE, {
      operation: 'getRemittanceBankAccountsAdmin',
      remittanceId
    });
    logError(appError, { operation: 'getRemittanceBankAccountsAdmin', remittanceId });
    throw appError;
  }
};

// ============================================================================
// END BANK SERVICE
// ============================================================================
