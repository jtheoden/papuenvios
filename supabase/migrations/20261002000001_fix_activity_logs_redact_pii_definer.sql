-- Fix: client-side activity logging has been dead since SEC-07
-- (20260809000002_sec07_activity_logs_pii_ttl.sql + 20260809000003_fix_sec07_search_path.sql).
--
-- Root cause (verified read-only against production on 2026-10-02):
--   * public.activity_logs_redact_pii() is the BEFORE INSERT trigger function on
--     public.activity_logs (trigger trg_activity_logs_redact_pii). It was created as
--     SECURITY INVOKER, so it runs with the privileges of the inserting role.
--   * It calls public.redact_pii_jsonb(jsonb), whose EXECUTE was revoked from PUBLIC
--     in SEC-07 and never granted to any app role (ACL: {postgres=X/postgres}).
--   * Result: every INSERT into activity_logs made by role "authenticated" fails with
--     SQLSTATE 42501 (permission denied for function redact_pii_jsonb). Only rows
--     written from SECURITY DEFINER RPCs owned by postgres kept working. The last
--     client-originated rows are from 2026-08-07.
--
-- Fix: run the trigger function as its owner (SECURITY DEFINER) with a pinned
-- search_path (public, pg_temp: pg_temp listed explicitly and last, so temporary
-- objects can never shadow what the definer resolves), so it can call
-- redact_pii_jsonb without widening that function's ACL.
-- A trigger function cannot be invoked directly (RETURNS trigger), so this does not
-- expose any new callable surface to app roles.
--
-- Idempotent: ALTER FUNCTION can be re-applied safely.
-- Rollback: ALTER FUNCTION public.activity_logs_redact_pii() SECURITY INVOKER;

BEGIN;

ALTER FUNCTION public.activity_logs_redact_pii() SECURITY DEFINER;
ALTER FUNCTION public.activity_logs_redact_pii() SET search_path = public, pg_temp;

-- Safety net: fail the migration (and roll back) if the function owner still cannot
-- execute the redaction helper, instead of silently leaving logging broken.
DO $$
DECLARE
  v_owner name;
BEGIN
  SELECT r.rolname INTO v_owner
  FROM pg_proc p
  JOIN pg_roles r ON r.oid = p.proowner
  WHERE p.oid = 'public.activity_logs_redact_pii()'::regprocedure;

  IF NOT has_function_privilege(v_owner, 'public.redact_pii_jsonb(jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION
      'Owner % of activity_logs_redact_pii() cannot execute redact_pii_jsonb(jsonb)', v_owner;
  END IF;
END;
$$;

COMMIT;
