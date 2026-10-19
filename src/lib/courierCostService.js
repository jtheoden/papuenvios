/**
 * Admin-only read of the per-order courier cost snapshot (table order_courier_costs, migration
 * 20261019140000_order_courier_costs.sql). Row level security only lets admins read it; for anyone else
 * the table is empty, so this service must only be called from admin screens.
 *
 * A failed read throws: the caller shows "unavailable", never zeros (an unknown cost is not a 0 cost).
 */

import { supabase } from './supabase';
import { ERROR_CODES, AppError, parseSupabaseError, logError } from './errorHandler';

const PAGE_SIZE = 1000;

/** @returns {Promise<Map<string, number|null>>} order id -> USD amount (null = no tariff was configured) */
export const listOrderCourierCosts = async () => {
  const costs = new Map();
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('order_courier_costs')
      .select('order_id, amount_usd')
      .order('order_id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) {
      const appError = parseSupabaseError(error) ?? new AppError('Unknown error', ERROR_CODES.DB_ERROR, 500);
      logError(appError, { operation: 'listOrderCourierCosts' });
      throw appError;
    }
    (data || []).forEach((row) => {
      costs.set(row.order_id, row.amount_usd === null || row.amount_usd === undefined ? null : Number(row.amount_usd));
    });
    if (!data || data.length < PAGE_SIZE) break;
  }
  return costs;
};
