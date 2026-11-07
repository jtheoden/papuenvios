-- PREPARED, NOT APPLIED
-- Why: customers must identify existing Zelle accounts by phone, not email.
-- What: back up every account's visibility/type, then make newly backed-up accounts
-- with a usable phone phone-only. Preserve all contact values and unrelated columns.
-- Production has contact_type; the repo/CI chain may not. All SQL referencing that
-- column is dynamic and guarded by information_schema.columns checks.
-- Safety: restricted backup with RLS; no rows deleted or source constraints changed.
-- Reruns never overwrite the backup or later admin decisions on backed-up accounts.
-- Deploy order: apply BEFORE or together with the frontend, which tolerates both states.
-- Rollback: supabase/rollbacks/20261107100000_zelle_accounts_phone_first_visibility_down.sql
-- restores only migrated accounts still in the migration's visibility/type state;
-- later admin edits and accounts created after the backup are preserved.

BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.zelle_accounts_visibility_backup_20261107 (
  account_id uuid PRIMARY KEY,
  show_email boolean NOT NULL,
  show_phone boolean NOT NULL,
  -- Track affected rows so rollback never restores accounts with unusable phones.
  was_migrated boolean NOT NULL DEFAULT false,
  backed_up_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'zelle_accounts_visibility_backup_20261107'
      AND column_name = 'contact_type'
  ) THEN
    EXECUTE 'ALTER TABLE public.zelle_accounts_visibility_backup_20261107 ADD COLUMN contact_type text NULL';
  END IF;
END
$$;

ALTER TABLE public.zelle_accounts_visibility_backup_20261107 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.zelle_accounts_visibility_backup_20261107 FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.zelle_accounts_visibility_backup_20261107 TO service_role;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'zelle_accounts' AND column_name = 'contact_type'
  ) THEN
    EXECUTE $sql$
      WITH newly_backed_up AS (
        INSERT INTO public.zelle_accounts_visibility_backup_20261107
          (account_id, show_email, show_phone, contact_type, was_migrated)
        SELECT id, show_email, show_phone, contact_type,
          COALESCE(regexp_replace(phone, '[[:space:] ]', '', 'g') ~ '\d', false)
        FROM public.zelle_accounts
        ON CONFLICT (account_id) DO NOTHING
        RETURNING account_id, was_migrated
      )
      UPDATE public.zelle_accounts
      SET show_email = false, show_phone = true, contact_type = 'phone'
      WHERE id IN (SELECT account_id FROM newly_backed_up WHERE was_migrated)
    $sql$;
  ELSE
    WITH newly_backed_up AS (
      INSERT INTO public.zelle_accounts_visibility_backup_20261107
        (account_id, show_email, show_phone, was_migrated)
      SELECT id, show_email, show_phone,
        COALESCE(regexp_replace(phone, '[[:space:] ]', '', 'g') ~ '\d', false)
      FROM public.zelle_accounts
      ON CONFLICT (account_id) DO NOTHING
      RETURNING account_id, was_migrated
    )
    UPDATE public.zelle_accounts
    SET show_email = false, show_phone = true
    WHERE id IN (SELECT account_id FROM newly_backed_up WHERE was_migrated);
  END IF;
END
$$;

COMMIT;
