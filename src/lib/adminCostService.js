/**
 * Admin-only reads of cost and margin data.
 *
 * Admin and customer share the `authenticated` database role, so a column privilege cannot tell them
 * apart: cost columns are read through SECURITY DEFINER RPCs that re-check the role inside
 * (migration 20261016160000_phase0b_admin_cost_read_rpcs.sql). Every RPC returns the row id plus
 * the cost columns only; the services merge them onto the public rows read from the tables.
 *
 * There is deliberately NO fallback to a direct table read: once the cost columns are hidden it would
 * only fail later and hide the real problem. A missing RPC surfaces as ADMIN_COST_RPC_UNAVAILABLE.
 */

import { supabase } from './supabase';
import { AppError, ERROR_CODES, parseSupabaseError, logError } from './errorHandler';

export const ADMIN_COST_RPC_UNAVAILABLE = 'ADMIN_COST_RPC_UNAVAILABLE';

// Same value as the RPC default; ids are sent in chunks of one page so each chunk is a single call.
const PAGE_SIZE = 500;

const isMissingFunction = (error) =>
  error?.code === 'PGRST202' || error?.status === 404
  || /could not find the function/i.test(String(error?.message ?? ''));

const toAdminCostError = (rpcName, error) => {
  if (isMissingFunction(error)) {
    return new AppError(
      `Cost data is unavailable: the database function ${rpcName} is missing. Apply the pending database migration and reload.`,
      ADMIN_COST_RPC_UNAVAILABLE,
      503,
      { rpc: rpcName, originalError: error }
    );
  }
  const appError = parseSupabaseError(error) ?? new AppError('Unknown error', ERROR_CODES.DB_ERROR, 500);
  appError.context = { ...appError.context, rpc: rpcName, postgresCode: appError.context?.postgresCode ?? error?.code };
  return appError;
};

const callPage = async (rpcName, args) => {
  const { data, error } = await supabase.rpc(rpcName, args);
  if (error) {
    const appError = toAdminCostError(rpcName, error);
    logError(appError, { operation: rpcName });
    throw appError;
  }
  return data || [];
};

/** Pages one RPC to the end (short page = last page) and returns the rows keyed by id. */
const listAll = async (rpcName, ids) => {
  const result = new Map();
  const add = (rows) => rows.forEach((row) => result.set(row.id, row));

  if (ids === undefined || ids === null) {
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const rows = await callPage(rpcName, { p_limit: PAGE_SIZE, p_offset: offset, p_ids: null });
      add(rows);
      if (rows.length < PAGE_SIZE) break;
    }
    return result;
  }

  const unique = [...new Set(ids)];
  for (let start = 0; start < unique.length; start += PAGE_SIZE) {
    add(await callPage(rpcName, { p_limit: PAGE_SIZE, p_offset: 0, p_ids: unique.slice(start, start + PAGE_SIZE) }));
  }
  return result;
};

/** @returns {Promise<Map<string, {id, base_price, profit_margin}>>} */
export const listProductCosts = (ids) => listAll('admin_list_product_costs', ids);

/** @returns {Promise<Map<string, {id, base_total_price, profit_margin}>>} */
export const listComboCosts = (ids) => listAll('admin_list_combo_costs', ids);

/** @returns {Promise<Map<string, {id, profit_margin}>>} */
export const listCategoryMargins = (ids) => listAll('admin_list_category_margins', ids);

/** @returns {Promise<Map<string, {id, product_id, cost_per_unit, supplier_reference}>>} */
export const listInventoryCosts = (ids) => listAll('admin_list_inventory_costs', ids);

/** @returns {Promise<Map<string, {id, transport_cost}>>} */
export const listShippingZoneCosts = (ids) => listAll('admin_list_shipping_zone_costs', ids);
