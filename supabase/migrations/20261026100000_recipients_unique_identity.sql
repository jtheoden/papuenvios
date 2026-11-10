-- ============================================================================
-- UNIQUE identity of a recipient (W6b).   PREPARED, NOT APPLIED
-- ============================================================================
-- *** APLICAR SOLO DESPUES de ejecutar la fusion en prod ***
--     (supabase/maintenance/20261026_merge_duplicate_recipients.sql, dry-run first, then `-v apply=1`).
--     While duplicates exist the guard below aborts with a readable message and nothing is created.
--
-- WHY: recipients had no UNIQUE, so the same person was inserted several times per user (double submit; recipients
--   hidden from the selector and created again). The front already looks the recipient up before inserting and maps a
--   23505 to "return the existing one", so it works with and without this index; the index closes the race between tabs.
--
-- IDENTITY: user_id + lower(collapsed name) + digits of the phone (NOT user + phone: a family can share a phone).
--   Must match src/lib/recipientIdentity.js and the merge script.
-- ROLLBACK: supabase/rollbacks/20261026100000_recipients_unique_identity_down.sql (DROP INDEX).
-- ============================================================================

BEGIN;

SET LOCAL lock_timeout = '5s';

-- Closes the window between the guard and CREATE UNIQUE INDEX: a duplicate inserted in between would raise a raw 23505.
-- Reads are not blocked; writers wait (or hit lock_timeout) for the few seconds the index build lasts.
LOCK TABLE public.recipients IN SHARE ROW EXCLUSIVE MODE;

DO $guard$
DECLARE
  v_groups integer;
BEGIN
  SELECT count(*) INTO v_groups FROM (
    SELECT 1 FROM public.recipients
    GROUP BY user_id, lower(regexp_replace(btrim(full_name), '\s+', ' ', 'g')), regexp_replace(phone, '\D', '', 'g')
    HAVING count(*) > 1
  ) g;
  IF v_groups > 0 THEN
    RAISE EXCEPTION 'recipients_unique_identity: % group(s) of duplicate recipients still exist. Run supabase/maintenance/20261026_merge_duplicate_recipients.sql (dry-run first, then -v apply=1) and apply this migration afterwards.', v_groups;
  END IF;
END
$guard$;

CREATE UNIQUE INDEX IF NOT EXISTS recipients_user_name_phone_uniq
  ON public.recipients (
    user_id,
    (lower(regexp_replace(btrim(full_name), '\s+', ' ', 'g'))),
    (regexp_replace(phone, '\D', '', 'g'))
  );

COMMIT;
