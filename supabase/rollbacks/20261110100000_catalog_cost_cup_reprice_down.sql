-- PREPARED, NOT APPLIED
-- Why/what: remove everything created by 20261110100000_catalog_cost_cup_reprice.sql: the RPCs, the helper
-- functions, the run/history tables and products.cost_cup. Prices (products.base_price, combo_products.
-- base_total_price) are NOT touched: whatever the last apply wrote stays. Restores the 3-column
-- admin_list_product_costs. The cost_cup values are first copied to public.products_cost_cup_backup_20261110
-- (id, cost_cup; not readable by API roles) before the column is dropped. The reprice history/runs are DESTROYED:
-- export them first if they are needed.

BEGIN;
SET LOCAL lock_timeout = '5s';

-- Keep the costs (the column is about to be dropped).
DO $backup$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'products' AND column_name = 'cost_cup') THEN
    EXECUTE 'CREATE TABLE IF NOT EXISTS public.products_cost_cup_backup_20261110 AS
             SELECT id, cost_cup FROM public.products WHERE cost_cup IS NOT NULL';
    EXECUTE 'ALTER TABLE public.products_cost_cup_backup_20261110 ENABLE ROW LEVEL SECURITY';
    EXECUTE 'REVOKE ALL ON public.products_cost_cup_backup_20261110 FROM PUBLIC, anon, authenticated';
  END IF;
END
$backup$;

DROP TRIGGER IF EXISTS products_cost_cup_sync ON public.products;
DROP FUNCTION IF EXISTS public.products_cost_cup_sync();

-- admin_list_product_costs goes back to the 3-column signature of 20261016160000 (same body and grants).
DROP FUNCTION IF EXISTS public.admin_list_product_costs(integer, integer, uuid[]);
CREATE FUNCTION public.admin_list_product_costs(
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

DROP FUNCTION IF EXISTS public.apply_catalog_reprice(boolean, numeric);
DROP FUNCTION IF EXISTS public.apply_catalog_reprice(boolean);
DROP FUNCTION IF EXISTS public.preview_catalog_reprice(numeric);
DROP FUNCTION IF EXISTS public.catalog_reprice_plan(numeric, numeric);
DROP FUNCTION IF EXISTS public.catalog_reprice_plan(numeric);
DROP FUNCTION IF EXISTS public.catalog_reprice_rate();
DROP FUNCTION IF EXISTS public.catalog_reprice_rate_ok(numeric);

DROP TABLE IF EXISTS public.catalog_price_history;
DROP TABLE IF EXISTS public.catalog_reprice_runs;

ALTER TABLE public.products DROP COLUMN IF EXISTS cost_cup;

NOTIFY pgrst, 'reload schema';

COMMIT;
