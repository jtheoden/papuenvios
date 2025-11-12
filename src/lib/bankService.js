// ============================================================================
// BANK SERVICE - Master data management for banks and account types
// ============================================================================

import { supabase } from '@/lib/supabase';

/**
 * Get all banks
 * @returns {Object} { success, data, error }
 */
export const getAllBanks = async () => {
  try {
    const { data, error } = await supabase
      .from('banks')
      .select('*')
      .order('name', { ascending: true });

    if (error) return { success: false, error: error.message };
    return { success: true, data };
  } catch (error) {
    console.error('Error fetching banks:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Get all account types
 * @returns {Object} { success, data, error }
 */
export const getAllAccountTypes = async () => {
  try {
    const { data, error } = await supabase
      .from('account_types')
      .select('*')
      .order('name', { ascending: true });

    if (error) return { success: false, error: error.message };
    return { success: true, data };
  } catch (error) {
    console.error('Error fetching account types:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Create a new bank (admin only)
 * @param {Object} bankData - { name, swiftCode, localCode, countryCode }
 * @returns {Object} { success, data, error }
 */
export const createBank = async (bankData) => {
  try {
    const { name, swiftCode, localCode, countryCode } = bankData;

    if (!name) {
      return { success: false, error: 'Bank name is required' };
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

    if (error) return { success: false, error: error.message };
    return { success: true, data };
  } catch (error) {
    console.error('Error creating bank:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Get bank by ID with full details
 * @param {string} bankId - Bank ID
 * @returns {Object} { success, data, error }
 */
export const getBankById = async (bankId) => {
  try {
    const { data, error } = await supabase
      .from('banks')
      .select('*')
      .eq('id', bankId)
      .single();

    if (error) return { success: false, error: error.message };
    return { success: true, data };
  } catch (error) {
    console.error('Error fetching bank:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Search banks by name or code
 * @param {string} query - Search query
 * @returns {Object} { success, data, error }
 */
export const searchBanks = async (query) => {
  try {
    if (!query || query.length < 2) {
      return { success: true, data: [] };
    }

    const { data, error } = await supabase
      .from('banks')
      .select('*')
      .or(`name.ilike.%${query}%,swift_code.ilike.%${query}%,local_code.ilike.%${query}%`)
      .limit(10);

    if (error) return { success: false, error: error.message };
    return { success: true, data };
  } catch (error) {
    console.error('Error searching banks:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Get all active currencies
 * @returns {Object} { success, data, error }
 */
export const getAllCurrencies = async () => {
  try {
    const { data, error } = await supabase
      .from('currencies')
      .select('*')
      .eq('is_active', true)
      .order('code', { ascending: true });

    if (error) return { success: false, error: error.message };
    return { success: true, data };
  } catch (error) {
    console.error('Error fetching currencies:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Get account types filtered by currency
 * @param {string} currencyCode - Currency code (USD, CUP, MLC, etc.)
 * @returns {Object} { success, data, error }
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

    if (error) return { success: false, error: error.message };

    // Filter by currency in metadata
    const filtered = data.filter(type => {
      const currency = type.metadata?.currency;
      return currency === currencyCode;
    });

    return { success: true, data: filtered };
  } catch (error) {
    console.error('Error fetching account types by currency:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Get currency UUID by code
 * @param {string} currencyCode - Currency code (USD, CUP, MLC, etc.)
 * @returns {Object} { success, data: {id, code}, error }
 */
export const getCurrencyByCode = async (currencyCode) => {
  try {
    const { data, error } = await supabase
      .from('currencies')
      .select('id, code, name_es, name_en')
      .eq('code', currencyCode)
      .eq('is_active', true)
      .single();

    if (error) return { success: false, error: error.message };
    return { success: true, data };
  } catch (error) {
    console.error('Error fetching currency by code:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Get default account type for a currency (100% dinámico, busca en metadata)
 * Busca account_types donde metadata.currency === currencyCode
 * @param {string} currencyCode - Currency code (USD, CUP, MLC, etc.)
 * @returns {Object} { success, data: {id, name}, error }
 */
export const getDefaultAccountTypeForCurrency = async (currencyCode) => {
  try {
    // Cargar TODOS los account_types
    const { data, error } = await supabase
      .from('account_types')
      .select('id, name, description, metadata')
      .order('name', { ascending: true });

    if (error) {
      console.error('Error loading account types:', error);
      return { success: false, error: error.message };
    }

    // Buscar dinámicamente el que tenga metadata.currency === currencyCode
    const matchingTypes = data.filter(type =>
      type.metadata?.currency === currencyCode
    );

    if (matchingTypes.length === 0) {
      return {
        success: false,
        error: `No account type found for currency: ${currencyCode}. Please configure one in account_types table with metadata.currency = '${currencyCode}'`
      };
    }

    // Si hay varios, tomar el primero (puede mejorarse con is_default en metadata si se necesita)
    const selectedType = matchingTypes[0];

    console.log(`✅ Auto-selected account type '${selectedType.name}' for currency ${currencyCode}`);

    return { success: true, data: selectedType };
  } catch (error) {
    console.error('Error fetching default account type:', error);
    return { success: false, error: error.message };
  }
};

// ============================================================================
// ADMIN-ONLY FUNCTIONS - Full account number access
// NOTA: Estas funciones requieren ejecutar la migración 20250128000002 primero
// ============================================================================

/**
 * Get full bank account details for a recipient (ADMIN ONLY)
 * Includes complete account number - only accessible to admin/super_admin roles
 *
 * IMPORTANTE: Requiere ejecutar migración 20250128000002_add_account_full_number_and_logos.sql
 * antes de usar esta función.
 *
 * @param {string} recipientBankAccountId - ID from recipient_bank_accounts table
 * @returns {Object} { success, data, error }
 */
export const getRecipientBankAccountFull = async (recipientBankAccountId) => {
  try {
    const { data, error } = await supabase
      .rpc('get_recipient_bank_account_full', {
        p_recipient_bank_account_id: recipientBankAccountId
      });

    if (error) {
      console.error('Error fetching full bank account:', error);
      // Si la función no existe, dar mensaje claro
      if (error.message.includes('function') && error.message.includes('does not exist')) {
        return {
          success: false,
          error: 'Migration 20250128000002 not executed. Please run the migration first.'
        };
      }
      return { success: false, error: error.message };
    }

    // RPC returns array, get first element
    if (data && data.length > 0) {
      return { success: true, data: data[0] };
    }

    return { success: false, error: 'Bank account not found' };
  } catch (error) {
    console.error('Error in getRecipientBankAccountFull:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Get all bank accounts for a remittance with full details (ADMIN ONLY)
 * Includes complete account numbers - only accessible to admin/super_admin roles
 *
 * IMPORTANTE: Requiere ejecutar migración 20250128000002_add_account_full_number_and_logos.sql
 * antes de usar esta función.
 *
 * @param {string} remittanceId - Remittance ID
 * @returns {Object} { success, data, error }
 */
export const getRemittanceBankAccountsAdmin = async (remittanceId) => {
  try {
    const { data, error } = await supabase
      .rpc('get_remittance_bank_accounts_admin', {
        p_remittance_id: remittanceId
      });

    if (error) {
      console.error('Error fetching remittance bank accounts:', error);
      // Si la función no existe, dar mensaje claro
      if (error.message.includes('function') && error.message.includes('does not exist')) {
        return {
          success: false,
          error: 'Migration 20250128000002 not executed. Please run the migration first.'
        };
      }
      return { success: false, error: error.message };
    }

    return { success: true, data: data || [] };
  } catch (error) {
    console.error('Error in getRemittanceBankAccountsAdmin:', error);
    return { success: false, error: error.message };
  }
};

// ============================================================================
// END BANK SERVICE
// ============================================================================
