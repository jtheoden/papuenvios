-- PREPARED, NOT APPLIED
-- Why: customers must identify existing Zelle accounts by phone, not email.
-- What: back up every account's visibility flags, then make accounts with a usable
-- phone phone-only. Accounts without a usable phone retain their original flags.
-- Safety: additive backup, restricted to service_role/postgres; no contact values,
-- other account columns, rows, constraints, or customer-facing RPCs are changed.
-- Deploy order: apply BEFORE or together with the frontend; the frontend tolerates
-- both the original and phone-first visibility states.
-- Rollback: run supabase/rollbacks/20261107100000_zelle_accounts_phone_first_visibility_down.sql
-- to restore the backed-up flags for surviving accounts and drop the backup.
-- Accounts created after the backup are not modified by rollback.

BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.zelle_accounts_visibility_backup_20261107 (
  account_id uuid PRIMARY KEY,
  show_email boolean NOT NULL,
  show_phone boolean NOT NULL,
  backed_up_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.zelle_accounts_visibility_backup_20261107 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.zelle_accounts_visibility_backup_20261107 FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.zelle_accounts_visibility_backup_20261107 TO service_role;

INSERT INTO public.zelle_accounts_visibility_backup_20261107 (account_id, show_email, show_phone)
SELECT id, show_email, show_phone FROM public.zelle_accounts
ON CONFLICT (account_id) DO NOTHING;

UPDATE public.zelle_accounts
SET show_email = false, show_phone = true
WHERE phone IS NOT NULL AND btrim(phone) <> '';

COMMIT;
