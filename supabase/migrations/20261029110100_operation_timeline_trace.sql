-- ============================================================================
-- Refund audit trail (R5a 2/3): read-only timeline and trace.   PREPARED, NOT APPLIED
-- ============================================================================
-- Three admin RPCs, all STABLE and read-only (they write nothing), SECURITY DEFINER, 42501 for anyone who is not an enabled admin:
--   admin_operation_timeline(operation_type, operation_id) -> jsonb array, ascending by time (max 500 rows):
--       { ts, source, kind, actor_id, ref_id, summary }.  Sources: status_history (order/remittance status changes),
--       refund_event (this module's events), refund_marker (derived: eligible_at / due_at, nothing is stored for them),
--       commission_proposal / commission_override (remittances). Ties at the same instant: status change, refund event, marker,
--       commission. summary never carries free text, references, phones, proof paths or URLs.
--   admin_get_operation_refunds(operation_type, operation_id) -> jsonb array: every refund episode of the operation (cancel,
--       reopen, cancel again = several), whitelisted columns only, with queue_state and proof_state.
--   admin_refund_trace(operation_type, operation_id) -> jsonb { timeline, refunds, gaps[] } where each gap is { code, refund_id }:
--       no_created_event, no_closed_event, refunded_without_proof, self_dealing_attempt, orphan_events,
--       paid_cancel_without_refund_request (remittances only: the paid state of an order is not kept in its history).
--   A missing link never raises: it is reported as a gap.
-- Nothing existing is replaced. ROLLBACK: supabase/rollbacks/20261029110100_operation_timeline_trace_down.sql
-- ============================================================================

BEGIN;

SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public._refund_assert_admin_operation(p_operation_type text, p_operation_id uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF auth.uid() IS NULL OR public.current_user_is_blocked() OR NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'insufficient_privilege: only an administrator can read this' USING ERRCODE = '42501';
  END IF;
  IF p_operation_type IS NULL OR p_operation_type NOT IN ('order', 'remittance') OR p_operation_id IS NULL THEN
    RAISE EXCEPTION 'invalid_argument: operation' USING ERRCODE = '22023', DETAIL = 'operation';
  END IF;
END;
$function$;
REVOKE ALL ON FUNCTION public._refund_assert_admin_operation(text, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._refund_operation_timeline(p_operation_type text, p_operation_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  WITH items AS (
    SELECT h.created_at AS ts, 'status_history'::text AS source, 'status_changed'::text AS kind, h.changed_by AS actor_id,
           h.id::text AS ref_id, 1 AS rank, 0::bigint AS seq,
           jsonb_build_object('from', h.previous_status::text, 'to', h.new_status::text) AS summary
      FROM public.order_status_history h
     WHERE p_operation_type = 'order' AND h.order_id = p_operation_id
    UNION ALL
    SELECT h.created_at, 'status_history', 'status_changed', h.changed_by, h.id::text, 1, 0,
           jsonb_build_object('from', h.old_status::text, 'to', h.new_status::text)
      FROM public.remittance_status_history h
     WHERE p_operation_type = 'remittance' AND h.remittance_id = p_operation_id
    UNION ALL
    SELECT e.occurred_at, 'refund_event', e.event_type, e.actor_id, e.refund_id::text, 2, e.id,
           jsonb_strip_nulls(jsonb_build_object(
             'from', e.from_status, 'to', e.to_status, 'actor_role', e.actor_role, 'owner_is_actor', e.owner_is_actor,
             'amount', e.amount, 'currency', e.currency, 'reason_code', e.reason_code, 'has_proof', e.has_proof))
      FROM public.refund_request_events e
     WHERE (p_operation_type = 'order' AND e.order_id = p_operation_id)
        OR (p_operation_type = 'remittance' AND e.remittance_id = p_operation_id)
    UNION ALL
    SELECT m.ts, 'refund_marker', m.kind, NULL::uuid, r.id::text, 3, 0, jsonb_build_object('derived', true)
      FROM public.refund_requests r
      CROSS JOIN LATERAL (VALUES (r.eligible_at, 'refund_eligible'), (r.due_at, 'refund_due')) AS m(ts, kind)
     WHERE (p_operation_type = 'order' AND r.order_id = p_operation_id)
        OR (p_operation_type = 'remittance' AND r.remittance_id = p_operation_id)
    UNION ALL
    SELECT p.created_at, 'commission_proposal', 'commission_proposed', p.created_by, p.id::text, 4, 0,
           jsonb_build_object('direction', p.direction)
      FROM public.remittance_commission_proposals p
     WHERE p_operation_type = 'remittance' AND p.remittance_id = p_operation_id
    UNION ALL
    SELECT p.responded_at, 'commission_proposal', 'commission_' || p.status, p.responded_by, p.id::text, 4, 1,
           jsonb_build_object('direction', p.direction)
      FROM public.remittance_commission_proposals p
     WHERE p_operation_type = 'remittance' AND p.remittance_id = p_operation_id AND p.responded_at IS NOT NULL
    UNION ALL
    SELECT o.set_at, 'commission_override', 'commission_override_set', o.set_by, o.id::text, 4, 0,
           jsonb_build_object('commission', o.commission, 'standard_commission', o.standard_commission)
      FROM public.remittance_commission_overrides o
     WHERE p_operation_type = 'remittance' AND o.remittance_id = p_operation_id
  ), ordered AS (
    SELECT * FROM items ORDER BY ts, rank, seq, ref_id LIMIT 500
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('ts', ts, 'source', source, 'kind', kind, 'actor_id', actor_id,
                                                'ref_id', ref_id, 'summary', summary) ORDER BY ts, rank, seq, ref_id), '[]'::jsonb)
    FROM ordered;
$function$;
REVOKE ALL ON FUNCTION public._refund_operation_timeline(text, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._refund_operation_refunds(p_operation_type text, p_operation_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', r.id, 'status', r.status, 'user_id', r.user_id, 'payment_evidence', r.payment_evidence, 'amount', r.amount,
           'currency', r.currency, 'cancelled_at', r.cancelled_at, 'cancelled_by_role', r.cancelled_by_role,
           'eligible_at', r.eligible_at, 'due_at', r.due_at, 'resolved_at', r.resolved_at, 'resolved_by', r.resolved_by,
           'refunded_at', r.refunded_at, 'self_resolved', r.self_resolved, 'proof_expires_at', r.proof_expires_at,
           'proof_state', CASE WHEN r.proof_purged_at IS NOT NULL THEN 'expired' WHEN r.proof_path IS NOT NULL THEN 'available' ELSE 'none' END,
           'queue_state', CASE
                            WHEN r.status <> 'pending' THEN NULL
                            WHEN now() < r.eligible_at THEN 'on_hold'
                            WHEN now() >= r.due_at THEN 'overdue'
                            WHEN r.due_at - now() <= interval '24 hours' THEN 'due_soon'
                            ELSE 'on_time' END,
           'created_at', r.created_at) ORDER BY r.created_at, r.id), '[]'::jsonb)
    FROM public.refund_requests r
   WHERE (p_operation_type = 'order' AND r.order_id = p_operation_id)
      OR (p_operation_type = 'remittance' AND r.remittance_id = p_operation_id);
$function$;
REVOKE ALL ON FUNCTION public._refund_operation_refunds(text, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_operation_timeline(p_operation_type text, p_operation_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  PERFORM public._refund_assert_admin_operation(p_operation_type, p_operation_id);
  RETURN public._refund_operation_timeline(p_operation_type, p_operation_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_get_operation_refunds(p_operation_type text, p_operation_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  PERFORM public._refund_assert_admin_operation(p_operation_type, p_operation_id);
  RETURN public._refund_operation_refunds(p_operation_type, p_operation_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_refund_trace(p_operation_type text, p_operation_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_gaps  jsonb;
  v_paid_cancels integer := 0;
  v_refund_count integer;
BEGIN
  PERFORM public._refund_assert_admin_operation(p_operation_type, p_operation_id);

  SELECT COALESCE(jsonb_agg(g), '[]'::jsonb) INTO v_gaps FROM (
    SELECT jsonb_build_object('code', 'no_created_event', 'refund_id', r.id) AS g
      FROM public.refund_requests r
     WHERE ((p_operation_type = 'order' AND r.order_id = p_operation_id) OR (p_operation_type = 'remittance' AND r.remittance_id = p_operation_id))
       AND NOT EXISTS (SELECT 1 FROM public.refund_request_events e WHERE e.refund_id = r.id AND e.event_type = 'created')
    UNION ALL
    SELECT jsonb_build_object('code', 'no_closed_event', 'refund_id', r.id)
      FROM public.refund_requests r
     WHERE ((p_operation_type = 'order' AND r.order_id = p_operation_id) OR (p_operation_type = 'remittance' AND r.remittance_id = p_operation_id))
       AND r.status <> 'pending'
       AND NOT EXISTS (SELECT 1 FROM public.refund_request_events e
                        WHERE e.refund_id = r.id AND e.event_type IN ('closed_refunded', 'closed_not_applicable', 'closed_by_reopen'))
    UNION ALL
    SELECT jsonb_build_object('code', 'refunded_without_proof', 'refund_id', r.id)
      FROM public.refund_requests r
     WHERE ((p_operation_type = 'order' AND r.order_id = p_operation_id) OR (p_operation_type = 'remittance' AND r.remittance_id = p_operation_id))
       AND r.status = 'refunded' AND r.proof_path IS NULL
    UNION ALL
    SELECT jsonb_build_object('code', 'self_dealing_attempt', 'refund_id', e.refund_id)
      FROM public.refund_request_events e
     WHERE e.event_type = 'self_resolution_blocked'
       AND ((p_operation_type = 'order' AND e.order_id = p_operation_id) OR (p_operation_type = 'remittance' AND e.remittance_id = p_operation_id))
    UNION ALL
    SELECT DISTINCT jsonb_build_object('code', 'orphan_events', 'refund_id', e.refund_id)
      FROM public.refund_request_events e
     WHERE ((p_operation_type = 'order' AND e.order_id = p_operation_id) OR (p_operation_type = 'remittance' AND e.remittance_id = p_operation_id))
       AND NOT EXISTS (SELECT 1 FROM public.refund_requests r WHERE r.id = e.refund_id)
  ) q;

  IF p_operation_type = 'remittance' THEN
    SELECT count(*) INTO v_paid_cancels
      FROM public.remittance_status_history h
     WHERE h.remittance_id = p_operation_id AND h.new_status::text = 'cancelled'
       AND h.old_status::text IN ('payment_validated', 'processing', 'delivered', 'completed', 'payment_proof_uploaded');
    SELECT count(*) INTO v_refund_count FROM public.refund_requests r WHERE r.remittance_id = p_operation_id;
    IF v_paid_cancels > v_refund_count THEN
      v_gaps := v_gaps || jsonb_build_array(jsonb_build_object('code', 'paid_cancel_without_refund_request', 'refund_id', NULL));
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'timeline', public._refund_operation_timeline(p_operation_type, p_operation_id),
    'refunds', public._refund_operation_refunds(p_operation_type, p_operation_id),
    'gaps', v_gaps);
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_operation_timeline(text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_get_operation_refunds(text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_refund_trace(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_operation_timeline(text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_operation_refunds(text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_refund_trace(text, uuid) TO authenticated;

COMMIT;
