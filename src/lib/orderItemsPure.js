/**
 * Order items display helpers (pure, no I/O).
 *
 * order_items stores a combo as ONE row (item_type 'combo'); its contents live in combo_items.
 * These helpers expand a combo row into its CURRENT components at read time, so they work for
 * historical orders without any data migration.
 */

const COMBO_TYPE = 'combo';

const PRODUCT_TYPE = 'product';

const isComboItem = (item) => item?.item_type === COMBO_TYPE;
const isProductItem = (item) => item?.item_type === PRODUCT_TYPE;

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

/**
 * Unique product ids of the plain product lines of the given orders (combos excluded: their
 * components get the unit from the combo definition query).
 * @param {Array<{order_items?: Array}>} orders
 * @returns {string[]}
 */
export const collectProductIds = (orders) => {
  const ids = new Set();
  (orders || []).forEach((order) => {
    (order?.order_items || []).forEach((item) => {
      if (isProductItem(item) && item.item_id) ids.add(item.item_id);
    });
  });
  return [...ids];
};

/**
 * Index `{id, unit}` product rows by id.
 * @param {Array|null} rows
 * @returns {Map<string, string|null>}
 */
export const toProductUnitMap = (rows) =>
  new Map((rows || []).filter((row) => row?.id).map((row) => [row.id, row.unit ?? null]));

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
 * @param {{language?: 'es'|'en', orderCreatedAt?: string, productUnits?: Map<string, string|null>}} [options]
 * @returns {Array<{item: object, unit: string|null, components: Array|null, compositionChanged: boolean}>}
 *   `unit` is the CURRENT unit of a plain product line (null for any other line or when unknown);
 *   components carry their own `unit`.
 */
export const buildOrderItemLines = (
  items,
  comboDefinitions,
  { language = 'es', orderCreatedAt, productUnits } = {}
) =>
  (items || [])
    .filter(Boolean)
    .map((item) => {
      const definition = isComboItem(item) && item.item_id ? comboDefinitions?.get(item.item_id) : null;
      if (!definition) {
        const unit = isProductItem(item) ? (productUnits?.get(item.item_id) ?? null) : null;
        return { item, unit, components: null, compositionChanged: false };
      }

      const lineQuantity = toQuantity(item.quantity);
      const comboItems = definition.combo_items || [];
      return {
        item,
        unit: null,
        components: comboItems.map((ci) => ({
          productId: ci.product_id,
          name: pickName(ci.products, language),
          quantity: toQuantity(ci.quantity) * lineQuantity,
          unit: ci.products?.unit ?? null
        })),
        compositionChanged: wasCompositionChanged(comboItems, orderCreatedAt)
      };
    });
