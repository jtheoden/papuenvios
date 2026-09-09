/**
 * Bulk Delete Service
 * Selección múltiple + borrado masivo para super_admin (Frente 1 del plan
 * admin-bulk-ops-reset-audit). Cada llamada delega en un RPC SECURITY DEFINER
 * que reusa la misma cascada de borrado físico de deleteProduct/deleteCategory
 * dentro de una única transacción, con reporte parcial por ítem.
 */

import { supabase } from '@/lib/supabase';
import { AppError, ERROR_CODES, logError, createValidationError, parseSupabaseError } from '@/lib/errorHandler';

const shapeResult = (rows) => {
  const deleted = [];
  const blocked = [];

  for (const row of rows || []) {
    if (row.deleted_id) {
      deleted.push(row.deleted_id);
    } else if (row.blocked_id) {
      blocked.push({ id: row.blocked_id, reason: row.block_reason });
    }
  }

  return { deleted, blocked };
};

const runBulkDelete = async (rpcName, ids, operation) => {
  try {
    if (!Array.isArray(ids) || ids.length === 0) {
      throw createValidationError({ ids: 'At least one ID is required' }, 'No items selected');
    }

    const { data, error } = await supabase.rpc(rpcName, { p_ids: ids });

    if (error) {
      throw parseSupabaseError(error);
    }

    return shapeResult(data);
  } catch (error) {
    if (error instanceof AppError) {
      logError(error, { operation, ids });
      throw error;
    }

    const appError = parseSupabaseError(error);
    logError(appError, { operation, ids });
    throw appError;
  }
};

/**
 * Borrado masivo de productos (super_admin únicamente — el RPC re-verifica el rol).
 * @param {string[]} ids
 * @returns {Promise<{deleted: string[], blocked: Array<{id: string, reason: string}>}>}
 */
export const bulkDeleteProducts = (ids) => runBulkDelete('bulk_delete_products', ids, 'bulkDeleteProducts');

/**
 * Borrado masivo de categorías (super_admin únicamente — el RPC re-verifica el rol).
 * @param {string[]} ids
 * @returns {Promise<{deleted: string[], blocked: Array<{id: string, reason: string}>}>}
 */
export const bulkDeleteCategories = (ids) => runBulkDelete('bulk_delete_categories', ids, 'bulkDeleteCategories');

const runPreview = async (rpcName, ids, operation, shapeRow) => {
  try {
    if (!Array.isArray(ids) || ids.length === 0) {
      throw createValidationError({ ids: 'At least one ID is required' }, 'No items selected');
    }

    const { data, error } = await supabase.rpc(rpcName, { p_ids: ids });

    if (error) {
      throw parseSupabaseError(error);
    }

    return (data || []).map(shapeRow);
  } catch (error) {
    if (error instanceof AppError) {
      logError(error, { operation, ids });
      throw error;
    }

    const appError = parseSupabaseError(error);
    logError(appError, { operation, ids });
    throw appError;
  }
};

/**
 * Preview de solo lectura del impacto en cascada de bulk_delete_products —
 * mismos chequeos que el RPC de borrado real, sin escribir nada. Pensado
 * para mostrarse ANTES de que el usuario confirme el borrado.
 * @param {string[]} ids
 * @returns {Promise<Array<{id: string, name: string, canDelete: boolean, blockReason: string|null, counts: {blockingOrders: number, combosToDeactivate: number, inventoryRows: number, inventoryMovements: number}}>>}
 */
export const previewBulkDeleteProducts = (ids) => runPreview(
  'preview_bulk_delete_products',
  ids,
  'previewBulkDeleteProducts',
  (row) => ({
    id: row.id,
    name: row.name,
    canDelete: row.can_delete,
    blockReason: row.block_reason,
    counts: {
      blockingOrders: row.blocking_orders_count,
      combosToDeactivate: row.combos_to_deactivate,
      inventoryRows: row.inventory_rows,
      inventoryMovements: row.inventory_movements
    }
  })
);

/**
 * Preview de solo lectura del impacto en cascada de bulk_delete_categories.
 * @param {string[]} ids
 * @returns {Promise<Array<{id: string, name: string, canDelete: boolean, blockReason: string|null, counts: {products: number}}>>}
 */
export const previewBulkDeleteCategories = (ids) => runPreview(
  'preview_bulk_delete_categories',
  ids,
  'previewBulkDeleteCategories',
  (row) => ({
    id: row.id,
    name: row.name,
    canDelete: row.can_delete,
    blockReason: row.block_reason,
    counts: { products: row.products_count }
  })
);
