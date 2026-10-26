-- ============================================================================
-- Courier management, M2: delivery assignment, accruals, delivery trigger, effective cost.   PREPARED, NOT APPLIED
-- ============================================================================
-- WHY: see .claude/docs/plan_courier-management-module.md (phase 1, M2). Every delivered remittance / order must leave ONE
--   frozen accrual (what the delivery costs), computed with the rule in force at delivery time. OWNER RULE: no value is
--   seeded; with no applicable rule the accrual is written with amount NULL ("unknown", never 0).
-- WHAT:
--   1. delivery_assignments: which registered courier delivers an operation (optional; set BEFORE delivery, by RPC).
--   2. courier_accruals: one 'delivery' row per operation (unique) + signed 'adjustment' rows. Amount in CUP, the rate
--      used and the USD figure are stored: nothing is recalculated afterwards. rule_snapshot freezes the rule and the
--      inputs. margin_usd / margin_pct / margin_status are persisted from _operation_margin at accrual time.
--      order_id / remittance_id are real FKs with ON DELETE CASCADE (execute_platform_reset deletes both tables).
--   3. AFTER UPDATE OF status triggers on orders and remittances (WHEN status becomes 'delivered'). They NEVER block the
--      delivery: any error becomes a WARNING. _order_transition / _remittance_transition are NOT touched.
--   4. Conversion CUP -> USD: remittances delivered in CUP use the remittance's own frozen exchange_rate (the rate that
--      produced amount_to_deliver); orders (and remittances not delivered in CUP) use the active USD->CUP exchange_rates
--      row. No rate => amount_usd NULL (unknown), amount_cup is still stored.
--   5. v_effective_courier_cost: ONE cost per operation = the non-void accrual when its amount is known, else the legacy
--      zone snapshot (order_courier_costs / remittance_courier_costs) flagged as an estimate. Never both.
--   6. RPCs (admin, role re-verified, audited): admin_assign_delivery_courier, admin_void_accrual (a PAID accrual: only
--      super_admin), admin_adjust_accrual (only on a PAID accrual, only super_admin), admin_reassign_accrual,
--      admin_recalculate_accrual (ONLY a 'calculated' accrual whose amount is still unknown (NULL); a known amount is never
--      overwritten), admin_list_deliveries_without_accrual, admin_backfill_missing_accruals (idempotent, requires a start
--      date, marked source 'late'). BOTH the recalculation and the backfill use the rule and the exchange rate in force
--      NOW, not those of the delivery date (documented limit: they exist to fill gaps, not to re-price history).
-- MARGIN OF ORDERS: the order profit is computed in the app (JS) from product costs, it is not stored; the SQL flag of an
--   order accrual is therefore 'unknown' in phase 1 (never invented).
-- SECURITY: RLS admin-read only, REVOKE ALL from PUBLIC/anon/authenticated/service_role, no column added to orders /
--   remittances, the customer reads nothing.
-- Apply order: M1 -> M2 -> M3. Requires M1 first. Rollback order: M3 -> M2 -> M1.
-- ROLLBACK: supabase/rollbacks/20261031110000_delivery_assignments_and_accruals_down.sql
-- ============================================================================

BEGIN;

SET LOCAL lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.delivery_assignments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id      uuid REFERENCES public.orders(id) ON DELETE CASCADE,
  remittance_id uuid REFERENCES public.remittances(id) ON DELETE CASCADE,
  courier_id    uuid NOT NULL REFERENCES public.couriers(id) ON DELETE RESTRICT,
  assigned_by   uuid,
  assigned_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT delivery_assignments_one_operation_chk CHECK ((order_id IS NULL) <> (remittance_id IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS delivery_assignments_order_uniq ON public.delivery_assignments (order_id) WHERE order_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS delivery_assignments_remittance_uniq ON public.delivery_assignments (remittance_id) WHERE remittance_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS delivery_assignments_courier_idx ON public.delivery_assignments (courier_id);

CREATE TABLE IF NOT EXISTS public.courier_accruals (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id           uuid REFERENCES public.orders(id) ON DELETE CASCADE,
  remittance_id      uuid REFERENCES public.remittances(id) ON DELETE CASCADE,
  source_kind        text GENERATED ALWAYS AS (CASE WHEN order_id IS NOT NULL THEN 'order' ELSE 'remittance' END) STORED,
  source_id          uuid GENERATED ALWAYS AS (COALESCE(order_id, remittance_id)) STORED,
  component          text NOT NULL DEFAULT 'delivery' CHECK (component IN ('delivery', 'adjustment')),
  adjusts_accrual_id uuid REFERENCES public.courier_accruals(id) ON DELETE CASCADE,
  courier_id         uuid REFERENCES public.couriers(id) ON DELETE RESTRICT,
  rule_id            uuid REFERENCES public.messenger_payment_types(id) ON DELETE RESTRICT,
  rule_snapshot      jsonb NOT NULL,
  amount_cup         numeric(12,2),
  fx_used            numeric(15,6) CHECK (fx_used IS NULL OR fx_used > 0),
  amount_usd         numeric(12,2),
  status             text NOT NULL DEFAULT 'calculated' CHECK (status IN ('calculated', 'paid', 'void')),
  payment_id         uuid,
  delivered_at       timestamptz NOT NULL,
  margin_usd         numeric(12,2),
  margin_pct         numeric(10,4),
  margin_status      text CHECK (margin_status IS NULL OR margin_status IN ('ok', 'warning', 'critical', 'unknown')),
  voided_by          uuid,
  voided_at          timestamptz,
  void_reason        text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT courier_accruals_one_operation_chk CHECK ((order_id IS NULL) <> (remittance_id IS NULL)),
  CONSTRAINT courier_accruals_adjustment_link_chk CHECK ((component = 'adjustment') = (adjusts_accrual_id IS NOT NULL)),
  CONSTRAINT courier_accruals_amount_sign_chk CHECK (component = 'adjustment' OR
    ((amount_cup IS NULL OR amount_cup >= 0) AND (amount_usd IS NULL OR amount_usd >= 0))),
  CONSTRAINT courier_accruals_void_reason_chk CHECK (status <> 'void' OR void_reason IS NOT NULL)
);
-- one delivery accrual per operation (idempotency of the trigger, of the late backfill and of double transitions)
CREATE UNIQUE INDEX IF NOT EXISTS courier_accruals_order_delivery_uniq
  ON public.courier_accruals (order_id) WHERE component = 'delivery' AND order_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS courier_accruals_remittance_delivery_uniq
  ON public.courier_accruals (remittance_id) WHERE component = 'delivery' AND remittance_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS courier_accruals_courier_delivered_idx ON public.courier_accruals (courier_id, delivered_at);
CREATE INDEX IF NOT EXISTS courier_accruals_status_idx ON public.courier_accruals (status);
CREATE INDEX IF NOT EXISTS courier_accruals_adjusts_idx ON public.courier_accruals (adjusts_accrual_id) WHERE adjusts_accrual_id IS NOT NULL;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['delivery_assignments', 'courier_accruals'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated, service_role', t);
    EXECUTE format('GRANT SELECT ON TABLE public.%I TO authenticated', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_select_admin', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING ((SELECT public.is_admin_user()))',
                   t || '_select_admin', t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Calculation (the ONLY place where an accrual amount is computed)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._courier_compute_accrual(
  p_kind       text,
  p_op_id      uuid,
  p_courier_id uuid,
  p_source     text
)
RETURNS TABLE (
  rule_id uuid, amount_cup numeric, fx_used numeric, amount_usd numeric, rule_snapshot jsonb,
  margin_usd numeric, margin_pct numeric, margin_status text
)
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_sent     numeric;
  v_deliver  numeric;
  v_rate     numeric;
  v_cur_sent text;
  v_cur_del  text;
  v_comm     numeric;
  v_dcost    numeric;
  v_zone     uuid;
  v_type     uuid;
  v_tier     numeric;
  v_est      numeric;
  v_rule     public.messenger_payment_types%ROWTYPE;
  v_cup      numeric;
  v_fx       numeric;
  v_fx_src   text := 'none';
  v_usd      numeric;
  v_reason   text;
  v_income   numeric;
  v_cost     numeric;
  v_warn     numeric;
  v_crit     numeric;
  v_m        record;
BEGIN
  IF p_kind = 'remittance' THEN
    SELECT r.amount_sent, r.amount_to_deliver, r.exchange_rate, r.currency_sent, r.currency_delivered,
           r.commission_total, r.delivery_cost, r.shipping_zone_id, r.remittance_type_id
      INTO v_sent, v_deliver, v_rate, v_cur_sent, v_cur_del, v_comm, v_dcost, v_zone, v_type
      FROM public.remittances r WHERE r.id = p_op_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'operation_not_found' USING ERRCODE = 'P0002';
    END IF;
    v_tier := CASE WHEN v_cur_sent = 'USD' THEN v_sent END;
    -- the frozen rate of the remittance is a USD->CUP rate only when it was sent in USD and delivered in CUP
    IF v_cur_sent = 'USD' AND v_cur_del = 'CUP' AND v_rate > 0 THEN
      v_fx := v_rate;
      v_fx_src := 'remittance';
    END IF;
    SELECT c.amount_usd INTO v_est FROM public.remittance_courier_costs c WHERE c.remittance_id = p_op_id;
  ELSIF p_kind = 'order' THEN
    SELECT CASE WHEN cur.code = 'USD' THEN o.subtotal END, o.shipping_zone_id
      INTO v_tier, v_zone
      FROM public.orders o LEFT JOIN public.currencies cur ON cur.id = o.currency_id WHERE o.id = p_op_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'operation_not_found' USING ERRCODE = 'P0002';
    END IF;
    SELECT c.amount_usd INTO v_est FROM public.order_courier_costs c WHERE c.order_id = p_op_id;
  ELSE
    RAISE EXCEPTION 'invalid_argument: unknown operation kind' USING ERRCODE = '22023';
  END IF;

  IF v_fx IS NULL THEN
    SELECT er.rate INTO v_fx
      FROM public.exchange_rates er
      JOIN public.currencies f ON f.id = er.from_currency_id AND f.code = 'USD'
      JOIN public.currencies t ON t.id = er.to_currency_id AND t.code = 'CUP'
     WHERE er.is_active
     ORDER BY er.effective_date DESC LIMIT 1;
    IF v_fx IS NOT NULL THEN v_fx_src := 'exchange_rates'; END IF;
  END IF;

  SELECT m.* INTO v_rule FROM public.messenger_payment_types m
   WHERE m.id = public._courier_rule_resolve(p_kind, p_courier_id, v_zone, v_type, v_tier, now());
  IF NOT FOUND THEN
    v_reason := 'no_rule';
  ELSE
    v_cup := CASE v_rule.method
      WHEN 'fixed_cup' THEN v_rule.fixed_cup
      WHEN 'per_usd_delivered' THEN round(v_rule.cup_per_usd * CASE v_rule.base
          WHEN 'nominal_usd'   THEN CASE WHEN v_cur_sent = 'USD' THEN v_sent END
          WHEN 'delivered_cup' THEN CASE WHEN v_cur_sent = 'USD' AND v_cur_del = 'CUP' AND v_rate > 0 THEN round(v_deliver / v_rate, 2) END
        END, 2)
      WHEN 'percent_of_base' THEN CASE v_rule.base
          WHEN 'nominal_usd'   THEN CASE WHEN v_cur_sent = 'USD' AND v_fx IS NOT NULL THEN round(round(v_rule.percent / 100 * v_sent, 2) * v_fx, 2) END
          WHEN 'delivered_cup' THEN CASE WHEN v_cur_del = 'CUP' THEN round(v_rule.percent / 100 * v_deliver, 2) END
        END
    END;
    IF v_cup IS NULL THEN v_reason := 'no_amount_basis'; END IF;
  END IF;

  IF v_cup IS NOT NULL AND v_fx IS NOT NULL THEN
    v_usd := round(v_cup / v_fx, 2);
  END IF;

  -- Margin: remittances only (the order profit is not stored in SQL). Cost = this accrual, else the legacy estimate.
  IF p_kind = 'remittance' THEN
    v_income := v_comm + v_dcost;
  END IF;
  v_cost := COALESCE(v_usd, v_est);
  SELECT s.warning_pct, s.critical_pct INTO v_warn, v_crit FROM public.courier_margin_settings s WHERE s.kind = p_kind;
  SELECT * INTO v_m FROM public._operation_margin(v_tier, v_income, v_cost, v_warn, v_crit);

  RETURN QUERY SELECT
    v_rule.id, v_cup, v_fx, v_usd,
    jsonb_strip_nulls(jsonb_build_object(
      'source', p_source, 'reason', v_reason, 'method', v_rule.method, 'fx_source', v_fx_src,
      'cost_estimated', (v_usd IS NULL AND v_est IS NOT NULL),
      'rule', CASE WHEN v_rule.id IS NULL THEN NULL ELSE jsonb_build_object(
        'code', v_rule.code, 'version', v_rule.version, 'name', v_rule.name, 'applies_to', v_rule.applies_to,
        'method', v_rule.method, 'fixed_cup', v_rule.fixed_cup, 'cup_per_usd', v_rule.cup_per_usd, 'percent', v_rule.percent,
        'base', v_rule.base, 'courier_id', v_rule.courier_id, 'zone_id', v_rule.shipping_zone_id,
        'type_id', v_rule.remittance_type_id, 'amount_from', v_rule.amount_from, 'amount_to', v_rule.amount_to) END,
      'inputs', jsonb_build_object(
        'amount_sent', v_sent, 'amount_to_deliver', v_deliver, 'rate', v_rate, 'currency_sent', v_cur_sent,
        'currency_delivered', v_cur_del, 'tier_amount', v_tier, 'commission_total', v_comm, 'delivery_cost', v_dcost,
        'zone_id', v_zone, 'type_id', v_type, 'estimate_usd', v_est))),
    v_m.margin_usd, v_m.margin_pct, v_m.status;
END;
$function$;
REVOKE ALL ON FUNCTION public._courier_compute_accrual(text, uuid, uuid, text) FROM PUBLIC, anon, authenticated, service_role;

-- Creates the delivery accrual of an operation; returns its id, or NULL when one already exists (idempotent).
CREATE OR REPLACE FUNCTION public._courier_create_accrual(p_kind text, p_op_id uuid, p_source text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_delivered timestamptz;
  v_courier   uuid;
  v_c         record;
  v_id        uuid;
BEGIN
  IF p_kind = 'remittance' THEN
    SELECT COALESCE(r.delivered_at, now()) INTO v_delivered FROM public.remittances r WHERE r.id = p_op_id;
    SELECT a.courier_id INTO v_courier FROM public.delivery_assignments a WHERE a.remittance_id = p_op_id;
  ELSE
    SELECT COALESCE(o.delivered_at, now()) INTO v_delivered FROM public.orders o WHERE o.id = p_op_id;
    SELECT a.courier_id INTO v_courier FROM public.delivery_assignments a WHERE a.order_id = p_op_id;
  END IF;
  IF v_delivered IS NULL THEN
    RAISE EXCEPTION 'operation_not_found' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_c FROM public._courier_compute_accrual(p_kind, p_op_id, v_courier, p_source);

  INSERT INTO public.courier_accruals
    (order_id, remittance_id, component, courier_id, rule_id, rule_snapshot, amount_cup, fx_used, amount_usd,
     delivered_at, margin_usd, margin_pct, margin_status)
  VALUES
    (CASE WHEN p_kind = 'order' THEN p_op_id END, CASE WHEN p_kind = 'remittance' THEN p_op_id END, 'delivery',
     v_courier, v_c.rule_id, v_c.rule_snapshot, v_c.amount_cup, v_c.fx_used, v_c.amount_usd,
     v_delivered, v_c.margin_usd, v_c.margin_pct, v_c.margin_status)
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$;
REVOKE ALL ON FUNCTION public._courier_create_accrual(text, uuid, text) FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Delivery trigger: accounting must NEVER block a delivery
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._courier_accrue_on_delivered()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  PERFORM public._courier_create_accrual(CASE TG_TABLE_NAME WHEN 'orders' THEN 'order' ELSE 'remittance' END, NEW.id, 'trigger');
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'courier accrual failed for % %: % (%)', TG_TABLE_NAME, NEW.id, SQLERRM, SQLSTATE;
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public._courier_accrue_on_delivered() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS courier_accrual_on_delivered ON public.orders;
CREATE TRIGGER courier_accrual_on_delivered
  AFTER UPDATE OF status ON public.orders
  FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'delivered')
  EXECUTE FUNCTION public._courier_accrue_on_delivered();

DROP TRIGGER IF EXISTS courier_accrual_on_delivered ON public.remittances;
CREATE TRIGGER courier_accrual_on_delivered
  AFTER UPDATE OF status ON public.remittances
  FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'delivered')
  EXECUTE FUNCTION public._courier_accrue_on_delivered();

-- ---------------------------------------------------------------------------
-- 4. Effective cost: ONE number per operation (accrual when known, else the legacy zone snapshot as an estimate)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_effective_courier_cost WITH (security_invoker = true) AS
WITH ops AS (
  SELECT 'order'::text AS source_kind, c.order_id AS source_id, c.amount_usd AS estimate_usd, c.created_at AS recorded_at FROM public.order_courier_costs c
  UNION ALL
  SELECT 'remittance'::text, c.remittance_id, c.amount_usd, c.created_at FROM public.remittance_courier_costs c
  UNION ALL
  SELECT a.source_kind, a.source_id, NULL::numeric, min(a.created_at) FROM public.courier_accruals a
   WHERE NOT EXISTS (SELECT 1 FROM public.order_courier_costs c WHERE c.order_id = a.source_id)
     AND NOT EXISTS (SELECT 1 FROM public.remittance_courier_costs c WHERE c.remittance_id = a.source_id)
   GROUP BY a.source_kind, a.source_id
), acc AS (
  SELECT a.source_kind, a.source_id,
         sum(a.amount_usd) FILTER (WHERE a.status <> 'void') AS usd_sum,
         bool_or(a.component = 'delivery' AND a.status <> 'void' AND a.amount_usd IS NOT NULL) AS delivery_known
    FROM public.courier_accruals a GROUP BY a.source_kind, a.source_id
)
SELECT o.source_kind, o.source_id,
       CASE WHEN acc.delivery_known THEN acc.usd_sum ELSE o.estimate_usd END AS amount_usd,
       NOT COALESCE(acc.delivery_known, false) AS is_estimated,
       o.recorded_at
  FROM ops o LEFT JOIN acc ON acc.source_kind = o.source_kind AND acc.source_id = o.source_id;

REVOKE ALL ON public.v_effective_courier_cost FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.v_effective_courier_cost TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. RPCs
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_assign_delivery_courier(p_kind text, p_id uuid, p_courier_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid    uuid := public._courier_require_admin();
  v_status text;
  v_old    uuid;
  v_rowid  uuid;
BEGIN
  IF p_kind IS NULL OR p_kind NOT IN ('order', 'remittance') THEN
    RAISE EXCEPTION 'invalid_argument: kind must be order or remittance' USING ERRCODE = '22023';
  END IF;
  -- Same row lock the status transitions take: assignment and delivery are serialized.
  IF p_kind = 'remittance' THEN
    SELECT r.status INTO v_status FROM public.remittances r WHERE r.id = p_id FOR UPDATE;
  ELSE
    SELECT o.status INTO v_status FROM public.orders o WHERE o.id = p_id FOR UPDATE;
  END IF;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'operation_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_status IN ('delivered', 'completed', 'cancelled') THEN
    RAISE EXCEPTION 'invalid_status: the courier cannot be changed once the operation is % (the amount is frozen at delivery)', v_status
      USING ERRCODE = '22023';
  END IF;
  IF p_courier_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.couriers WHERE id = p_courier_id AND is_active) THEN
    RAISE EXCEPTION 'invalid_argument: courier not found or inactive' USING ERRCODE = '22023';
  END IF;

  IF p_kind = 'remittance' THEN
    SELECT a.id, a.courier_id INTO v_rowid, v_old FROM public.delivery_assignments a WHERE a.remittance_id = p_id;
  ELSE
    SELECT a.id, a.courier_id INTO v_rowid, v_old FROM public.delivery_assignments a WHERE a.order_id = p_id;
  END IF;

  IF p_courier_id IS NULL THEN
    IF v_rowid IS NOT NULL THEN
      DELETE FROM public.delivery_assignments WHERE id = v_rowid;
      PERFORM public._courier_audit('delivery_assignments', v_rowid, 'courier_id', v_old::text, NULL, 'UPDATE');
    END IF;
  ELSIF v_rowid IS NULL THEN
    INSERT INTO public.delivery_assignments (order_id, remittance_id, courier_id, assigned_by)
    VALUES (CASE WHEN p_kind = 'order' THEN p_id END, CASE WHEN p_kind = 'remittance' THEN p_id END, p_courier_id, v_uid)
    RETURNING id INTO v_rowid;
    PERFORM public._courier_audit('delivery_assignments', v_rowid, 'created', NULL, p_courier_id::text, 'UPDATE');
  ELSIF v_old IS DISTINCT FROM p_courier_id THEN
    UPDATE public.delivery_assignments SET courier_id = p_courier_id, assigned_by = v_uid, assigned_at = now() WHERE id = v_rowid;
    PERFORM public._courier_audit('delivery_assignments', v_rowid, 'courier_id', v_old::text, p_courier_id::text, 'UPDATE');
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_void_accrual(p_id uuid, p_reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid    uuid := public._courier_require_admin();
  v_reason text := btrim(COALESCE(p_reason, ''));
  v_a      public.courier_accruals%ROWTYPE;
BEGIN
  IF char_length(v_reason) < 10 OR char_length(v_reason) > 500 THEN
    RAISE EXCEPTION 'invalid_reason: a reason of 10 to 500 characters is required' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_a FROM public.courier_accruals WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'accrual_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_a.status = 'void' THEN
    RAISE EXCEPTION 'invalid_status: the accrual is already void' USING ERRCODE = '22023';
  END IF;
  IF v_a.status = 'paid' AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'insufficient_privilege: only a super administrator can void a paid accrual' USING ERRCODE = '42501';
  END IF;
  UPDATE public.courier_accruals
     SET status = 'void', voided_by = v_uid, voided_at = now(), void_reason = v_reason
   WHERE id = p_id;
  PERFORM public._courier_audit('courier_accruals', p_id, 'status', v_a.status, 'void', 'UPDATE');
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_adjust_accrual(p_id uuid, p_amount_cup numeric, p_reason text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid    uuid := public._courier_require_admin();
  v_reason text := btrim(COALESCE(p_reason, ''));
  v_a      public.courier_accruals%ROWTYPE;
  v_id     uuid;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'insufficient_privilege: only a super administrator can adjust a paid accrual' USING ERRCODE = '42501';
  END IF;
  IF char_length(v_reason) < 10 OR char_length(v_reason) > 500 THEN
    RAISE EXCEPTION 'invalid_reason: a reason of 10 to 500 characters is required' USING ERRCODE = '22023';
  END IF;
  IF p_amount_cup IS NULL OR p_amount_cup = 0 OR p_amount_cup <> round(p_amount_cup, 2) THEN
    RAISE EXCEPTION 'invalid_amount: a non-zero amount with at most 2 decimals is required' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_a FROM public.courier_accruals WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'accrual_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_a.status <> 'paid' OR v_a.component <> 'delivery' THEN
    RAISE EXCEPTION 'invalid_status: only a paid delivery accrual can be adjusted' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.courier_accruals
    (order_id, remittance_id, component, adjusts_accrual_id, courier_id, rule_snapshot, amount_cup, fx_used, amount_usd, delivered_at)
  VALUES
    (v_a.order_id, v_a.remittance_id, 'adjustment', p_id, v_a.courier_id,
     jsonb_build_object('source', 'adjustment', 'reason', v_reason, 'adjusted_by', v_uid),
     p_amount_cup, v_a.fx_used, CASE WHEN v_a.fx_used IS NOT NULL THEN round(p_amount_cup / v_a.fx_used, 2) END, v_a.delivered_at)
  RETURNING id INTO v_id;
  PERFORM public._courier_audit('courier_accruals', v_id, 'created', NULL, p_amount_cup::text, 'UPDATE');
  RETURN v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_reassign_accrual(p_id uuid, p_courier_id uuid, p_reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_reason text := btrim(COALESCE(p_reason, ''));
  v_a      public.courier_accruals%ROWTYPE;
BEGIN
  PERFORM public._courier_require_admin();
  IF char_length(v_reason) < 10 OR char_length(v_reason) > 500 THEN
    RAISE EXCEPTION 'invalid_reason: a reason of 10 to 500 characters is required' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_a FROM public.courier_accruals WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'accrual_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_a.status <> 'calculated' THEN
    RAISE EXCEPTION 'invalid_status: only a calculated (unpaid) accrual can change courier' USING ERRCODE = '22023';
  END IF;
  IF p_courier_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.couriers WHERE id = p_courier_id AND is_active) THEN
    RAISE EXCEPTION 'invalid_argument: courier not found or inactive' USING ERRCODE = '22023';
  END IF;
  -- The amount is NOT recalculated: it is the frozen figure. For another amount: recalculate (unpaid) or adjust (paid).
  UPDATE public.courier_accruals SET courier_id = p_courier_id WHERE id = p_id;
  PERFORM public._courier_audit('courier_accruals', p_id, 'courier_id', v_a.courier_id::text, p_courier_id::text, 'UPDATE');
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_recalculate_accrual(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_a public.courier_accruals%ROWTYPE;
  v_c record;
BEGIN
  PERFORM public._courier_require_admin();
  SELECT * INTO v_a FROM public.courier_accruals WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'accrual_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_a.component <> 'delivery' OR v_a.status <> 'calculated' OR v_a.amount_cup IS NOT NULL THEN
    RAISE EXCEPTION 'invalid_status: only a calculated delivery accrual with an unknown amount can be recalculated' USING ERRCODE = '22023';
  END IF;
  -- Uses the rule and rate in force NOW (documented): meant to fill an unknown amount once the owner configured a rule.
  SELECT * INTO v_c FROM public._courier_compute_accrual(v_a.source_kind, v_a.source_id, v_a.courier_id, 'recalc');
  UPDATE public.courier_accruals
     SET rule_id = v_c.rule_id, rule_snapshot = v_c.rule_snapshot, amount_cup = v_c.amount_cup, fx_used = v_c.fx_used,
         amount_usd = v_c.amount_usd, margin_usd = v_c.margin_usd, margin_pct = v_c.margin_pct, margin_status = v_c.margin_status
   WHERE id = p_id;
  PERFORM public._courier_audit('courier_accruals', p_id, 'amount_cup', v_a.amount_cup::text, v_c.amount_cup::text, 'UPDATE');
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_list_deliveries_without_accrual(p_from timestamptz, p_to timestamptz)
RETURNS TABLE (source_kind text, source_id uuid, delivered_at timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  PERFORM public._courier_require_admin();
  RETURN QUERY
  SELECT 'remittance'::text, r.id, r.delivered_at FROM public.remittances r
   WHERE r.status IN ('delivered', 'completed') AND r.delivered_at IS NOT NULL
     AND (p_from IS NULL OR r.delivered_at >= p_from) AND (p_to IS NULL OR r.delivered_at < p_to)
     AND NOT EXISTS (SELECT 1 FROM public.courier_accruals a WHERE a.remittance_id = r.id AND a.component = 'delivery')
  UNION ALL
  SELECT 'order'::text, o.id, o.delivered_at FROM public.orders o
   WHERE o.status IN ('delivered', 'completed') AND o.delivered_at IS NOT NULL
     AND (p_from IS NULL OR o.delivered_at >= p_from) AND (p_to IS NULL OR o.delivered_at < p_to)
     AND NOT EXISTS (SELECT 1 FROM public.courier_accruals a WHERE a.order_id = o.id AND a.component = 'delivery')
  ORDER BY 3;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_backfill_missing_accruals(p_from timestamptz)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_row record;
  v_n   integer := 0;
BEGIN
  PERFORM public._courier_require_admin();
  -- it books history with the rule and rate of NOW: super_admin only
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'insufficient_privilege: only a super administrator can backfill missing accruals' USING ERRCODE = '42501';
  END IF;
  IF p_from IS NULL THEN
    RAISE EXCEPTION 'invalid_argument: a start date is required (history is not backfilled by default)' USING ERRCODE = '22023';
  END IF;
  FOR v_row IN SELECT * FROM public.admin_list_deliveries_without_accrual(p_from, NULL) LOOP
    BEGIN
      IF public._courier_create_accrual(v_row.source_kind, v_row.source_id, 'late') IS NOT NULL THEN
        v_n := v_n + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'late courier accrual failed for % %: % (%)', v_row.source_kind, v_row.source_id, SQLERRM, SQLSTATE;
    END;
  END LOOP;
  RETURN v_n;
END;
$function$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'admin_assign_delivery_courier(text, uuid, uuid)',
    'admin_void_accrual(uuid, text)',
    'admin_adjust_accrual(uuid, numeric, text)',
    'admin_reassign_accrual(uuid, uuid, text)',
    'admin_recalculate_accrual(uuid)',
    'admin_list_deliveries_without_accrual(timestamptz, timestamptz)',
    'admin_backfill_missing_accruals(timestamptz)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', f);
  END LOOP;
END $$;

COMMIT;
