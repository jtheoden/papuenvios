-- PREPARED, NOT APPLIED
-- Why/what: reverse the phone-first visibility migration using its original backup.
-- Safety: abort if the backup is missing; restore only visibility flags for accounts
-- that still exist. New accounts and all other account data remain untouched.
-- Deploy order: run only after the matching forward migration; the frontend
-- tolerates both visibility states and does not need to be rolled back first.
-- Rollback of this rollback: reapply the forward migration to take a fresh backup
-- and make accounts with usable phones phone-only again.

BEGIN;
SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF to_regclass('public.zelle_accounts_visibility_backup_20261107') IS NULL THEN
    RAISE EXCEPTION 'Zelle visibility backup is missing; cannot safely restore original flags';
  END IF;
END
$$;

UPDATE public.zelle_accounts AS za
SET show_email = backup.show_email, show_phone = backup.show_phone
FROM public.zelle_accounts_visibility_backup_20261107 AS backup
WHERE za.id = backup.account_id;

DROP TABLE public.zelle_accounts_visibility_backup_20261107;

COMMIT;
