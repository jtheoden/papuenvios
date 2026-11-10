-- PREPARED, NOT APPLIED
-- Why/what: reverse the phone-first migration using its original visibility/type backup.
-- Safety: abort if the backup is missing. Restore ONLY migrated accounts whose current
-- show_email=false, show_phone=true and (when present) contact_type='phone' still match
-- the migration's state. Later admin flag/type edits are NOT undone. Unmigrated accounts,
-- new accounts, contact values and unrelated columns remain untouched. Drop backup last.
-- Deploy order: run only after the matching forward migration; frontend tolerates both states.
-- Rollback of this rollback: reapply the forward migration to take a fresh backup.

BEGIN;
SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF to_regclass('public.zelle_accounts_visibility_backup_20261107') IS NULL THEN
    RAISE EXCEPTION 'Zelle visibility backup is missing; cannot safely restore original flags and type';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'zelle_accounts' AND column_name = 'contact_type'
  ) THEN
    EXECUTE $sql$
      UPDATE public.zelle_accounts AS za
      SET show_email = backup.show_email, show_phone = backup.show_phone, contact_type = backup.contact_type
      FROM public.zelle_accounts_visibility_backup_20261107 AS backup
      WHERE za.id = backup.account_id AND backup.was_migrated
        AND za.show_email = false AND za.show_phone = true AND za.contact_type = 'phone'
    $sql$;
  ELSE
    UPDATE public.zelle_accounts AS za
    SET show_email = backup.show_email, show_phone = backup.show_phone
    FROM public.zelle_accounts_visibility_backup_20261107 AS backup
    WHERE za.id = backup.account_id AND backup.was_migrated
      AND za.show_email = false AND za.show_phone = true;
  END IF;
END
$$;

DROP TABLE public.zelle_accounts_visibility_backup_20261107;

COMMIT;
