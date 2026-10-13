-- ============================================================================
-- Remittances: owner UPDATE guard + server-side recalculation RPC (SECURITY)
-- ============================================================================
-- Vulnerability:
--   RLS policy "users can update own remittances" (UPDATE, authenticated,
--   USING / WITH CHECK user_id = current_user_id()) has no column restriction and
--   `authenticated` holds table-level UPDATE. An owner could therefore change ANY
--   column of their own remittance: self-validate a payment (payment_validated,
--   status), inflate amount_to_deliver, rewrite exchange_rate / commission_*,
--   drop discount/delivery_cost, swap recipient data after validation, etc.
--
-- Fix (RLS policies and table GRANTs are intentionally NOT changed):
--   1. public.recalculate_remittance_at_current_rate(uuid): SECURITY DEFINER RPC
--      that replaces the client-side money UPDATE done by
--      recalculateRemittanceAtCurrentRate. It re-checks ownership (or admin) and
--      status, and replicates the JS rate/commission formula exactly.
--   2. public.guard_remittance_owner_update() BEFORE UPDATE trigger (SECURITY
--      INVOKER): for a normal owner session, every column outside a small
--      allow-list must be unchanged, and the allow-listed columns may only change
--      along the legal owner flows (upload payment proof, cancel). The "unchanged"
--      check is generic (to_jsonb(NEW) - allowed keys = to_jsonb(OLD) - allowed
--      keys), so columns added in the future are protected BY DEFAULT.
--
-- Owner flows derived from the application code:
--   uploadPaymentProof : payment_pending | payment_rejected -> payment_proof_uploaded
--                        (payment_proof_url, payment_reference, payment_proof_notes,
--                         payment_proof_uploaded_at, payer_phone, status, updated_at)
--   cancelRemittance   : payment_pending | payment_rejected | payment_proof_uploaded
--                        -> cancelled (cancelled_at, cancelled_by, cancellation_reason,
--                         status, updated_at). The service itself would also accept
--                        payment_validated / processing, but the UI only offers cancel
--                        on payment_pending / payment_rejected; after validation the
--                        money flow is admin-owned, so the guard denies those.
--   recalculate        : money columns, via the RPC only (runs as the function owner).
--
-- Bypass (guard returns NEW untouched): current_user in (postgres, service_role,
--   supabase_admin), auth.uid() IS NULL (no end-user JWT: migrations, cron, edge
--   functions with service role), is_admin_user() or is_super_admin(). Admin flows
--   (validatePayment, rejectPayment, startProcessing, confirmDelivery,
--   completeRemittance, delivery proof upload) run as admin sessions and are not
--   affected.
--
-- Dependency: apply AFTER 20261013140000_add_payer_phone.sql and
--   20261013160000_remittances_delivery_cost.sql (payer_phone, delivery_cost and
--   shipping_zone_id must exist; the guard itself is column-agnostic but the owner
--   upload flow writes payer_phone).
--
-- Idempotent: CREATE OR REPLACE FUNCTION, DROP TRIGGER IF EXISTS + CREATE TRIGGER.
-- No backfill, no data changes.
--
-- Verification: see supabase/probes/remittances_owner_update_guard_probes.sql and:
--   SELECT tgname, tgenabled FROM pg_trigger
--   WHERE tgrelid = 'public.remittances'::regclass AND tgname = 'guard_remittance_owner_update';
--   SELECT proname, prosecdef, proconfig FROM pg_proc
--   WHERE proname IN ('recalculate_remittance_at_current_rate', 'guard_remittance_owner_update');
--   SELECT has_function_privilege('anon', 'public.recalculate_remittance_at_current_rate(uuid)', 'EXECUTE');          -- false
--   SELECT has_function_privilege('authenticated', 'public.recalculate_remittance_at_current_rate(uuid)', 'EXECUTE'); -- true
--
-- ROLLBACK (manual):
--   DROP TRIGGER IF EXISTS guard_remittance_owner_update ON public.remittances;
--   DROP FUNCTION IF EXISTS public.guard_remittance_owner_update();
--   DROP FUNCTION IF EXISTS public.recalculate_remittance_at_current_rate(uuid);
--   (Rolling back re-opens the vulnerability and requires reverting the client
--    change in src/lib/remittanceService.js only if the RPC is dropped.)
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. RPC: recalculate a payment_pending / payment_rejected remittance at the
--    current type rate. Mirrors getRemittanceExchangeRate (remittanceService.js)
--    -> getExchangeRate / getConversionRate (currencyService.js):
--      same currency            -> 1
--      type.exchange_rate > 0   -> type.exchange_rate
--      exchange_rates direct    -> latest active from->to
--      exchange_rates inverse   -> 1 / latest active to->from
--      official_currency_rates  -> rate_to_usd(from) / rate_to_usd(to), with the
--                                  static fallbacks USD=1, MLC=1, CUP=0.041
--      otherwise                -> 1
--    (the JS resolves currency ids first, requiring both codes active in
--     public.currencies; if not, getExchangeRate throws and the caller uses 1.)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.recalculate_remittance_at_current_rate(p_remittance_id uuid)
RETURNS public.remittances
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
VOLATILE
AS $function$
DECLARE
  v_rem          public.remittances%ROWTYPE;
  v_type         public.remittance_types%ROWTYPE;
  v_from_id      uuid;
  v_to_id        uuid;
  v_rate         numeric;
  v_inv          numeric;
  v_from_usd     numeric;
  v_to_usd       numeric;
  v_comm_pct     numeric;
  v_comm_fixed   numeric;
  v_comm_total   numeric;
  v_to_deliver   numeric;
BEGIN
  SELECT * INTO v_rem
  FROM public.remittances
  WHERE id = p_remittance_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'remittance_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF NOT (
    v_rem.user_id = public.current_user_id()
    OR public.is_admin_user()
    OR public.is_super_admin()
  ) THEN
    RAISE EXCEPTION 'insufficient_privilege: not the owner of this remittance' USING ERRCODE = '42501';
  END IF;

  IF v_rem.status NOT IN ('payment_pending', 'payment_rejected') THEN
    RAISE EXCEPTION 'invalid_status: only payment_pending or payment_rejected remittances can be recalculated'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_type
  FROM public.remittance_types
  WHERE id = v_rem.remittance_type_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'remittance_type_not_found' USING ERRCODE = 'P0002';
  END IF;

  -- Exchange rate resolution (see header)
  IF v_rem.currency_sent = v_rem.currency_delivered THEN
    v_rate := 1;
  ELSIF v_type.exchange_rate IS NOT NULL AND v_type.exchange_rate > 0 THEN
    v_rate := v_type.exchange_rate;
  ELSE
    SELECT id INTO v_from_id FROM public.currencies
      WHERE code = v_rem.currency_sent AND is_active = true LIMIT 1;
    SELECT id INTO v_to_id FROM public.currencies
      WHERE code = v_rem.currency_delivered AND is_active = true LIMIT 1;

    IF v_from_id IS NOT NULL AND v_to_id IS NOT NULL THEN
      SELECT rate INTO v_rate
      FROM public.exchange_rates
      WHERE from_currency_id = v_from_id AND to_currency_id = v_to_id AND is_active = true
      ORDER BY effective_date DESC
      LIMIT 1;

      IF v_rate IS NULL OR v_rate <= 0 THEN
        v_rate := NULL;
        SELECT rate INTO v_inv
        FROM public.exchange_rates
        WHERE from_currency_id = v_to_id AND to_currency_id = v_from_id AND is_active = true
        ORDER BY effective_date DESC
        LIMIT 1;

        IF v_inv IS NOT NULL AND v_inv <> 0 THEN
          v_rate := 1 / v_inv;
        END IF;
      END IF;

      IF v_rate IS NULL OR v_rate <= 0 THEN
        v_rate := NULL;
        SELECT rate_to_usd INTO v_from_usd FROM public.official_currency_rates
          WHERE currency_code = v_rem.currency_sent;
        SELECT rate_to_usd INTO v_to_usd FROM public.official_currency_rates
          WHERE currency_code = v_rem.currency_delivered;

        v_from_usd := COALESCE(v_from_usd, CASE v_rem.currency_sent WHEN 'USD' THEN 1 WHEN 'MLC' THEN 1 WHEN 'CUP' THEN 0.041 END);
        v_to_usd   := COALESCE(v_to_usd,   CASE v_rem.currency_delivered WHEN 'USD' THEN 1 WHEN 'MLC' THEN 1 WHEN 'CUP' THEN 0.041 END);

        IF v_from_usd IS NOT NULL AND v_to_usd IS NOT NULL AND v_to_usd <> 0 THEN
          v_rate := v_from_usd / v_to_usd;
        END IF;
      END IF;
    END IF;

    IF v_rate IS NULL OR v_rate <= 0 THEN
      v_rate := 1;
    END IF;
  END IF;

  v_comm_pct   := COALESCE(v_type.commission_percentage, 0);
  v_comm_fixed := COALESCE(v_type.commission_fixed, 0);

  -- Same order of operations as the JS: the UNROUNDED commission feeds the
  -- delivered amount; both results are then rounded to 2 decimals.
  v_comm_total := (v_rem.amount_sent * v_comm_pct / 100) + v_comm_fixed;
  v_to_deliver := (v_rem.amount_sent - v_comm_total) * v_rate;

  UPDATE public.remittances
  SET exchange_rate         = v_rate,
      commission_percentage = v_comm_pct,
      commission_fixed      = v_comm_fixed,
      commission_total      = round(v_comm_total, 2),
      amount_to_deliver     = round(v_to_deliver, 2),
      updated_at            = now()
  WHERE id = p_remittance_id
  RETURNING * INTO v_rem;

  RETURN v_rem;
END;
$function$;

REVOKE ALL ON FUNCTION public.recalculate_remittance_at_current_rate(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.recalculate_remittance_at_current_rate(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.recalculate_remittance_at_current_rate(uuid) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 2. Guard trigger: restrict what an OWNER session may change on remittances
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_remittance_owner_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $function$
DECLARE
  -- Columns the owner may touch at all (each further constrained below)
  c_allowed constant text[] := ARRAY[
    'payment_proof_url', 'payment_reference', 'payment_proof_notes',
    'payment_proof_uploaded_at', 'payer_phone', 'updated_at',
    'status', 'cancelled_at', 'cancelled_by', 'cancellation_reason'
  ];
  c_proof constant text[] := ARRAY[
    'payment_proof_url', 'payment_reference', 'payment_proof_notes',
    'payment_proof_uploaded_at', 'payer_phone'
  ];
  c_cancel constant text[] := ARRAY['cancelled_at', 'cancelled_by', 'cancellation_reason'];
  v_new jsonb;
  v_old jsonb;
  v_key text;
BEGIN
  -- Trusted contexts: privileged DB roles, no end-user JWT, admins
  IF current_user IN ('postgres', 'service_role', 'supabase_admin')
     OR auth.uid() IS NULL
     OR public.is_admin_user()
     OR public.is_super_admin() THEN
    RETURN NEW;
  END IF;

  v_new := to_jsonb(NEW);
  v_old := to_jsonb(OLD);

  -- 1. Every column outside the allow-list must be unchanged (future columns included)
  FOR v_key IN
    SELECT k FROM jsonb_object_keys(v_new) AS k WHERE k <> ALL (c_allowed)
  LOOP
    IF (v_new -> v_key) IS DISTINCT FROM (v_old -> v_key) THEN
      RAISE EXCEPTION 'remittance_owner_update_forbidden: column %', v_key USING ERRCODE = '42501';
    END IF;
  END LOOP;

  -- 2. Payment proof columns: only while the payment is still open
  FOREACH v_key IN ARRAY c_proof LOOP
    IF (v_new -> v_key) IS DISTINCT FROM (v_old -> v_key)
       AND OLD.status NOT IN ('payment_pending', 'payment_rejected') THEN
      RAISE EXCEPTION 'remittance_owner_update_forbidden: column %', v_key USING ERRCODE = '42501';
    END IF;
  END LOOP;

  -- 3. Status: only the legal owner transitions
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT (
      (OLD.status IN ('payment_pending', 'payment_rejected') AND NEW.status = 'payment_proof_uploaded')
      OR (OLD.status IN ('payment_pending', 'payment_rejected', 'payment_proof_uploaded') AND NEW.status = 'cancelled')
    ) THEN
      RAISE EXCEPTION 'remittance_owner_update_forbidden: column status' USING ERRCODE = '42501';
    END IF;
  END IF;

  -- 4. cancelled_*: only together with a transition to cancelled, and never forged
  FOREACH v_key IN ARRAY c_cancel LOOP
    IF (v_new -> v_key) IS DISTINCT FROM (v_old -> v_key)
       AND NOT (NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled') THEN
      RAISE EXCEPTION 'remittance_owner_update_forbidden: column %', v_key USING ERRCODE = '42501';
    END IF;
  END LOOP;

  IF NEW.cancelled_by IS DISTINCT FROM OLD.cancelled_by
     AND NEW.cancelled_by IS NOT NULL
     AND NEW.cancelled_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'remittance_owner_update_forbidden: column cancelled_by' USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS guard_remittance_owner_update ON public.remittances;
CREATE TRIGGER guard_remittance_owner_update
  BEFORE UPDATE ON public.remittances
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_remittance_owner_update();

COMMIT;
