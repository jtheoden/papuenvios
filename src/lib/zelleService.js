/**
 * Zelle Service
 * Gestión de cuentas Zelle con rotación automática
 */

import { supabase } from '@/lib/supabase';

// ============================================================================
// GESTIÓN DE CUENTAS ZELLE
// ============================================================================

/**
 * Obtener cuenta Zelle disponible con rotación automática
 * @param {string} transactionType - 'remittance', 'product', 'combo'
 * @param {number} amount - Monto de la transacción
 */
export const getAvailableZelleAccount = async (transactionType, amount) => {
  try {
    // Llamar a la función de base de datos que maneja la lógica de rotación
    const { data, error } = await supabase
      .rpc('select_available_zelle_account', {
        p_transaction_type: transactionType,
        p_amount: amount
      });

    if (error) throw error;
    if (!data) throw new Error('No hay cuentas Zelle disponibles en este momento');

    // Obtener los detalles completos de la cuenta
    const { data: account, error: accountError } = await supabase
      .from('zelle_accounts')
      .select('*')
      .eq('id', data)
      .single();

    if (accountError) throw accountError;

    return { success: true, account };
  } catch (error) {
    console.error('Error getting available Zelle account:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Registrar transacción en el historial
 */
export const registerZelleTransaction = async (transactionData) => {
  try {
    const { data, error } = await supabase
      .from('zelle_transaction_history')
      .insert([{
        zelle_account_id: transactionData.zelle_account_id,
        transaction_type: transactionData.transaction_type,
        reference_id: transactionData.reference_id,
        amount: transactionData.amount,
        status: 'pending',
        notes: transactionData.notes
      }])
      .select()
      .single();

    if (error) throw error;

    // Actualizar contadores de la cuenta
    await supabase.rpc('update_zelle_account_usage', {
      p_account_id: transactionData.zelle_account_id,
      p_amount: transactionData.amount
    });

    return { success: true, transaction: data };
  } catch (error) {
    console.error('Error registering Zelle transaction:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Validar transacción de Zelle (Admin)
 */
export const validateZelleTransaction = async (transactionId) => {
  try {
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError) throw userError;

    const { data, error } = await supabase
      .from('zelle_transaction_history')
      .update({
        status: 'validated',
        validated_by: user.id,
        validated_at: new Date().toISOString()
      })
      .eq('id', transactionId)
      .select()
      .single();

    if (error) throw error;
    return { success: true, transaction: data };
  } catch (error) {
    console.error('Error validating transaction:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Rechazar transacción de Zelle (Admin)
 */
export const rejectZelleTransaction = async (transactionId, reason) => {
  try {
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError) throw userError;

    // Obtener la transacción para revertir los contadores
    const { data: transaction, error: fetchError } = await supabase
      .from('zelle_transaction_history')
      .select('*')
      .eq('id', transactionId)
      .single();

    if (fetchError) throw fetchError;

    // Actualizar estado
    const { data, error } = await supabase
      .from('zelle_transaction_history')
      .update({
        status: 'rejected',
        validated_by: user.id,
        validated_at: new Date().toISOString(),
        notes: reason
      })
      .eq('id', transactionId)
      .select()
      .single();

    if (error) throw error;

    // Revertir contadores
    await supabase.rpc('update_zelle_account_usage', {
      p_account_id: transaction.zelle_account_id,
      p_amount: -transaction.amount
    });

    return { success: true, transaction: data };
  } catch (error) {
    console.error('Error rejecting transaction:', error);
    return { success: false, error: error.message };
  }
};

// ============================================================================
// GESTIÓN DE CUENTAS (ADMIN)
// ============================================================================

/**
 * Obtener todas las cuentas Zelle (Admin)
 */
export const getAllZelleAccounts = async () => {
  try {
    const { data, error } = await supabase
      .from('zelle_accounts')
      .select('*')
      .order('priority_order', { ascending: true })
      .order('account_name');

    if (error) throw error;
    return { success: true, accounts: data || [] };
  } catch (error) {
    console.error('Error fetching Zelle accounts:', error);
    return { success: false, accounts: [], error: error.message };
  }
};

/**
 * Crear cuenta Zelle (Admin)
 */
export const createZelleAccount = async (accountData) => {
  try {
    const { data, error } = await supabase
      .from('zelle_accounts')
      .insert([accountData])
      .select()
      .single();

    if (error) throw error;
    return { success: true, account: data };
  } catch (error) {
    console.error('Error creating Zelle account:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Actualizar cuenta Zelle (Admin)
 */
export const updateZelleAccount = async (accountId, updates) => {
  try {
    const { data, error } = await supabase
      .from('zelle_accounts')
      .update(updates)
      .eq('id', accountId)
      .select()
      .single();

    if (error) throw error;
    return { success: true, account: data };
  } catch (error) {
    console.error('Error updating Zelle account:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Eliminar cuenta Zelle (Admin)
 */
export const deleteZelleAccount = async (accountId) => {
  try {
    const { error } = await supabase
      .from('zelle_accounts')
      .delete()
      .eq('id', accountId);

    if (error) throw error;
    return { success: true };
  } catch (error) {
    console.error('Error deleting Zelle account:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Obtener historial de transacciones de una cuenta
 */
export const getZelleAccountTransactions = async (accountId, filters = {}) => {
  try {
    let query = supabase
      .from('zelle_transaction_history')
      .select('*')
      .eq('zelle_account_id', accountId);

    if (filters.startDate) {
      query = query.gte('transaction_date', filters.startDate);
    }

    if (filters.endDate) {
      query = query.lte('transaction_date', filters.endDate);
    }

    if (filters.status) {
      query = query.eq('status', filters.status);
    }

    query = query.order('transaction_date', { ascending: false });

    const { data, error } = await query;

    if (error) throw error;
    return { success: true, transactions: data || [] };
  } catch (error) {
    console.error('Error fetching account transactions:', error);
    return { success: false, transactions: [], error: error.message };
  }
};

/**
 * Obtener estadísticas de una cuenta Zelle
 */
export const getZelleAccountStats = async (accountId) => {
  try {
    const { data, error } = await supabase
      .from('zelle_transaction_history')
      .select('amount, status, transaction_type')
      .eq('zelle_account_id', accountId);

    if (error) throw error;

    const stats = {
      total_transactions: data.length,
      total_amount: data.reduce((sum, t) => sum + parseFloat(t.amount), 0),
      validated_amount: data
        .filter(t => t.status === 'validated')
        .reduce((sum, t) => sum + parseFloat(t.amount), 0),
      pending_amount: data
        .filter(t => t.status === 'pending')
        .reduce((sum, t) => sum + parseFloat(t.amount), 0),
      by_type: {
        remittance: data.filter(t => t.transaction_type === 'remittance').length,
        product: data.filter(t => t.transaction_type === 'product').length,
        combo: data.filter(t => t.transaction_type === 'combo').length
      }
    };

    return { success: true, stats };
  } catch (error) {
    console.error('Error fetching account stats:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Reset manual de contadores (Admin)
 */
export const resetZelleCounters = async (accountId, type = 'daily') => {
  try {
    const updates = type === 'daily'
      ? { current_daily_amount: 0, last_reset_date: new Date().toISOString() }
      : { current_monthly_amount: 0 };

    const { data, error } = await supabase
      .from('zelle_accounts')
      .update(updates)
      .eq('id', accountId)
      .select()
      .single();

    if (error) throw error;
    return { success: true, account: data };
  } catch (error) {
    console.error('Error resetting counters:', error);
    return { success: false, error: error.message };
  }
};
