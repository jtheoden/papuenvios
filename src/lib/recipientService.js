/**
 * Recipient Service
 * Gestión de destinatarios y sus direcciones
 */

import { supabase } from '@/lib/supabase';

// ============================================================================
// DESTINATARIOS
// ============================================================================

/**
 * Obtener todos los destinatarios del usuario
 */
export const getMyRecipients = async () => {
  try {
    const { data, error } = await supabase
      .from('recipients')
      .select(`
        *,
        addresses:recipient_addresses(*)
      `)
      .order('is_favorite', { ascending: false })
      .order('created_at', { ascending: false });

    if (error) throw error;
    return { success: true, recipients: data || [] };
  } catch (error) {
    console.error('Error fetching recipients:', error);
    return { success: false, recipients: [], error: error.message };
  }
};

/**
 * Obtener un destinatario por ID
 */
export const getRecipientById = async (recipientId) => {
  try {
    const { data, error } = await supabase
      .from('recipients')
      .select(`
        *,
        addresses:recipient_addresses(*)
      `)
      .eq('id', recipientId)
      .single();

    if (error) throw error;
    return { success: true, recipient: data };
  } catch (error) {
    console.error('Error fetching recipient:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Crear nuevo destinatario
 */
export const createRecipient = async (recipientData) => {
  try {
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError) throw userError;
    if (!user) throw new Error('Usuario no autenticado');

    const { data, error } = await supabase
      .from('recipients')
      .insert([{
        user_id: user.id,
        ...recipientData
      }])
      .select()
      .single();

    if (error) throw error;
    return { success: true, recipient: data };
  } catch (error) {
    console.error('Error creating recipient:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Actualizar destinatario
 */
export const updateRecipient = async (recipientId, updates) => {
  try {
    const { data, error } = await supabase
      .from('recipients')
      .update(updates)
      .eq('id', recipientId)
      .select()
      .single();

    if (error) throw error;
    return { success: true, recipient: data };
  } catch (error) {
    console.error('Error updating recipient:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Eliminar destinatario
 */
export const deleteRecipient = async (recipientId) => {
  try {
    const { error } = await supabase
      .from('recipients')
      .delete()
      .eq('id', recipientId);

    if (error) throw error;
    return { success: true };
  } catch (error) {
    console.error('Error deleting recipient:', error);
    return { success: false, error: error.message };
  }
};

// ============================================================================
// DIRECCIONES DE DESTINATARIOS
// ============================================================================

/**
 * Agregar dirección a destinatario
 */
export const addRecipientAddress = async (addressData) => {
  try {
    // Si es dirección por defecto, desmarcar las demás
    if (addressData.is_default) {
      await supabase
        .from('recipient_addresses')
        .update({ is_default: false })
        .eq('recipient_id', addressData.recipient_id);
    }

    const { data, error } = await supabase
      .from('recipient_addresses')
      .insert([addressData])
      .select()
      .single();

    if (error) throw error;
    return { success: true, address: data };
  } catch (error) {
    console.error('Error adding address:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Actualizar dirección
 */
export const updateRecipientAddress = async (addressId, updates) => {
  try {
    // Si se marca como default, desmarcar las demás
    if (updates.is_default) {
      const { data: address } = await supabase
        .from('recipient_addresses')
        .select('recipient_id')
        .eq('id', addressId)
        .single();

      if (address) {
        await supabase
          .from('recipient_addresses')
          .update({ is_default: false })
          .eq('recipient_id', address.recipient_id);
      }
    }

    const { data, error } = await supabase
      .from('recipient_addresses')
      .update(updates)
      .eq('id', addressId)
      .select()
      .single();

    if (error) throw error;
    return { success: true, address: data };
  } catch (error) {
    console.error('Error updating address:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Eliminar dirección
 */
export const deleteRecipientAddress = async (addressId) => {
  try {
    const { error } = await supabase
      .from('recipient_addresses')
      .delete()
      .eq('id', addressId);

    if (error) throw error;
    return { success: true };
  } catch (error) {
    console.error('Error deleting address:', error);
    return { success: false, error: error.message };
  }
};

// ============================================================================
// LOCALIDADES DE CUBA
// ============================================================================

/**
 * Obtener todas las provincias
 */
export const getCubanProvinces = async () => {
  try {
    const { data, error } = await supabase
      .from('cuban_municipalities')
      .select('province')
      .eq('delivery_available', true);

    if (error) throw error;

    // Eliminar duplicados
    const provinces = [...new Set(data.map(item => item.province))].sort();
    return { success: true, provinces };
  } catch (error) {
    console.error('Error fetching provinces:', error);
    return { success: false, provinces: [], error: error.message };
  }
};

/**
 * Obtener municipios por provincia
 */
export const getMunicipalitiesByProvince = async (province) => {
  try {
    const { data, error } = await supabase
      .from('cuban_municipalities')
      .select('*')
      .eq('province', province)
      .eq('delivery_available', true)
      .order('municipality');

    if (error) throw error;
    return { success: true, municipalities: data || [] };
  } catch (error) {
    console.error('Error fetching municipalities:', error);
    return { success: false, municipalities: [], error: error.message };
  }
};

// ============================================================================
// BANK ACCOUNT MANAGEMENT - Functions for bank account operations
// ============================================================================

/**
 * Create a bank account for a user
 * @param {string} userId - User ID
 * @param {Object} bankData - { bankId, accountTypeId, currencyId, accountNumber, accountHolderName }
 * @returns {Object} { success, data, error }
 */
export const createBankAccount = async (userId, bankData) => {
  try {
    const { bankId, accountTypeId, currencyId, accountNumber, accountHolderName } = bankData;

    // Validate basic inputs
    if (!userId || !bankId || !currencyId || !accountNumber || !accountHolderName) {
      return { success: false, error: 'Missing required fields' };
    }

    // ============================================================================
    // CONVERSIÓN AUTOMÁTICA: currencyId (code → UUID) y accountTypeId (auto-detect)
    // ============================================================================

    let finalCurrencyId = currencyId;
    let finalAccountTypeId = accountTypeId;

    // Si currencyId es un código (string como 'USD'), convertir a UUID
    if (typeof currencyId === 'string' && currencyId.length <= 4) {
      console.log(`🔄 Converting currency code '${currencyId}' to UUID...`);
      const { getCurrencyByCode } = await import('@/lib/bankService');
      const currencyResult = await getCurrencyByCode(currencyId);

      if (!currencyResult.success) {
        return { success: false, error: `Currency '${currencyId}' not found: ${currencyResult.error}` };
      }

      finalCurrencyId = currencyResult.data.id;
      console.log(`✅ Currency UUID: ${finalCurrencyId}`);
    }

    // Si accountTypeId es null/undefined, obtener automáticamente según currency
    if (!accountTypeId) {
      console.log(`🔄 Auto-detecting account type for currency: ${currencyId}...`);
      const { getDefaultAccountTypeForCurrency } = await import('@/lib/bankService');
      const accountTypeResult = await getDefaultAccountTypeForCurrency(currencyId);

      if (!accountTypeResult.success) {
        return { success: false, error: `No account type found for currency '${currencyId}': ${accountTypeResult.error}` };
      }

      finalAccountTypeId = accountTypeResult.data.id;
      console.log(`✅ Auto-selected account type: ${accountTypeResult.data.name} (${finalAccountTypeId})`);
    }

    // Validar que ahora tengamos UUIDs
    if (!finalAccountTypeId) {
      return { success: false, error: 'Account type could not be determined' };
    }

    // Hash account number for security (last 4 for display) using Web Crypto API
    const encoder = new TextEncoder();
    const dataToHash = encoder.encode(accountNumber + userId);
    const hashBuffer = await crypto.subtle.digest('SHA-256', dataToHash);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const accountNumberHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    const accountNumberLast4 = accountNumber.slice(-4);

    // Insert bank account (hash + last 4 digits only for security)
    // NOTE: account_number_full requires migration 20250128000002 to be executed first
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
          account_holder_name: accountHolderName,
          is_active: true
        }
      ])
      .select()
      .single();

    if (error) return { success: false, error: error.message };
    return { success: true, data };
  } catch (error) {
    console.error('Error creating bank account:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Get bank accounts for a user
 * @param {string} userId - User ID
 * @param {boolean} activeOnly - Filter only active accounts
 * @returns {Object} { success, data, error }
 */
export const getBankAccountsByUser = async (userId, activeOnly = true) => {
  try {
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

    if (error) return { success: false, error: error.message };
    return { success: true, data };
  } catch (error) {
    console.error('Error fetching bank accounts:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Update bank account
 * @param {string} accountId - Bank account ID
 * @param {Object} updates - { isActive, accountHolderName }
 * @returns {Object} { success, data, error }
 */
export const updateBankAccount = async (accountId, updates) => {
  try {
    const { data, error } = await supabase
      .from('bank_accounts')
      .update({
        ...updates,
        updated_at: new Date().toISOString()
      })
      .eq('id', accountId)
      .select()
      .single();

    if (error) return { success: false, error: error.message };
    return { success: true, data };
  } catch (error) {
    console.error('Error updating bank account:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Soft delete a bank account
 * @param {string} accountId - Bank account ID
 * @param {string} deletedByUserId - User deleting the account
 * @returns {Object} { success, data, error }
 */
export const deleteBankAccount = async (accountId, deletedByUserId) => {
  try {
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

    if (error) return { success: false, error: error.message };
    return { success: true, data };
  } catch (error) {
    console.error('Error deleting bank account:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Link a bank account to a recipient
 * @param {string} recipientId - Recipient ID
 * @param {string} bankAccountId - Bank account ID
 * @param {boolean} isDefault - Set as default account
 * @returns {Object} { success, data, error }
 */
export const linkBankAccountToRecipient = async (recipientId, bankAccountId, isDefault = false) => {
  try {
    // If setting as default, unset other defaults
    if (isDefault) {
      await supabase
        .from('recipient_bank_accounts')
        .update({ is_default: false })
        .eq('recipient_id', recipientId);
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

    if (error) return { success: false, error: error.message };
    return { success: true, data };
  } catch (error) {
    console.error('Error linking bank account to recipient:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Get bank accounts for a recipient
 * @param {string} recipientId - Recipient ID
 * @returns {Object} { success, data, error }
 */
export const getBankAccountsForRecipient = async (recipientId) => {
  try {
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

    if (error) return { success: false, error: error.message };
    return { success: true, data };
  } catch (error) {
    console.error('Error fetching recipient bank accounts:', error);
    return { success: false, error: error.message };
  }
};

// ============================================================================
// END BANK ACCOUNT MANAGEMENT
// ============================================================================
