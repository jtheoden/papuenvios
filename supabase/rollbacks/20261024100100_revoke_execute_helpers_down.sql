-- Rollback of 20261024100100_revoke_execute_helpers.sql: restores the Postgres default (EXECUTE to PUBLIC)
-- for the exact list the migration touched, except remittance_money_columns and redact_pii_jsonb, which in the
-- harness DB were already restricted to authenticated + service_role before E2 (they keep that state; if production
-- still has PUBLIC on them, add GRANT EXECUTE ... TO PUBLIC for those two by hand).
--
-- Fidelity to the pre-E2 state (checked, not assumed):
--   * No earlier migration revokes EXECUTE on any function of the list: the only earlier REVOKEs are
--     20261014120000 (audit_order_status_change / audit_remittance_status_change, NOT in the list, left untouched
--     here and by E2) and 20261013180000 (get_low_stock_count, handled below: authenticated only).
--   * In the local e2e clone (pre-replay) every function of the list has PUBLIC EXECUTE (proacl contains '=X'),
--     so the default grant is exactly what is restored. Functions created by later migrations keep the default too.
--   * remittance_money_columns / redact_pii_jsonb were already restricted before E2: not regranted.
--   If production differs for any function (compare proacl first), edit the list before running this file.
BEGIN;
SET LOCAL lock_timeout = '5s';
DO $down$
DECLARE
  v_fn regprocedure;
BEGIN
  FOR v_fn IN
    SELECT p.oid::regprocedure FROM pg_proc p
     WHERE p.pronamespace = 'public'::regnamespace AND p.prokind = 'f' AND p.proname = ANY (ARRAY[
       'activity_logs_redact_pii', 'generate_remittance_number', 'guard_platform_reset_lock',
       'guard_remittance_owner_insert', 'guard_remittance_owner_update', 'guard_user_profiles_birth_date',
       'handle_new_user', 'set_order_number', 'sync_user_email', 'update_business_visual_settings_timestamp',
       'update_publications_timestamp', 'update_updated_at', 'update_updated_at_column',
       'reserve_zelle_account', 'reset_daily_zelle_counters', 'reset_monthly_zelle_counters',
       'current_user_id', 'generate_order_number',
       'calculate_order_total', 'count_user_interactions', 'current_user_is_enabled', 'current_user_role',
       'get_category_from_interactions', 'get_shipping_cost_for_location', 'is_admin', 'is_manager', 'upsert_my_profile'
     ])
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO PUBLIC', v_fn);
  END LOOP;
  -- get_low_stock_count was authenticated-only before E2 (see the original grants of the harness DB).
  FOR v_fn IN
    SELECT p.oid::regprocedure FROM pg_proc p
     WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'get_low_stock_count'
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', v_fn);
  END LOOP;
END
$down$;
COMMIT;
