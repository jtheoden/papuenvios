-- Rollback of 20261026100000_recipients_unique_identity.sql.
-- Only drops the index; the data merge (supabase/maintenance/20261026_merge_duplicate_recipients.sql) is not undone.
-- The front keeps working without the index (it looks the recipient up before inserting).
BEGIN;
SET LOCAL lock_timeout = '5s';
DROP INDEX IF EXISTS public.recipients_user_name_phone_uniq;
COMMIT;
