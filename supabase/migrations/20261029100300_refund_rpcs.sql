-- ============================================================================
-- Refunds queue (4/4): admin RPCs.   PREPARED, NOT APPLIED
-- ============================================================================
-- admin_list_refunds(status, limit, offset, queue_state) -> jsonb { total, items[] }
--     status: pending (default) | refunded | not_applicable | all; limit clamped to 1..200.
--     queue_state is derived at read time from now() for OPEN requests (null for resolved ones):
--       on_hold   now < eligible_at          (48 h hold, not refundable yet, only "not applicable")
--       overdue   now >= due_at
--       due_soon  due_at - now <= 24 h
--       on_time   otherwise
--     Order: overdue, due_soon, on_time, on_hold, then due_at; resolved rows by resolved_at desc.
--     Each item is the table row plus operation_number, customer_name, customer_email, payment_proof_url (the path the
--     front signs with the private-proofs flow) and zelle_account { id, account_name, email }.
-- admin_refund_counts() -> jsonb { actionable, on_hold, due_soon, overdue, pending_amount_usd }
--     actionable = open requests past eligible_at (what the badge counts); overdue and due_soon are subsets of it.
-- admin_resolve_refund(id, 'refunded' | 'not_applicable', reference, refunded_at, reason) -> refund_requests
--     'refunded' fails with refund_on_hold before eligible_at; 'not_applicable' is allowed any time. Row lock + status check:
--     a second call with the same parameters returns the stored row, with different ones fails already_resolved.
--     Writes an activity_logs row (action refund_resolved, no PII in metadata).
-- All three: SECURITY DEFINER, authenticated only, and 42501 for anyone who is not an enabled admin (anon, customers, disabled
--     admins). Errors: 42501 not authorized, P0002 refund_not_found, 22023 invalid_argument | refund_on_hold | already_resolved.
-- ROLLBACK: supabase/rollbacks/20261029100300_refund_rpcs_down.sql
-- ============================================================================

BEGIN;

SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.admin_list_refunds(
  p_status      text    DEFAULT 'pending',
  p_limit       integer DEFAULT 100,
  p_offset      integer DEFAULT 0,
  p_queue_state text    DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_limit  integer := LEAST(GREATEST(COALESCE(p_limit, 100), 1), 200);
  v_offset integer := GREATEST(COALESCE(p_offset, 0), 0);
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL OR public.current_user_is_blocked() OR NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'insufficient_privilege: only an administrator can list refunds' USING ERRCODE = '42501';
  END IF;
  IF p_status IS NULL OR p_status NOT IN ('pending', 'refunded', 'not_applicable', 'all') THEN
    RAISE EXCEPTION 'invalid_argument: p_status' USING ERRCODE = '22023', DETAIL = 'p_status';
  END IF;
  IF p_queue_state IS NOT NULL AND p_queue_state NOT IN ('on_hold', 'on_time', 'due_soon', 'overdue') THEN
    RAISE EXCEPTION 'invalid_argument: p_queue_state' USING ERRCODE = '22023', DETAIL = 'p_queue_state';
  END IF;

  WITH base AS (
    SELECT r.*,
           CASE
             WHEN r.status <> 'pending' THEN NULL
             WHEN now() < r.eligible_at THEN 'on_hold'
             WHEN now() >= r.due_at THEN 'overdue'
             WHEN r.due_at - now() <= interval '24 hours' THEN 'due_soon'
             ELSE 'on_time'
           END AS queue_state
      FROM public.refund_requests r
     WHERE p_status = 'all' OR r.status = p_status
  ),
  filtered AS (
    SELECT * FROM base WHERE p_queue_state IS NULL OR queue_state = p_queue_state
  ),
  page AS (
    SELECT f.id,
           to_jsonb(f.*) || jsonb_build_object(
             'operation_number', COALESCE(o.order_number, rm.remittance_number),
             'customer_name', up.full_name,
             'customer_email', up.email,
             'payment_proof_url', COALESCE(o.payment_proof_url, rm.payment_proof_url),
             'zelle_account', CASE WHEN z.id IS NULL THEN NULL
                                   ELSE jsonb_build_object('id', z.id, 'account_name', z.account_name, 'email', z.email) END
           ) AS item,
           row_number() OVER (
             ORDER BY CASE f.queue_state WHEN 'overdue' THEN 0 WHEN 'due_soon' THEN 1 WHEN 'on_time' THEN 2 ELSE 3 END,
                      CASE WHEN f.status = 'pending' THEN f.due_at END,
                      f.resolved_at DESC NULLS LAST, f.id
           ) AS rn
      FROM filtered f
      LEFT JOIN public.orders o ON o.id = f.order_id
      LEFT JOIN public.remittances rm ON rm.id = f.remittance_id
      LEFT JOIN public.user_profiles up ON up.id = f.user_id
      LEFT JOIN public.zelle_accounts z ON z.id = f.zelle_account_id
  )
  SELECT jsonb_build_object(
           'total', (SELECT count(*) FROM filtered),
           'items', COALESCE((SELECT jsonb_agg(p.item ORDER BY p.rn) FROM (
                                SELECT item, rn FROM page ORDER BY rn LIMIT v_limit OFFSET v_offset) p), '[]'::jsonb))
    INTO v_result;
  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_refund_counts()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL OR public.current_user_is_blocked() OR NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'insufficient_privilege: only an administrator can read refund counts' USING ERRCODE = '42501';
  END IF;
  SELECT jsonb_build_object(
           'actionable', count(*) FILTER (WHERE now() >= eligible_at),
           'on_hold', count(*) FILTER (WHERE now() < eligible_at),
           'due_soon', count(*) FILTER (WHERE now() >= eligible_at AND now() < due_at AND due_at - now() <= interval '24 hours'),
           'overdue', count(*) FILTER (WHERE now() >= due_at),
           'pending_amount_usd', COALESCE(sum(amount) FILTER (WHERE currency = 'USD'), 0))
    INTO v_result
    FROM public.refund_requests
   WHERE status = 'pending';
  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_resolve_refund(
  p_refund_id   uuid,
  p_action      text,
  p_reference   text        DEFAULT NULL,
  p_refunded_at timestamptz DEFAULT NULL,
  p_reason      text        DEFAULT NULL
)
RETURNS public.refund_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid    uuid := auth.uid();
  v_ref    text := btrim(COALESCE(p_reference, ''));
  v_reason text := btrim(COALESCE(p_reason, ''));
  v_when   timestamptz;
  v_row    public.refund_requests%ROWTYPE;
BEGIN
  IF v_uid IS NULL OR public.current_user_is_blocked() OR NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'insufficient_privilege: only an administrator can resolve a refund' USING ERRCODE = '42501';
  END IF;
  IF p_action IS NULL OR p_action NOT IN ('refunded', 'not_applicable') THEN
    RAISE EXCEPTION 'invalid_argument: p_action must be refunded or not_applicable' USING ERRCODE = '22023', DETAIL = 'p_action';
  END IF;

  SELECT * INTO v_row FROM public.refund_requests WHERE id = p_refund_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'refund_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_row.status <> 'pending' THEN
    IF v_row.status = p_action
       AND ((p_action = 'refunded' AND v_row.refund_reference = v_ref)
         OR (p_action = 'not_applicable' AND v_row.resolution_reason = v_reason)) THEN
      RETURN v_row;
    END IF;
    RAISE EXCEPTION 'already_resolved: this refund request is already %', v_row.status USING ERRCODE = '22023';
  END IF;

  IF p_action = 'refunded' THEN
    IF now() < v_row.eligible_at THEN
      RAISE EXCEPTION 'refund_on_hold: refunds start 48 hours after the cancellation' USING ERRCODE = '22023',
        DETAIL = 'eligible_at=' || to_char(v_row.eligible_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
    END IF;
    IF char_length(v_ref) NOT BETWEEN 1 AND 200 THEN
      RAISE EXCEPTION 'invalid_argument: p_reference is required (1 to 200 characters)' USING ERRCODE = '22023', DETAIL = 'p_reference';
    END IF;
    v_when := COALESCE(p_refunded_at, now());
    IF v_when > now() OR v_when < v_row.eligible_at THEN
      RAISE EXCEPTION 'invalid_argument: p_refunded_at must be between eligible_at and now' USING ERRCODE = '22023', DETAIL = 'p_refunded_at';
    END IF;
    UPDATE public.refund_requests
       SET status = 'refunded', refund_reference = v_ref, refunded_at = v_when, resolved_by = v_uid, resolved_at = now()
     WHERE id = v_row.id
    RETURNING * INTO v_row;
  ELSE
    IF char_length(v_reason) NOT BETWEEN 1 AND 500 THEN
      RAISE EXCEPTION 'invalid_argument: p_reason is required (1 to 500 characters)' USING ERRCODE = '22023', DETAIL = 'p_reason';
    END IF;
    UPDATE public.refund_requests
       SET status = 'not_applicable', resolution_reason = v_reason, resolved_by = v_uid, resolved_at = now()
     WHERE id = v_row.id
    RETURNING * INTO v_row;
  END IF;

  INSERT INTO public.activity_logs (action, entity_type, entity_id, performed_by, description, metadata)
  VALUES ('refund_resolved', 'refund_request', v_row.id, v_uid::text, 'Refund request resolved: ' || p_action,
          jsonb_build_object('refund_id', v_row.id, 'action', p_action, 'amount', v_row.amount, 'currency', v_row.currency,
                             'operation_type', v_row.operation_type, 'order_id', v_row.order_id,
                             'remittance_id', v_row.remittance_id));
  RETURN v_row;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_list_refunds(text, integer, integer, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_refund_counts() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_resolve_refund(uuid, text, text, timestamptz, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_refunds(text, integer, integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_refund_counts() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_resolve_refund(uuid, text, text, timestamptz, text) TO authenticated;

COMMIT;
