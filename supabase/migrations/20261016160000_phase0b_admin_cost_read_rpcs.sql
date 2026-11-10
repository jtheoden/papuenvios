-- ============================================================================
-- Phase 0b, migration A (EXPAND): admin-only READ RPCs for cost and margin data
-- ============================================================================
-- PREPARED, NOT APPLIED to the hosted project. Applying it to production is a separate action that needs the
-- owner's explicit go-ahead. Deploy order: THIS FILE -> admin front -> observation window (>= 48 h, no 42501) ->
-- contract file (supabase/contract/20261016160100_phase0b_contract_revoke_cost_columns.sql, NOT in this folder).
--
-- Why RPCs: admin and customer share the `authenticated` database role, so a column privilege cannot tell them
-- apart. Cost and margin columns can only be read by an admin through SECURITY DEFINER functions that re-check
-- the role INSIDE the body.
--
-- Verified against production on 2026-10-16 (read-only SELECTs):
--   * roles in user_profiles: user, admin, super_admin (a `manager` value is allowed by the CHECK but has 0 rows
--     and is_admin_user() does not accept it). There is NO vendor-without-admin role: the vendor screens are
--     admin screens, so admin + super_admin are the only callers.
--   * 53 products, 16 combos, 11 categories, 53 inventory rows, 26 shipping zones: every list fits in one page.
--   * products.cost_price is NULL in all 53 rows and no source file reads or writes it -> not returned.
--
-- Functions (all STABLE, SECURITY DEFINER, SET search_path = public, pg_temp, EXECUTE only for `authenticated`):
--   admin_list_product_costs(p_limit, p_offset, p_ids)         -> id, base_price, profit_margin
--   admin_list_combo_costs(p_limit, p_offset, p_ids)           -> id, base_total_price, profit_margin
--   admin_list_category_margins(p_limit, p_offset, p_ids)      -> id, profit_margin
--   admin_list_inventory_costs(p_limit, p_offset, p_ids)       -> id, product_id, cost_per_unit, supplier_reference
--   admin_list_shipping_zone_costs(p_limit, p_offset, p_ids)   -> id, transport_cost
--
-- Contract shared by all five:
--   * Role check first: auth.uid() NOT NULL and (is_admin_user() OR is_super_admin()), else ERRCODE 42501 with a
--     generic message that never echoes a value.
--   * p_limit 1..1000 (above 1000 is clamped), p_offset >= 0, otherwise ERRCODE 22023.
--   * p_ids: NULL = every row, an array = only those ids (an EMPTY array returns nothing), at most 1000 ids.
--   * Order is by id, so pages are deterministic even when rows share created_at.
--   * Only the cost columns plus the key are returned; the rest of the row is still read straight from the table.
--
-- Nothing here changes a table, a grant on a table, a policy or an existing function. Re-runnable
-- (CREATE OR REPLACE + idempotent REVOKE/GRANT).
--
-- ROLLBACK (exact; also available as supabase/rollbacks/20261016160000_phase0b_admin_cost_read_rpcs_down.sql):
--   DROP FUNCTION IF EXISTS public.admin_list_product_costs(integer, integer, uuid[]);
--   DROP FUNCTION IF EXISTS public.admin_list_combo_costs(integer, integer, uuid[]);
--   DROP FUNCTION IF EXISTS public.admin_list_category_margins(integer, integer, uuid[]);
--   DROP FUNCTION IF EXISTS public.admin_list_inventory_costs(integer, integer, uuid[]);
--   DROP FUNCTION IF EXISTS public.admin_list_shipping_zone_costs(integer, integer, uuid[]);
--   NOTIFY pgrst, 'reload schema';
-- ============================================================================

-- products.base_price and products.profit_margin (cost_price is deliberately NOT returned: it is NULL in all 53 production rows and nothing in the app reads or writes it)
CREATE OR REPLACE FUNCTION public.admin_list_product_costs(
  p_limit integer DEFAULT 500,
  p_offset integer DEFAULT 0,
  p_ids uuid[] DEFAULT NULL
)
RETURNS TABLE (id uuid, base_price numeric, profit_margin numeric)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_limit integer;
BEGIN
  IF auth.uid() IS NULL OR NOT (public.is_admin_user() OR public.is_super_admin()) THEN
    RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE = '42501';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_offset IS NULL OR p_offset < 0 THEN
    RAISE EXCEPTION 'invalid_pagination' USING ERRCODE = '22023';
  END IF;
  IF p_ids IS NOT NULL AND cardinality(p_ids) > 1000 THEN
    RAISE EXCEPTION 'too_many_ids' USING ERRCODE = '22023';
  END IF;
  v_limit := LEAST(p_limit, 1000);

  RETURN QUERY
    SELECT p.id, p.base_price, p.profit_margin
      FROM public.products p
     WHERE p_ids IS NULL OR p.id = ANY (p_ids)
     ORDER BY p.id
     LIMIT v_limit OFFSET p_offset;
END;
$fn$;

REVOKE ALL ON FUNCTION public.admin_list_product_costs(integer, integer, uuid[]) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_list_product_costs(integer, integer, uuid[]) TO authenticated;

-- combo_products.base_total_price and combo_products.profit_margin
CREATE OR REPLACE FUNCTION public.admin_list_combo_costs(
  p_limit integer DEFAULT 500,
  p_offset integer DEFAULT 0,
  p_ids uuid[] DEFAULT NULL
)
RETURNS TABLE (id uuid, base_total_price numeric, profit_margin numeric)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_limit integer;
BEGIN
  IF auth.uid() IS NULL OR NOT (public.is_admin_user() OR public.is_super_admin()) THEN
    RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE = '42501';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_offset IS NULL OR p_offset < 0 THEN
    RAISE EXCEPTION 'invalid_pagination' USING ERRCODE = '22023';
  END IF;
  IF p_ids IS NOT NULL AND cardinality(p_ids) > 1000 THEN
    RAISE EXCEPTION 'too_many_ids' USING ERRCODE = '22023';
  END IF;
  v_limit := LEAST(p_limit, 1000);

  RETURN QUERY
    SELECT c.id, c.base_total_price, c.profit_margin
      FROM public.combo_products c
     WHERE p_ids IS NULL OR c.id = ANY (p_ids)
     ORDER BY c.id
     LIMIT v_limit OFFSET p_offset;
END;
$fn$;

REVOKE ALL ON FUNCTION public.admin_list_combo_costs(integer, integer, uuid[]) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_list_combo_costs(integer, integer, uuid[]) TO authenticated;

-- product_categories.profit_margin
CREATE OR REPLACE FUNCTION public.admin_list_category_margins(
  p_limit integer DEFAULT 500,
  p_offset integer DEFAULT 0,
  p_ids uuid[] DEFAULT NULL
)
RETURNS TABLE (id uuid, profit_margin numeric)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_limit integer;
BEGIN
  IF auth.uid() IS NULL OR NOT (public.is_admin_user() OR public.is_super_admin()) THEN
    RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE = '42501';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_offset IS NULL OR p_offset < 0 THEN
    RAISE EXCEPTION 'invalid_pagination' USING ERRCODE = '22023';
  END IF;
  IF p_ids IS NOT NULL AND cardinality(p_ids) > 1000 THEN
    RAISE EXCEPTION 'too_many_ids' USING ERRCODE = '22023';
  END IF;
  v_limit := LEAST(p_limit, 1000);

  RETURN QUERY
    SELECT k.id, k.profit_margin
      FROM public.product_categories k
     WHERE p_ids IS NULL OR k.id = ANY (p_ids)
     ORDER BY k.id
     LIMIT v_limit OFFSET p_offset;
END;
$fn$;

REVOKE ALL ON FUNCTION public.admin_list_category_margins(integer, integer, uuid[]) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_list_category_margins(integer, integer, uuid[]) TO authenticated;

-- inventory.cost_per_unit and inventory.supplier_reference (no screen reads them today; this is the only admin path once they are hidden)
CREATE OR REPLACE FUNCTION public.admin_list_inventory_costs(
  p_limit integer DEFAULT 500,
  p_offset integer DEFAULT 0,
  p_ids uuid[] DEFAULT NULL
)
RETURNS TABLE (id uuid, product_id uuid, cost_per_unit numeric, supplier_reference text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_limit integer;
BEGIN
  IF auth.uid() IS NULL OR NOT (public.is_admin_user() OR public.is_super_admin()) THEN
    RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE = '42501';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_offset IS NULL OR p_offset < 0 THEN
    RAISE EXCEPTION 'invalid_pagination' USING ERRCODE = '22023';
  END IF;
  IF p_ids IS NOT NULL AND cardinality(p_ids) > 1000 THEN
    RAISE EXCEPTION 'too_many_ids' USING ERRCODE = '22023';
  END IF;
  v_limit := LEAST(p_limit, 1000);

  RETURN QUERY
    SELECT i.id, i.product_id, i.cost_per_unit, i.supplier_reference
      FROM public.inventory i
     WHERE p_ids IS NULL OR i.id = ANY (p_ids)
     ORDER BY i.id
     LIMIT v_limit OFFSET p_offset;
END;
$fn$;

REVOKE ALL ON FUNCTION public.admin_list_inventory_costs(integer, integer, uuid[]) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_list_inventory_costs(integer, integer, uuid[]) TO authenticated;

-- shipping_zones.transport_cost
CREATE OR REPLACE FUNCTION public.admin_list_shipping_zone_costs(
  p_limit integer DEFAULT 500,
  p_offset integer DEFAULT 0,
  p_ids uuid[] DEFAULT NULL
)
RETURNS TABLE (id uuid, transport_cost numeric)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_limit integer;
BEGIN
  IF auth.uid() IS NULL OR NOT (public.is_admin_user() OR public.is_super_admin()) THEN
    RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE = '42501';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_offset IS NULL OR p_offset < 0 THEN
    RAISE EXCEPTION 'invalid_pagination' USING ERRCODE = '22023';
  END IF;
  IF p_ids IS NOT NULL AND cardinality(p_ids) > 1000 THEN
    RAISE EXCEPTION 'too_many_ids' USING ERRCODE = '22023';
  END IF;
  v_limit := LEAST(p_limit, 1000);

  RETURN QUERY
    SELECT z.id, z.transport_cost
      FROM public.shipping_zones z
     WHERE p_ids IS NULL OR z.id = ANY (p_ids)
     ORDER BY z.id
     LIMIT v_limit OFFSET p_offset;
END;
$fn$;

REVOKE ALL ON FUNCTION public.admin_list_shipping_zone_costs(integer, integer, uuid[]) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_list_shipping_zone_costs(integer, integer, uuid[]) TO authenticated;

NOTIFY pgrst, 'reload schema';
