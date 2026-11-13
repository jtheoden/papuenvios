-- Rollback of 20261113130000_financial_entries. PREPARED, NOT APPLIED
-- The table is an append-only ledger: it is NOT dropped while it holds entries. Export them first
-- (SELECT * FROM public.financial_entries) and only then remove the rows by hand if the ledger must go.
-- Disable the Dashboard panel first; it reads the table through RLS.
BEGIN;
SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF to_regclass('public.financial_entries') IS NOT NULL AND EXISTS (SELECT 1 FROM public.financial_entries) THEN
    RAISE EXCEPTION 'financial_entries holds entries; refusing to drop the ledger. Export and remove them explicitly first.';
  END IF;
END
$$;

DROP FUNCTION IF EXISTS public.superadmin_void_financial_entry(uuid, text);
DROP FUNCTION IF EXISTS public.superadmin_add_financial_entry(text, numeric, date, text, text);
DROP TABLE IF EXISTS public.financial_entries;
DROP FUNCTION IF EXISTS public.financial_entries_append_only();
COMMIT;
