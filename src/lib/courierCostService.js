/**
 * Admin-only read of the courier cost of each order / remittance for the Dashboard.
 *
 * Source of truth: the view v_effective_courier_cost (courier-management module), which already merges the legacy
 * zone snapshots (order_courier_costs / remittance_courier_costs) with the courier accruals: ONE number per operation.
 * The legacy tables are read ONLY while the view does not exist yet (front deployed before the migrations), never
 * together with it, so nothing is counted twice. Row level security only lets admins read these relations.
 *
 * A failed read throws: the caller shows "unavailable", never zeros (an unknown cost is not a 0 cost).
 */

import { supabase } from './supabase';
import { ERROR_CODES, AppError, parseSupabaseError, logError } from './errorHandler';

const PAGE_SIZE = 1000;
const VIEW = 'v_effective_courier_cost';
const VIEW_MISSING = new Set(['42P01', 'PGRST205']);

/**
 * Reads a whole relation (one row per order/remittance) in pages.
 * @returns {Promise<Map<string, number|null> & { firstRecordedAt: string|null }>} id -> USD amount (null = unknown
 * cost). `firstRecordedAt` is the ISO instant of the oldest row (the moment the feature started recording), null while
 * empty. It is a property of the Map so existing callers keep working.
 * Resolves `{ missing: true }` instead when the relation does not exist and `tolerateMissing` is set.
 */
const readCosts = async ({ table, keyColumn, timeColumn, filter, operation, tolerateMissing }) => {
  const costs = new Map();
  let firstMs = Infinity;
  for (let from = 0; ; from += PAGE_SIZE) {
    let query = supabase.from(table).select(`${keyColumn}, amount_usd, ${timeColumn}`);
    if (filter) query = query.eq(...filter);
    const { data, error } = await query.order(keyColumn, { ascending: true }).range(from, from + PAGE_SIZE - 1);
    if (error) {
      if (tolerateMissing && VIEW_MISSING.has(error.code)) return { missing: true };
      const appError = parseSupabaseError(error) ?? new AppError('Unknown error', ERROR_CODES.DB_ERROR, 500);
      logError(appError, { operation });
      throw appError;
    }
    (data || []).forEach((row) => {
      const ms = Date.parse(row[timeColumn]);
      if (ms < firstMs) firstMs = ms;
      costs.set(row[keyColumn], row.amount_usd === null || row.amount_usd === undefined ? null : Number(row.amount_usd));
    });
    if (!data || data.length < PAGE_SIZE) break;
  }
  costs.firstRecordedAt = Number.isFinite(firstMs) ? new Date(firstMs).toISOString() : null;
  return costs;
};

const listCourierCosts = async (kind, legacy, operation) => {
  const fromView = await readCosts({
    table: VIEW, keyColumn: 'source_id', timeColumn: 'recorded_at', filter: ['source_kind', kind], operation, tolerateMissing: true
  });
  if (!fromView.missing) return fromView;
  return readCosts({ ...legacy, timeColumn: 'created_at', operation });
};

export const listOrderCourierCosts = () =>
  listCourierCosts('order', { table: 'order_courier_costs', keyColumn: 'order_id' }, 'listOrderCourierCosts');

/** Same for remittances (cash deliveries only). Throws if neither the view nor the legacy table exist. */
export const listRemittanceCourierCosts = () =>
  listCourierCosts('remittance', { table: 'remittance_courier_costs', keyColumn: 'remittance_id' }, 'listRemittanceCourierCosts');
