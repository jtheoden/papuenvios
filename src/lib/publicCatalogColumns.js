/**
 * Explicit column lists for everything the public catalog path (anon + customer) may read.
 *
 * Cost and margin columns are deliberately absent. Never replace a list with `*` or an
 * empty `.select()`: once column privileges are tightened a wildcard fails for the whole
 * table (42501). New public columns must be added here on purpose.
 */

const join = (columns) => columns.join(', ');

// image_file is left out on purpose: byte-identical copy of the base64 image_url.
export const PUBLIC_PRODUCT_COLUMNS = join([
  'id', 'sku', 'name_es', 'name_en', 'description_es', 'description_en',
  'category_id', 'base_currency_id', 'final_price', 'weight', 'unit', 'dimensions', 'image_url',
  'requires_expiry', 'is_active', 'is_featured', 'tags',
  'created_at', 'updated_at'
]);

export const PUBLIC_COMBO_COLUMNS = join([
  'id', 'name_es', 'name_en', 'description_es', 'description_en', 'image_url',
  'final_price', 'shipping_free', 'shipping_discount_percent', 'out_of_province_shipping',
  'out_of_province_price', 'is_active', 'is_featured', 'created_at', 'updated_at'
]);

export const PUBLIC_CATEGORY_COLUMNS = join([
  'id', 'slug', 'name_es', 'name_en', 'description_es', 'description_en',
  'display_order', 'is_active'
]);

export const PUBLIC_INVENTORY_COLUMNS = join([
  'product_id', 'quantity', 'available_quantity', 'expiry_date'
]);

export const PUBLIC_SHIPPING_COLUMNS = join([
  'id', 'province_name', 'municipality_name', 'shipping_cost', 'free_shipping', 'is_active'
]);

// Components of a combo as the public catalog shows them (name only, never a price).
export const PUBLIC_COMBO_ITEM_COLUMNS = 'combo_id, quantity, products(id, name_es, name_en)';

export const PUBLIC_PRODUCT_CATEGORY_EMBED = 'category:product_categories(id, name_es, name_en, slug)';

const split = (list) => list.split(',').map((column) => column.trim());

/**
 * Every column the public queries touch per table: selected, embedded, filtered or ordered.
 * PostgREST needs SELECT on all of them, so this is the exact input for a column-level grant
 * (a list built from the select constants alone would miss the inventory filter and order).
 */
export const PUBLIC_READABLE_COLUMNS = {
  products: split(PUBLIC_PRODUCT_COLUMNS),
  combo_products: split(PUBLIC_COMBO_COLUMNS),
  // product_id and created_at are read by the order views (orderComboService embeds combo_items).
  combo_items: ['combo_id', 'product_id', 'quantity', 'created_at'],
  product_categories: split(PUBLIC_CATEGORY_COLUMNS),
  inventory: [...split(PUBLIC_INVENTORY_COLUMNS), 'is_active', 'created_at'],
  shipping_zones: split(PUBLIC_SHIPPING_COLUMNS)
};
