-- ============================================================================
-- Courier management, M1: couriers, messenger payment types, margin thresholds.   PREPARED, NOT APPLIED
-- ============================================================================
-- WHY: the owner wants to manage couriers and what each delivery costs from the admin panel, with the EXACT values set by
--   himself. See .claude/docs/plan_courier-management-module.md (phase 1, M1). OWNER RULE: no amount, percentage,
--   threshold, rate or tier lives in code or is seeded here: every table starts EMPTY (the only seed rows are the two
--   all-NULL threshold rows) and a delivery with no applicable rule accrues an UNKNOWN (NULL) amount, never 0.
-- WHAT:
--   0. Orphan safety: zone / remittance-type references are plain uuids (no FK) so existing flows that delete them are never
--      blocked; the RPC validates existence at creation and an orphan id simply matches nothing (rule inert, never widened).
--   1. public.couriers (optional registry; "dual mode": with none registered the general rule applies, courier_id NULL).
--   2. public.messenger_payment_types: payment rules, VERSIONED APPEND-ONLY. Closed set of calculation methods with typed
--      parameters (CHECKs, never expressions): fixed_cup (per delivery), per_usd_delivered (CUP per USD, base nominal sent
--      or delivered equivalent), percent_of_base (percent of nominal USD sent or of delivered CUP). Scope: remittance |
--      order | both; optional courier, shipping zone, remittance type and amount tier (a,b]; validity window.
--      A guard trigger makes rows immutable except valid_to / is_active (which only the RPCs touch).
--   3. public.courier_margin_settings: margin thresholds (target / warning / critical) per kind, NULL until the owner sets them.
--   4. RPCs (SECURITY DEFINER, role re-verified, one advisory lock for the whole rule domain, audited in
--      financial_audit_log): admin_upsert_courier, admin_set_messenger_payment_type, admin_deactivate_messenger_payment_type,
--      admin_set_margin_thresholds. Overlaps are validated in the RPC (btree_gist is not installed).
--   5. _courier_rule_resolve(): deterministic precedence courier > zone > type > tier > general; ONE rule wins.
--      _operation_margin(): IMMUTABLE pure function, the single source of the margin (unknown cost => 'unknown', never 0).
--   6. Audit rows are written with operation 'UPDATE' (the log's CHECK only allows UPDATE/DELETE and is NOT altered: this
--      migration is strictly additive); a creation is the column 'created' with NULL old value.
-- SECURITY: RLS on every table, SELECT only for is_admin_user(); REVOKE ALL from PUBLIC/anon/authenticated/service_role;
--   writes only through the RPCs. orders / remittances get NO new column (the owner of the row would read it).
-- Apply order: M1 -> M2 -> M3. Rollback order: M3 -> M2 -> M1.
-- ROLLBACK: supabase/rollbacks/20261031100000_couriers_and_payment_types_down.sql
-- ============================================================================

BEGIN;

SET LOCAL lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.couriers (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 200),
  phone      text CHECK (phone IS NULL OR char_length(phone) <= 50),
  notes      text CHECK (notes IS NULL OR char_length(notes) <= 1000),
  is_active  boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS couriers_active_name_uniq
  ON public.couriers (lower(regexp_replace(btrim(name), '\s+', ' ', 'g'))) WHERE is_active;

CREATE TABLE IF NOT EXISTS public.messenger_payment_types (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code               text NOT NULL CHECK (char_length(btrim(code)) BETWEEN 1 AND 100),
  name               text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 200),
  version            integer NOT NULL CHECK (version >= 1),
  applies_to         text NOT NULL CHECK (applies_to IN ('remittance', 'order', 'both')),
  method             text NOT NULL CHECK (method IN ('fixed_cup', 'per_usd_delivered', 'percent_of_base')),
  fixed_cup          numeric(12,2) CHECK (fixed_cup IS NULL OR fixed_cup >= 0),
  cup_per_usd        numeric(12,4) CHECK (cup_per_usd IS NULL OR cup_per_usd >= 0),
  percent            numeric(6,3)  CHECK (percent IS NULL OR percent BETWEEN 0 AND 100),
  base               text CHECK (base IS NULL OR base IN ('nominal_usd', 'delivered_cup')),
  courier_id         uuid REFERENCES public.couriers(id) ON DELETE RESTRICT,
  shipping_zone_id   uuid,  -- NO FK on purpose: deleting a zone must keep working; an orphan id makes the rule inert
  remittance_type_id uuid,  -- NO FK on purpose (same reason); existence is validated by the RPC at creation
  amount_from        numeric(12,2) CHECK (amount_from IS NULL OR amount_from >= 0),
  amount_to          numeric(12,2) CHECK (amount_to IS NULL OR amount_to >= 0),
  valid_from         timestamptz NOT NULL,
  valid_to           timestamptz,
  is_active          boolean NOT NULL DEFAULT true,
  created_by         uuid,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT messenger_payment_types_code_version_uniq UNIQUE (code, version),
  CONSTRAINT messenger_payment_types_window_chk CHECK (valid_to IS NULL OR valid_to > valid_from),
  CONSTRAINT messenger_payment_types_tier_chk CHECK (amount_from IS NULL OR amount_to IS NULL OR amount_to > amount_from),
  CONSTRAINT messenger_payment_types_params_chk CHECK (
       (method = 'fixed_cup'         AND fixed_cup IS NOT NULL AND cup_per_usd IS NULL AND percent IS NULL AND base IS NULL)
    OR (method = 'per_usd_delivered' AND cup_per_usd IS NOT NULL AND fixed_cup IS NULL AND percent IS NULL AND base IS NOT NULL)
    OR (method = 'percent_of_base'   AND percent IS NOT NULL AND fixed_cup IS NULL AND cup_per_usd IS NULL AND base IS NOT NULL)),
  CONSTRAINT messenger_payment_types_method_scope_chk CHECK (method = 'fixed_cup' OR applies_to = 'remittance'),
  CONSTRAINT messenger_payment_types_type_scope_chk CHECK (remittance_type_id IS NULL OR applies_to = 'remittance')
);

CREATE TABLE IF NOT EXISTS public.courier_margin_settings (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind         text NOT NULL UNIQUE CHECK (kind IN ('remittance', 'order')),
  target_pct   numeric(8,4) CHECK (target_pct   BETWEEN -100 AND 100),
  warning_pct  numeric(8,4) CHECK (warning_pct  BETWEEN -100 AND 100),
  critical_pct numeric(8,4) CHECK (critical_pct BETWEEN -100 AND 100),
  updated_by   uuid,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT courier_margin_settings_order_chk CHECK (
        (critical_pct IS NULL OR warning_pct IS NULL OR critical_pct <= warning_pct)
    AND (warning_pct  IS NULL OR target_pct  IS NULL OR warning_pct  <= target_pct)
    AND (critical_pct IS NULL OR target_pct  IS NULL OR critical_pct <= target_pct))
);
-- Empty rows only: no threshold exists until the owner sets one (no alerts before that).
INSERT INTO public.courier_margin_settings (kind) VALUES ('remittance'), ('order') ON CONFLICT (kind) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. Visibility: admin-only read, writes only through the RPCs below
-- ---------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['couriers', 'messenger_payment_types', 'courier_margin_settings'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated, service_role', t);
    EXECUTE format('GRANT SELECT ON TABLE public.%I TO authenticated', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_select_admin', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING ((SELECT public.is_admin_user()))',
                   t || '_select_admin', t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 4. Append-only guard for messenger_payment_types (only valid_to / is_active may change; never DELETE)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.messenger_payment_types_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'messenger_payment_types_is_append_only: rules are never deleted' USING ERRCODE = '42501';
  END IF;
  IF (to_jsonb(NEW) - 'valid_to' - 'is_active') IS DISTINCT FROM (to_jsonb(OLD) - 'valid_to' - 'is_active') THEN
    RAISE EXCEPTION 'messenger_payment_types_is_append_only: create a new version instead' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.messenger_payment_types_guard() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS messenger_payment_types_guard ON public.messenger_payment_types;
CREATE TRIGGER messenger_payment_types_guard
  BEFORE UPDATE OR DELETE ON public.messenger_payment_types
  FOR EACH ROW EXECUTE FUNCTION public.messenger_payment_types_guard();

-- ---------------------------------------------------------------------------
-- 5. Internal helpers (not callable by API roles)
-- ---------------------------------------------------------------------------
-- Role gate shared by every courier RPC: a signed-in, enabled admin or super_admin (re-verified on each call).
CREATE OR REPLACE FUNCTION public._courier_require_admin()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL OR NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'insufficient_privilege: courier management is for administrators' USING ERRCODE = '42501';
  END IF;
  RETURN v_uid;
END;
$function$;
REVOKE ALL ON FUNCTION public._courier_require_admin() FROM PUBLIC, anon, authenticated, service_role;

-- One row of financial_audit_log per call (the trigger-based audit only sees UPDATE/DELETE of its own tables).
CREATE OR REPLACE FUNCTION public._courier_audit(
  p_table text, p_row_id uuid, p_column text, p_old text, p_new text, p_op text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid  uuid := auth.uid();
  v_role text;
BEGIN
  v_role := CASE
    WHEN v_uid IS NULL THEN CASE WHEN COALESCE(current_setting('role', true), '') = 'service_role' THEN 'service_role' ELSE 'system' END
    WHEN public.is_super_admin() THEN 'super_admin'
    WHEN public.is_admin_user() THEN 'admin'
    ELSE 'user'
  END;
  INSERT INTO public.financial_audit_log (table_name, row_id, column_name, old_value, new_value, operation, changed_by, changed_by_role, via_function)
  VALUES (p_table, p_row_id, p_column, p_old, p_new, p_op, v_uid, v_role, NULL);
END;
$function$;
REVOKE ALL ON FUNCTION public._courier_audit(text, uuid, text, text, text, text) FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. Rule resolver: courier > zone > type > tier > general; exactly ONE rule (or NULL = no rule => unknown amount)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._courier_rule_resolve(
  p_kind       text,
  p_courier_id uuid,
  p_zone_id    uuid,
  p_type_id    uuid,
  p_amount     numeric,
  p_at         timestamptz DEFAULT now()
)
RETURNS uuid
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $function$
  SELECT m.id
    FROM public.messenger_payment_types m
   WHERE m.is_active
     AND m.applies_to IN (p_kind, 'both')
     AND m.valid_from <= p_at AND (m.valid_to IS NULL OR p_at < m.valid_to)
     AND (m.courier_id IS NULL OR m.courier_id = p_courier_id)
     AND (m.shipping_zone_id IS NULL OR m.shipping_zone_id = p_zone_id)
     AND (m.remittance_type_id IS NULL OR m.remittance_type_id = p_type_id)
     AND (m.amount_from IS NULL OR p_amount > m.amount_from)
     AND (m.amount_to IS NULL OR p_amount <= m.amount_to)
   ORDER BY (m.courier_id IS NOT NULL) DESC,
            (m.shipping_zone_id IS NOT NULL) DESC,
            (m.remittance_type_id IS NOT NULL) DESC,
            (m.amount_from IS NOT NULL OR m.amount_to IS NOT NULL) DESC,
            m.valid_from DESC, m.id
   LIMIT 1;
$function$;
REVOKE ALL ON FUNCTION public._courier_rule_resolve(text, uuid, uuid, uuid, numeric, timestamptz) FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. Pure margin function (single source of the margin). Thresholds come in as arguments; NULL threshold = never alerts.
--    Cost or income NULL, or a base <= 0 => 'unknown' (never 0). Comparison in cents with a 0.005 tolerance.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._operation_margin(
  p_amount_base numeric,
  p_income_usd  numeric,
  p_cost_usd    numeric,
  p_warning_pct numeric,
  p_critical_pct numeric
)
RETURNS TABLE (margin_usd numeric, margin_pct numeric, status text)
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $function$
  SELECT CASE WHEN k.known THEN k.m END,
         CASE WHEN k.known THEN round(k.m / p_amount_base * 100, 4) END,
         CASE WHEN NOT k.known THEN 'unknown'
              WHEN p_warning_pct IS NULL AND p_critical_pct IS NULL THEN 'unknown' -- no thresholds set: nothing to judge against, never 'ok'
              WHEN p_critical_pct IS NOT NULL AND k.m + 0.005 < p_amount_base * p_critical_pct / 100 THEN 'critical'
              WHEN p_warning_pct  IS NOT NULL AND k.m + 0.005 < p_amount_base * p_warning_pct  / 100 THEN 'warning'
              ELSE 'ok' END
    FROM (SELECT COALESCE(p_amount_base > 0 AND p_income_usd IS NOT NULL AND p_cost_usd IS NOT NULL, false) AS known,
                 round(p_income_usd - p_cost_usd, 2) AS m) k;
$function$;
REVOKE ALL ON FUNCTION public._operation_margin(numeric, numeric, numeric, numeric, numeric) FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 8. RPCs
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_upsert_courier(
  p_id        uuid,
  p_name      text,
  p_phone     text,
  p_notes     text,
  p_is_active boolean DEFAULT true
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid  uuid := public._courier_require_admin();
  v_name text := btrim(COALESCE(p_name, ''));
  v_old  public.couriers%ROWTYPE;
  v_id   uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('courier_rules'));
  IF char_length(v_name) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'invalid_name: 1 to 200 characters required' USING ERRCODE = '22023';
  END IF;
  IF char_length(COALESCE(p_phone, '')) > 50 OR char_length(COALESCE(p_notes, '')) > 1000 THEN
    RAISE EXCEPTION 'invalid_argument: phone up to 50 and notes up to 1000 characters' USING ERRCODE = '22023';
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.couriers (name, phone, notes, is_active, created_by)
    VALUES (v_name, NULLIF(btrim(p_phone), ''), NULLIF(btrim(p_notes), ''), COALESCE(p_is_active, true), v_uid)
    RETURNING id INTO v_id;
    PERFORM public._courier_audit('couriers', v_id, 'created', NULL, v_id::text, 'UPDATE');
  ELSE
    SELECT * INTO v_old FROM public.couriers WHERE id = p_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'courier_not_found' USING ERRCODE = 'P0002';
    END IF;
    UPDATE public.couriers
       SET name = v_name, phone = NULLIF(btrim(p_phone), ''), notes = NULLIF(btrim(p_notes), ''),
           is_active = COALESCE(p_is_active, true), updated_at = now()
     WHERE id = p_id;
    v_id := p_id;
    IF v_old.is_active IS DISTINCT FROM COALESCE(p_is_active, true) THEN
      PERFORM public._courier_audit('couriers', v_id, 'is_active', v_old.is_active::text, COALESCE(p_is_active, true)::text, 'UPDATE');
    END IF;
    -- name / phone / notes are personal data of a third party: the trail records THAT they changed, not their value.
    IF (v_old.name, v_old.phone, v_old.notes) IS DISTINCT FROM (v_name, NULLIF(btrim(p_phone), ''), NULLIF(btrim(p_notes), '')) THEN
      PERFORM public._courier_audit('couriers', v_id, 'profile', NULL, NULL, 'UPDATE');
    END IF;
  END IF;
  RETURN v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_set_messenger_payment_type(
  p_code        text,
  p_name        text,
  p_applies_to  text,
  p_method      text,
  p_fixed_cup   numeric,
  p_cup_per_usd numeric,
  p_percent     numeric,
  p_base        text,
  p_courier_id  uuid,
  p_zone_id     uuid,
  p_type_id     uuid,
  p_amount_from numeric,
  p_amount_to   numeric,
  p_valid_from  timestamptz DEFAULT NULL,
  p_valid_to    timestamptz DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid     uuid := public._courier_require_admin();
  v_code    text := btrim(COALESCE(p_code, ''));
  v_name    text := btrim(COALESCE(p_name, ''));
  v_from    timestamptz := COALESCE(p_valid_from, now());
  v_version integer;
  v_last    timestamptz;
  v_id      uuid;
  v_prev    record;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('courier_rules'));

  IF char_length(v_code) NOT BETWEEN 1 AND 100 OR char_length(v_name) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'invalid_argument: code (1-100) and name (1-200) are required' USING ERRCODE = '22023';
  END IF;
  IF p_applies_to IS NULL OR p_applies_to NOT IN ('remittance', 'order', 'both')
     OR p_method IS NULL OR p_method NOT IN ('fixed_cup', 'per_usd_delivered', 'percent_of_base') THEN
    RAISE EXCEPTION 'invalid_argument: unknown applies_to or method' USING ERRCODE = '22023';
  END IF;
  IF p_method <> 'fixed_cup' AND p_applies_to <> 'remittance' THEN
    RAISE EXCEPTION 'invalid_argument: this method only applies to remittances' USING ERRCODE = '22023';
  END IF;
  IF p_type_id IS NOT NULL AND p_applies_to <> 'remittance' THEN
    RAISE EXCEPTION 'invalid_argument: a remittance type only makes sense for remittance rules' USING ERRCODE = '22023';
  END IF;
  -- Typed parameters of the chosen method, and none of the others.
  IF NOT (CASE p_method
            WHEN 'fixed_cup' THEN p_fixed_cup >= 0 AND p_cup_per_usd IS NULL AND p_percent IS NULL AND p_base IS NULL
            WHEN 'per_usd_delivered' THEN p_cup_per_usd >= 0 AND p_fixed_cup IS NULL AND p_percent IS NULL
                                          AND p_base IN ('nominal_usd', 'delivered_cup')
            WHEN 'percent_of_base' THEN p_percent BETWEEN 0 AND 100 AND p_fixed_cup IS NULL AND p_cup_per_usd IS NULL
                                        AND p_base IN ('nominal_usd', 'delivered_cup')
          END) IS TRUE THEN
    RAISE EXCEPTION 'invalid_argument: parameters do not match the method' USING ERRCODE = '22023';
  END IF;
  IF (p_amount_from IS NOT NULL AND p_amount_from < 0) OR (p_amount_to IS NOT NULL AND p_amount_to < 0)
     OR (p_amount_from IS NOT NULL AND p_amount_to IS NOT NULL AND p_amount_to <= p_amount_from) THEN
    RAISE EXCEPTION 'invalid_argument: the amount tier must satisfy 0 <= from < to' USING ERRCODE = '22023';
  END IF;
  IF p_courier_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.couriers WHERE id = p_courier_id AND is_active) THEN
    RAISE EXCEPTION 'invalid_argument: courier not found or inactive' USING ERRCODE = '22023';
  END IF;
  IF p_zone_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.shipping_zones WHERE id = p_zone_id) THEN
    RAISE EXCEPTION 'invalid_argument: shipping zone not found' USING ERRCODE = '22023';
  END IF;
  IF p_type_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.remittance_types WHERE id = p_type_id) THEN
      RAISE EXCEPTION 'invalid_argument: remittance type not found' USING ERRCODE = '22023';
    END IF;
    IF p_base = 'delivered_cup' AND NOT EXISTS (SELECT 1 FROM public.remittance_types WHERE id = p_type_id AND delivery_currency = 'CUP') THEN
      RAISE EXCEPTION 'invalid_argument: the delivered_cup base needs a remittance type delivered in CUP' USING ERRCODE = '22023';
    END IF;
  END IF;
  -- Only the future is editable: new rates never touch deliveries already accrued.
  IF v_from < now() - interval '1 minute' THEN
    RAISE EXCEPTION 'invalid_argument: valid_from cannot be in the past' USING ERRCODE = '22023';
  END IF;
  IF p_valid_to IS NOT NULL AND p_valid_to <= v_from THEN
    RAISE EXCEPTION 'invalid_argument: valid_to must be after valid_from' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(max(version), 0), max(valid_from) FILTER (WHERE is_active)
    INTO v_version, v_last FROM public.messenger_payment_types WHERE code = v_code;
  IF v_last IS NOT NULL AND v_from <= v_last THEN
    RAISE EXCEPTION 'invalid_argument: a new version must start after the latest version of this code' USING ERRCODE = '22023';
  END IF;

  -- Overlap: same scope tuple, same tier presence, intersecting tiers (a,b], windows and operation kinds.
  IF EXISTS (
    SELECT 1 FROM public.messenger_payment_types o
     WHERE o.is_active AND o.code <> v_code
       AND o.courier_id IS NOT DISTINCT FROM p_courier_id
       AND o.shipping_zone_id IS NOT DISTINCT FROM p_zone_id
       AND o.remittance_type_id IS NOT DISTINCT FROM p_type_id
       AND ((o.amount_from IS NOT NULL OR o.amount_to IS NOT NULL) = (p_amount_from IS NOT NULL OR p_amount_to IS NOT NULL))
       AND COALESCE(o.amount_from, -1) < COALESCE(p_amount_to, 1e15)
       AND COALESCE(p_amount_from, -1) < COALESCE(o.amount_to, 1e15)
       AND (o.applies_to = 'both' OR p_applies_to = 'both' OR o.applies_to = p_applies_to)
       AND o.valid_from < COALESCE(p_valid_to, 'infinity'::timestamptz)
       AND v_from < COALESCE(o.valid_to, 'infinity'::timestamptz)
  ) THEN
    RAISE EXCEPTION 'overlapping_rule: another active rule already covers this scope in this period' USING ERRCODE = '23P01';
  END IF;

  -- Close the previous version at the start of the new one.
  FOR v_prev IN
    UPDATE public.messenger_payment_types
       SET valid_to = v_from
     WHERE code = v_code AND is_active AND valid_from < v_from AND (valid_to IS NULL OR valid_to > v_from)
    RETURNING id, valid_to
  LOOP
    PERFORM public._courier_audit('messenger_payment_types', v_prev.id, 'valid_to', NULL, v_prev.valid_to::text, 'UPDATE');
  END LOOP;

  INSERT INTO public.messenger_payment_types
    (code, name, version, applies_to, method, fixed_cup, cup_per_usd, percent, base, courier_id, shipping_zone_id,
     remittance_type_id, amount_from, amount_to, valid_from, valid_to, created_by)
  VALUES
    (v_code, v_name, v_version + 1, p_applies_to, p_method, p_fixed_cup, p_cup_per_usd, p_percent, p_base, p_courier_id, p_zone_id,
     p_type_id, p_amount_from, p_amount_to, v_from, p_valid_to, v_uid)
  RETURNING id INTO v_id;

  PERFORM public._courier_audit('messenger_payment_types', v_id, 'created', NULL,
    jsonb_build_object('code', v_code, 'version', v_version + 1, 'applies_to', p_applies_to, 'method', p_method,
                       'fixed_cup', p_fixed_cup, 'cup_per_usd', p_cup_per_usd, 'percent', p_percent, 'base', p_base,
                       'courier_id', p_courier_id, 'zone_id', p_zone_id, 'type_id', p_type_id,
                       'amount_from', p_amount_from, 'amount_to', p_amount_to, 'valid_from', v_from, 'valid_to', p_valid_to)::text,
    'UPDATE');
  RETURN v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_deactivate_messenger_payment_type(p_code text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_code text := btrim(COALESCE(p_code, ''));
  v_row  record;
  v_n    integer := 0;
BEGIN
  PERFORM public._courier_require_admin();
  PERFORM pg_advisory_xact_lock(hashtext('courier_rules'));
  IF NOT EXISTS (SELECT 1 FROM public.messenger_payment_types WHERE code = v_code) THEN
    RAISE EXCEPTION 'invalid_argument: unknown payment type code' USING ERRCODE = '22023';
  END IF;
  FOR v_row IN
    UPDATE public.messenger_payment_types SET is_active = false WHERE code = v_code AND is_active RETURNING id
  LOOP
    v_n := v_n + 1;
    PERFORM public._courier_audit('messenger_payment_types', v_row.id, 'is_active', 'true', 'false', 'UPDATE');
  END LOOP;
  RETURN v_n;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_set_margin_thresholds(
  p_kind     text,
  p_target   numeric,
  p_warning  numeric,
  p_critical numeric
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid uuid := public._courier_require_admin();
  v_old public.courier_margin_settings%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('courier_rules'));
  IF p_kind IS NULL OR p_kind NOT IN ('remittance', 'order') THEN
    RAISE EXCEPTION 'invalid_argument: kind must be remittance or order' USING ERRCODE = '22023';
  END IF;
  IF (p_target IS NOT NULL AND p_target NOT BETWEEN -100 AND 100) OR (p_warning IS NOT NULL AND p_warning NOT BETWEEN -100 AND 100)
     OR (p_critical IS NOT NULL AND p_critical NOT BETWEEN -100 AND 100)
     OR (p_critical IS NOT NULL AND p_warning IS NOT NULL AND p_critical > p_warning)
     OR (p_warning IS NOT NULL AND p_target IS NOT NULL AND p_warning > p_target)
     OR (p_critical IS NOT NULL AND p_target IS NOT NULL AND p_critical > p_target) THEN
    RAISE EXCEPTION 'invalid_argument: thresholds must satisfy critical <= warning <= target within -100..100' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_old FROM public.courier_margin_settings WHERE kind = p_kind FOR UPDATE;
  UPDATE public.courier_margin_settings
     SET target_pct = p_target, warning_pct = p_warning, critical_pct = p_critical, updated_by = v_uid, updated_at = now()
   WHERE kind = p_kind;
  IF v_old.target_pct IS DISTINCT FROM p_target THEN
    PERFORM public._courier_audit('courier_margin_settings', v_old.id, 'target_pct', v_old.target_pct::text, p_target::text, 'UPDATE');
  END IF;
  IF v_old.warning_pct IS DISTINCT FROM p_warning THEN
    PERFORM public._courier_audit('courier_margin_settings', v_old.id, 'warning_pct', v_old.warning_pct::text, p_warning::text, 'UPDATE');
  END IF;
  IF v_old.critical_pct IS DISTINCT FROM p_critical THEN
    PERFORM public._courier_audit('courier_margin_settings', v_old.id, 'critical_pct', v_old.critical_pct::text, p_critical::text, 'UPDATE');
  END IF;
END;
$function$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'admin_upsert_courier(uuid, text, text, text, boolean)',
    'admin_set_messenger_payment_type(text, text, text, text, numeric, numeric, numeric, text, uuid, uuid, uuid, numeric, numeric, timestamptz, timestamptz)',
    'admin_deactivate_messenger_payment_type(text)',
    'admin_set_margin_thresholds(text, numeric, numeric, numeric)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', f);
  END LOOP;
END $$;

COMMIT;
