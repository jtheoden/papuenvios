/**
 * Order combo definitions
 *
 * order_items stores a combo as one row. This reads the CURRENT combo composition for the
 * combo ids shown on screen (one query, no N+1). The result is display-only and is never
 * cached: order data must always be read fresh.
 */

import { supabase } from './supabase';
import { toComboDefinitionMap } from './orderItemsPure';

const COMBO_DEFINITION_SELECT =
  'id, name_es, name_en, combo_items(product_id, quantity, created_at, products(name_es, name_en))';

/**
 * @param {string[]} comboIds
 * @returns {Promise<Map<string, object>>} definitions by combo id; empty on error (best effort)
 */
export const fetchComboDefinitions = async (comboIds) => {
  if (!Array.isArray(comboIds) || comboIds.length === 0) return new Map();

  const { data, error } = await supabase
    .from('combo_products')
    .select(COMBO_DEFINITION_SELECT)
    .in('id', comboIds);

  if (error) return new Map();
  return toComboDefinitionMap(data);
};
