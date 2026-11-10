/**
 * Admin-side catalog helpers.
 *
 * Cost and margin columns are NOT listed here any more: admin reads get them from the admin_list_* RPCs
 * (src/lib/adminCostService.js, migration 20261016160000) and merge them onto the public rows. What stays:
 *  - the non-sensitive extra shipping columns the admin settings screen edits, and
 *  - the guards that keep an admin edit form from being seeded with a row that lacks the cost fields.
 */

// Every shipping_zones column except transport_cost (read through the RPC). The admin screen edits
// delivery_days and delivery_note, which the public projection leaves out.
export const ADMIN_SHIPPING_COLUMNS = [
  'id', 'province_name', 'municipality_name', 'shipping_cost', 'is_active', 'free_shipping',
  'created_at', 'updated_at', 'delivery_days', 'delivery_note'
].join(', ');

/**
 * Admin edit forms must only be seeded from rows loaded through the admin view: a public row
 * has no cost fields, and saving a form built from it would overwrite them with defaults.
 */
export const hasAdminProductFields = (product) =>
  product?.base_price !== undefined && product?.base_price !== null;

export const hasAdminComboFields = (combo) =>
  combo?.baseTotalPrice !== undefined && combo?.baseTotalPrice !== null
  && combo?.profitMargin !== undefined && combo?.profitMargin !== null;
