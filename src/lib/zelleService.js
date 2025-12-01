/**
 * Zelle Service
 * Gestión de cuentas Zelle con rotación automática
 * Refactored with proper error handling, validation, and authorization
 */

import { supabase } from '@/lib/supabase';
import {
  AppError,
  ERROR_CODES,
  logError,
  createValidationError,
  createNotFoundError,
  createPermissionError,
  parseSupabaseError
} from '@/lib/errorHandler';
import { USER_ROLES } from '@/lib/constants';

// ============================================================================
// ZELLE STATUS CONSTANTS
// ============================================================================

export const ZELLE_STATUS = {
  PENDING: 'pending',      // Transaction registered, awaiting validation
  VALIDATED: 'validated',  // Transaction confirmed by admin
  REJECTED: 'rejected'     // Transaction rejected by admin
};

export const ZELLE_TRANSACTION_TYPES = {
  REMITTANCE: 'remittance',
  PRODUCT: 'product',
  COMBO: 'combo'
};

// ============================================================================
// AUTHORIZATION HELPERS
// ============================================================================

/**
 * Verify user is authenticated and has admin role
 * @param {object} user - User object from auth
 * @throws {AppError} If not authenticated or lacks admin role
 */
const verifyAdminRole = (user) => {
  if (!user) {
    throw createPermissionError('access this resource', 'admin');
  }

  if (user.user_metadata?.role !== USER_ROLES.ADMIN && user.user_metadata?.role !== USER_ROLES.SUPER_ADMIN) {
    throw createPermissionError('access this resource', 'admin');
  }
};

// ============================================================================
// INPUT VALIDATION HELPERS
// ============================================================================

/**
 * Validate Zelle account creation data
 * @param {object} data - Account data
 * @throws {AppError} If validation fails
 */
const validateAccountData = (data) => {
  const errors = {};

  if (!data.account_name || typeof data.account_name !== 'string' || data.account_name.trim().length === 0) {
    errors.account_name = 'Account name is required and must be a non-empty string';
  }

  if (!data.phone || typeof data.phone !== 'string' || data.phone.trim().length === 0) {
    errors.phone = 'Phone number is required and must be a non-empty string';
  }

  if (!data.account_holder || typeof data.account_holder !== 'string' || data.account_holder.trim().length === 0) {
    errors.account_holder = 'Holder name is required and must be a non-empty string';
  }

  if (!data.email || typeof data.email !== 'string' || data.email.trim().length === 0) {
    errors.email = 'Email is required and must be a non-empty string';
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) {
    errors.email = 'Email must be a valid email address';
  }

  if (data.daily_limit !== undefined && (typeof data.daily_limit !== 'number' || data.daily_limit < 0)) {
    errors.daily_limit = 'Daily limit must be a non-negative number';
  }

  if (data.monthly_limit !== undefined && (typeof data.monthly_limit !== 'number' || data.monthly_limit < 0)) {
    errors.monthly_limit = 'Monthly limit must be a non-negative number';
  }

  if (data.priority_order !== undefined && (typeof data.priority_order !== 'number' || data.priority_order < 0)) {
    errors.priority_order = 'Priority order must be a non-negative number';
  }

  if (data.is_active !== undefined && typeof data.is_active !== 'boolean') {
    errors.is_active = 'Active status must be a boolean';
  }

  if (Object.keys(errors).length > 0) {
    throw createValidationError(errors, 'Invalid Zelle account data');
  }
};

/**
 * Validate transaction registration data
 * @param {object} data - Transaction data
 * @throws {AppError} If validation fails
 */
const validateTransactionData = (data) => {
  const errors = {};

  if (!data.zelle_account_id || typeof data.zelle_account_id !== 'string') {
    errors.zelle_account_id = 'Zelle account ID is required and must be a string';
  }

  if (!data.transaction_type || !Object.values(ZELLE_TRANSACTION_TYPES).includes(data.transaction_type)) {
    errors.transaction_type = `Transaction type must be one of: ${Object.values(ZELLE_TRANSACTION_TYPES).join(', ')}`;
  }

  if (!data.reference_id || typeof data.reference_id !== 'string') {
    errors.reference_id = 'Reference ID is required and must be a string';
  }

  if (typeof data.amount !== 'number' || data.amount <= 0) {
    errors.amount = 'Amount must be a positive number';
  }

  if (Object.keys(errors).length > 0) {
    throw createValidationError(errors, 'Invalid transaction data');
  }
};

// ============================================================================
// ACCOUNT MANAGEMENT
// ============================================================================

/**
 * Obtener cuenta Zelle disponible con rotación automática
 * Calls the database RPC function that handles rotation logic and load balancing
 *
 * @param {string} transactionType - Type of transaction: 'remittance', 'product', or 'combo'
 * @param {number} amount - Amount of the transaction in USD
 * @returns {Promise<object>} Available Zelle account with full details
 * @throws {AppError} If no available accounts or database error
 *
 * @example
 * const account = await getAvailableZelleAccount('remittance', 250);
 * // Returns: { id: 'acc-123', phone_number: '+1234567890', holder_name: 'Juan Perez', ... }
 */
export const getAvailableZelleAccount = async (transactionType, amount) => {
  try {
    // Validate input
    if (!transactionType || !Object.values(ZELLE_TRANSACTION_TYPES).includes(transactionType)) {
      throw createValidationError(
        { transactionType: `Must be one of: ${Object.values(ZELLE_TRANSACTION_TYPES).join(', ')}` },
        'Invalid transaction type'
      );
    }

    if (typeof amount !== 'number' || amount <= 0) {
      throw createValidationError({ amount: 'Must be a positive number' }, 'Invalid amount');
    }

    // Call RPC function to select account with rotation logic
    const { data, error } = await supabase.rpc('select_available_zelle_account', {
      p_transaction_type: transactionType,
      p_amount: amount
    });

    if (error) {
      throw parseSupabaseError(error);
    }

    if (!data) {
      throw new AppError(
        'No Zelle accounts available at this moment',
        ERROR_CODES.INSUFFICIENT_STOCK,
        503,
        { transactionType, amount }
      );
    }

    // Fetch complete account details
    const { data: account, error: accountError } = await supabase
      .from('zelle_accounts')
      .select('*')
      .eq('id', data)
      .single();

    if (accountError) {
      throw parseSupabaseError(accountError);
    }

    if (!account) {
      throw createNotFoundError('Zelle account', data);
    }

    return account;
  } catch (error) {
    if (error instanceof AppError) {
      logError(error, { operation: 'getAvailableZelleAccount', transactionType, amount });
      throw error;
    }

    const appError = parseSupabaseError(error);
    logError(appError, { operation: 'getAvailableZelleAccount', transactionType, amount });
    throw appError;
  }
};

// ============================================================================
// TRANSACTION MANAGEMENT
// ============================================================================

/**
 * Registrar transacción en el historial
 * Inserts a new transaction record and atomically updates account usage counters
 *
 * TRANSACTION BOUNDARY:
 * This operation should be atomic with RPC update_zelle_account_usage.
 * Current implementation: Insert transaction, then update counters via RPC.
 * Future improvement: Use database transaction or mark for batching if needed.
 *
 * @param {object} transactionData - Transaction information
 * @param {string} transactionData.zelle_account_id - ID of the Zelle account
 * @param {string} transactionData.transaction_type - Type: remittance, product, or combo
 * @param {string} transactionData.reference_id - Reference ID (order/remittance ID)
 * @param {number} transactionData.amount - Amount in USD
 * @param {string} [transactionData.notes] - Optional notes about transaction
 * @returns {Promise<object>} Created transaction record with ID and timestamps
 * @throws {AppError} If validation fails or database error
 *
 * @example
 * const transaction = await registerZelleTransaction({
 *   zelle_account_id: 'acc-123',
 *   transaction_type: 'remittance',
 *   reference_id: 'rem-456',
 *   amount: 250,
 *   notes: 'Cuba remittance for Juan Perez'
 * });
 */
export const registerZelleTransaction = async (transactionData) => {
  try {
    // Validate input
    validateTransactionData(transactionData);

    // Insert transaction record
    const { data, error } = await supabase
      .from('zelle_transaction_history')
      .insert([{
        zelle_account_id: transactionData.zelle_account_id,
        transaction_type: transactionData.transaction_type,
        reference_id: transactionData.reference_id,
        amount: transactionData.amount,
        status: ZELLE_STATUS.PENDING,
        notes: transactionData.notes || null
      }])
      .select()
      .single();

    if (error) {
      throw parseSupabaseError(error);
    }

    // Update account usage counters (non-critical RPC, graceful failure)
    try {
      const { error: rpcError } = await supabase.rpc('update_zelle_account_usage', {
        p_account_id: transactionData.zelle_account_id,
        p_amount: transactionData.amount
      });

      if (rpcError) {
        logError(rpcError, {
          operation: 'registerZelleTransaction',
          context: 'RPC update_zelle_account_usage failed',
          accountId: transactionData.zelle_account_id,
          transactionId: data.id
        });
        // Log but don't throw - transaction was already recorded
      }
    } catch (rpcError) {
      logError(rpcError, {
        operation: 'registerZelleTransaction',
        context: 'RPC call exception',
        accountId: transactionData.zelle_account_id,
        transactionId: data.id
      });
      // Continue - transaction was already recorded
    }

    return data;
  } catch (error) {
    if (error instanceof AppError) {
      logError(error, { operation: 'registerZelleTransaction', ...transactionData });
      throw error;
    }

    const appError = parseSupabaseError(error);
    logError(appError, { operation: 'registerZelleTransaction', ...transactionData });
    throw appError;
  }
};

/**
 * Validar transacción de Zelle (Admin only)
 * Marks a pending transaction as validated by an admin
 *
 * @param {string} transactionId - ID of the transaction to validate
 * @returns {Promise<object>} Updated transaction record with validated timestamp and admin ID
 * @throws {AppError} If unauthorized, validation fails, or database error
 *
 * @example
 * const validatedTx = await validateZelleTransaction('tx-789');
 * // Returns: { id: 'tx-789', status: 'validated', validated_by: 'user-123', ... }
 */
export const validateZelleTransaction = async (transactionId) => {
  try {
    if (!transactionId || typeof transactionId !== 'string') {
      throw createValidationError({ transactionId: 'Must be a non-empty string' }, 'Invalid transaction ID');
    }

    // Get authenticated user
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError) {
      throw parseSupabaseError(userError);
    }

    if (!user) {
      throw createPermissionError('access this resource', 'authenticated user');
    }

    // Update transaction status
    const { data, error } = await supabase
      .from('zelle_transaction_history')
      .update({
        status: ZELLE_STATUS.VALIDATED,
        validated_by: user.id,
        validated_at: new Date().toISOString()
      })
      .eq('id', transactionId)
      .select()
      .single();

    if (error) {
      throw parseSupabaseError(error);
    }

    if (!data) {
      throw createNotFoundError('Transaction', transactionId);
    }

    return data;
  } catch (error) {
    if (error instanceof AppError) {
      logError(error, { operation: 'validateZelleTransaction', transactionId });
      throw error;
    }

    const appError = parseSupabaseError(error);
    logError(appError, { operation: 'validateZelleTransaction', transactionId });
    throw appError;
  }
};

/**
 * Rechazar transacción de Zelle (Admin only)
 * Marks a transaction as rejected and reverses the usage counters
 *
 * TRANSACTION BOUNDARY:
 * This operation should atomically:
 * 1. Update transaction status to rejected
 * 2. Reverse account usage counters via RPC with negative amount
 * Current implementation: Update status, then reverse counters.
 * Future improvement: Use database transaction or ensure idempotency.
 *
 * @param {string} transactionId - ID of the transaction to reject
 * @param {string} [reason] - Reason for rejection (stored in notes)
 * @returns {Promise<object>} Updated transaction record with rejected status
 * @throws {AppError} If unauthorized, validation fails, or database error
 *
 * @example
 * const rejectedTx = await rejectZelleTransaction('tx-789', 'Duplicate transaction');
 * // Returns: { id: 'tx-789', status: 'rejected', notes: 'Duplicate transaction', ... }
 */
export const rejectZelleTransaction = async (transactionId, reason = null) => {
  try {
    if (!transactionId || typeof transactionId !== 'string') {
      throw createValidationError({ transactionId: 'Must be a non-empty string' }, 'Invalid transaction ID');
    }

    // Get authenticated user
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError) {
      throw parseSupabaseError(userError);
    }

    if (!user) {
      throw createPermissionError('access this resource', 'authenticated user');
    }

    // Fetch transaction to get account ID and amount for reversal
    const { data: transaction, error: fetchError } = await supabase
      .from('zelle_transaction_history')
      .select('*')
      .eq('id', transactionId)
      .single();

    if (fetchError) {
      throw parseSupabaseError(fetchError);
    }

    if (!transaction) {
      throw createNotFoundError('Transaction', transactionId);
    }

    // Update transaction status to rejected
    const { data, error } = await supabase
      .from('zelle_transaction_history')
      .update({
        status: ZELLE_STATUS.REJECTED,
        validated_by: user.id,
        validated_at: new Date().toISOString(),
        notes: reason || null
      })
      .eq('id', transactionId)
      .select()
      .single();

    if (error) {
      throw parseSupabaseError(error);
    }

    // Reverse account usage counters (non-critical RPC, graceful failure)
    try {
      const { error: rpcError } = await supabase.rpc('update_zelle_account_usage', {
        p_account_id: transaction.zelle_account_id,
        p_amount: -transaction.amount // Negative amount to reverse
      });

      if (rpcError) {
        logError(rpcError, {
          operation: 'rejectZelleTransaction',
          context: 'RPC update_zelle_account_usage reversal failed',
          accountId: transaction.zelle_account_id,
          transactionId,
          amount: -transaction.amount
        });
        // Log but don't throw - transaction status was already updated
      }
    } catch (rpcError) {
      logError(rpcError, {
        operation: 'rejectZelleTransaction',
        context: 'RPC call exception during reversal',
        accountId: transaction.zelle_account_id,
        transactionId,
        amount: -transaction.amount
      });
      // Continue - transaction status was already updated
    }

    return data;
  } catch (error) {
    if (error instanceof AppError) {
      logError(error, { operation: 'rejectZelleTransaction', transactionId, reason });
      throw error;
    }

    const appError = parseSupabaseError(error);
    logError(appError, { operation: 'rejectZelleTransaction', transactionId, reason });
    throw appError;
  }
};

// ============================================================================
// ACCOUNT MANAGEMENT (ADMIN ONLY)
// ============================================================================

/**
 * Obtener todas las cuentas Zelle (Admin only)
 * Retrieves all Zelle accounts sorted by priority order and name
 *
 * @returns {Promise<Array>} List of all Zelle account records
 * @throws {AppError} If unauthorized or database error
 *
 * @example
 * const accounts = await getAllZelleAccounts();
 * // Returns: [{ id: 'acc-1', account_name: 'Zelle 1', ... }, { id: 'acc-2', ... }]
 */
export const getAllZelleAccounts = async () => {
  try {
    // Get authenticated user (role verification delegated to component protection via withProtectedRoute HOC)
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError) {
      throw parseSupabaseError(userError);
    }

    if (!user) {
      throw createPermissionError('access this resource', 'authenticated user');
    }

    // Fetch all accounts
    const { data, error } = await supabase
      .from('zelle_accounts')
      .select('*')
      .order('priority_order', { ascending: true })
      .order('account_name');

    if (error) {
      throw parseSupabaseError(error);
    }

    return data || [];
  } catch (error) {
    if (error instanceof AppError) {
      logError(error, { operation: 'getAllZelleAccounts' });
      throw error;
    }

    const appError = parseSupabaseError(error);
    logError(appError, { operation: 'getAllZelleAccounts' });
    throw appError;
  }
};

/**
 * Crear cuenta Zelle (Admin only)
 * Creates a new Zelle account with validation
 *
 * @param {object} accountData - Account information
 * @param {string} accountData.account_name - Display name for the account
 * @param {string} accountData.phone_number - Zelle registered phone number
 * @param {string} accountData.holder_name - Name of account holder
 * @param {number} [accountData.daily_limit] - Daily transaction limit in USD
 * @param {number} [accountData.monthly_limit] - Monthly transaction limit in USD
 * @param {number} [accountData.priority_order] - Priority for rotation (lower = higher priority)
 * @param {boolean} [accountData.is_active] - Whether account is active for transactions
 * @returns {Promise<object>} Created account record with ID and timestamps
 * @throws {AppError} If unauthorized, validation fails, or database error
 *
 * @example
 * const newAccount = await createZelleAccount({
 *   account_name: 'Zelle Primary',
 *   phone_number: '+1-555-0123',
 *   holder_name: 'Juan Martinez',
 *   daily_limit: 5000,
 *   monthly_limit: 50000,
 *   priority_order: 1,
 *   is_active: true
 * });
 */
export const createZelleAccount = async (accountData) => {
  try {
    // Get authenticated user
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError) {
      throw parseSupabaseError(userError);
    }

    if (!user) {
      throw createPermissionError('access this resource', 'authenticated user');
    }

    // Validate input
    validateAccountData(accountData);

    // Insert new account
    const { data, error } = await supabase
      .from('zelle_accounts')
      .insert([accountData])
      .select()
      .single();

    if (error) {
      throw parseSupabaseError(error);
    }

    logError(
      new AppError('Account created', ERROR_CODES.INTERNAL_SERVER_ERROR, 200),
      { operation: 'createZelleAccount', accountId: data.id, accountName: accountData.account_name }
    );

    return data;
  } catch (error) {
    if (error instanceof AppError) {
      logError(error, { operation: 'createZelleAccount', ...accountData });
      throw error;
    }

    const appError = parseSupabaseError(error);
    logError(appError, { operation: 'createZelleAccount', ...accountData });
    throw appError;
  }
};

/**
 * Actualizar cuenta Zelle (Admin only)
 * Updates an existing Zelle account with validation
 *
 * @param {string} accountId - ID of the account to update
 * @param {object} updates - Fields to update (partial)
 * @returns {Promise<object>} Updated account record
 * @throws {AppError} If unauthorized, validation fails, or database error
 *
 * @example
 * const updated = await updateZelleAccount('acc-123', {
 *   is_active: false,
 *   daily_limit: 3000
 * });
 */
export const updateZelleAccount = async (accountId, updates) => {
  try {
    if (!accountId || typeof accountId !== 'string') {
      throw createValidationError({ accountId: 'Must be a non-empty string' }, 'Invalid account ID');
    }

    // Get authenticated user
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError) {
      throw parseSupabaseError(userError);
    }

    if (!user) {
      throw createPermissionError('access this resource', 'authenticated user');
    }

    // Validate updates if they contain account data fields
    if (Object.keys(updates).some(key => ['account_name', 'phone_number', 'holder_name', 'daily_limit', 'monthly_limit', 'priority_order', 'is_active'].includes(key))) {
      validateAccountData({ ...updates });
    }

    // Update account
    const { data, error } = await supabase
      .from('zelle_accounts')
      .update(updates)
      .eq('id', accountId)
      .select()
      .single();

    if (error) {
      throw parseSupabaseError(error);
    }

    if (!data) {
      throw createNotFoundError('Zelle account', accountId);
    }

    return data;
  } catch (error) {
    if (error instanceof AppError) {
      logError(error, { operation: 'updateZelleAccount', accountId, ...updates });
      throw error;
    }

    const appError = parseSupabaseError(error);
    logError(appError, { operation: 'updateZelleAccount', accountId, ...updates });
    throw appError;
  }
};

/**
 * Eliminar cuenta Zelle (Admin only)
 * IMPORTANT: Currently performs hard delete. Consider soft delete for audit trail.
 * If business logic requires audit trail of deleted accounts, implement soft delete pattern.
 *
 * @param {string} accountId - ID of the account to delete
 * @returns {Promise<void>} Void on success
 * @throws {AppError} If unauthorized, validation fails, or database error
 *
 * @example
 * await deleteZelleAccount('acc-123');
 */
export const deleteZelleAccount = async (accountId) => {
  try {
    if (!accountId || typeof accountId !== 'string') {
      throw createValidationError({ accountId: 'Must be a non-empty string' }, 'Invalid account ID');
    }

    // Get authenticated user
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError) {
      throw parseSupabaseError(userError);
    }

    if (!user) {
      throw createPermissionError('access this resource', 'authenticated user');
    }

    // Delete account (hard delete - consider soft delete for audit trail)
    const { error } = await supabase
      .from('zelle_accounts')
      .delete()
      .eq('id', accountId);

    if (error) {
      throw parseSupabaseError(error);
    }
  } catch (error) {
    if (error instanceof AppError) {
      logError(error, { operation: 'deleteZelleAccount', accountId });
      throw error;
    }

    const appError = parseSupabaseError(error);
    logError(appError, { operation: 'deleteZelleAccount', accountId });
    throw appError;
  }
};

// ============================================================================
// TRANSACTION HISTORY & STATISTICS
// ============================================================================

/**
 * Obtener historial de transacciones de una cuenta
 * Retrieves transaction history for an account with optional filtering
 *
 * @param {string} accountId - ID of the Zelle account
 * @param {object} [filters] - Optional filters
 * @param {string} [filters.startDate] - ISO date string for start of range (inclusive)
 * @param {string} [filters.endDate] - ISO date string for end of range (inclusive)
 * @param {string} [filters.status] - Filter by status: pending, validated, or rejected
 * @returns {Promise<Array>} Array of transaction records, newest first
 * @throws {AppError} If database error
 *
 * @example
 * const transactions = await getZelleAccountTransactions('acc-123', {
 *   status: 'validated',
 *   startDate: '2024-01-01T00:00:00Z'
 * });
 */
export const getZelleAccountTransactions = async (accountId, filters = {}) => {
  try {
    if (!accountId || typeof accountId !== 'string') {
      throw createValidationError({ accountId: 'Must be a non-empty string' }, 'Invalid account ID');
    }

    // Validate filter values
    if (filters.status && !Object.values(ZELLE_STATUS).includes(filters.status)) {
      throw createValidationError(
        { status: `Must be one of: ${Object.values(ZELLE_STATUS).join(', ')}` },
        'Invalid status filter'
      );
    }

    // Build query
    let query = supabase
      .from('zelle_transaction_history')
      .select('*')
      .eq('zelle_account_id', accountId);

    // Apply optional filters
    if (filters.startDate) {
      query = query.gte('transaction_date', filters.startDate);
    }

    if (filters.endDate) {
      query = query.lte('transaction_date', filters.endDate);
    }

    if (filters.status) {
      query = query.eq('status', filters.status);
    }

    // Sort by date, newest first
    query = query.order('transaction_date', { ascending: false });

    const { data, error } = await query;

    if (error) {
      throw parseSupabaseError(error);
    }

    return data || [];
  } catch (error) {
    if (error instanceof AppError) {
      logError(error, { operation: 'getZelleAccountTransactions', accountId, filters });
      throw error;
    }

    const appError = parseSupabaseError(error);
    logError(appError, { operation: 'getZelleAccountTransactions', accountId, filters });
    throw appError;
  }
};

/**
 * Obtener estadísticas de una cuenta Zelle
 * Calculates aggregated statistics from transaction history
 *
 * GRACEFUL FALLBACK:
 * Stats calculation is performed on fetched data and cannot fail after data retrieval.
 * If data fetch fails, error is thrown. If calculation has issues, graceful defaults are used.
 *
 * @param {string} accountId - ID of the Zelle account
 * @returns {Promise<object>} Statistics object with totals and breakdowns
 * @returns {number} returns.total_transactions - Count of all transactions
 * @returns {number} returns.total_amount - Sum of all transaction amounts
 * @returns {number} returns.validated_amount - Sum of validated transactions
 * @returns {number} returns.pending_amount - Sum of pending transactions
 * @returns {object} returns.by_type - Breakdown by transaction type
 * @throws {AppError} If database error
 *
 * @example
 * const stats = await getZelleAccountStats('acc-123');
 * // Returns: {
 * //   total_transactions: 42,
 * //   total_amount: 10500.50,
 * //   validated_amount: 9800.00,
 * //   pending_amount: 700.50,
 * //   by_type: { remittance: 30, product: 8, combo: 4 }
 * // }
 */
export const getZelleAccountStats = async (accountId) => {
  try {
    if (!accountId || typeof accountId !== 'string') {
      throw createValidationError({ accountId: 'Must be a non-empty string' }, 'Invalid account ID');
    }

    // Fetch transaction data
    const { data, error } = await supabase
      .from('zelle_transaction_history')
      .select('amount, status, transaction_type')
      .eq('zelle_account_id', accountId);

    if (error) {
      throw parseSupabaseError(error);
    }

    // Gracefully calculate stats from retrieved data
    const transactionData = data || [];

    try {
      const stats = {
        total_transactions: transactionData.length,
        total_amount: transactionData.reduce((sum, t) => sum + (parseFloat(t.amount) || 0), 0),
        validated_amount: transactionData
          .filter(t => t.status === ZELLE_STATUS.VALIDATED)
          .reduce((sum, t) => sum + (parseFloat(t.amount) || 0), 0),
        pending_amount: transactionData
          .filter(t => t.status === ZELLE_STATUS.PENDING)
          .reduce((sum, t) => sum + (parseFloat(t.amount) || 0), 0),
        rejected_amount: transactionData
          .filter(t => t.status === ZELLE_STATUS.REJECTED)
          .reduce((sum, t) => sum + (parseFloat(t.amount) || 0), 0),
        by_type: {
          remittance: transactionData.filter(t => t.transaction_type === ZELLE_TRANSACTION_TYPES.REMITTANCE).length,
          product: transactionData.filter(t => t.transaction_type === ZELLE_TRANSACTION_TYPES.PRODUCT).length,
          combo: transactionData.filter(t => t.transaction_type === ZELLE_TRANSACTION_TYPES.COMBO).length
        }
      };

      return stats;
    } catch (calcError) {
      // Graceful fallback - return zeros if calculation fails
      logError(calcError, {
        operation: 'getZelleAccountStats',
        context: 'Stats calculation failed, returning zeros',
        accountId
      });

      return {
        total_transactions: 0,
        total_amount: 0,
        validated_amount: 0,
        pending_amount: 0,
        rejected_amount: 0,
        by_type: {
          remittance: 0,
          product: 0,
          combo: 0
        }
      };
    }
  } catch (error) {
    if (error instanceof AppError) {
      logError(error, { operation: 'getZelleAccountStats', accountId });
      throw error;
    }

    const appError = parseSupabaseError(error);
    logError(appError, { operation: 'getZelleAccountStats', accountId });
    throw appError;
  }
};

/**
 * Reset manual de contadores (Admin only)
 * Manually resets daily or monthly usage counters for an account
 *
 * @param {string} accountId - ID of the account
 * @param {string} [type='daily'] - Type of reset: 'daily' or 'monthly'
 * @returns {Promise<object>} Updated account record with reset counters
 * @throws {AppError} If unauthorized, validation fails, or database error
 *
 * @example
 * const account = await resetZelleCounters('acc-123', 'daily');
 * // Returns: { id: 'acc-123', current_daily_amount: 0, last_reset_date: '2024-...' }
 */
export const resetZelleCounters = async (accountId, type = 'daily') => {
  try {
    if (!accountId || typeof accountId !== 'string') {
      throw createValidationError({ accountId: 'Must be a non-empty string' }, 'Invalid account ID');
    }

    if (!['daily', 'monthly'].includes(type)) {
      throw createValidationError({ type: 'Must be either "daily" or "monthly"' }, 'Invalid reset type');
    }

    // Get authenticated user
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError) {
      throw parseSupabaseError(userError);
    }

    if (!user) {
      throw createPermissionError('access this resource', 'authenticated user');
    }

    // Prepare updates based on type
    const updates = type === 'daily'
      ? { current_daily_amount: 0, last_reset_date: new Date().toISOString() }
      : { current_monthly_amount: 0 };

    // Update account
    const { data, error } = await supabase
      .from('zelle_accounts')
      .update(updates)
      .eq('id', accountId)
      .select()
      .single();

    if (error) {
      throw parseSupabaseError(error);
    }

    if (!data) {
      throw createNotFoundError('Zelle account', accountId);
    }

    return data;
  } catch (error) {
    if (error instanceof AppError) {
      logError(error, { operation: 'resetZelleCounters', accountId, type });
      throw error;
    }

    const appError = parseSupabaseError(error);
    logError(appError, { operation: 'resetZelleCounters', accountId, type });
    throw appError;
  }
};

// ============================================================================
// SERVICE NAMESPACE EXPORT
// ============================================================================

export const zelleService = {
  getAllZelleAccounts,
  createZelleAccount,
  updateZelleAccount,
  deleteZelleAccount,
  getZelleAccountTransactions,
  getZelleAccountStats,
  resetZelleCounters,
  ZELLE_STATUS,
  ZELLE_TRANSACTION_TYPES
};
