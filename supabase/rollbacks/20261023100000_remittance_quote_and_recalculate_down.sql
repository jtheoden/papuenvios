-- Rollback of 20261023100000_remittance_quote_and_recalculate.sql.
-- Restores the previous body of recalculate_remittance_at_current_rate (prod 20261016192617) and drops the helper.
-- If 20261023120000_remittance_commission_override.sql is applied, roll THAT one back first (it redefines the same RPC).
BEGIN;

CREATE OR REPLACE FUNCTION public.recalculate_remittance_at_current_rate(p_remittance_id uuid)
 RETURNS remittances
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_rem          public.remittances%ROWTYPE;
  v_type         public.remittance_types%ROWTYPE;
  v_from_id      uuid;
  v_to_id        uuid;
  v_rate         numeric;
  v_comm_pct     numeric;
  v_comm_fixed   numeric;
  v_comm_total   numeric;
  v_to_deliver   numeric;
BEGIN
  SELECT * INTO v_rem FROM public.remittances WHERE id = p_remittance_id FOR UPDATE;
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
  SELECT * INTO v_type FROM public.remittance_types WHERE id = v_rem.remittance_type_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'remittance_type_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_rem.currency_sent = v_rem.currency_delivered THEN
    v_rate := 1;
  ELSIF v_type.exchange_rate IS NOT NULL AND v_type.exchange_rate > 0 THEN
    v_rate := v_type.exchange_rate;
  ELSE
    -- Central rate: the ACTIVE DIRECT pair (sent -> delivered) of exchange_rates. No inverse, no default.
    SELECT id INTO v_from_id FROM public.currencies
      WHERE code = v_rem.currency_sent AND is_active = true LIMIT 1;
    SELECT id INTO v_to_id FROM public.currencies
      WHERE code = v_rem.currency_delivered AND is_active = true LIMIT 1;
    IF v_from_id IS NOT NULL AND v_to_id IS NOT NULL THEN
      SELECT er.rate INTO v_rate
      FROM public.exchange_rates er
      WHERE er.from_currency_id = v_from_id
        AND er.to_currency_id = v_to_id
        AND er.is_active = true
        AND er.rate > 0
      ORDER BY er.effective_date DESC, er.updated_at DESC, er.id DESC
      LIMIT 1;
    END IF;
    IF v_rate IS NULL OR v_rate <= 0 THEN
      RAISE EXCEPTION 'exchange_rate_unavailable: no active % -> % rate in exchange_rates',
        v_rem.currency_sent, v_rem.currency_delivered
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  v_comm_pct   := COALESCE(v_type.commission_percentage, 0);
  v_comm_fixed := COALESCE(v_type.commission_fixed, 0);
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

REVOKE ALL ON FUNCTION public.recalculate_remittance_at_current_rate(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recalculate_remittance_at_current_rate(uuid) TO authenticated, service_role;

DROP FUNCTION IF EXISTS public._remittance_quote(numeric, numeric, numeric, numeric, text, numeric);
DROP FUNCTION IF EXISTS public._remittance_discount_source(uuid, numeric);

COMMIT;
