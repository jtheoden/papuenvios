/**
 * Payment FX (EUR) service for the Bizum admin front.
 *
 * Thin wrapper over get_payment_fx_status / set_payment_fx_rate
 * (supabase/migrations/20261015120000_bizum_s3_currency_settings_fx_rates.sql). The database owns
 * authorization, the 0.5-1.5 sanity band, the large-change guard and the freshness state; the
 * local validation only avoids a pointless round-trip. Kept separate from bizumService because S5+
 * (quotes) reuses it for the customer-side rate; design 3.9 names the future home paymentQuoteService.
 */

import { supabase } from '@/lib/supabase';
import { toBizumError } from '@/lib/bizumErrors';
import { parseDecimal, countDecimals } from '@/lib/bizumService';

export const PAYMENT_FX_STATES = Object.freeze({
  NONE: 'none',
  OK: 'ok',
  WARN: 'warn',
  BLOCKED: 'blocked'
});

export const PAYMENT_FX_BOUNDS = Object.freeze({
  mid: Object.freeze({ min: 0.5, max: 1.5, decimals: 6 }),
  spread: Object.freeze({ min: 0, max: 10, decimals: 2 }),
  noteMaxLength: 500
});

const checkNumber = (raw, { min, max, decimals }) => {
  const text = String(raw ?? '').trim();
  if (text === '') return 'required';
  const value = parseDecimal(text);
  if (!Number.isFinite(value) || value < min || value > max) return 'range';
  if (countDecimals(text) > decimals) return 'decimals';
  return null;
};

/**
 * Validate the "load a rate" form. Values are strings (a decimal comma is accepted).
 * @returns {{mid?: string, spread?: string, note?: string}} error code per field
 */
export const validatePaymentFxForm = ({ mid, spread, note = '' }) => {
  const errors = {};
  const midError = checkNumber(mid, PAYMENT_FX_BOUNDS.mid);
  if (midError) errors.mid = midError;
  const spreadError = checkNumber(spread, PAYMENT_FX_BOUNDS.spread);
  if (spreadError) errors.spread = spreadError;
  if (String(note ?? '').trim().length > PAYMENT_FX_BOUNDS.noteMaxLength) errors.note = 'tooLong';
  return errors;
};

const loadAuthorName = async (userId) => {
  try {
    const { data, error } = await supabase.from('user_profiles').select('id, full_name').in('id', [userId]);
    if (error || !Array.isArray(data)) return null;
    return data.find((row) => row.id === userId)?.full_name || null;
  } catch {
    return null;
  }
};

/**
 * Latest rate with its freshness state and the thresholds the server applied.
 * The author name is best-effort (null when the lookup fails).
 * @throws {import('@/lib/bizumErrors').BizumError}
 */
export const getPaymentFxStatus = async () => {
  const { data, error } = await supabase.rpc('get_payment_fx_status');
  if (error) throw toBizumError(error);
  const status = data || {};
  const createdByName = status.created_by ? await loadAuthorName(status.created_by) : null;
  return { ...status, created_by_name: createdByName };
};

/**
 * Append a new rate (append-only ledger).
 * @param {{mid: number, spread: number, source?: 'manual', note?: string, confirmLargeChange?: boolean}} params
 * @throws {import('@/lib/bizumErrors').BizumError} token payment_fx_large_change asks for confirmation
 */
export const setPaymentFxRate = async ({ mid, spread, source = 'manual', note = '', confirmLargeChange = false }) => {
  const trimmedNote = String(note ?? '').trim();
  const { data, error } = await supabase.rpc('set_payment_fx_rate', {
    p_mid: mid,
    p_spread: spread,
    p_source: source,
    p_note: trimmedNote === '' ? null : trimmedNote,
    p_confirm_large_change: Boolean(confirmLargeChange)
  });
  if (error) throw toBizumError(error);
  return data;
};

/** Effective rate exactly like the generated column: round(mid * (1 + spread / 100), 6). */
export const effectiveRate = (mid, spread) => Number((Number(mid) * (1 + Number(spread) / 100)).toFixed(6));

/** Signed % change from `previous` to `next`; NaN when there is no usable previous rate. */
export const changePercent = (previous, next) => {
  const base = Number(previous);
  return base > 0 ? ((Number(next) - base) / base) * 100 : Number.NaN;
};
