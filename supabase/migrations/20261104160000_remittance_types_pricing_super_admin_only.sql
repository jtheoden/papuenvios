-- ============================================================================
-- remittance_types: pricing and currency pair are super_admin-only.                         PREPARED, NOT APPLIED
-- ============================================================================
-- WHY (audit 2026-11-04, C3)
--   remittance_types.exchange_rate is the rate remittances are actually priced with (guard_remittance_pricing,
--   _remittance_quote, remittanceService), yet policy remittance_types_all_admin lets ANY admin write it, while
--   exchange_rates (the "official" table) already requires super_admin (DEC-10). Prod: 2 admins + 3 super_admins.
--
-- LIVE STATE (read-only 2026-11-04)
--   remittance_types_all_admin      PERMISSIVE {public} ALL    USING (( SELECT is_admin_user() AS is_admin_user))     -> unchanged
--   remittance_types_select_public  PERMISSIVE {public} SELECT USING ((is_active = true) OR ( SELECT is_admin_user()))-> unchanged
--   triggers: audit_financial_update / audit_financial_delete (AFTER, ALWAYS). No updated_at trigger: updated_at is
--   2025-10-14 on 3 of the 4 rows and 2026-01-30 on the other, although the rate was edited 7 times since 2026-10-22.
--   No server function writes remittance_types (prosrc scan). Only writer: RemittanceTypesConfig.jsx (create / update /
--   delete / is_active toggle) via PostgREST.
--
-- WHAT
--   1. BEFORE INSERT OR UPDATE trigger guard_remittance_types_pricing (ENABLE ALWAYS, like the money guards). For an API
--      caller (current_user authenticated/anon) that is not an enabled super_admin it raises 42501
--      'remittance_type_pricing_super_admin_only' when:
--        - INSERT (a new type always carries a rate), or
--        - UPDATE changes exchange_rate, commission_percentage, commission_fixed, currency_code or delivery_currency
--          (IS DISTINCT FROM, after the column typmod coercion, so re-sending the stored value is not a change).
--      Everything else (name, description, min/max_amount, days, icon, order, is_active, DELETE) stays manageable by any
--      admin under the unchanged RLS policy (is_active / min_amount / max_amount: owner decision, F4). A policy cannot
--      compare OLD and NEW, hence a trigger; RLS stays as is.
--      Scope extensions over the audit item: commission_fixed (same pricing lever) and the currency pair (an admin could
--      otherwise turn the USD->USD type, exchange_rate 105, into USD->CUP and price at 105 CUP/USD).
--      System paths (postgres, service_role, SECURITY DEFINER owners) are not gated, as in guard_remittance_money_columns.
--   2. BEFORE UPDATE trigger trigger_update_remittance_types_updated_at -> existing public.update_updated_at()
--      (same as exchange_rates). Fires after the guard (alphabetical order).
--
-- AUDIT
--   Accepted changes are already logged by audit_financial_changes (exchange_rate, commission_percentage,
--   commission_fixed, currency_code, delivery_currency are monitored columns) with changed_by_role. A REJECTED attempt cannot be persisted in
--   financial_audit_log: the RAISE rolls back the whole transaction, audit insert included (no autonomous transactions).
--   It surfaces only as the 42501 error to the client and in the Postgres log.
--
-- DATA / BEHAVIOUR
--   No row is read for write, inserted, updated or deleted. Behaviour change: plain admins can no longer create types
--   nor edit their pricing or currency pair (super_admins unaffected). The guard compares OLD vs NEW with IS DISTINCT
--   FROM, so a column that is not sent, or is sent with its stored value, is never a change.
--   remittance_types.commission_percentage is numeric(20,10) (only remittances.commission_percentage is numeric(5,2)):
--   a super_admin's write is stored at full precision, and an unchanged value compares equal.
--   Front contract the guard relies on (F2, branch fix/financial-client-hardening, commit 64ad7da9): "new type" and the
--   rate / commission fields are hidden for non-super admins; a non-super admin's save does not send exchange_rate,
--   commission_percentage or commission_fixed; and the form no longer rewrites commission_percentage when only name,
--   limits or is_active change (it recomputes it only when the market or delivery rate is edited).
--   Deploy order: apply ONLY after that F2 front is deployed. With the pre-F2 front (main today), which re-sends every
--   field, an admin's name/limit edit still passes for the 4 live rows (their recomputed commission_percentage equals
--   the stored one, financialDbHardeningF3.test.js), but "new type" and any rate/commission edit by a non-super admin
--   get the 42501 (fail-closed, nothing saved).
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
     OR NEW.commission_fixed IS DISTINCT FROM OLD.commission_fixed
     OR NEW.currency_code IS DISTINCT FROM OLD.currency_code
     OR NEW.delivery_currency IS DISTINCT FROM OLD.delivery_currency THEN
    RAISE EXCEPTION 'remittance_type_pricing_super_admin_only' USING ERRCODE = '42501',
      HINT = 'Only a super_admin can change the rate, the commissions or the currency pair of a remittance type.';
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
