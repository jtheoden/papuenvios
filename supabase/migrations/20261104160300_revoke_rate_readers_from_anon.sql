-- ============================================================================
-- get_order_exchange_rate / get_market_exchange_rate: no EXECUTE for PUBLIC / anon.             PREPARED, NOT APPLIED
-- ============================================================================
-- WHY (audit 2026-11-04, W7/W10): both SECURITY DEFINER readers return 1.0 when a currency or rate is missing (fail-open
--   1:1 conversion). get_order_exchange_rate is executable by anon.
-- LIVE STATE (pg_proc, read-only 2026-11-04). Both functions exist ONLY in prod: no repo migration nor the e2e base
--   schema defines them (created out of band), hence the to_regprocedure guards below.
--   get_order_exchange_rate(text,text)   proacl {=X/postgres,postgres=X/postgres,authenticated=X/postgres,anon=X/postgres}
--   get_market_exchange_rate(text,text)  proacl {=X/postgres,postgres=X/postgres,authenticated=X/postgres}
--   anon inherits EXECUTE from PUBLIC (=X), so revoking only from anon would change nothing: PUBLIC is revoked too.
-- CALLERS: none. rg over src/ and supabase/functions: 0 hits; prod prosrc of every other function, pg_policies and
--   pg_views: 0 references.
-- WHAT: REVOKE EXECUTE FROM PUBLIC, anon. authenticated keeps its explicit grant; postgres (owner) keeps it.
--   service_role only had it through PUBLIC and loses it (no caller). Dropping them or making them RAISE instead of
--   returning 1.0 is left for F4.
-- DATA: none. ROLLBACK: supabase/rollbacks/20261104160300_revoke_rate_readers_from_anon_down.sql (exact live ACLs).
-- ============================================================================

BEGIN;

SET LOCAL lock_timeout = '5s';

DO $do$
BEGIN
  IF to_regprocedure('public.get_order_exchange_rate(text,text)') IS NOT NULL THEN
    REVOKE EXECUTE ON FUNCTION public.get_order_exchange_rate(text, text) FROM PUBLIC, anon;
  END IF;
  IF to_regprocedure('public.get_market_exchange_rate(text,text)') IS NOT NULL THEN
    REVOKE EXECUTE ON FUNCTION public.get_market_exchange_rate(text, text) FROM PUBLIC, anon;
  END IF;
END
$do$;

COMMIT;
