/**
 * Order combo definitions
 *
 * order_items stores a combo as one row. This reads the CURRENT combo composition for the
 * combo ids shown on screen (one query, no N+1). The result is display-only and is never
 * cached: order data must always be read fresh.
 */

import { supabase } from './supabase';
import { toComboDefinitionMap, toProductUnitMap } from './orderItemsPure';

const COMBO_DEFINITION_SELECT =
  'id, name_es, name_en, combo_items(product_id, quantity, created_at, products(name_es, name_en, unit))';

// Same query without products.unit: used only if the unit column is not available yet
// (front deployed before the migration), so combos still expand with plain quantities.
const COMBO_DEFINITION_SELECT_NO_UNIT =
  'id, name_es, name_en, combo_items(product_id, quantity, created_at, products(name_es, name_en))';

const UNDEFINED_COLUMN = '42703';

const isMissingUnitColumn = (error) =>
  error?.code === UNDEFINED_COLUMN || /\bunit\b/i.test(error?.message || '');

/**
 * @param {string[]} comboIds
 * @returns {Promise<Map<string, object>>} definitions by combo id; empty on error (best effort)
 */
export const fetchComboDefinitions = async (comboIds) => {
  if (!Array.isArray(comboIds) || comboIds.length === 0) return new Map();

  const query = (select) => supabase.from('combo_products').select(select).in('id', comboIds);

  let { data, error } = await query(COMBO_DEFINITION_SELECT);
  if (error && isMissingUnitColumn(error)) {
    ({ data, error } = await query(COMBO_DEFINITION_SELECT_NO_UNIT));
  }

  if (error) return new Map();
  return toComboDefinitionMap(data);
};

/**
 * Current unit of measure for plain product lines (one batched query, no N+1).
 * Display-only and best effort: any failure (including a missing column) yields an empty map,
 * which renders plain quantities.
 * @param {string[]} productIds
 * @returns {Promise<Map<string, string|null>>}
 */
export const fetchProductUnits = async (productIds) => {
  if (!Array.isArray(productIds) || productIds.length === 0) return new Map();

  try {
    const { data, error } = await supabase.from('products').select('id, unit').in('id', productIds);
    if (error) return new Map();
    return toProductUnitMap(data);
  } catch {
    return new Map();
  }
};
