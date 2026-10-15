/**
 * Order items display helpers (pure, no I/O).
 *
 * order_items stores a combo as ONE row (item_type 'combo'); its contents live in combo_items.
 * These helpers expand a combo row into its CURRENT components at read time, so they work for
 * historical orders without any data migration.
 */

const COMBO_TYPE = 'combo';

const isComboItem = (item) => item?.item_type === COMBO_TYPE;

const toTime = (value) => {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
};

/**
 * Unique combo ids referenced by the given orders (null ids are ignored).
 * @param {Array<{order_items?: Array}>} orders
 * @returns {string[]}
 */
export const collectComboIds = (orders) => {
  const ids = new Set();
  (orders || []).forEach((order) => {
    (order?.order_items || []).forEach((item) => {
      if (isComboItem(item) && item.item_id) ids.add(item.item_id);
    });
  });
  return [...ids];
};

/**
 * Index combo definition rows (combo_products + combo_items + products) by id.
 * @param {Array|null} rows
 * @returns {Map<string, object>}
 */
export const toComboDefinitionMap = (rows) =>
  new Map((rows || []).filter((row) => row?.id).map((row) => [row.id, row]));

const pickName = (product, language) => {
  if (!product) return null;
  const primary = language === 'en' ? product.name_en : product.name_es;
  const secondary = language === 'en' ? product.name_es : product.name_en;
  return primary || secondary || null;
};

const toQuantity = (value) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 1;
};

/**
 * True when a component row was (re)created after the order. updateCombo deletes and reinserts
 * combo_items, so created_at moves whenever the composition is saved. combo_products.updated_at
 * is NOT used: it is bumped by unrelated updates (e.g. image migrations).
 */
const wasCompositionChanged = (comboItems, orderCreatedAt) => {
  const orderTime = toTime(orderCreatedAt);
  if (orderTime === null) return false;
  return (comboItems || []).some((ci) => {
    const created = toTime(ci?.created_at);
    return created !== null && created > orderTime;
  });
};

/**
 * Build display lines for order items. Combo lines get `components` (current definition x line
 * quantity); every other line, and combos whose definition cannot be found, get `components: null`.
 *
 * @param {Array} items - order_items rows
 * @param {Map<string, object>} [comboDefinitions]
 * @param {{language?: 'es'|'en', orderCreatedAt?: string}} [options]
 * @returns {Array<{item: object, components: Array|null, compositionChanged: boolean}>}
 */
export const buildOrderItemLines = (items, comboDefinitions, { language = 'es', orderCreatedAt } = {}) =>
  (items || [])
    .filter(Boolean)
    .map((item) => {
      const definition = isComboItem(item) && item.item_id ? comboDefinitions?.get(item.item_id) : null;
      if (!definition) return { item, components: null, compositionChanged: false };

      const lineQuantity = toQuantity(item.quantity);
      const comboItems = definition.combo_items || [];
      return {
        item,
        components: comboItems.map((ci) => ({
          productId: ci.product_id,
          name: pickName(ci.products, language),
          quantity: toQuantity(ci.quantity) * lineQuantity
        })),
        compositionChanged: wasCompositionChanged(comboItems, orderCreatedAt)
      };
    });
