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

// ============================================================================
// END BANK SERVICE
// ============================================================================
