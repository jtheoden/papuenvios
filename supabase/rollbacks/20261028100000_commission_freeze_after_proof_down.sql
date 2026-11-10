-- ROLLBACK of 20261028100000_commission_freeze_after_proof.sql: restores the body of 20261025100000 (adjustment in
-- payment_pending / payment_rejected / payment_proof_uploaded, and payment_validated lowering only). Remittances and
-- history rows are untouched. Revert the front in Vercel FIRST if it relies on the freeze. Same signature, grants re-issued.
BEGIN;

SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.admin_set_remittance_commission(
  p_remittance_id uuid,
  p_commission    numeric,
  p_reason        text
)
RETURNS public.remittances
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid    uuid := auth.uid();
  v_reason text := btrim(COALESCE(p_reason, ''));
  v_rem    public.remittances%ROWTYPE;
  v_type   public.remittance_types%ROWTYPE;
  v_disc   record;
  v_quote  record;
BEGIN
  IF v_uid IS NULL OR NOT (public.is_admin_user() OR public.is_super_admin()) THEN
    RAISE EXCEPTION 'insufficient_privilege: only an administrator can adjust a commission' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_rem FROM public.remittances WHERE id = p_remittance_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'remittance_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_rem.status NOT IN ('payment_pending', 'payment_rejected', 'payment_proof_uploaded', 'payment_validated') THEN
    RAISE EXCEPTION 'invalid_status: the commission can only be adjusted before the delivery starts'
      USING ERRCODE = '22023';
  END IF;
  IF p_commission IS NULL OR p_commission <> round(p_commission, 2)
     OR p_commission < 0 OR p_commission >= v_rem.amount_sent THEN
    RAISE EXCEPTION 'invalid_commission: must be between 0 and the amount sent (excluded), with at most 2 decimals'
      USING ERRCODE = '22023';
  END IF;
  IF v_rem.status = 'payment_validated' AND p_commission > v_rem.commission_total THEN
    RAISE EXCEPTION 'invalid_commission: once the payment is validated the commission can only be lowered'
      USING ERRCODE = '22023';
  END IF;
  IF char_length(v_reason) < 10 OR char_length(v_reason) > 500 THEN
    RAISE EXCEPTION 'invalid_reason: a reason of 10 to 500 characters is required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_type FROM public.remittance_types WHERE id = v_rem.remittance_type_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'remittance_type_not_found' USING ERRCODE = 'P0002';
  END IF;

  -- What the system would charge today at the rate the customer was shown (offer discount included).
  SELECT * INTO v_disc FROM public._remittance_discount_source(v_rem.offer_id, v_rem.discount_amount);
  SELECT * INTO v_quote FROM public._remittance_quote(
    v_rem.amount_sent, COALESCE(v_type.commission_percentage, 0), COALESCE(v_type.commission_fixed, 0),
    v_rem.exchange_rate, v_disc.discount_type, v_disc.discount_value);

  INSERT INTO public.remittance_commission_overrides (remittance_id, commission, standard_commission, reason, set_by)
  VALUES (p_remittance_id, p_commission, v_quote.commission_total, v_reason, v_uid);

  UPDATE public.remittances
  SET commission_total  = p_commission,
      discount_amount   = 0,
      amount_to_deliver = round((v_rem.amount_sent - p_commission) * v_quote.rate4, 2),
      updated_at        = now()
  WHERE id = p_remittance_id
  RETURNING * INTO v_rem;

  RETURN v_rem;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_set_remittance_commission(uuid, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_remittance_commission(uuid, numeric, text) TO authenticated;

COMMIT;
