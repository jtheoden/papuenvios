-- ============================================================================
-- Refund dispute states (R5 front): admin_refund_dispute_states(refund_ids).   PREPARED, NOT APPLIED
-- ============================================================================
-- Read-only, STABLE, SECURITY DEFINER, enabled admins only (42501 otherwise). Given an array of refund ids (max 500, else 22023),
-- returns a jsonb array with the ids that have an OPEN dispute (public._refund_dispute_open). Null or empty input -> [].
-- admin_list_refunds is NOT replaced: the dispute control asks this RPC separately. Nothing is written.
-- ROLLBACK: supabase/rollbacks/20261103100100_refund_dispute_states_down.sql
-- ============================================================================

BEGIN;

SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.admin_refund_dispute_states(p_refund_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF auth.uid() IS NULL OR public.current_user_is_blocked() OR NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'insufficient_privilege: only an administrator can read this' USING ERRCODE = '42501';
  END IF;
  IF p_refund_ids IS NULL OR cardinality(p_refund_ids) = 0 THEN
    RETURN '[]'::jsonb;
  END IF;
  IF cardinality(p_refund_ids) > 500 THEN
    RAISE EXCEPTION 'invalid_argument: at most 500 ids' USING ERRCODE = '22023', DETAIL = 'p_refund_ids';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(to_jsonb(id) ORDER BY id)
      FROM (SELECT DISTINCT r.id FROM public.refund_requests r
             WHERE r.id = ANY (p_refund_ids) AND public._refund_dispute_open(r.id)) q
  ), '[]'::jsonb);
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_refund_dispute_states(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_refund_dispute_states(uuid[]) TO authenticated;

COMMIT;
