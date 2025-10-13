/**
 * Query Helper Utilities
 * Reduces redundancy in Supabase query patterns
 */

/**
 * Execute a Supabase query with consistent error handling
 * @param {Function} queryFn - Async function that executes the query
 * @param {string} errorContext - Context message for logging
 * @returns {Promise<{data: any, error: any}>}
 */
export const executeQuery = async (queryFn, errorContext = 'Query') => {
  try {
    const { data, error } = await queryFn();
    if (error) throw error;
    return { data, error: null };
  } catch (error) {
    console.error(`[${errorContext}] Error:`, error);
    return { data: null, error };
  }
};

/**
 * Soft delete a record by setting is_active to false
 * @param {Object} supabase - Supabase client
 * @param {string} tableName - Table name
 * @param {string} id - Record ID
 * @returns {Promise<{data: any, error: any}>}
 */
export const softDelete = async (supabase, tableName, id) => {
  return executeQuery(
    () => supabase
      .from(tableName)
      .update({ is_active: false })
      .eq('id', id)
      .select()
      .single(),
    `Soft delete from ${tableName}`
  );
};

/**
 * Get active records from a table
 * @param {Object} supabase - Supabase client
 * @param {string} tableName - Table name
 * @param {string} selectFields - Fields to select (default: *)
 * @param {string} orderBy - Order by field (default: created_at)
 * @param {boolean} ascending - Sort order (default: false)
 * @returns {Promise<{data: any, error: any}>}
 */
export const getActiveRecords = async (
  supabase,
  tableName,
  selectFields = '*',
  orderBy = 'created_at',
  ascending = false
) => {
  return executeQuery(
    () => supabase
      .from(tableName)
      .select(selectFields)
      .eq('is_active', true)
      .order(orderBy, { ascending }),
    `Get active records from ${tableName}`
  );
};

/**
 * Generate a slug from text (removes accents, converts to lowercase, replaces spaces with hyphens)
 * @param {string} text - Text to convert to slug
 * @returns {string} - Generated slug
 */
export const generateSlug = (text) => {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Remove accents
    .replace(/[^a-z0-9]+/g, '-') // Replace non-alphanumeric with hyphens
    .replace(/^-+|-+$/g, ''); // Remove leading/trailing hyphens
};

/**
 * Calculate final price with profit margin
 * @param {number} basePrice - Base price
 * @param {number} profitMargin - Profit margin percentage
 * @returns {number} - Final price
 */
export const calculateFinalPrice = (basePrice, profitMargin) => {
  const base = parseFloat(basePrice || 0);
  const margin = parseFloat(profitMargin || 0) / 100;
  return base * (1 + margin);
};

/**
 * Format timestamp to ISO string with current time
 * @returns {string} - ISO timestamp
 */
export const getCurrentTimestamp = () => new Date().toISOString();

/**
 * Batch query multiple IDs efficiently
 * @param {Object} supabase - Supabase client
 * @param {string} tableName - Table name
 * @param {string} idField - ID field name
 * @param {Array} ids - Array of IDs
 * @param {string} selectFields - Fields to select
 * @returns {Promise<{data: any, error: any}>}
 */
export const batchQuery = async (supabase, tableName, idField, ids, selectFields = '*') => {
  if (!ids || ids.length === 0) {
    return { data: [], error: null };
  }

  return executeQuery(
    () => supabase
      .from(tableName)
      .select(selectFields)
      .in(idField, ids),
    `Batch query ${tableName}`
  );
};
