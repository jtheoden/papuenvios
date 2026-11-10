-- PREPARED, NOT APPLIED
-- Why: the owner buys in CUP and sells in USD. products.base_price (USD) is frozen at the rate of the day the
--   cost was typed, so when the informal USD->CUP rate moves, the margin erodes. The CUP cost is not stored anywhere.
-- Requires: 20261016160000_phase0b_admin_cost_read_rpcs.sql (admin_list_product_costs) and
--   20261105150000 (exchange_rates.rate_type). The migration raises a clear error if the RPC is missing.
-- What:
--   1. products.cost_cup numeric(14,2) NULL, CHECK products_cost_cup_positive_chk (> 0 and not NaN): the purchase cost
--      in CUP, the new source of truth for products.
--   2. Trigger products_cost_cup_sync (BEFORE UPDATE OF base_price): a direct base_price edit that does not also
--      change cost_cup sets cost_cup to NULL (the manual price wins; the product leaves the automatic repricing until a
--      new cost is typed). apply_catalog_reprice and the backfill set app.catalog_reprice = 'on' (transaction local)
--      so their own writes do not trigger it. Consequence for clients: a save that changes base_price must send a
--      different cost_cup to keep it; re-sending the same cost_cup with a new base_price clears it.
--   3. catalog_reprice_runs (one row per apply / backfill) and catalog_price_history (one row per changed item).
--      RLS: admins read, nobody writes directly (only the SECURITY DEFINER RPCs write).
--   4. preview_catalog_reprice(p_rate): STABLE, super_admin only, writes nothing.
--      apply_catalog_reprice(p_confirm_large, p_expected_rate): super_admin only (re-verified inside), serialized with
--      pg_advisory_xact_lock(hashtext('catalog_reprice')), writes prices + run + history in one transaction.
--   5. admin_list_product_costs now also returns cost_cup (id, base_price, profit_margin, cost_cup). The return type
--      changes, so it is DROP + CREATE inside this transaction; body, role check (42501), pagination, SECURITY DEFINER,
--      STABLE, search_path and grants (EXECUTE only authenticated) are exactly those of 20261016160000.
--   6. Idempotent backfill: for every USD product with cost_cup IS NULL, cost_cup := round(base_price * rate, 2)
--      (only base_price > 0; a base_price of 0 stays without cost) using the active USD->CUP rate. Skipped (no error) when there is no active pair. It records a run with status
--      'backfill' ONLY when it filled rows (a rerun with nothing to fill does not move the baseline).
-- Active rate: exchange_rates.rate of the active USD->CUP rows, choosing ORDER BY (rate_type = 'general') DESC NULLS
--   LAST, effective_date DESC, id LIMIT 1 (same rule as the courier functions); never market_rate, never the inverse
--   CUP->USD row. Several active rows are NOT an error. No active row => usd_cup_pair_not_found.
-- Products: new base_price = round(cost_cup / rate, 2) for USD products with cost_cup. If cost_cup > 0 but the result
--   rounds to 0.00 the product is skipped and reported in skipped_products (reason rounds_to_zero). final_price is the
--   generated column and follows.
-- Combos (redesigned): combo_products carry no cost. Real data showed combos whose base_total_price is 5-25 % above the
--   sum of their products, so recomputing from components would cut prices without any rate change. Instead EVERY combo
--   with base_total_price > 0 is scaled by the rate ratio: new = round(base_total_price * baseline_rate / new_rate, 2),
--   baseline_rate = the rate of the latest run (any status: applied, noop or backfill; a noop run still records the rate
--   at which the catalog was last reconciled). Same rate => ratio 1 => no change. No baseline => combos are not touched.
--   NOT path independent: every step rounds to cents, so 900 -> 850 -> 900 can leave a cent of drift on a combo.
--   Combos with total NULL/0, or whose result would round to 0, are skipped silently.
--   KNOWN LIMITATION (baseline): the baseline only moves when an apply/backfill runs. If the rate is saved without an
--   apply and a combo is then edited by hand at the new rate, the next apply still scales it by
--   baseline_rate / new_rate, i.e. it applies a correction the manual edit already included. Apply right after changing
--   the rate (the runbook explains it) and re-check hand-edited combos in the preview.
-- PRECISION: products.base_price / combo_products.base_total_price are numeric(15,2) (see
--   20241001000000_complete_schema.sql), so they cannot hold 4 decimals. base_price is rounded to cents; final_price can
--   differ by about 1 cent from the unrounded value (cost 2950, margin 45 %, rate 900: base 3.28 -> final 4.76, not
--   4.75). Widening the column would mean dropping/re-adding the generated final_price on live data: not done here.
-- BACKFILL ROUND TRIP: cost = round(base * rate, 2) then base' = round(cost / rate, 2). The cost rounding error is
--   <= 0.005 CUP, i.e. <= 0.005 / rate USD, strictly below half a cent for rate > 1, so base' = base exactly: with the
--   same rate apply changes no product and writes no history for it.
-- THRESHOLD: |rate - baseline| / baseline * 100 > 10 needs p_confirm_large = true. The baseline is the latest run of
--   catalog_reprice_runs. Because the backfill records the rate it used, the first apply after it compares against that
--   rate (variation 0). If there is no run at all (no backfill happened) the first apply ALWAYS needs p_confirm_large.
-- p_expected_rate: if given and |active rate - p_expected_rate| > 0.000001 the apply fails with rate_changed, so a
--   confirmation dialog built on a previewed rate cannot apply a different one.
-- CONCURRENCY: apply takes the advisory lock, locks (FOR UPDATE, ordered by id) the products with cost_cup and all combos,
--   then computes the plan ONCE into a temp table (ON COMMIT DROP) that feeds the run row, the history and both UPDATEs,
--   so the history describes exactly what was written and a concurrent edit cannot slip between plan and write.
-- AUDIT: runs + history are the audit trail (who, when, rate, old/new base per item); not editable through the API.
--   Existing orders / order_items keep their frozen amounts: nothing here touches them.
-- EXPOSURE: products has table-level SELECT for anon/authenticated until the phase0b contract
--   (supabase/contract/20261016160100_phase0b_contract_revoke_cost_columns.sql, prepared, not applied) is applied. Until
--   then cost_cup is readable by anon exactly like base_price, cost_price and profit_margin today. This does not worsen
--   the existing exposure (cost_cup is derived from base_price * rate and base_price is already public), and cost_cup is
--   listed as a hidden column in the contract: it is not in its grant list, so applying the contract hides it too.
-- Errors (the message is the stable code): forbidden (42501), invalid_rate (22023), usd_cup_pair_not_found (P0002),
--   rate_changed (P0001), large_rate_change_requires_confirmation (P0001).
-- preview_catalog_reprice(p_rate numeric DEFAULT NULL) -> jsonb { rate, previous_rate, pct_change, rate_pct_change
--   (same value as pct_change), requires_extra_confirmation, products_affected, combos_affected, skipped_products
--   [{id,name,reason}], avg_pct_change, max_abs_pct_change (products), combos_avg_pct_change,
--   combos_max_abs_pct_change, sample [{type,id,name,old_base,new_base}] (10 largest absolute changes) }
-- apply_catalog_reprice(p_confirm_large boolean DEFAULT false, p_expected_rate numeric DEFAULT NULL) -> jsonb
--   { run_id, rate, previous_rate, pct_change, rate_pct_change, products_updated, combos_updated, skipped_products }
-- Rollback: supabase/rollbacks/20261110100000_catalog_cost_cup_reprice_down.sql (does not touch prices; keeps a copy of
--   cost_cup in public.products_cost_cup_backup_20261110).

BEGIN;
SET LOCAL lock_timeout = '5s';

DO $precondition$
BEGIN
  IF to_regprocedure('public.admin_list_product_costs(integer,integer,uuid[])') IS NULL THEN
    RAISE EXCEPTION 'admin_list_product_costs(integer,integer,uuid[]) is missing: apply 20261016160000_phase0b_admin_cost_read_rpcs.sql first';
  END IF;
END
$precondition$;

-- 1. Column
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS cost_cup numeric(14,2);
-- Named and re-created so a rerun is idempotent. > 0 (a zero cost would make apply set the price to 0.00) and
-- < 'NaN' (in PostgreSQL NaN sorts above every number, so a plain >= 0 check lets it through).
ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_cost_cup_positive_chk;
ALTER TABLE public.products ADD CONSTRAINT products_cost_cup_positive_chk
  CHECK (cost_cup IS NULL OR (cost_cup > 0 AND cost_cup < 'NaN'::numeric));

-- 2. Sync trigger: a manual base_price edit voids the cost
CREATE OR REPLACE FUNCTION public.products_cost_cup_sync()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF NEW.base_price IS DISTINCT FROM OLD.base_price
     AND NEW.cost_cup IS NOT DISTINCT FROM OLD.cost_cup
     AND current_setting('app.catalog_reprice', true) IS DISTINCT FROM 'on' THEN
    NEW.cost_cup := NULL;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.products_cost_cup_sync() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS products_cost_cup_sync ON public.products;
CREATE TRIGGER products_cost_cup_sync
  BEFORE UPDATE OF base_price ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.products_cost_cup_sync();

-- 3. Tables
CREATE TABLE IF NOT EXISTS public.catalog_reprice_runs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rate             numeric(20,6) NOT NULL CHECK (rate > 0),
  previous_rate    numeric(20,6),
  pct_change       numeric(12,4),
  status           text NOT NULL CHECK (status IN ('applied', 'noop', 'backfill')),
  applied_by       uuid,
  applied_at       timestamptz NOT NULL DEFAULT clock_timestamp(),
  products_updated integer NOT NULL DEFAULT 0,
  combos_updated   integer NOT NULL DEFAULT 0,
  skipped_products jsonb NOT NULL DEFAULT '[]'::jsonb
);
CREATE INDEX IF NOT EXISTS catalog_reprice_runs_applied_at_idx ON public.catalog_reprice_runs (applied_at DESC);

CREATE TABLE IF NOT EXISTS public.catalog_price_history (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_id      uuid NOT NULL REFERENCES public.catalog_reprice_runs(id),
  entity_type text NOT NULL CHECK (entity_type IN ('product', 'combo')),
  entity_id   uuid NOT NULL,
  old_base    numeric(15,2) NOT NULL,
  new_base    numeric(15,2) NOT NULL,
  rate        numeric(20,6) NOT NULL
);
CREATE INDEX IF NOT EXISTS catalog_price_history_entity_idx ON public.catalog_price_history (entity_type, entity_id, id DESC);
CREATE INDEX IF NOT EXISTS catalog_price_history_run_idx ON public.catalog_price_history (run_id);

ALTER TABLE public.catalog_reprice_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalog_price_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS catalog_reprice_runs_select_admin ON public.catalog_reprice_runs;
CREATE POLICY catalog_reprice_runs_select_admin ON public.catalog_reprice_runs
  FOR SELECT USING ((SELECT public.is_admin_user()));
DROP POLICY IF EXISTS catalog_price_history_select_admin ON public.catalog_price_history;
CREATE POLICY catalog_price_history_select_admin ON public.catalog_price_history
  FOR SELECT USING ((SELECT public.is_admin_user()));

REVOKE ALL ON public.catalog_reprice_runs FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.catalog_price_history FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.catalog_reprice_runs TO authenticated;
GRANT SELECT ON public.catalog_price_history TO authenticated;

-- 4. Internal helpers (not callable by API roles)
-- A rate is usable when it is a finite number > 0 (text compare: numeric NaN/Infinity exist only on PG14+).
CREATE OR REPLACE FUNCTION public.catalog_reprice_rate_ok(p_rate numeric)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $function$
  SELECT p_rate IS NOT NULL AND p_rate::text NOT IN ('NaN', 'Infinity', '-Infinity') AND p_rate > 0;
$function$;

-- Active USD->CUP 'rate': general first, then the latest effective_date, then id.
CREATE OR REPLACE FUNCTION public.catalog_reprice_rate()
RETURNS numeric
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_rate numeric;
BEGIN
  SELECT er.rate INTO v_rate
  FROM exchange_rates er
  JOIN currencies f ON f.id = er.from_currency_id AND f.code = 'USD'
  JOIN currencies t ON t.id = er.to_currency_id AND t.code = 'CUP'
  WHERE er.is_active = true
  ORDER BY (er.rate_type = 'general') DESC NULLS LAST, er.effective_date DESC, er.id
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'usd_cup_pair_not_found' USING ERRCODE = 'P0002';
  END IF;
  RETURN v_rate;
END;
$function$;

-- Items whose price would change at p_rate, plus skipped products. Combos are scaled by p_prev / p_rate (p_prev NULL => none).
DROP FUNCTION IF EXISTS public.catalog_reprice_plan(numeric);
CREATE OR REPLACE FUNCTION public.catalog_reprice_plan(p_rate numeric, p_prev numeric)
RETURNS TABLE (entity_type text, entity_id uuid, entity_name text, old_base numeric, new_base numeric, skip_reason text)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $function$
  WITH prod AS (
    SELECT p.id, p.name_es, p.base_price, p.cost_cup, round(p.cost_cup / p_rate, 2) AS new_base
    FROM products p
    WHERE p.cost_cup IS NOT NULL AND p.base_currency_id IN (SELECT id FROM currencies WHERE code = 'USD')
  ),
  combo AS (
    SELECT c.id, c.name_es, c.base_total_price AS old_total, round(c.base_total_price * p_prev / p_rate, 2) AS new_total
    FROM combo_products c
    WHERE p_prev IS NOT NULL AND c.base_total_price > 0
  )
  SELECT 'product'::text, id, name_es, base_price, new_base, NULL::text FROM prod
    WHERE new_base IS DISTINCT FROM base_price AND NOT (cost_cup > 0 AND new_base = 0)
  UNION ALL
  SELECT 'product'::text, id, name_es, base_price, NULL::numeric, 'rounds_to_zero'::text FROM prod
    WHERE cost_cup > 0 AND new_base = 0 AND base_price <> 0
  UNION ALL
  SELECT 'combo'::text, id, name_es, old_total, new_total, NULL::text FROM combo
    WHERE new_total IS DISTINCT FROM old_total AND new_total > 0;
$function$;

REVOKE ALL ON FUNCTION public.catalog_reprice_rate_ok(numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.catalog_reprice_rate() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.catalog_reprice_plan(numeric, numeric) FROM PUBLIC, anon, authenticated;

-- 5. preview_catalog_reprice
CREATE OR REPLACE FUNCTION public.preview_catalog_reprice(p_rate numeric DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_rate numeric;
  v_prev numeric;
  v_pct  numeric;
  v_res  jsonb;
BEGIN
  IF NOT (SELECT public.is_super_admin()) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF p_rate IS NOT NULL AND NOT public.catalog_reprice_rate_ok(p_rate) THEN
    RAISE EXCEPTION 'invalid_rate' USING ERRCODE = '22023';
  END IF;
  v_rate := COALESCE(p_rate, public.catalog_reprice_rate());
  IF NOT public.catalog_reprice_rate_ok(v_rate) THEN
    RAISE EXCEPTION 'invalid_rate' USING ERRCODE = '22023';
  END IF;

  SELECT rate INTO v_prev FROM catalog_reprice_runs ORDER BY applied_at DESC LIMIT 1;
  v_pct := CASE WHEN v_prev IS NULL THEN NULL ELSE round((v_rate - v_prev) / v_prev * 100, 4) END;

  SELECT jsonb_build_object(
    'rate', v_rate,
    'previous_rate', v_prev,
    'pct_change', v_pct,
    'rate_pct_change', v_pct,
    'requires_extra_confirmation', (v_prev IS NULL OR abs(v_pct) > 10),
    'products_affected', count(*) FILTER (WHERE entity_type = 'product' AND new_base IS NOT NULL),
    'combos_affected', count(*) FILTER (WHERE entity_type = 'combo'),
    'skipped_products', COALESCE(jsonb_agg(jsonb_build_object('id', entity_id, 'name', entity_name, 'reason', skip_reason))
                                 FILTER (WHERE skip_reason IS NOT NULL), '[]'::jsonb),
    'avg_pct_change', round(avg((new_base - old_base) / NULLIF(old_base, 0) * 100)
                            FILTER (WHERE entity_type = 'product' AND new_base IS NOT NULL), 4),
    'max_abs_pct_change', round(max(abs((new_base - old_base) / NULLIF(old_base, 0) * 100))
                                FILTER (WHERE entity_type = 'product' AND new_base IS NOT NULL), 4),
    'combos_avg_pct_change', round(avg((new_base - old_base) / NULLIF(old_base, 0) * 100) FILTER (WHERE entity_type = 'combo'), 4),
    'combos_max_abs_pct_change', round(max(abs((new_base - old_base) / NULLIF(old_base, 0) * 100)) FILTER (WHERE entity_type = 'combo'), 4),
    'sample', COALESCE((SELECT jsonb_agg(jsonb_build_object('type', s.entity_type, 'id', s.entity_id, 'name', s.entity_name,
                                                            'old_base', s.old_base, 'new_base', s.new_base))
                        FROM (SELECT * FROM catalog_reprice_plan(v_rate, v_prev) WHERE new_base IS NOT NULL
                              ORDER BY abs(new_base - old_base) DESC, entity_id LIMIT 10) s), '[]'::jsonb)
  ) INTO v_res
  FROM catalog_reprice_plan(v_rate, v_prev);

  RETURN v_res;
END;
$function$;

-- 6. apply_catalog_reprice (the old one-argument overload is dropped: a single signature)
DROP FUNCTION IF EXISTS public.apply_catalog_reprice(boolean);
CREATE OR REPLACE FUNCTION public.apply_catalog_reprice(p_confirm_large boolean DEFAULT false, p_expected_rate numeric DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_rate    numeric;
  v_prev    numeric;
  v_pct     numeric;
  v_run     uuid;
  v_prods   integer;
  v_combos  integer;
  v_skipped jsonb;
BEGIN
  IF NOT (SELECT public.is_super_admin()) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('catalog_reprice'));

  v_rate := public.catalog_reprice_rate();
  IF NOT public.catalog_reprice_rate_ok(v_rate) THEN
    RAISE EXCEPTION 'invalid_rate' USING ERRCODE = '22023';
  END IF;
  IF p_expected_rate IS NOT NULL AND abs(v_rate - p_expected_rate) > 0.000001 THEN
    RAISE EXCEPTION 'rate_changed' USING ERRCODE = 'P0001';
  END IF;

  SELECT rate INTO v_prev FROM catalog_reprice_runs ORDER BY applied_at DESC LIMIT 1;
  v_pct := CASE WHEN v_prev IS NULL THEN NULL ELSE round((v_rate - v_prev) / v_prev * 100, 4) END;

  IF (v_prev IS NULL OR abs(v_pct) > 10) AND NOT COALESCE(p_confirm_large, false) THEN
    RAISE EXCEPTION 'large_rate_change_requires_confirmation';
  END IF;

  -- Lock what we are about to rewrite (stable order), then plan once.
  PERFORM 1 FROM products WHERE cost_cup IS NOT NULL ORDER BY id FOR UPDATE;
  PERFORM 1 FROM combo_products ORDER BY id FOR UPDATE;

  DROP TABLE IF EXISTS pg_temp.catalog_reprice_plan_tmp;
  CREATE TEMP TABLE catalog_reprice_plan_tmp ON COMMIT DROP AS
    SELECT * FROM catalog_reprice_plan(v_rate, v_prev);

  PERFORM set_config('app.catalog_reprice', 'on', true);

  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', entity_id, 'name', entity_name, 'reason', skip_reason)), '[]'::jsonb)
    INTO v_skipped FROM pg_temp.catalog_reprice_plan_tmp WHERE skip_reason IS NOT NULL;

  INSERT INTO catalog_reprice_runs (rate, previous_rate, pct_change, status, applied_by, skipped_products)
  VALUES (v_rate, v_prev, v_pct, 'applied', auth.uid(), v_skipped)
  RETURNING id INTO v_run;

  INSERT INTO catalog_price_history (run_id, entity_type, entity_id, old_base, new_base, rate)
  SELECT v_run, entity_type, entity_id, old_base, new_base, v_rate
  FROM pg_temp.catalog_reprice_plan_tmp WHERE new_base IS NOT NULL;

  UPDATE products p SET base_price = pl.new_base, updated_at = now()
  FROM pg_temp.catalog_reprice_plan_tmp pl
  WHERE pl.entity_type = 'product' AND pl.new_base IS NOT NULL AND pl.entity_id = p.id;
  GET DIAGNOSTICS v_prods = ROW_COUNT;

  UPDATE combo_products c SET base_total_price = pl.new_base, updated_at = now()
  FROM pg_temp.catalog_reprice_plan_tmp pl
  WHERE pl.entity_type = 'combo' AND pl.new_base IS NOT NULL AND pl.entity_id = c.id;
  GET DIAGNOSTICS v_combos = ROW_COUNT;

  PERFORM set_config('app.catalog_reprice', 'off', true);

  UPDATE catalog_reprice_runs
  SET products_updated = v_prods, combos_updated = v_combos,
      status = CASE WHEN v_prods + v_combos = 0 THEN 'noop' ELSE 'applied' END
  WHERE id = v_run;

  RETURN jsonb_build_object('run_id', v_run, 'rate', v_rate, 'previous_rate', v_prev, 'pct_change', v_pct,
                            'rate_pct_change', v_pct, 'products_updated', v_prods, 'combos_updated', v_combos,
                            'skipped_products', v_skipped);
END;
$function$;

REVOKE ALL ON FUNCTION public.preview_catalog_reprice(numeric) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.apply_catalog_reprice(boolean, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.preview_catalog_reprice(numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.apply_catalog_reprice(boolean, numeric) TO authenticated;

-- 7. admin_list_product_costs with cost_cup (return type change => DROP + CREATE)
DROP FUNCTION IF EXISTS public.admin_list_product_costs(integer, integer, uuid[]);
CREATE FUNCTION public.admin_list_product_costs(
  p_limit integer DEFAULT 500,
  p_offset integer DEFAULT 0,
  p_ids uuid[] DEFAULT NULL
)
RETURNS TABLE (id uuid, base_price numeric, profit_margin numeric, cost_cup numeric)
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
    SELECT p.id, p.base_price, p.profit_margin, p.cost_cup
      FROM public.products p
     WHERE p_ids IS NULL OR p.id = ANY (p_ids)
     ORDER BY p.id
     LIMIT v_limit OFFSET p_offset;
END;
$fn$;

REVOKE ALL ON FUNCTION public.admin_list_product_costs(integer, integer, uuid[]) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_list_product_costs(integer, integer, uuid[]) TO authenticated;

-- 8. Idempotent backfill: the current USD price becomes the initial CUP cost
DO $backfill$
DECLARE
  v_rate numeric;
  v_n    integer;
BEGIN
  SELECT er.rate INTO v_rate
  FROM public.exchange_rates er
  JOIN public.currencies f ON f.id = er.from_currency_id AND f.code = 'USD'
  JOIN public.currencies t ON t.id = er.to_currency_id AND t.code = 'CUP'
  WHERE er.is_active = true
  ORDER BY (er.rate_type = 'general') DESC NULLS LAST, er.effective_date DESC, er.id
  LIMIT 1;

  IF NOT public.catalog_reprice_rate_ok(v_rate) THEN
    RAISE NOTICE 'catalog cost_cup backfill skipped: no usable active USD->CUP rate';
    RETURN;
  END IF;

  PERFORM set_config('app.catalog_reprice', 'on', true);
  WITH filled AS (
    UPDATE public.products p
    SET cost_cup = round(p.base_price * v_rate, 2)
    WHERE p.cost_cup IS NULL
      AND p.base_price > 0
      AND round(p.base_price * v_rate, 2) > 0
      AND p.base_currency_id = (SELECT id FROM public.currencies WHERE code = 'USD')
    RETURNING 1
  )
  SELECT count(*) INTO v_n FROM filled;
  PERFORM set_config('app.catalog_reprice', 'off', true);

  IF v_n > 0 THEN
    INSERT INTO public.catalog_reprice_runs (rate, status, products_updated)
    VALUES (v_rate, 'backfill', v_n);
  END IF;
END
$backfill$;

NOTIFY pgrst, 'reload schema';

COMMIT;
