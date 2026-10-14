-- ============================================================================
-- F0: Payment methods catalog + per-flow on/off toggle
-- ============================================================================
-- Context (plan_bizum-payment-method.md, sections 5, 9.4, 9.6, 9.8)
--   Today every order has payment_method = 'zelle' and `remittances` has no
--   payment_method column. This migration adds the catalog and the switch; it
--   does NOT add Bizum itself (the bizum row exists as available = false, i.e.
--   "coming soon", and cannot be enabled until a later phase flips `available`).
--
-- Behaviour
--   * Toggle is per flow (orders / remittances) and per method.
--   * Only admins (public.is_admin_user()) can toggle, and only through
--     public.set_payment_method_enabled(). No client role has INSERT / UPDATE /
--     DELETE on the table.
--   * Disabling the LAST enabled method of a flow is allowed only with
--     p_confirm_last = true (maintenance mode); the UI then shows a "payments
--     temporarily unavailable" state instead of a broken form.
--   * A toggle never touches existing orders / remittances: they keep being
--     validated / rejected. It only blocks the CREATION of new ones (BEFORE
--     INSERT trigger on both tables).
--
-- Rejection contract of the creation guard
--   RAISE EXCEPTION 'payment_method_disabled' USING ERRCODE = 'P0001'.
--   P0001 (raise_exception) was chosen over 42501 because this is a business
--   rule, not a privilege failure, and the front maps it by message. Other
--   RPC errors: payment_method_forbidden (42501), payment_method_invalid_flow,
--   payment_method_not_found, payment_method_unavailable,
--   payment_method_last_enabled, payment_method_reason_too_long (all P0001).
--
-- Why the guard is SECURITY INVOKER and reads through a helper
--   Customers have no SELECT on payment_methods. If the trigger function were
--   SECURITY DEFINER, current_user would be the owner (postgres) and the
--   bypass `current_user IN ('postgres', ...)` would fire for EVERY insert,
--   turning the guard into a no-op. So the trigger stays SECURITY INVOKER (same
--   as guard_orders_owner_insert) and reads the catalog through the tiny
--   definer helper public.payment_method_allowed(), which returns a boolean
--   only. The helper is deliberately VOLATILE: a STABLE function would reuse the
--   snapshot of the calling INSERT, taken BEFORE the shared advisory lock was
--   granted, and could miss a toggle that committed while the insert waited.
--
-- Trigger firing order (BEFORE row triggers fire alphabetically by name; live
-- names read from pg_trigger)
--   orders INSERT      : guard_orders_owner_insert
--                        -> guard_payment_method_enabled   (this migration)
--                        -> guard_reset_lock_orders
--                        -> trigger_set_order_number
--   remittances INSERT : guard_payment_method_enabled       (this migration)
--                        -> guard_remittance_owner_insert
--                        -> guard_reset_lock_remittances
--                        -> trigger_generate_remittance_number
--   Note the asymmetry: "guard_o..." sorts before "guard_p..." but
--   "guard_p..." sorts before "guard_r...". On remittances the payment-method
--   check therefore runs before the owner guard; both only reject, so the
--   outcome is the same, only the error message differs for a payload that
--   violates both. Both fire before the platform-reset lock and numbering
--   triggers, so a rejected insert consumes no side effects.
--
-- Owner UPDATE guards
--   guard_remittance_owner_update (live definition, verified) compares every
--   key of to_jsonb(NEW) outside its c_allowed whitelist against OLD, so the
--   new remittances.payment_method column is blocked for owners BY DEFAULT.
--   It is intentionally NOT added to any whitelist. guard_orders_owner_update
--   already excludes payment_method.
--
-- remittances.payment_method
--   NOT NULL DEFAULT 'zelle' kept permanently: browser tabs open before the
--   deploy do not send the field. Constant default => no table rewrite.
--   Violators before VALIDATE (run manually if desired; with the constant
--   default it is 0 by construction):
--     SELECT count(*) FROM public.remittances
--      WHERE payment_method NOT IN ('zelle', 'bizum');
--
-- Deploy order: apply this migration BEFORE shipping the front that calls the
-- RPCs. The front fails open for checkout if the RPC is missing (the trigger
-- is the real enforcement) and shows an error state in the admin card.
--
-- ROLLBACK (exact inverse; safe to run at any time, drops the toggle state)
-- DROP TRIGGER IF EXISTS guard_payment_method_enabled ON public.orders;
-- DROP TRIGGER IF EXISTS guard_payment_method_enabled ON public.remittances;
-- DROP FUNCTION IF EXISTS public.guard_payment_method_enabled();
-- DROP FUNCTION IF EXISTS public.payment_method_allowed(text, text);
-- DROP FUNCTION IF EXISTS public.list_payment_methods_public();
-- DROP FUNCTION IF EXISTS public.set_payment_method_enabled(text, text, boolean, text, boolean);
-- ALTER TABLE public.remittances DROP CONSTRAINT IF EXISTS remittances_payment_method_check;
-- ALTER TABLE public.remittances DROP COLUMN IF EXISTS payment_method;
-- DROP TABLE IF EXISTS public.payment_methods;
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Catalog table
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.payment_methods (
  code                    text PRIMARY KEY CHECK (code IN ('zelle', 'bizum')),
  available               boolean NOT NULL DEFAULT false,
  enabled_for_orders      boolean NOT NULL DEFAULT false,
  enabled_for_remittances boolean NOT NULL DEFAULT false,
  disabled_reason         text,
  updated_at              timestamptz NOT NULL DEFAULT now(),
  updated_by              uuid,
  CONSTRAINT payment_methods_unavailable_not_enabled
    CHECK (available OR (NOT enabled_for_orders AND NOT enabled_for_remittances)),
  CONSTRAINT payment_methods_reason_length
    CHECK (disabled_reason IS NULL OR char_length(disabled_reason) <= 200)
);

-- Seed only when missing: re-running must never re-enable a method an admin turned off.
INSERT INTO public.payment_methods (code, available, enabled_for_orders, enabled_for_remittances)
VALUES
  ('zelle', true, true, true),
  ('bizum', false, false, false)
ON CONFLICT (code) DO NOTHING;

ALTER TABLE public.payment_methods ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payment_methods_admin_read ON public.payment_methods;
CREATE POLICY payment_methods_admin_read ON public.payment_methods
  FOR SELECT TO authenticated
  USING (public.is_admin_user());

-- Supabase default privileges hand new tables to anon / authenticated: strip them first.
REVOKE ALL ON public.payment_methods FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.payment_methods TO authenticated;

-- ----------------------------------------------------------------------------
-- 2. Toggle RPC (the only write path)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_payment_method_enabled(
  p_code text,
  p_flow text,
  p_enabled boolean,
  p_reason text DEFAULT NULL,
  p_confirm_last boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_row       public.payment_methods%ROWTYPE;
  v_prev      boolean;
  v_remaining integer;
  v_reason    text;
  v_orders    boolean;
  v_remit     boolean;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'payment_method_forbidden' USING ERRCODE = '42501';
  END IF;

  IF p_flow IS NULL OR p_flow NOT IN ('orders', 'remittances') THEN
    RAISE EXCEPTION 'payment_method_invalid_flow' USING ERRCODE = 'P0001';
  END IF;

  IF p_enabled IS NULL THEN
    RAISE EXCEPTION 'payment_method_invalid_flow' USING ERRCODE = 'P0001';
  END IF;

  v_reason := NULLIF(btrim(COALESCE(p_reason, '')), '');
  IF v_reason IS NOT NULL AND char_length(v_reason) > 200 THEN
    RAISE EXCEPTION 'payment_method_reason_too_long' USING ERRCODE = 'P0001';
  END IF;

  -- Serialize against other toggles; creation triggers take the shared flavour.
  PERFORM pg_advisory_xact_lock(hashtext('payment_methods'));

  SELECT * INTO v_row
    FROM public.payment_methods
   WHERE code = p_code
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'payment_method_not_found' USING ERRCODE = 'P0001';
  END IF;

  v_prev := CASE p_flow WHEN 'orders' THEN v_row.enabled_for_orders ELSE v_row.enabled_for_remittances END;

  -- Idempotent: already in the requested state, nothing to write or audit.
  IF v_prev = p_enabled THEN
    RETURN jsonb_build_object(
      'code', v_row.code,
      'available', v_row.available,
      'enabled_for_orders', v_row.enabled_for_orders,
      'enabled_for_remittances', v_row.enabled_for_remittances,
      'disabled_reason', v_row.disabled_reason,
      'updated_at', v_row.updated_at,
      'updated_by', v_row.updated_by
    );
  END IF;

  IF p_enabled AND NOT v_row.available THEN
    RAISE EXCEPTION 'payment_method_unavailable' USING ERRCODE = 'P0001';
  END IF;

  IF NOT p_enabled THEN
    SELECT count(*) INTO v_remaining
      FROM public.payment_methods pm
     WHERE pm.code <> p_code
       AND pm.available
       AND CASE p_flow WHEN 'orders' THEN pm.enabled_for_orders ELSE pm.enabled_for_remittances END;

    IF v_remaining = 0 AND NOT COALESCE(p_confirm_last, false) THEN
      RAISE EXCEPTION 'payment_method_last_enabled' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  v_orders := CASE WHEN p_flow = 'orders' THEN p_enabled ELSE v_row.enabled_for_orders END;
  v_remit  := CASE WHEN p_flow = 'remittances' THEN p_enabled ELSE v_row.enabled_for_remittances END;

  UPDATE public.payment_methods
     SET enabled_for_orders      = v_orders,
         enabled_for_remittances = v_remit,
         disabled_reason = CASE
           WHEN v_orders AND v_remit THEN NULL
           WHEN NOT p_enabled AND v_reason IS NOT NULL THEN v_reason
           ELSE disabled_reason
         END,
         updated_at = now(),
         updated_by = auth.uid()
   WHERE code = p_code
   RETURNING * INTO v_row;

  -- Audit INSIDE the function: activity_logs INSERT is open to any authenticated
  -- user, so a client-written log line could be forged. No PII: the actor is the
  -- auth uid; the free-text reason still passes the activity_logs redaction trigger.
  INSERT INTO public.activity_logs (action, entity_type, entity_id, performed_by, description, metadata)
  VALUES (
    'payment_method_toggled',
    'payment_method',
    NULL,
    auth.uid()::text,
    format('Payment method %s %s for %s', p_code, CASE WHEN p_enabled THEN 'enabled' ELSE 'disabled' END, p_flow),
    jsonb_build_object(
      'code', p_code,
      'flow', p_flow,
      'enabled', p_enabled,
      'previous', v_prev,
      'confirm_last', COALESCE(p_confirm_last, false),
      'reason', v_reason
    )
  );

  RETURN jsonb_build_object(
    'code', v_row.code,
    'available', v_row.available,
    'enabled_for_orders', v_row.enabled_for_orders,
    'enabled_for_remittances', v_row.enabled_for_remittances,
    'disabled_reason', v_row.disabled_reason,
    'updated_at', v_row.updated_at,
    'updated_by', v_row.updated_by
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.set_payment_method_enabled(text, text, boolean, text, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_payment_method_enabled(text, text, boolean, text, boolean)
  TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 3. Public (customer-facing) listing: explicit columns only
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_payment_methods_public()
RETURNS TABLE (
  code text,
  available boolean,
  enabled_for_orders boolean,
  enabled_for_remittances boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT pm.code, pm.available, pm.enabled_for_orders, pm.enabled_for_remittances
    FROM public.payment_methods pm
   ORDER BY pm.code;
$function$;

REVOKE ALL ON FUNCTION public.list_payment_methods_public()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_payment_methods_public()
  TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 4. remittances.payment_method
-- ----------------------------------------------------------------------------
ALTER TABLE public.remittances
  ADD COLUMN IF NOT EXISTS payment_method text NOT NULL DEFAULT 'zelle';

DO $mig$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'remittances_payment_method_check'
       AND conrelid = 'public.remittances'::regclass
  ) THEN
    ALTER TABLE public.remittances
      ADD CONSTRAINT remittances_payment_method_check
      CHECK (payment_method IN ('zelle', 'bizum')) NOT VALID;
  END IF;
END
$mig$;

-- Safe: every existing row got the constant default 'zelle' (0 violators).
ALTER TABLE public.remittances VALIDATE CONSTRAINT remittances_payment_method_check;

-- ----------------------------------------------------------------------------
-- 5. Creation guard (BEFORE INSERT on orders and remittances)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.payment_method_allowed(p_code text, p_flow text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  -- Fails closed: unknown / NULL code, unknown flow or missing row => false.
  RETURN COALESCE(
    (
      SELECT pm.available AND CASE p_flow
               WHEN 'orders' THEN pm.enabled_for_orders
               WHEN 'remittances' THEN pm.enabled_for_remittances
               ELSE false
             END
        FROM public.payment_methods pm
       WHERE pm.code = p_code
    ),
    false
  );
END;
$function$;

-- The trigger runs as the inserting role, so that role needs EXECUTE. The helper
-- returns a bare boolean (same information as list_payment_methods_public).
REVOKE ALL ON FUNCTION public.payment_method_allowed(text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.payment_method_allowed(text, text)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.guard_payment_method_enabled()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $function$
DECLARE
  v_flow text;
BEGIN
  IF current_user IN ('postgres', 'service_role', 'supabase_admin')
     OR auth.uid() IS NULL
     OR public.is_admin_user()
     OR public.is_super_admin() THEN
    RETURN NEW;
  END IF;

  v_flow := CASE TG_TABLE_NAME
    WHEN 'orders' THEN 'orders'
    WHEN 'remittances' THEN 'remittances'
    ELSE NULL
  END;

  -- Wait for any in-flight toggle (it holds the exclusive flavour of this lock).
  PERFORM pg_advisory_xact_lock_shared(hashtext('payment_methods'));

  IF v_flow IS NULL OR NOT public.payment_method_allowed(NEW.payment_method, v_flow) THEN
    RAISE EXCEPTION 'payment_method_disabled'
      USING ERRCODE = 'P0001',
            DETAIL = format('table=%s method=%s', TG_TABLE_NAME, COALESCE(NEW.payment_method, 'NULL'));
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.guard_payment_method_enabled() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS guard_payment_method_enabled ON public.orders;
CREATE TRIGGER guard_payment_method_enabled
  BEFORE INSERT ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.guard_payment_method_enabled();

DROP TRIGGER IF EXISTS guard_payment_method_enabled ON public.remittances;
CREATE TRIGGER guard_payment_method_enabled
  BEFORE INSERT ON public.remittances
  FOR EACH ROW EXECUTE FUNCTION public.guard_payment_method_enabled();
