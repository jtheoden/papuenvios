-- ============================================================================
-- Commission override: freeze after proof upload (M0).   PREPARED, NOT APPLIED
-- ============================================================================
-- WHY: owner decision: the commission is frozen when the customer uploads the payment proof. The customer pays an amount
--   based on the commission shown; changing it afterwards (even down) invalidates what they transferred.
--
-- WHAT: CREATE OR REPLACE public.admin_set_remittance_commission(uuid, numeric, text), same signature, same grants,
--   same audit/history behaviour as 20261025100000. Only the status gate changes:
--     payment_pending | payment_rejected -> any valid commission
--     anything else (proof uploaded, validated, processing, delivered, completed, cancelled) -> 22023 invalid_status
--   The "lower only in payment_validated" branch is removed (that status is now refused by the gate).
--   Production body verified identical (md5) to 20261025100000 before writing this.
--
-- Deploy order: independent of the front (the UI of the front PR already disables the button). Needs the owner's "dale"
--   to apply remotely.
-- ROLLBACK: supabase/rollbacks/20261028100000_commission_freeze_after_proof_down.sql (restores 20261025100000).
-- ============================================================================

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
  IF v_rem.status NOT IN ('payment_pending', 'payment_rejected') THEN
    RAISE EXCEPTION 'invalid_status: the commission is frozen once the payment proof is uploaded'
      USING ERRCODE = '22023';
  END IF;
  IF p_commission IS NULL OR p_commission <> round(p_commission, 2)
     OR p_commission < 0 OR p_commission >= v_rem.amount_sent THEN
    RAISE EXCEPTION 'invalid_commission: must be between 0 and the amount sent (excluded), with at most 2 decimals'
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
