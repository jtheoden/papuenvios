-- ============================================================================
-- Customer refund status (R5 front): my_operation_refund(kind, operation_id).   PREPARED, NOT APPLIED
-- ============================================================================
-- Read-only, STABLE, SECURITY DEFINER. Returns to the OWNER of the operation (orders.user_id / remittances.user_id) the state of
-- the refund episodes of that operation: { refunds: [ { status, stage, amount, currency, cancelled_at, eligible_at, due_at,
-- refunded_at } ] }. Deliberately NOT returned: proof path or state, refund reference, resolver, resolution reason (internal notes),
-- payer data, dispute state.
--   stage: on_hold (before eligible_at) | processing (pending, hold elapsed) | refunded | not_applicable
-- Anyone who is not the owner (admins included) gets { refunds: [] }: no error that would reveal whether the operation exists.
-- Errors: 42501 without a session / blocked user; 22023 for an invalid kind or null id.
-- Nothing existing is replaced and no row is written. ROLLBACK: supabase/rollbacks/20261103100000_my_operation_refund_down.sql
-- ============================================================================

BEGIN;

SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.my_operation_refund(p_kind text, p_operation_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_result jsonb;
BEGIN
  IF v_uid IS NULL OR public.current_user_is_blocked() THEN
    RAISE EXCEPTION 'insufficient_privilege: sign in to read this' USING ERRCODE = '42501';
  END IF;
  IF p_kind IS NULL OR p_kind NOT IN ('order', 'remittance') OR p_operation_id IS NULL THEN
    RAISE EXCEPTION 'invalid_argument: operation' USING ERRCODE = '22023', DETAIL = 'operation';
  END IF;

  SELECT jsonb_build_object('refunds', COALESCE(jsonb_agg(jsonb_build_object(
           'status', r.status,
           'stage', CASE WHEN r.status = 'pending' THEN (CASE WHEN now() < r.eligible_at THEN 'on_hold' ELSE 'processing' END)
                         ELSE r.status END,
           'amount', r.amount, 'currency', r.currency, 'cancelled_at', r.cancelled_at,
           'eligible_at', r.eligible_at, 'due_at', r.due_at, 'refunded_at', r.refunded_at
         ) ORDER BY r.created_at, r.id), '[]'::jsonb))
    INTO v_result
    FROM public.refund_requests r
   WHERE r.user_id = v_uid
     AND ((p_kind = 'order' AND r.order_id = p_operation_id) OR (p_kind = 'remittance' AND r.remittance_id = p_operation_id));
  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.my_operation_refund(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_operation_refund(text, uuid) TO authenticated;

COMMIT;
