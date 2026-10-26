-- ============================================================================
-- Courier management, M3: courier payments and the period report.   PREPARED, NOT APPLIED
-- ============================================================================
-- WHY: "paid" needs evidence (who, when, how, how much) and the owner needs totals per courier and period.
--   See .claude/docs/plan_courier-management-module.md (phase 1, M3). Strictly additive: new table, new FK on the NEW
--   courier_accruals table, new functions. No pre-existing table is modified.
-- WHAT:
--   1. courier_payments: immutable (guard trigger), amount computed by the server as the sum of the selected accruals.
--      courier_id NULL = payment of accruals that have no registered courier (dual mode).
--   2. courier_accruals.payment_id gets its FK (courier_accruals is an M2 table).
--   3. admin_register_courier_payment(courier, accrual_ids[], method, reference, paid_at, notes): all-or-nothing; rejects
--      empty/duplicate lists, accruals of another courier, void, already paid, UNKNOWN-amount accruals, totals <= 0.
--      Rows are locked FOR UPDATE, so the same accrual can never be paid twice.
--   4. admin_courier_report(from, to, courier): aggregates by courier over delivered_at in [from, to): deliveries,
--      remittance volume, accrued / paid / pending / void, voided-after-payment, unknown amounts and margin flags counted
--      apart (an unknown amount is NEVER added as 0). No customer or operation identifiers are returned.
-- Idempotent: IF NOT EXISTS / CREATE OR REPLACE / guarded constraint.
-- Apply order: M1 -> M2 -> M3. Requires M1 and M2. Rollback order: M3 -> M2 -> M1.
-- ROLLBACK: supabase/rollbacks/20261031120000_courier_payments_and_report_down.sql
-- ============================================================================

BEGIN;

SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.courier_payments (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  courier_id uuid REFERENCES public.couriers(id) ON DELETE RESTRICT,
  amount_cup numeric(12,2) NOT NULL CHECK (amount_cup > 0),
  amount_usd numeric(12,2),
  method     text NOT NULL CHECK (char_length(btrim(method)) BETWEEN 1 AND 50),
  reference  text CHECK (reference IS NULL OR char_length(reference) <= 200),
  notes      text CHECK (notes IS NULL OR char_length(notes) <= 1000),
  paid_at    timestamptz NOT NULL,
  paid_by    uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS courier_payments_courier_idx ON public.courier_payments (courier_id, paid_at DESC);

ALTER TABLE public.courier_payments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.courier_payments FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.courier_payments TO authenticated;
DROP POLICY IF EXISTS courier_payments_select_admin ON public.courier_payments;
CREATE POLICY courier_payments_select_admin ON public.courier_payments
  FOR SELECT TO authenticated USING ((SELECT public.is_admin_user()));

CREATE OR REPLACE FUNCTION public.courier_payments_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
BEGIN
  RAISE EXCEPTION 'courier_payments_is_append_only: a payment is evidence and is never edited or deleted' USING ERRCODE = '42501';
END;
$function$;
REVOKE ALL ON FUNCTION public.courier_payments_immutable() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS courier_payments_immutable ON public.courier_payments;
CREATE TRIGGER courier_payments_immutable
  BEFORE UPDATE OR DELETE ON public.courier_payments
  FOR EACH ROW EXECUTE FUNCTION public.courier_payments_immutable();

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'courier_accruals_payment_fk') THEN
    ALTER TABLE public.courier_accruals
      ADD CONSTRAINT courier_accruals_payment_fk FOREIGN KEY (payment_id) REFERENCES public.courier_payments(id) ON DELETE RESTRICT;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.admin_register_courier_payment(
  p_courier_id  uuid,
  p_accrual_ids uuid[],
  p_method      text,
  p_reference   text,
  p_paid_at     timestamptz,
  p_notes       text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid    uuid := public._courier_require_admin();
  v_method text := btrim(COALESCE(p_method, ''));
  v_paid   timestamptz := COALESCE(p_paid_at, now());
  v_n      integer;
  v_found  integer;
  v_bad    integer;
  v_cup    numeric;
  v_usd    numeric;
  v_id     uuid;
BEGIN
  v_n := COALESCE(cardinality(p_accrual_ids), 0);
  IF v_n < 1 OR v_n > 1000 OR v_n <> (SELECT count(DISTINCT x) FROM unnest(p_accrual_ids) x) THEN
    RAISE EXCEPTION 'invalid_argument: 1 to 1000 distinct accruals are required' USING ERRCODE = '22023';
  END IF;
  IF char_length(v_method) NOT BETWEEN 1 AND 50 OR char_length(COALESCE(p_reference, '')) > 200
     OR char_length(COALESCE(p_notes, '')) > 1000 THEN
    RAISE EXCEPTION 'invalid_argument: method (1-50), reference (max 200) or notes (max 1000) out of range' USING ERRCODE = '22023';
  END IF;
  IF v_paid > now() + interval '1 minute' THEN
    RAISE EXCEPTION 'invalid_argument: paid_at cannot be in the future' USING ERRCODE = '22023';
  END IF;
  IF p_courier_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.couriers WHERE id = p_courier_id) THEN
    RAISE EXCEPTION 'invalid_argument: courier not found' USING ERRCODE = '22023';
  END IF;

  -- Lock in a stable order (no deadlock between two payments); a concurrent payment of the same accrual waits here.
  PERFORM 1 FROM public.courier_accruals WHERE id = ANY (p_accrual_ids) ORDER BY id FOR UPDATE;

  SELECT count(*),
         count(*) FILTER (WHERE a.status <> 'calculated' OR a.payment_id IS NOT NULL OR a.amount_cup IS NULL
                            OR a.courier_id IS DISTINCT FROM p_courier_id),
         sum(a.amount_cup),
         CASE WHEN bool_or(a.amount_usd IS NULL) THEN NULL ELSE sum(a.amount_usd) END
    INTO v_found, v_bad, v_cup, v_usd
    FROM public.courier_accruals a WHERE a.id = ANY (p_accrual_ids);
  IF v_found <> v_n THEN
    RAISE EXCEPTION 'invalid_argument: an accrual does not exist' USING ERRCODE = '22023';
  END IF;
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'invalid_argument: every accrual must be calculated, unpaid, of known amount and of this courier' USING ERRCODE = '22023';
  END IF;
  IF v_cup <= 0 THEN
    RAISE EXCEPTION 'invalid_argument: nothing to pay (total <= 0)' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.courier_payments (courier_id, amount_cup, amount_usd, method, reference, notes, paid_at, paid_by)
  VALUES (p_courier_id, v_cup, v_usd, v_method, NULLIF(btrim(p_reference), ''), NULLIF(btrim(p_notes), ''), v_paid, v_uid)
  RETURNING id INTO v_id;
  UPDATE public.courier_accruals SET status = 'paid', payment_id = v_id WHERE id = ANY (p_accrual_ids);
  PERFORM public._courier_audit('courier_payments', v_id, 'created', NULL, v_cup::text, 'UPDATE');
  RETURN v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_courier_report(p_from timestamptz, p_to timestamptz, p_courier_id uuid DEFAULT NULL)
RETURNS TABLE (
  courier_id uuid, courier_name text, remittance_deliveries integer, order_deliveries integer,
  remittance_amount_sent_usd numeric, accrued_cup numeric, accrued_usd numeric, paid_cup numeric, pending_cup numeric,
  voided_cup numeric, voided_after_payment_cup numeric, unknown_amount_count integer,
  margin_warning_count integer, margin_critical_count integer, margin_unknown_count integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  PERFORM public._courier_require_admin();
  RETURN QUERY
  SELECT a.courier_id, c.name,
         (count(*) FILTER (WHERE a.component = 'delivery' AND a.status <> 'void' AND a.remittance_id IS NOT NULL))::integer,
         (count(*) FILTER (WHERE a.component = 'delivery' AND a.status <> 'void' AND a.order_id IS NOT NULL))::integer,
         COALESCE(sum(r.amount_sent) FILTER (WHERE a.component = 'delivery' AND a.status <> 'void' AND r.currency_sent = 'USD'), 0),
         COALESCE(sum(a.amount_cup) FILTER (WHERE a.status <> 'void'), 0),
         COALESCE(sum(a.amount_usd) FILTER (WHERE a.status <> 'void'), 0),
         COALESCE(sum(a.amount_cup) FILTER (WHERE a.status = 'paid'), 0),
         COALESCE(sum(a.amount_cup) FILTER (WHERE a.status = 'calculated'), 0),
         COALESCE(sum(a.amount_cup) FILTER (WHERE a.status = 'void' AND a.payment_id IS NULL), 0),
         COALESCE(sum(a.amount_cup) FILTER (WHERE a.status = 'void' AND a.payment_id IS NOT NULL), 0),
         (count(*) FILTER (WHERE a.component = 'delivery' AND a.status <> 'void' AND a.amount_cup IS NULL))::integer,
         (count(*) FILTER (WHERE a.component = 'delivery' AND a.status <> 'void' AND a.margin_status = 'warning'))::integer,
         (count(*) FILTER (WHERE a.component = 'delivery' AND a.status <> 'void' AND a.margin_status = 'critical'))::integer,
         (count(*) FILTER (WHERE a.component = 'delivery' AND a.status <> 'void' AND a.margin_status = 'unknown'))::integer
    FROM public.courier_accruals a
    LEFT JOIN public.couriers c ON c.id = a.courier_id
    LEFT JOIN public.remittances r ON r.id = a.remittance_id
   WHERE (p_from IS NULL OR a.delivered_at >= p_from) AND (p_to IS NULL OR a.delivered_at < p_to)
     AND (p_courier_id IS NULL OR a.courier_id = p_courier_id)
   GROUP BY a.courier_id, c.name
   ORDER BY c.name NULLS LAST;
END;
$function$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'admin_register_courier_payment(uuid, uuid[], text, text, timestamptz, text)',
    'admin_courier_report(timestamptz, timestamptz, uuid)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', f);
  END LOOP;
END $$;

COMMIT;
