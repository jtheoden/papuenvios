-- ============================================================================
-- Remittance money columns can only change through RPCs, never by a direct PATCH.   PREPARED, NOT APPLIED
-- ============================================================================
-- WHY: the policy "admins can update all remittances" has no column limit, so an admin (or a compromised admin
--   session) can PATCH commission_total / amount_to_deliver / exchange_rate straight through PostgREST. The financial
--   audit trail (20261020100000, prod 20261021120040) RECORDS such a change but does not prevent it. Money changes
--   must go through SECURITY DEFINER RPCs that validate the business rule (re-pricing at the current rate, the
--   commission override of 20261023120000), which also leaves a precise via_function in the audit log.
--
-- WHAT: trigger guard_remittance_money_columns, BEFORE UPDATE FOR EACH ROW, SECURITY INVOKER (it needs current_user,
--   which a DEFINER function would replace by its owner).
--   * current_user in (authenticated, anon) = a direct PostgREST request, whether admin or owner: if a column of
--     financial_audit_columns('remittances') changes it raises 42501 'remittance_money_columns_rpc_only: column <c>'.
--     The list comes from that function, the single source of truth (a column added to the audit list is guarded too).
--   * Any other current_user passes: SECURITY DEFINER RPCs run as the function owner (recalculate_remittance_at_current_rate,
--     admin_set_remittance_commission, execute_platform_reset), and postgres / service_role / supabase_admin are the
--     maintenance paths. Same criterion as guard_remittance_owner_update.
--   * No exception for shipping_zone_id: the FK remittances_shipping_zone_id_fkey is ON DELETE SET NULL, but referential
--     actions run with the privileges of the table owner, so current_user is not authenticated there (verified in the
--     local DB: deleting a zone as an admin still works, test in remittanceMoneyColumnsGuard.test.js).
--   * ENABLE ALWAYS: it also fires under session_replication_role = replica.
--   * The invoker cannot execute financial_audit_columns() (its privileges are pinned by the audit tests), so the guard reads
--     the list through remittance_money_columns(), a SECURITY DEFINER wrapper that returns the same list (column names only).
--
-- Verified before writing: no client code updates money columns of remittances (rg ".update(" over src/: only status,
--   proof, cancellation and delivery fields; guarded by remittanceService.noClientMoneyUpdate.test.js), and the only SQL
--   function that updates remittances is recalculate_remittance_at_current_rate (SECURITY DEFINER). Re-run both greps
--   against main, and `prosrc ~* 'update\s+(public\.)?remittances'` against production, right before applying.
--
-- Preconditions: financial_audit_columns() (20261020100000). Idempotent. Needs the owner's "dale" to apply remotely.
-- ROLLBACK (one line): DROP TRIGGER IF EXISTS guard_remittance_money_columns ON public.remittances;
--   (supabase/rollbacks/20261023110000_remittance_money_columns_guard_down.sql)
-- ============================================================================

BEGIN;

SET LOCAL lock_timeout = '5s';

-- The invoker (authenticated) cannot execute financial_audit_columns() (its privileges are pinned by the audit tests),
-- so the guard reads the list through this SECURITY DEFINER wrapper: same list, no new grant on the original.
CREATE OR REPLACE FUNCTION public.remittance_money_columns()
RETURNS text[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT public.financial_audit_columns('remittances');
$function$;

REVOKE ALL ON FUNCTION public.remittance_money_columns() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remittance_money_columns() TO authenticated;

CREATE OR REPLACE FUNCTION public.guard_remittance_money_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_old jsonb;
  v_new jsonb;
  v_col text;
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW; -- SECURITY DEFINER RPCs (function owner), postgres, service_role, supabase_admin
  END IF;
  v_old := to_jsonb(OLD);
  v_new := to_jsonb(NEW);
  FOREACH v_col IN ARRAY public.remittance_money_columns() LOOP
    IF (v_old -> v_col) IS DISTINCT FROM (v_new -> v_col) THEN
      RAISE EXCEPTION 'remittance_money_columns_rpc_only: column %', v_col USING ERRCODE = '42501';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.guard_remittance_money_columns() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS guard_remittance_money_columns ON public.remittances;
CREATE TRIGGER guard_remittance_money_columns
  BEFORE UPDATE ON public.remittances
  FOR EACH ROW EXECUTE FUNCTION public.guard_remittance_money_columns();
ALTER TABLE public.remittances ENABLE ALWAYS TRIGGER guard_remittance_money_columns;

COMMIT;
