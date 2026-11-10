-- ============================================================================
-- Phase 1.5 / S4 (audit_phase1_price_tamper.md, patch P5): ownership on remittance_status_history inserts (T-18) and a
-- minimal offer_id validity guard on orders / remittances (T-06) with an off / warn / block kill switch.
--                                                                  PREPARED, NOT APPLIED
-- ============================================================================
-- PART A. rsh_insert policy (T-18)
--   Before: WITH CHECK (true): any authenticated user could write history rows for ANY remittance.
--   After:  the remittance must belong to the caller or the caller is an admin:
--           EXISTS (SELECT 1 FROM remittances r WHERE r.id = remittance_id AND (r.user_id = auth.uid() OR is_admin_user())).
--   Flows checked (rg over src/ and supabase/): the front end never INSERTs into remittance_status_history (the only
--   reference, remittanceService.getRemittanceDetails, SELECTs). The real rows are written by the SECURITY DEFINER trigger
--   audit_remittance_status_change, which is not subject to the policy. Production: 58 history rows, 0 orphans, 0 rows whose
--   changed_by is neither the remittance owner nor an admin. rsh_select is untouched. Idempotent (DROP POLICY IF EXISTS).
--
-- PART B. offers_select_authenticated is DELIBERATELY KEPT (audit question 5, "if in doubt, do not remove it")
--   The policy lets any authenticated user read ALL offers (inactive, expired, codes). Removing it would break the order
--   screens: orderService.js (getUserOrders / getOrderDetails) enriches each order with
--   offers.select('id, code, discount_type, discount_value, name_es, name_en, is_active') BY ID, including offers that are
--   inactive or expired today, and offers_select_public_active only returns active in-window offers. The characterization test
--   in phase15S4HistoryAndOffers.test.js pins this. The leak is limited to marketing data (no customer data), so it is
--   documented risk, not a blocker. Safe way to close it later: a SECURITY DEFINER RPC / view that returns the offer fields of
--   the caller's own orders, switch orderService to it, then drop the policy (separate slice, needs the owner's "dale").
--
-- PART C. guard_offer_id_validity (BEFORE INSERT ... WHEN offer_id IS NOT NULL on orders AND remittances)
--   blocking class (rejected in 'block', recorded as flag mode 'warn' in 'warn'):
--     offer_inactive_or_out_of_window  not is_active, or now() outside [start_date, end_date]
--     below_min_purchase               ORDERS only: subtotal < min_purchase_amount (remittance amounts are in another unit,
--                                      the client does not apply min_purchase to them)
--     global_limit_reached             max_usage_global set and offer_usage rows for the offer >= max_usage_global
--     user_limit_reached               max_usage_per_user set and offer_usage rows of NEW.user_id >= max_usage_per_user
--   Counts are taken before the new row because the client records offer_usage AFTER the order (best effort, no lock: the
--   audit accepts this as "mejor esfuerzo"; atomic usage counting stays in F4a). The legacy columns usage_limit, usage_count and
--   user_usage_limit are ignored on purpose: the client never reads them (validateAndGetOffer uses max_usage_*).
--   NOT validated here (F4a): discount formula, applies_to, stacking, that discount_amount matches the offer.
--   Every comparison is "(cond) IS NOT TRUE" (NULL rejects). Same bypass as S2/S3: auth.uid() IS NULL, GUC role in
--   (service_role, postgres, supabase_admin), admins, super_admins; never current_user inside SECURITY DEFINER.
--   Uniform error 'offer_id_rejected' (SQLSTATE 23514, no DETAIL/HINT).
--   Flags go to the existing public.price_integrity_flags (S2), source_table = 'orders' | 'remittances'.
--
-- KILL SWITCH: system_config key offer_id_guard_mode: 'off' | 'warn' | 'block'. Ships 'warn'; missing or invalid = 'warn'.
--   SELECT public.set_offer_id_guard_mode('block');  (super_admin only, logged to activity_logs). It is independent from the
--   S2 and S3 switches so each can be promoted to block on its own schedule.
--
-- TRIGGER ORDER: guard_order_offer_id sorts before guard_orders_owner_insert and guard_payment_method_enabled and well before
--   seal_bizum_payment (alphabetical, '_' < 's'); guard_remittance_offer_id sorts before guard_remittance_owner_insert.
--
-- Production verification (read-only SELECTs via MCP, 2026-10-19, project qcwnlbpultscerwdnzbm):
--   offers: 3, active: 0. orders with offer_id: 0. remittances with offer_id: 0. offer_usage rows linked: none relevant.
--   Therefore the guard cannot flag or reject any existing row and no live flow uses offers today (latent risk only).
--   remittance_status_history: 58 rows, 0 orphans, 0 rows with a foreign author (see PART A).
--   system_config has no offer_id_guard_mode row.
--
-- Preconditions: S2 applied (price_integrity_flags). Apply order: S1, S2, S3, S4. Needs the owner's "dale".
--   The orders/remittances exact-trigger-list characterization tests include the two new triggers.
--
-- ROLLBACK (exact inverse):
-- DROP POLICY IF EXISTS rsh_insert ON public.remittance_status_history;
-- CREATE POLICY rsh_insert ON public.remittance_status_history FOR INSERT WITH CHECK (true);
-- DROP TRIGGER IF EXISTS guard_order_offer_id ON public.orders;
-- DROP TRIGGER IF EXISTS guard_remittance_offer_id ON public.remittances;
-- DROP FUNCTION IF EXISTS public.guard_offer_id_validity();
-- DROP FUNCTION IF EXISTS public.set_offer_id_guard_mode(text);
-- DROP FUNCTION IF EXISTS public._offer_id_guard_mode();
-- DELETE FROM public.system_config WHERE key = 'offer_id_guard_mode';
-- DELETE FROM public.price_integrity_flags WHERE rule IN ('offer_inactive_or_out_of_window', 'below_min_purchase', 'global_limit_reached', 'user_limit_reached', 'offer_not_found');
-- ============================================================================

SET LOCAL lock_timeout = '5s';

-- ----------------------------------------------------------------------------------------------------
-- A. rsh_insert with ownership
-- ----------------------------------------------------------------------------------------------------
DROP POLICY IF EXISTS rsh_insert ON public.remittance_status_history;
CREATE POLICY rsh_insert ON public.remittance_status_history
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.remittances r
       WHERE r.id = remittance_status_history.remittance_id
         AND (r.user_id = (SELECT auth.uid()) OR (SELECT public.is_admin_user()))
    )
  );

-- ----------------------------------------------------------------------------------------------------
-- C. Kill switch + offer validity guard
-- ----------------------------------------------------------------------------------------------------
INSERT INTO public.system_config (key, value_text, description)
SELECT 'offer_id_guard_mode', 'warn',
       'Offer id guard mode: off | warn | block. warn records violations in price_integrity_flags without blocking; block rejects them. Missing or invalid values behave as warn.'
 WHERE NOT EXISTS (SELECT 1 FROM public.system_config c WHERE c.key = 'offer_id_guard_mode');

CREATE OR REPLACE FUNCTION public._offer_id_guard_mode()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT COALESCE(
    (SELECT value_text FROM public.system_config
      WHERE key = 'offer_id_guard_mode' AND value_text IN ('off', 'warn', 'block')),
    'warn');
$function$;

REVOKE ALL ON FUNCTION public._offer_id_guard_mode() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.set_offer_id_guard_mode(p_mode text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_before text;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE = '42501';
  END IF;
  IF p_mode IS NULL OR p_mode NOT IN ('off', 'warn', 'block') THEN
    RAISE EXCEPTION 'invalid_mode: expected off, warn or block' USING ERRCODE = '22023';
  END IF;

  v_before := public._offer_id_guard_mode();

  INSERT INTO public.system_config (key, value_text, description)
  VALUES ('offer_id_guard_mode', p_mode,
          'Offer id guard mode: off | warn | block. Missing or invalid values behave as warn.')
  ON CONFLICT (key) DO UPDATE SET value_text = EXCLUDED.value_text;

  INSERT INTO public.activity_logs (action, entity_type, entity_id, performed_by, description, metadata)
  VALUES ('offer_id_guard_mode_changed', 'system_config', NULL, COALESCE(auth.uid()::text, 'service_role'),
          'Offer id guard mode changed',
          jsonb_build_object('before', v_before, 'after', p_mode));

  RETURN p_mode;
END;
$function$;

REVOKE ALL ON FUNCTION public.set_offer_id_guard_mode(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_offer_id_guard_mode(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.guard_offer_id_validity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_mode  text;
  v_offer public.offers%ROWTYPE;
  v_n     bigint;
  v_subtotal numeric;
  v_block text[] := ARRAY[]::text[];
  v_rule  text;
BEGIN
  IF auth.uid() IS NULL
     OR COALESCE(current_setting('role', true), '') IN ('service_role', 'postgres', 'supabase_admin')
     OR public.is_admin_user()
     OR public.is_super_admin() THEN
    RETURN NEW;
  END IF;

  v_mode := public._offer_id_guard_mode();
  IF v_mode = 'off' THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_offer FROM public.offers WHERE id = NEW.offer_id;
  IF NOT FOUND THEN
    v_block := array_append(v_block, 'offer_not_found'::text);
  ELSE
    IF (v_offer.is_active IS TRUE AND now() >= v_offer.start_date AND now() <= v_offer.end_date) IS NOT TRUE THEN
      v_block := array_append(v_block, 'offer_inactive_or_out_of_window'::text);
    END IF;

    -- remittances has no subtotal column: read it dynamically (plpgsql resolves NEW.<field> at plan time)
    IF TG_TABLE_NAME = 'orders' AND v_offer.min_purchase_amount IS NOT NULL THEN
      v_subtotal := (to_jsonb(NEW) ->> 'subtotal')::numeric;
      IF (v_subtotal >= v_offer.min_purchase_amount) IS NOT TRUE THEN
        v_block := array_append(v_block, 'below_min_purchase'::text);
      END IF;
    END IF;

    IF v_offer.max_usage_global IS NOT NULL THEN
      SELECT count(*) INTO v_n FROM public.offer_usage u WHERE u.offer_id = v_offer.id;
      IF (v_n < v_offer.max_usage_global) IS NOT TRUE THEN
        v_block := array_append(v_block, 'global_limit_reached'::text);
      END IF;
    END IF;

    IF v_offer.max_usage_per_user IS NOT NULL THEN
      SELECT count(*) INTO v_n FROM public.offer_usage u WHERE u.offer_id = v_offer.id AND u.user_id = NEW.user_id;
      IF (v_n < v_offer.max_usage_per_user) IS NOT TRUE THEN
        v_block := array_append(v_block, 'user_limit_reached'::text);
      END IF;
    END IF;
  END IF;

  IF array_length(v_block, 1) IS NOT NULL AND v_mode = 'block' THEN
    RAISE EXCEPTION 'offer_id_rejected' USING ERRCODE = '23514';
  END IF;

  FOREACH v_rule IN ARRAY v_block LOOP
    INSERT INTO public.price_integrity_flags (source_table, source_id, user_id, rule, mode, details)
    VALUES (TG_TABLE_NAME, NEW.id, NEW.user_id, v_rule, 'warn', jsonb_build_object('offer_id', NEW.offer_id));
  END LOOP;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.guard_offer_id_validity() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS guard_order_offer_id ON public.orders;
CREATE TRIGGER guard_order_offer_id
  BEFORE INSERT ON public.orders
  FOR EACH ROW
  WHEN (NEW.offer_id IS NOT NULL)
  EXECUTE FUNCTION public.guard_offer_id_validity();

DROP TRIGGER IF EXISTS guard_remittance_offer_id ON public.remittances;
CREATE TRIGGER guard_remittance_offer_id
  BEFORE INSERT ON public.remittances
  FOR EACH ROW
  WHEN (NEW.offer_id IS NOT NULL)
  EXECUTE FUNCTION public.guard_offer_id_validity();
