-- ============================================================================
-- REVOKE EXECUTE on trigger functions, helpers and legacy functions (W5c / E2).   PREPARED, NOT APPLIED
-- ============================================================================
-- WHY: Postgres grants EXECUTE to PUBLIC on every new function, so anon (and authenticated) can call 32 functions of
--   `public` through /rest/v1/rpc. Most are trigger functions or internal helpers nobody should call directly, and 9 are
--   SECURITY DEFINER (advisor 0028). Only five functions are meant for anon: the three used by RLS policies that
--   reach anonymous visitors (is_admin_user, is_super_admin, get_my_role) and the two public screens
--   (get_public_landing_stats, get_testimonial_author_profiles). Nothing else changes for them.
--
-- WHAT (per group; the lists are mirrored in src/tests/concurrency/revokeExecuteHelpers.test.js, which snapshots them):
--   1. Trigger functions (13): REVOKE FROM PUBLIC, anon, authenticated. Postgres does not check EXECUTE when a trigger
--      fires (it is checked at CREATE TRIGGER), so triggers keep working, including handle_new_user / sync_user_email
--      fired by GoTrue as supabase_auth_admin (ND-6: proved in the harness by logging in as that role).
--   2. Helpers that INVOKER code calls under the caller's rights (generate_order_number <- set_order_number,
--      remittance_money_columns <- the money guard, redact_pii_jsonb <- activity_logs_redact_pii, current_user_id <-
--      three remittances policies): REVOKE FROM PUBLIC, anon; GRANT to authenticated AND service_role. service_role
--      used to reach them only through PUBLIC, so revoking PUBLIC without that explicit grant would break inserts done
--      by edge functions or maintenance.
--   3. Legacy writers without callers (reserve_zelle_account, reset_daily/monthly_zelle_counters) and the SECURITY
--      DEFINER get_low_stock_count (no role check, no caller in src): REVOKE FROM PUBLIC, anon, authenticated.
--   4. Unused INVOKER readers subject to RLS: REVOKE FROM PUBLIC, anon; keep authenticated (and service_role). Deleting
--      them is W6.
--   Not touched: the 5 allowlisted functions and every authenticated RPC with an internal role check.
--   No ALTER DEFAULT PRIVILEGES (ND-2): the snapshot test catches a new exposed function in the harness.
--
-- Matching is by name over pg_proc (all overloads in `public`), so the migration also applies to a database where a
-- legacy function was already dropped. Idempotent; no data is touched.
-- Expected effect on advisor 0028: from 9 findings to the 5 allowlisted ones.
-- ROLLBACK: supabase/rollbacks/20261024100100_revoke_execute_helpers_down.sql (GRANT TO PUBLIC with the exact list).
-- Needs the owner's "dale" to apply remotely; smoke afterwards: anonymous home (catalog, stats, testimonials), login,
-- a test sign-up and a checkout.
-- ============================================================================

BEGIN;

SET LOCAL lock_timeout = '5s';

DO $revoke$
DECLARE
  v_fn regprocedure;
  v_triggers constant text[] := ARRAY[
    'activity_logs_redact_pii', 'generate_remittance_number', 'guard_platform_reset_lock',
    'guard_remittance_owner_insert', 'guard_remittance_owner_update', 'guard_user_profiles_birth_date',
    'handle_new_user', 'set_order_number', 'sync_user_email', 'update_business_visual_settings_timestamp',
    'update_publications_timestamp', 'update_updated_at', 'update_updated_at_column'
  ];
  v_helpers constant text[] := ARRAY[
    'current_user_id', 'generate_order_number', 'redact_pii_jsonb', 'remittance_money_columns'
  ];
  v_nobody constant text[] := ARRAY[
    'reserve_zelle_account', 'reset_daily_zelle_counters', 'reset_monthly_zelle_counters', 'get_low_stock_count'
  ];
  v_readers constant text[] := ARRAY[
    'calculate_order_total', 'count_user_interactions', 'current_user_is_enabled', 'current_user_role',
    'get_category_from_interactions', 'get_shipping_cost_for_location', 'is_admin', 'is_manager', 'upsert_my_profile'
  ];
BEGIN
  FOR v_fn IN
    SELECT p.oid::regprocedure FROM pg_proc p
     WHERE p.pronamespace = 'public'::regnamespace AND p.prokind = 'f' AND p.proname = ANY (v_triggers || v_nobody)
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', v_fn);
  END LOOP;

  FOR v_fn IN
    SELECT p.oid::regprocedure FROM pg_proc p
     WHERE p.pronamespace = 'public'::regnamespace AND p.prokind = 'f' AND p.proname = ANY (v_helpers || v_readers)
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', v_fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', v_fn);
  END LOOP;
END
$revoke$;

COMMIT;
