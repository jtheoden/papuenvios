-- ============================================================================
-- Commission client acceptance, M3: RPCs.   PREPARED, NOT APPLIED
-- ============================================================================
-- WHY: the admin's commission adjustment must open (or close) a customer-facing proposal, and the customer must have a
--   safe way to accept it. See .claude/docs/plan_commission-client-acceptance.md (2.4, 2.5).
-- WHAT:
--   1. admin_set_remittance_commission(uuid, numeric, text): CREATE OR REPLACE over the body of
--      20261028100000_commission_freeze_after_proof.sql (status gate, validations, history, UPDATE and return value are
--      unchanged), plus, in the same transaction and under the same FOR UPDATE:
--        base = baseline of the open 'pending' proposal, else the commission before this call (= last seen/accepted)
--        > base  -> previous pending 'superseded', new 'pending' (same base), alert commission_change_pending
--        < base  -> previous pending 'reverted', new 'informed', alert commission_lowered
--        = base  -> previous pending 'reverted' (no new row), alert commission_change_reverted; no pending -> nothing
--      The admin reason is never copied to proposals or alerts (wave 4 ND-5).
--   2. remittance_accept_commission(remittance_id, proposal_id): owner only. Does NOT touch money columns: the
--      remittance already carries the proposed commission; accepting validates that and releases the payment.
--   _remittance_transition is NOT replaced (its production body comes from 20261025110000).
-- Apply order: M1 (table) -> M2 -> M3. Requires M1 first. Rollback order: M3 -> M2 -> M1.
-- ROLLBACK: supabase/rollbacks/20261028100300_commission_acceptance_rpcs_down.sql (restores the M0 body, drops accept).
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
  v_uid         uuid := auth.uid();
  v_reason      text := btrim(COALESCE(p_reason, ''));
  v_rem         public.remittances%ROWTYPE;
  v_type        public.remittance_types%ROWTYPE;
  v_disc        record;
  v_quote       record;
  v_prev        numeric(10,2);
  v_override_id bigint;
  v_open        public.remittance_commission_proposals%ROWTYPE;
  v_base        numeric(10,2);
  v_prop_id     uuid;
  v_title       text;
  v_fmt         constant text := 'FM999999990.00';
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

  v_prev := v_rem.commission_total;

  INSERT INTO public.remittance_commission_overrides (remittance_id, commission, standard_commission, reason, set_by)
  VALUES (p_remittance_id, p_commission, v_quote.commission_total, v_reason, v_uid)
  RETURNING id INTO v_override_id;

  UPDATE public.remittances
  SET commission_total  = p_commission,
      discount_amount   = 0,
      amount_to_deliver = round((v_rem.amount_sent - p_commission) * v_quote.rate4, 2),
      updated_at        = now()
  WHERE id = p_remittance_id
  RETURNING * INTO v_rem;

  -- ---- customer-facing proposal (same transaction, same remittance lock) ----
  SELECT * INTO v_open FROM public.remittance_commission_proposals
   WHERE remittance_id = p_remittance_id AND status = 'pending' FOR UPDATE;
  v_base := COALESCE(v_open.baseline_commission, v_prev);

  IF v_open.id IS NOT NULL THEN
    UPDATE public.remittance_commission_proposals
       SET status = CASE WHEN p_commission > v_base THEN 'superseded' ELSE 'reverted' END,
           responded_at = now(), responded_by = v_uid
     WHERE id = v_open.id;
    UPDATE public.user_alerts
       SET is_dismissed = true, dismissed_at = now(), action_required = false
     WHERE metadata ->> 'remittanceId' = p_remittance_id::text
       AND alert_type = 'commission_change_pending' AND NOT is_dismissed;
  END IF;

  v_title := 'Cambió la comisión de su remesa ' || COALESCE(v_rem.remittance_number, '');

  IF p_commission > v_base THEN
    INSERT INTO public.remittance_commission_proposals
      (remittance_id, override_id, direction, baseline_commission, new_commission, status, created_by)
    VALUES (p_remittance_id, v_override_id, 'increase', v_base, p_commission, 'pending', v_uid)
    RETURNING id INTO v_prop_id;
    INSERT INTO public.user_alerts (user_id, alert_type, severity, title, message, metadata, action_required, action_url)
    VALUES (v_rem.user_id, 'commission_change_pending', 'warning', v_title,
            'La comisión pasó de ' || to_char(v_base, v_fmt) || ' a ' || to_char(p_commission, v_fmt) || ' ' || v_rem.currency_sent
            || '. Usted paga lo mismo. Acepte para poder enviar su comprobante de pago.',
            jsonb_build_object('remittanceId', p_remittance_id, 'proposalId', v_prop_id), true, 'my-remittances');
  ELSIF p_commission < v_base THEN
    INSERT INTO public.remittance_commission_proposals
      (remittance_id, override_id, direction, baseline_commission, new_commission, status, created_by)
    VALUES (p_remittance_id, v_override_id, 'decrease', v_base, p_commission, 'informed', v_uid)
    RETURNING id INTO v_prop_id;
    INSERT INTO public.user_alerts (user_id, alert_type, severity, title, message, metadata, action_required, action_url)
    VALUES (v_rem.user_id, 'commission_lowered', 'info', v_title,
            'Bajamos la comisión de ' || to_char(v_base, v_fmt) || ' a ' || to_char(p_commission, v_fmt) || ' ' || v_rem.currency_sent
            || '. No tiene que hacer nada.',
            jsonb_build_object('remittanceId', p_remittance_id, 'proposalId', v_prop_id), false, 'my-remittances');
  ELSIF v_open.id IS NOT NULL THEN
    INSERT INTO public.user_alerts (user_id, alert_type, severity, title, message, metadata, action_required, action_url)
    VALUES (v_rem.user_id, 'commission_change_reverted', 'info', v_title,
            'El ajuste de comisión fue retirado; todo sigue como antes.',
            jsonb_build_object('remittanceId', p_remittance_id, 'proposalId', v_open.id), false, 'my-remittances');
  END IF;

  RETURN v_rem;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_set_remittance_commission(uuid, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_remittance_commission(uuid, numeric, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.remittance_accept_commission(p_remittance_id uuid, p_proposal_id uuid)
RETURNS public.remittance_commission_proposals
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid   uuid := auth.uid();
  v_owner uuid;
  v_rem   public.remittances%ROWTYPE;
  v_prop  public.remittance_commission_proposals%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF public.current_user_is_blocked() THEN
    RAISE EXCEPTION 'user_disabled' USING ERRCODE = '42501';
  END IF;

  -- Foreign / unknown remittances look the same (no existence oracle). Admins do NOT accept on the customer's behalf.
  SELECT r.user_id INTO v_owner FROM public.remittances r WHERE r.id = p_remittance_id;
  IF NOT FOUND OR v_owner IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_rem FROM public.remittances WHERE id = p_remittance_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'remittance_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_rem.status NOT IN ('payment_pending', 'payment_rejected') THEN
    RAISE EXCEPTION 'invalid_transition' USING ERRCODE = '22023',
      DETAIL = jsonb_build_object('status', v_rem.status, 'action', 'accept_commission')::text;
  END IF;

  SELECT * INTO v_prop FROM public.remittance_commission_proposals
   WHERE id = p_proposal_id AND remittance_id = p_remittance_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'proposal_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_prop.status = 'accepted' THEN
    v_prop.created_by := NULL; -- idempotent; same sanitizing as below
    v_prop.override_id := NULL;
    v_prop.responded_by := NULL;
    RETURN v_prop;
  END IF;
  IF v_prop.status <> 'pending' THEN
    RAISE EXCEPTION 'proposal_not_open' USING ERRCODE = '22023', DETAIL = v_prop.status;
  END IF;
  IF v_rem.commission_total IS DISTINCT FROM v_prop.new_commission THEN
    RAISE EXCEPTION 'proposal_stale' USING ERRCODE = '22023';
  END IF;

  UPDATE public.remittance_commission_proposals
     SET status = 'accepted', responded_at = now(), responded_by = v_uid
   WHERE id = v_prop.id
  RETURNING * INTO v_prop;
  v_prop.created_by := NULL; -- admin-side columns are not returned to the owner
  v_prop.override_id := NULL;
  v_prop.responded_by := NULL;

  UPDATE public.user_alerts
     SET is_dismissed = true, dismissed_at = now(), action_required = false
   WHERE metadata ->> 'remittanceId' = p_remittance_id::text
     AND alert_type = 'commission_change_pending' AND NOT is_dismissed;

  -- Broadcasts the change through Realtime; touches no money column and no status.
  UPDATE public.remittances SET updated_at = now() WHERE id = p_remittance_id;

  RETURN v_prop;
END;
$function$;

REVOKE ALL ON FUNCTION public.remittance_accept_commission(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remittance_accept_commission(uuid, uuid) TO authenticated;

-- Admin read of the full rows (created_by / override_id are not column-readable by authenticated, see M1).
CREATE OR REPLACE FUNCTION public.admin_get_commission_proposals(p_remittance_id uuid)
RETURNS SETOF public.remittance_commission_proposals
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT (public.is_admin_user() OR public.is_super_admin()) THEN
    RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT * FROM public.remittance_commission_proposals
   WHERE remittance_id = p_remittance_id ORDER BY created_at, id;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_get_commission_proposals(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_commission_proposals(uuid) TO authenticated;

COMMIT;
