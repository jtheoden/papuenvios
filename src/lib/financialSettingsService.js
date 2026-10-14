/**
 * Financial settings service (global profit margins).
 * Persists the default product / combo profit percentages in system_config.
 * Admin-only: RLS exposes these keys only to admins (see migration
 * 20261013150000_f8_profit_margin_settings.sql).
 */

import { supabase } from '@/lib/supabase';
import { createValidationError, logError, parseSupabaseError } from '@/lib/errorHandler';
import { validateMarginPercent } from '@/lib/marginResolver';

export const MARGIN_KEYS = {
  PRODUCT: 'default_profit_margin',
  COMBO: 'default_combo_profit_margin'
};

const toNumberOrNull = (raw) => {
  if (raw === null || raw === undefined || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
};

/**
 * @returns {Promise<{ productProfit: number|null, comboProfit: number|null }>}
 * @throws {AppError} on database errors
 */
export const getMarginSettings = async () => {
  const { data, error } = await supabase
    .from('system_config')
    .select('key, value_numeric')
    .in('key', [MARGIN_KEYS.PRODUCT, MARGIN_KEYS.COMBO]);

  if (error) {
    const appError = parseSupabaseError(error);
    logError(appError, { operation: 'getMarginSettings' });
    throw appError;
  }

  const byKey = Object.fromEntries((data || []).map(row => [row.key, row.value_numeric]));
  return {
    productProfit: toNumberOrNull(byKey[MARGIN_KEYS.PRODUCT]),
    comboProfit: toNumberOrNull(byKey[MARGIN_KEYS.COMBO])
  };
};

/**
 * Validates and upserts both margins. Validation runs before any DB call.
 * @param {{ productProfit: unknown, comboProfit: unknown }} margins
 * @returns {Promise<{ productProfit: number, comboProfit: number }>}
 * @throws {AppError} VALIDATION_FAILED or a database error
 */
export const saveMarginSettings = async ({ productProfit, comboProfit } = {}) => {
  const fieldErrors = {};
  if (!validateMarginPercent(productProfit)) fieldErrors.productProfit = 'Must be a number between 0 and 999.99';
  if (!validateMarginPercent(comboProfit)) fieldErrors.comboProfit = 'Must be a number between 0 and 999.99';
  if (Object.keys(fieldErrors).length > 0) {
    throw createValidationError(fieldErrors, 'Invalid profit margin');
  }

  const normalized = {
    productProfit: Number(productProfit),
    comboProfit: Number(comboProfit)
  };
  const now = new Date().toISOString();

  const { error } = await supabase
    .from('system_config')
    .upsert(
      [
        { key: MARGIN_KEYS.PRODUCT, value_numeric: normalized.productProfit, updated_at: now },
        { key: MARGIN_KEYS.COMBO, value_numeric: normalized.comboProfit, updated_at: now }
      ],
      { onConflict: 'key' }
    );

  if (error) {
    const appError = parseSupabaseError(error);
    logError(appError, { operation: 'saveMarginSettings' });
    throw appError;
  }

  return normalized;
};
