-- ============================================================================
-- Phase 0b, CONTRACT (B): hide cost and margin columns from anon and authenticated
-- ============================================================================
-- PREPARED, NOT APPLIED.  DO NOT APPLY BEFORE 48h OBSERVATION.
--
-- This file lives in supabase/contract/ ON PURPOSE (not in supabase/migrations/): `supabase db push` and the
-- test bootstrap replay everything in migrations/, and this file must only run after:
--   1. migration A (20261016160000_phase0b_admin_cost_read_rpcs.sql) is applied,
--   2. the admin front that reads costs through those RPCs is deployed,
--   3. an observation window of AT LEAST 48 hours shows no 42501 coming from the app (query_logs / the
--      SELECT-only probe) and no direct admin reads of the hidden columns.
-- Applying it is a separate step that needs the owner's explicit go-ahead. To apply, copy it into
-- supabase/migrations/ with a fresh timestamp (or run it with `supabase db query`) at that point.
--
-- Mechanism (verified in the harness, not assumed): a column-level REVOKE is a NO-OP while a table-level
-- SELECT grant exists, so each table is REVOKEd at table level (which also clears any column-level SELECT)
-- and then granted back column by column. The grant list is EVERY column of the table except the hidden
-- ones; it is a superset of PUBLIC_READABLE_COLUMNS (src/lib/publicCatalogColumns.js): the extra columns
-- (delivery_days, delivery_note, image_file, timestamps...) are not sensitive and the admin screens read them
-- directly. Columns added to these tables later are NOT readable until granted here (fail closed);
-- src/tests/unit/phase0bContractStatic.test.js and the harness drift test enforce the list.
--
-- Not touched: INSERT / UPDATE / DELETE privileges and every RLS policy. Admin writes stay direct under RLS and
-- must name their RETURNING columns (`RETURNING *` and an empty .select() now fail with 42501).
-- Cost and margin are readable by admins only through migration A's admin_list_* RPCs.
-- combo_items has no sensitive column and keeps its table-level SELECT.
--
-- Also closed here (no caller in src/ or supabase/functions/):
--   * view order_analytics (security_invoker; exposes shipping_zones.transport_cost joined to orders)
--   * table remittance_services (0 rows in production; has profit_margin and fees)
--
-- Production state this was written against (read-only, 2026-10-16): anon has SELECT, authenticated has
-- SELECT/INSERT/UPDATE/DELETE on products, combo_products, product_categories, inventory, shipping_zones;
-- order_analytics and remittance_services have SELECT for authenticated only; none is in supabase_realtime
-- (only orders and remittances are); no function, trigger or policy reads a hidden column as the caller.
--
-- ROLLBACK: supabase/rollbacks/20261016160100_phase0b_contract_revoke_cost_columns_down.sql (effective
-- immediately, no front revert needed, tested up/down/up by src/tests/concurrency/phase0bContract.test.js).
-- ============================================================================

-- products: hidden = base_price, cost_price, profit_margin
REVOKE SELECT ON public.products FROM anon, authenticated;
GRANT SELECT (
  id,
  sku,
  name_es,
  name_en,
  description_es,
  description_en,
  category_id,
  base_currency_id,
  final_price,
  weight,
  dimensions,
  image_url,
  image_file,
  requires_expiry,
  min_stock_alert,
  is_active,
  is_featured,
  tags,
  created_at,
  updated_at,
  unit
) ON public.products TO anon, authenticated;

-- combo_products: hidden = base_total_price, profit_margin
REVOKE SELECT ON public.combo_products FROM anon, authenticated;
GRANT SELECT (
  id,
  name_es,
  name_en,
  description_es,
  description_en,
  image_url,
  final_price,
  shipping_free,
  shipping_discount_percent,
  out_of_province_shipping,
  out_of_province_price,
  is_active,
  is_featured,
  created_at,
  updated_at
) ON public.combo_products TO anon, authenticated;

-- product_categories: hidden = profit_margin
REVOKE SELECT ON public.product_categories FROM anon, authenticated;
GRANT SELECT (
  id,
  name_es,
  name_en,
  description_es,
  description_en,
  parent_id,
  image_url,
  is_active,
  display_order,
  created_at,
  updated_at,
  slug
) ON public.product_categories TO anon, authenticated;

-- inventory: hidden = cost_per_unit, supplier_reference
REVOKE SELECT ON public.inventory FROM anon, authenticated;
GRANT SELECT (
  id,
  product_id,
  batch_number,
  quantity,
  reserved_quantity,
  expiry_date,
  received_date,
  notes,
  is_active,
  created_at,
  updated_at,
  available_quantity
) ON public.inventory TO anon, authenticated;

-- shipping_zones: hidden = transport_cost
REVOKE SELECT ON public.shipping_zones FROM anon, authenticated;
GRANT SELECT (
  id,
  province_name,
  municipality_name,
  shipping_cost,
  is_active,
  free_shipping,
  created_at,
  updated_at,
  delivery_days,
  delivery_note
) ON public.shipping_zones TO anon, authenticated;

REVOKE SELECT ON public.order_analytics FROM anon, authenticated;
REVOKE SELECT ON public.remittance_services FROM anon, authenticated;

NOTIFY pgrst, 'reload schema';
