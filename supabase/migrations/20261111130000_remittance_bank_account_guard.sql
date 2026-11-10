-- PREPARED, NOT APPLIED (needs the owner's explicit "dale" before apply_migration / db push)
-- Why: a card / transfer / moneypocket remittance is paid into the recipient's account. The wizard and
-- createRemittance already require it (PR #194), but both run in the browser: an old cached bundle or a
-- direct insert could still store a non-cash remittance with no usable destination account.
-- What: BEFORE INSERT trigger on remittances. For a customer insert whose type delivers by anything but
-- cash, the row must carry recipient_id and recipient_bank_account_id, the link must belong to THAT
-- recipient and be active, and its bank account must be active, not deleted and in the type's delivery
-- currency. Otherwise: remittance_bank_account_required (23514). Same bypass as guard_remittance_pricing:
-- no session, service roles, admins and super admins.
-- Safe for production data: BEFORE INSERT only. Existing remittances are never read or changed.
-- Apply only after the client that collects the account is live (PR #194 createRemittance + wizard, PR #195 new-recipient
-- form) and a new recipient has been taken end to end with a card / transfer type in production: an older cached bundle
-- that sends a non-cash remittance without an account would be rejected with remittance_bank_account_required.
-- Existing remittances without account (non-cash types, created before the client check) are not touched.
-- Rollback: supabase/rollbacks/20261111130000_remittance_bank_account_guard_down.sql

BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.guard_remittance_bank_account()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_type public.remittance_types%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL
     OR COALESCE(current_setting('role', true), '') IN ('service_role', 'postgres', 'supabase_admin')
     OR public.is_admin_user()
     OR public.is_super_admin() THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_type FROM public.remittance_types WHERE id = NEW.remittance_type_id;
  -- Unknown type or cash delivery: not this guard's business (the pricing guard handles a missing type)
  IF NOT FOUND OR v_type.delivery_method = 'cash' THEN
    RETURN NEW;
  END IF;

  IF NEW.recipient_id IS NULL OR NEW.recipient_bank_account_id IS NULL
     OR NOT EXISTS (
       SELECT 1
         FROM public.recipient_bank_accounts rba
         JOIN public.bank_accounts ba ON ba.id = rba.bank_account_id
         JOIN public.currencies c ON c.id = ba.currency_id
        WHERE rba.id = NEW.recipient_bank_account_id
          AND rba.recipient_id = NEW.recipient_id
          AND rba.is_active IS TRUE
          AND ba.is_active IS TRUE
          AND ba.deleted_at IS NULL
          AND c.code = v_type.delivery_currency
     ) THEN
    RAISE EXCEPTION 'remittance_bank_account_required' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.guard_remittance_bank_account() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS guard_remittance_bank_account ON public.remittances;
CREATE TRIGGER guard_remittance_bank_account
  BEFORE INSERT ON public.remittances
  FOR EACH ROW EXECUTE FUNCTION public.guard_remittance_bank_account();

COMMIT;
