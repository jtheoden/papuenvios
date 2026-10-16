/**
 * Column lists that include cost and margin data. ADMIN USE ONLY.
 *
 * These reads still go straight to the tables today. Phase 0b replaces them with
 * SECURITY DEFINER read RPCs guarded by is_admin_user() and then this module goes away.
 * Public code must import from publicCatalogColumns.js instead.
 */

import {
  PUBLIC_PRODUCT_COLUMNS,
  PUBLIC_COMBO_COLUMNS,
  PUBLIC_CATEGORY_COLUMNS
} from './publicCatalogColumns';

export const ADMIN_PRODUCT_COLUMNS = `${PUBLIC_PRODUCT_COLUMNS}, base_price, cost_price, profit_margin`;

export const ADMIN_COMBO_COLUMNS = `${PUBLIC_COMBO_COLUMNS}, base_total_price, profit_margin`;

export const ADMIN_CATEGORY_COLUMNS = `${PUBLIC_CATEGORY_COLUMNS}, profit_margin`;

export const ADMIN_COMBO_ITEM_COLUMNS = 'combo_id, quantity, products(id, name_es, name_en, base_price)';

/**
 * Admin edit forms must only be seeded from rows loaded through the admin view: a public row
 * has no cost fields, and saving a form built from it would overwrite them with defaults.
 */
export const hasAdminProductFields = (product) =>
  product?.base_price !== undefined && product?.base_price !== null;

export const hasAdminComboFields = (combo) =>
  combo?.baseTotalPrice !== undefined && combo?.baseTotalPrice !== null
  && combo?.profitMargin !== undefined && combo?.profitMargin !== null;
