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

/**
 * Reads a whole snapshot table (one row per order/remittance) in pages.
 * @returns {Promise<Map<string, number|null> & { firstRecordedAt: string|null }>} id -> USD amount (null = no
 * tariff was configured). `firstRecordedAt` is the ISO instant of the oldest snapshot row (the moment the feature
 * started recording), null while the table is empty. It is a property of the Map so existing callers keep working.
 */
const listCourierCosts = async (table, keyColumn, operation) => {
  const costs = new Map();
  let firstMs = Infinity;
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from(table)
      .select(`${keyColumn}, amount_usd, created_at`)
      .order(keyColumn, { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) {
      const appError = parseSupabaseError(error) ?? new AppError('Unknown error', ERROR_CODES.DB_ERROR, 500);
      logError(appError, { operation });
      throw appError;
    }
    (data || []).forEach((row) => {
      const ms = Date.parse(row.created_at);
      if (ms < firstMs) firstMs = ms;
      costs.set(row[keyColumn], row.amount_usd === null || row.amount_usd === undefined ? null : Number(row.amount_usd));
    });
    if (!data || data.length < PAGE_SIZE) break;
  }
  costs.firstRecordedAt = Number.isFinite(firstMs) ? new Date(firstMs).toISOString() : null;
  return costs;
};

export const listOrderCourierCosts = () => listCourierCosts('order_courier_costs', 'order_id', 'listOrderCourierCosts');

/** Same snapshot for remittances (table remittance_courier_costs, cash deliveries only). Throws if not deployed yet. */
export const listRemittanceCourierCosts = () =>
  listCourierCosts('remittance_courier_costs', 'remittance_id', 'listRemittanceCourierCosts');
