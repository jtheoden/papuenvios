-- ============================================================================
-- Refunds queue (2/4): business-day arithmetic and policy constants.   PREPARED, NOT APPLIED
-- ============================================================================
-- add_business_days(p_from, p_days): the instant at which the p_days-th business day (Mon-Fri, America/New_York, no holidays)
--   after the New York calendar day of p_from ENDS, i.e. 00:00 New York of the following day. The named zone resolves DST.
--   Example: from Fri 23-Oct 18:00 ET, 5 days -> Sat 31-Oct 00:00 ET.
-- refund_hold_hours() / refund_business_days(): the policy constants. Their JS copies are REFUND_HOLD_HOURS and
--   REFUND_BUSINESS_DAYS in src/lib/legalConfig.js; unit tests compare both and the shared vectors
--   src/tests/fixtures/refund-window-vectors.json pin the arithmetic on both sides.
-- ROLLBACK: supabase/rollbacks/20261029100100_add_business_days_down.sql
-- ============================================================================

BEGIN;

SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.add_business_days(p_from timestamptz, p_days integer)
RETURNS timestamptz
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog
AS $function$
DECLARE
  v_day   date := (p_from AT TIME ZONE 'America/New_York')::date;
  v_count integer := 0;
BEGIN
  IF p_from IS NULL OR p_days IS NULL OR p_days < 0 OR p_days > 366 THEN
    RAISE EXCEPTION 'invalid_argument: p_from is required and p_days must be between 0 and 366' USING ERRCODE = '22023';
  END IF;
  WHILE v_count < p_days LOOP
    v_day := v_day + 1;
    IF extract(isodow FROM v_day) < 6 THEN
      v_count := v_count + 1;
    END IF;
  END LOOP;
  RETURN ((v_day + 1)::timestamp) AT TIME ZONE 'America/New_York';
END;
$function$;

CREATE OR REPLACE FUNCTION public.refund_hold_hours()
RETURNS integer LANGUAGE sql IMMUTABLE
AS $$ SELECT 48 $$;

CREATE OR REPLACE FUNCTION public.refund_business_days()
RETURNS integer LANGUAGE sql IMMUTABLE
AS $$ SELECT 5 $$;

REVOKE ALL ON FUNCTION public.add_business_days(timestamptz, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.refund_hold_hours() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.refund_business_days() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_business_days(timestamptz, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.refund_hold_hours() TO authenticated;
GRANT EXECUTE ON FUNCTION public.refund_business_days() TO authenticated;

COMMIT;
