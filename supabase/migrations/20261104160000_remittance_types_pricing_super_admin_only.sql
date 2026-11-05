-- ============================================================================
-- remittance_types: pricing (exchange_rate, commission_percentage, commission_fixed) is super_admin-only.   PREPARED, NOT APPLIED
-- ============================================================================
-- WHY (audit 2026-11-04, C3)
--   remittance_types.exchange_rate is the rate remittances are actually priced with (guard_remittance_pricing,
--   _remittance_quote, remittanceService), yet policy remittance_types_all_admin lets ANY admin write it, while
--   exchange_rates (the "official" table) already requires super_admin (DEC-10). Prod: 2 admins + 3 super_admins.
--
-- LIVE STATE (read-only 2026-11-04)
--   remittance_types_all_admin      PERMISSIVE {public} ALL    USING (( SELECT is_admin_user() AS is_admin_user))     -> unchanged
--   remittance_types_select_public  PERMISSIVE {public} SELECT USING ((is_active = true) OR ( SELECT is_admin_user()))-> unchanged
--   triggers: audit_financial_update / audit_financial_delete (AFTER, ALWAYS). No updated_at trigger (updated_at stuck
--   at 2025-10-14 although the rate was edited 7 times).
--   No server function writes remittance_types (prosrc scan). Only writer: RemittanceTypesConfig.jsx (create / update /
--   delete / is_active toggle) via PostgREST.
--
-- WHAT
--   1. BEFORE INSERT OR UPDATE trigger guard_remittance_types_pricing (ENABLE ALWAYS, like the money guards). For an API
--      caller (current_user authenticated/anon) that is not an enabled super_admin it raises 42501
--      'remittance_type_pricing_super_admin_only' when:
--        - INSERT (a new type always carries a rate), or
--        - UPDATE changes exchange_rate, commission_percentage or commission_fixed (IS DISTINCT FROM, after the column
--          typmod coercion, so re-sending the stored value is not a change).
--      Everything else (name, description, limits, days, icon, order, is_active, DELETE) stays manageable by any admin
--      under the unchanged RLS policy. A policy cannot compare OLD and NEW, hence a trigger; RLS stays as is.
--      commission_fixed is a scope extension over the audit item: it is the same pricing lever.
--      System paths (postgres, service_role, SECURITY DEFINER owners) are not gated, as in guard_remittance_money_columns.
--   2. BEFORE UPDATE trigger trigger_update_remittance_types_updated_at -> existing public.update_updated_at()
--      (same as exchange_rates). Fires after the guard (alphabetical order).
--
-- AUDIT
--   Accepted changes are already logged by audit_financial_changes (exchange_rate, commission_percentage,
--   commission_fixed are monitored columns) with changed_by_role. A REJECTED attempt cannot be persisted in
--   financial_audit_log: the RAISE rolls back the whole transaction, audit insert included (no autonomous transactions).
--   It surfaces only as the 42501 error to the client and in the Postgres log.
--
-- DATA / BEHAVIOUR
--   No row is read for write, inserted, updated or deleted. Behaviour change: plain admins can no longer create types
--   nor edit their pricing (super_admins unaffected). The edit form re-sends pricing on every save; for the 4 live rows
--   the recomputed commission_percentage round-trips exactly (checked read-only), so an admin's name/limit edit passes.
--   Deploy order: F2 front should hide/disable pricing fields and "new type" for non-super admins first; otherwise
--   those admins get an error toast (fail-closed, nothing saved).
--
-- ROLLBACK: supabase/rollbacks/20261104160000_remittance_types_pricing_super_admin_only_down.sql
-- ============================================================================

BEGIN;

SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.guard_remittance_types_pricing()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') OR public.is_super_admin() THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    RAISE EXCEPTION 'remittance_type_pricing_super_admin_only' USING ERRCODE = '42501',
      HINT = 'Only a super_admin can create remittance types.';
  END IF;
  IF NEW.exchange_rate IS DISTINCT FROM OLD.exchange_rate
     OR NEW.commission_percentage IS DISTINCT FROM OLD.commission_percentage
     OR NEW.commission_fixed IS DISTINCT FROM OLD.commission_fixed THEN
    RAISE EXCEPTION 'remittance_type_pricing_super_admin_only' USING ERRCODE = '42501',
      HINT = 'Only a super_admin can change exchange_rate, commission_percentage or commission_fixed.';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.guard_remittance_types_pricing() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS guard_remittance_types_pricing ON public.remittance_types;
CREATE TRIGGER guard_remittance_types_pricing
  BEFORE INSERT OR UPDATE ON public.remittance_types
  FOR EACH ROW EXECUTE FUNCTION public.guard_remittance_types_pricing();
ALTER TABLE public.remittance_types ENABLE ALWAYS TRIGGER guard_remittance_types_pricing;

DROP TRIGGER IF EXISTS trigger_update_remittance_types_updated_at ON public.remittance_types;
CREATE TRIGGER trigger_update_remittance_types_updated_at
  BEFORE UPDATE ON public.remittance_types
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

COMMIT;
