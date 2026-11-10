-- ============================================================================
-- Refund audit trail (R5a 3/3): metrics and audit export.   PREPARED, NOT APPLIED
-- ============================================================================
-- Two admin RPCs, STABLE, read-only, SECURITY DEFINER, 42501 for non-admins, 22023 for a bad range (p_to must be after p_from,
-- at most 366 days). The window selects refund requests by cancelled_at.
--   admin_refund_metrics(p_from, p_to, p_operation_type DEFAULT NULL) -> jsonb of AGGREGATES only:
--     total_refunded / total_not_applicable / total_pending, time_to_refund_from_cancel_hours and ..._from_eligible_hours
--     ({p50, p90, avg}), pct_on_time (refunded at or before due_at), overdue_by_day ([{day, open_overdue}], New York days),
--     pending_amount_by_currency, queue_age_hours ({p50, max}), not_applicable_rate (excluding reopens), reopen_count,
--     pct_with_proof / pct_without_proof (over refunded; an expired/purged proof still counts as "with proof"), self_resolved_count.
--   admin_refund_export(p_from, p_to) -> jsonb array (max 5000 rows) for the audit CSV: ids, operation number, amounts, dates,
--     actor id, SLO flag and proof state. No name, email, phone, reference, free text or storage path.
-- Nothing existing is replaced. ROLLBACK: supabase/rollbacks/20261029110200_refund_metrics_export_down.sql
-- ============================================================================

BEGIN;

SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public._refund_assert_admin_range(p_from timestamptz, p_to timestamptz)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF auth.uid() IS NULL OR public.current_user_is_blocked() OR NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'insufficient_privilege: only an administrator can read refund metrics' USING ERRCODE = '42501';
  END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_to <= p_from OR p_to - p_from > interval '366 days' THEN
    RAISE EXCEPTION 'invalid_argument: range must be positive and at most 366 days' USING ERRCODE = '22023', DETAIL = 'range';
  END IF;
END;
$function$;
REVOKE ALL ON FUNCTION public._refund_assert_admin_range(timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_refund_metrics(
  p_from           timestamptz,
  p_to             timestamptz,
  p_operation_type text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  PERFORM public._refund_assert_admin_range(p_from, p_to);
  IF p_operation_type IS NOT NULL AND p_operation_type NOT IN ('order', 'remittance') THEN
    RAISE EXCEPTION 'invalid_argument: p_operation_type' USING ERRCODE = '22023', DETAIL = 'p_operation_type';
  END IF;

  WITH r AS (
    SELECT * FROM public.refund_requests
     WHERE cancelled_at >= p_from AND cancelled_at < p_to
       AND (p_operation_type IS NULL OR operation_type = p_operation_type)
  ), refunded AS (
    SELECT * FROM r WHERE status = 'refunded'
  ), na AS (
    SELECT * FROM r WHERE status = 'not_applicable' AND COALESCE(resolution_reason, '') <> 'reopened'
  ), days AS (
    SELECT d::date AS day
      FROM generate_series((p_from AT TIME ZONE 'America/New_York')::date, (p_to AT TIME ZONE 'America/New_York')::date, interval '1 day') d
  )
  SELECT jsonb_build_object(
    'total_refunded', (SELECT count(*) FROM refunded),
    'total_not_applicable', (SELECT count(*) FROM r WHERE status = 'not_applicable'),
    'total_pending', (SELECT count(*) FROM r WHERE status = 'pending'),
    'time_to_refund_from_cancel_hours', (SELECT jsonb_build_object(
        'p50', round((percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM resolved_at - cancelled_at) / 3600))::numeric, 2),
        'p90', round((percentile_cont(0.9) WITHIN GROUP (ORDER BY extract(epoch FROM resolved_at - cancelled_at) / 3600))::numeric, 2),
        'avg', round(avg(extract(epoch FROM resolved_at - cancelled_at) / 3600)::numeric, 2)) FROM refunded),
    'time_to_refund_from_eligible_hours', (SELECT jsonb_build_object(
        'p50', round((percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM resolved_at - eligible_at) / 3600))::numeric, 2),
        'p90', round((percentile_cont(0.9) WITHIN GROUP (ORDER BY extract(epoch FROM resolved_at - eligible_at) / 3600))::numeric, 2),
        'avg', round(avg(extract(epoch FROM resolved_at - eligible_at) / 3600)::numeric, 2)) FROM refunded),
    'pct_on_time', (SELECT round(100.0 * count(*) FILTER (WHERE resolved_at <= due_at) / NULLIF(count(*), 0), 1) FROM refunded),
    'overdue_by_day', COALESCE((SELECT jsonb_agg(jsonb_build_object('day', d.day, 'open_overdue', (
        SELECT count(*) FROM r
         WHERE r.due_at < ((d.day + 1)::timestamp AT TIME ZONE 'America/New_York')
           AND (r.resolved_at IS NULL OR r.resolved_at >= ((d.day + 1)::timestamp AT TIME ZONE 'America/New_York'))
           AND r.status IN ('pending', 'refunded', 'not_applicable'))) ORDER BY d.day) FROM days d), '[]'::jsonb),
    'pending_amount_by_currency', COALESCE((SELECT jsonb_object_agg(currency, total) FROM (
        SELECT currency, sum(amount) AS total FROM r WHERE status = 'pending' GROUP BY currency) c), '{}'::jsonb),
    'queue_age_hours', (SELECT jsonb_build_object(
        'p50', round((percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM now() - cancelled_at) / 3600))::numeric, 2),
        'max', round(max(extract(epoch FROM now() - cancelled_at) / 3600)::numeric, 2)) FROM r WHERE status = 'pending'),
    'not_applicable_rate', (SELECT round(100.0 * (SELECT count(*) FROM na) / NULLIF((SELECT count(*) FROM na) + (SELECT count(*) FROM refunded), 0), 1)),
    'reopen_count', (SELECT count(*) FROM r WHERE resolution_reason = 'reopened'),
    'pct_with_proof', (SELECT round(100.0 * count(*) FILTER (WHERE proof_path IS NOT NULL) / NULLIF(count(*), 0), 1) FROM refunded),
    'pct_without_proof', (SELECT round(100.0 * count(*) FILTER (WHERE proof_path IS NULL) / NULLIF(count(*), 0), 1) FROM refunded),
    'self_resolved_count', (SELECT count(*) FROM r WHERE self_resolved)
  ) INTO v_result;
  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_refund_export(p_from timestamptz, p_to timestamptz)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  PERFORM public._refund_assert_admin_range(p_from, p_to);
  SELECT COALESCE(jsonb_agg(rec ORDER BY (rec ->> 'cancelled_at'), (rec ->> 'refund_id')), '[]'::jsonb) INTO v_result FROM (
    SELECT jsonb_build_object(
             'refund_id', r.id,
             'operation_type', r.operation_type,
             'operation_id', COALESCE(r.order_id, r.remittance_id),
             'operation_number', COALESCE(o.order_number, rm.remittance_number),
             'status', r.status,
             'payment_evidence', r.payment_evidence,
             'amount', r.amount,
             'currency', r.currency,
             'cancelled_at', r.cancelled_at,
             'cancelled_by_role', r.cancelled_by_role,
             'eligible_at', r.eligible_at,
             'due_at', r.due_at,
             'resolved_at', r.resolved_at,
             'refunded_at', r.refunded_at,
             'resolved_by', r.resolved_by,
             'within_slo', CASE WHEN r.status = 'refunded' THEN r.resolved_at <= r.due_at END,
             'proof_state', CASE WHEN r.proof_purged_at IS NOT NULL THEN 'expired' WHEN r.proof_path IS NOT NULL THEN 'available' ELSE 'none' END,
             'proof_expires_at', r.proof_expires_at,
             'self_resolved', r.self_resolved) AS rec
      FROM public.refund_requests r
      LEFT JOIN public.orders o ON o.id = r.order_id
      LEFT JOIN public.remittances rm ON rm.id = r.remittance_id
     WHERE r.cancelled_at >= p_from AND r.cancelled_at < p_to
     ORDER BY r.cancelled_at, r.id
     LIMIT 5000
  ) q;
  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_refund_metrics(timestamptz, timestamptz, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_refund_export(timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_refund_metrics(timestamptz, timestamptz, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_refund_export(timestamptz, timestamptz) TO authenticated;

COMMIT;
