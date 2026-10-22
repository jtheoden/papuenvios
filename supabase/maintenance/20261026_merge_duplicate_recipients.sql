-- ============================================================================
-- MAINTENANCE SCRIPT (NOT a migration): merge duplicate recipients.   PREPARED, NOT EXECUTED
-- ============================================================================
-- Deliverable (a) of W6b. Deliverable (b) is the UNIQUE index migration
-- supabase/migrations/20261026100000_recipients_unique_identity.sql, which must be applied only AFTER this script has
-- run in production (it aborts while duplicates exist).
--
-- WHY: recipients had no UNIQUE and the form could be submitted twice, so the same person exists several times per user
--   (diagnostico_beneficiarios-duplicados-y-comision.md, part A). A plain DELETE is impossible: remittances.recipient_id,
--   remittances.recipient_address_id, remittances.recipient_bank_account_id (NO ACTION) and
--   remittance_bank_transfers.recipient_bank_account_id (RESTRICT) point at the duplicates or at their children. The fix
--   is a MERGE: re-point every reference to the survivor, and only then delete.
--
-- IDENTITY (same as the index and src/lib/recipientIdentity.js): user_id + lower(collapsed name) + digits of the phone.
--   A family can share a phone, so the phone alone is NOT an identity.
-- SURVIVOR of each group: most remittances > has an address > oldest (created_at, then id).
-- PER DUPLICATE:
--   * addresses: equivalent address (same province / municipality / address_line_1, normalized) already on the survivor
--     (or already chosen from another duplicate) -> remittances are re-pointed to it and the copy disappears with the
--     duplicate; otherwise the address MOVES to the survivor. If the survivor ends up with no default, the preferred one
--     (was default, then oldest) becomes the default.
--   * bank links (recipient_bank_accounts): same rule keyed by bank_account_id (UNIQUE(recipient_id, bank_account_id)).
--     remittances and remittance_bank_transfers follow. A merged link keeps is_active = true if any copy was active.
--   * remittances.recipient_id -> survivor.  is_favorite of the survivor = OR of the group.
--   * id_number / email / notes: a blank (NULL, empty or whitespace) value of the survivor is completed with the first
--     non-blank value of its duplicates (oldest created_at, then id); a value the survivor already has is never overwritten.
--     The report counts the fields completed and the duplicate values that conflict with the survivor and would be dropped.
--   * the duplicate is deleted only after asserting nothing references it any more; the CASCADE then only drops copies.
--
-- USAGE (psql, never the Supabase SQL editor: it uses psql meta-commands):
--   DRY-RUN (default): reads real tables, writes only private temp tables (then the transaction is set read only), prints the counts and one line per duplicate (ids cut to
--     8 characters, no names or phones), then ROLLBACK:
--       psql "$DB_URL" -X -v ON_ERROR_STOP=1 -f supabase/maintenance/20261026_merge_duplicate_recipients.sql
--   APPLY (needs the owner's explicit "dale", after reviewing the dry-run): one transaction, takes
--     LOCK TABLE IN SHARE ROW EXCLUSIVE MODE on recipients, remittances, recipient_addresses and recipient_bank_accounts
--     (their INSERT/UPDATE/DELETE wait, or hit lock_timeout = 5s, for the few seconds it lasts; reads are not blocked. Locking
--     recipients alone would NOT stop remittance inserts: the FK check only takes a row-level KEY SHARE on recipients):
--       psql "$DB_URL" -X -v ON_ERROR_STOP=1 -v apply=1 -f supabase/maintenance/20261026_merge_duplicate_recipients.sql
--   Any error (lock timeout, a reference left behind, a duplicate group still present at the end) aborts and rolls back.
--
-- ROLE: run it as the table owner (postgres; with the Supabase CLI credentials: `SET ROLE postgres` first). The
--   remittances triggers let postgres / service_role / supabase_admin through: guard_remittance_owner_update (explicit
--   role list), guard_remittance_money_columns (only blocks authenticated/anon, and does not cover recipient_* columns),
--   guard_status_via_rpc (UPDATE OF status only) and audit_financial_update (money columns only). No SECURITY DEFINER
--   function is needed. Verified on the local scratch DB by src/tests/concurrency/recipientsMerge.test.js.
-- ROLLBACK: none after COMMIT (rows are deleted). Take a backup / PITR point first. Dry-run is fully reversible.
-- ============================================================================

\set ON_ERROR_STOP on
\if :{?apply}
\else
  \set apply 0
\endif

BEGIN;
SET LOCAL lock_timeout = '5s';
SELECT pg_advisory_xact_lock(hashtext('recipients_merge'));
\if :apply
LOCK TABLE public.recipients, public.remittances, public.recipient_addresses, public.recipient_bank_accounts
  IN SHARE ROW EXCLUSIVE MODE;
\endif

-- ---------------------------------------------------------------------------
-- Plan (reads real tables, writes temp tables only)
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE _rm_member ON COMMIT DROP AS
SELECT id, user_id, keep_id, COALESCE(is_favorite, false) AS is_favorite, n_rem, has_addr
FROM (
  SELECT r.id, r.user_id, r.is_favorite, g.n_rem, g.has_addr,
         first_value(r.id) OVER w AS keep_id,
         count(*) OVER (PARTITION BY r.user_id, g.name_key, g.phone_key) AS grp_size
  FROM public.recipients r
  CROSS JOIN LATERAL (
    SELECT lower(regexp_replace(btrim(r.full_name), '\s+', ' ', 'g')) AS name_key,
           regexp_replace(r.phone, '\D', '', 'g') AS phone_key,
           (SELECT count(*) FROM public.remittances x WHERE x.recipient_id = r.id) AS n_rem,
           EXISTS (SELECT 1 FROM public.recipient_addresses a WHERE a.recipient_id = r.id) AS has_addr
  ) g
  WINDOW w AS (PARTITION BY r.user_id, g.name_key, g.phone_key
               ORDER BY g.n_rem DESC, g.has_addr DESC, r.created_at ASC, r.id ASC)
) ranked
WHERE grp_size > 1;

CREATE TEMP TABLE _rm_dup ON COMMIT DROP AS
SELECT id AS dup_id, keep_id, user_id, n_rem FROM _rm_member WHERE id <> keep_id;

CREATE TEMP TABLE _rm_addr ON COMMIT DROP AS
SELECT addr_id, keep_id, target_id, is_default, created_at
FROM (
  SELECT a.id AS addr_id, m.keep_id, COALESCE(a.is_default, false) AS is_default, a.created_at, (m.id <> m.keep_id) AS is_dup,
         first_value(a.id) OVER (
           PARTITION BY m.keep_id,
                        lower(btrim(a.province)), lower(btrim(COALESCE(a.municipality, ''))),
                        lower(regexp_replace(btrim(a.address_line_1), '\s+', ' ', 'g'))
           ORDER BY (m.id <> m.keep_id), a.created_at, a.id) AS target_id
  FROM _rm_member m
  JOIN public.recipient_addresses a ON a.recipient_id = m.id
) t
WHERE is_dup;

CREATE TEMP TABLE _rm_link ON COMMIT DROP AS
SELECT link_id, keep_id, target_id, is_default, is_active, created_at
FROM (
  SELECT l.id AS link_id, m.keep_id, COALESCE(l.is_default, false) AS is_default, COALESCE(l.is_active, true) AS is_active,
         l.created_at, (m.id <> m.keep_id) AS is_dup,
         first_value(l.id) OVER (PARTITION BY m.keep_id, l.bank_account_id
                                 ORDER BY (m.id <> m.keep_id), l.created_at, l.id) AS target_id
  FROM _rm_member m
  JOIN public.recipient_bank_accounts l ON l.recipient_id = m.id
) t
WHERE is_dup;

-- Survivor fields to complete: first non-blank value among the duplicates (NULL when the survivor already has one)
CREATE TEMP TABLE _rm_fill ON COMMIT DROP AS
SELECT k.id AS keep_id,
  CASE WHEN nullif(btrim(k.id_number), '') IS NULL THEN (
    SELECT x.id_number FROM _rm_dup d JOIN public.recipients x ON x.id = d.dup_id
    WHERE d.keep_id = k.id AND nullif(btrim(x.id_number), '') IS NOT NULL ORDER BY x.created_at, x.id LIMIT 1) END AS id_number,
  CASE WHEN nullif(btrim(k.email), '') IS NULL THEN (
    SELECT x.email FROM _rm_dup d JOIN public.recipients x ON x.id = d.dup_id
    WHERE d.keep_id = k.id AND nullif(btrim(x.email), '') IS NOT NULL ORDER BY x.created_at, x.id LIMIT 1) END AS email,
  CASE WHEN nullif(btrim(k.notes), '') IS NULL THEN (
    SELECT x.notes FROM _rm_dup d JOIN public.recipients x ON x.id = d.dup_id
    WHERE d.keep_id = k.id AND nullif(btrim(x.notes), '') IS NOT NULL ORDER BY x.created_at, x.id LIMIT 1) END AS notes
FROM public.recipients k
WHERE k.id IN (SELECT DISTINCT keep_id FROM _rm_dup);

-- Dry-run: from here on the transaction is read only, so even a bug could not write a real table.
\if :apply
\else
  SET transaction_read_only = on;
\endif

-- ---------------------------------------------------------------------------
-- Report (identical in dry-run and apply; ids cut to 8 characters, no names or phones)
-- ---------------------------------------------------------------------------
SELECT metric, n FROM (
  SELECT 1 AS ord, 'groups_with_duplicates' AS metric, count(DISTINCT keep_id) AS n FROM _rm_dup
  UNION ALL SELECT 2, 'duplicate_rows_to_delete', count(*) FROM _rm_dup
  UNION ALL SELECT 3, 'remittances_repointed_to_survivor', count(*) FROM public.remittances WHERE recipient_id IN (SELECT dup_id FROM _rm_dup)
  UNION ALL SELECT 4, 'addresses_moved_to_survivor', count(*) FROM _rm_addr WHERE target_id = addr_id
  UNION ALL SELECT 5, 'addresses_merged_into_equivalent', count(*) FROM _rm_addr WHERE target_id <> addr_id
  UNION ALL SELECT 6, 'remittance_address_repoints', count(*) FROM public.remittances r JOIN _rm_addr p ON r.recipient_address_id = p.addr_id WHERE p.target_id <> p.addr_id
  UNION ALL SELECT 7, 'bank_links_moved_to_survivor', count(*) FROM _rm_link WHERE target_id = link_id
  UNION ALL SELECT 8, 'bank_links_merged_into_equivalent', count(*) FROM _rm_link WHERE target_id <> link_id
  UNION ALL SELECT 9, 'remittance_bank_link_repoints', count(*) FROM public.remittances r JOIN _rm_link p ON r.recipient_bank_account_id = p.link_id WHERE p.target_id <> p.link_id
  UNION ALL SELECT 10, 'bank_transfer_link_repoints', count(*) FROM public.remittance_bank_transfers t JOIN _rm_link p ON t.recipient_bank_account_id = p.link_id WHERE p.target_id <> p.link_id
  UNION ALL SELECT 11, 'survivors_gaining_favorite', count(DISTINCT m.keep_id) FROM _rm_member m JOIN public.recipients k ON k.id = m.keep_id WHERE m.is_favorite AND NOT COALESCE(k.is_favorite, false)
  UNION ALL SELECT 12, 'survivor_fields_completed', (SELECT count(id_number) + count(email) + count(notes) FROM _rm_fill)
  UNION ALL SELECT 13, 'duplicate_values_lost_in_conflict', count(*)
    FROM _rm_dup d
    JOIN public.recipients x ON x.id = d.dup_id
    JOIN public.recipients k ON k.id = d.keep_id
    JOIN _rm_fill f ON f.keep_id = d.keep_id
    CROSS JOIN LATERAL (VALUES
      (x.id_number, CASE WHEN nullif(btrim(k.id_number), '') IS NULL THEN f.id_number ELSE k.id_number END),
      (x.email,     CASE WHEN nullif(btrim(k.email), '')     IS NULL THEN f.email     ELSE k.email     END),
      (x.notes,     CASE WHEN nullif(btrim(k.notes), '')     IS NULL THEN f.notes     ELSE k.notes     END)
    ) v(dup_val, final_val)
    WHERE nullif(btrim(v.dup_val), '') IS NOT NULL AND v.dup_val IS DISTINCT FROM v.final_val
) report ORDER BY ord;

SELECT left(d.user_id::text, 8) AS user8, left(d.keep_id::text, 8) AS survivor8, left(d.dup_id::text, 8) AS duplicate8,
       d.n_rem AS remittances,
       (SELECT count(*) FROM public.recipient_addresses a WHERE a.recipient_id = d.dup_id) AS addresses,
       (SELECT count(*) FROM public.recipient_bank_accounts l WHERE l.recipient_id = d.dup_id) AS bank_links
FROM _rm_dup d
ORDER BY user8, survivor8, duplicate8;

-- ---------------------------------------------------------------------------
-- Apply (skipped entirely in dry-run)
-- ---------------------------------------------------------------------------
\if :apply

-- 1. merged copies: references go to the equivalent row that stays
UPDATE public.remittances r SET recipient_address_id = p.target_id
  FROM _rm_addr p WHERE r.recipient_address_id = p.addr_id AND p.target_id <> p.addr_id;
UPDATE public.remittances r SET recipient_bank_account_id = p.target_id
  FROM _rm_link p WHERE r.recipient_bank_account_id = p.link_id AND p.target_id <> p.link_id;
UPDATE public.remittance_bank_transfers t SET recipient_bank_account_id = p.target_id
  FROM _rm_link p WHERE t.recipient_bank_account_id = p.link_id AND p.target_id <> p.link_id;
UPDATE public.recipient_bank_accounts t SET is_active = true
  WHERE t.id IN (SELECT target_id FROM _rm_link WHERE target_id <> link_id AND is_active) AND NOT COALESCE(t.is_active, true);

-- 2. rows without an equivalent move to the survivor (never as default: the defaults are fixed in step 3)
UPDATE public.recipient_addresses a SET recipient_id = p.keep_id, is_default = false
  FROM _rm_addr p WHERE a.id = p.addr_id AND p.target_id = p.addr_id;
UPDATE public.recipient_bank_accounts l SET recipient_id = p.keep_id, is_default = false
  FROM _rm_link p WHERE l.id = p.link_id AND p.target_id = p.link_id;

-- 3. a survivor left without a default gets the preferred one (was default, then oldest)
UPDATE public.recipient_addresses a SET is_default = true
WHERE a.id IN (
  SELECT DISTINCT ON (x.recipient_id) x.id
  FROM public.recipient_addresses x
  LEFT JOIN _rm_addr p ON p.addr_id = x.id
  WHERE x.recipient_id IN (SELECT DISTINCT keep_id FROM _rm_dup)
  ORDER BY x.recipient_id, COALESCE(p.is_default, false) DESC, x.created_at, x.id)
  AND NOT EXISTS (SELECT 1 FROM public.recipient_addresses d WHERE d.recipient_id = a.recipient_id AND d.is_default);
UPDATE public.recipient_bank_accounts l SET is_default = true
WHERE l.id IN (
  SELECT DISTINCT ON (x.recipient_id) x.id
  FROM public.recipient_bank_accounts x
  LEFT JOIN _rm_link p ON p.link_id = x.id
  WHERE x.recipient_id IN (SELECT DISTINCT keep_id FROM _rm_dup)
  ORDER BY x.recipient_id, COALESCE(p.is_default, false) DESC, x.created_at, x.id)
  AND NOT EXISTS (SELECT 1 FROM public.recipient_bank_accounts d WHERE d.recipient_id = l.recipient_id AND d.is_default);

-- 4. favorite = OR of the group; blank survivor fields are completed; remittances move to the survivor
UPDATE public.recipients k SET id_number = COALESCE(f.id_number, k.id_number), email = COALESCE(f.email, k.email), notes = COALESCE(f.notes, k.notes)
  FROM _rm_fill f WHERE k.id = f.keep_id AND (f.id_number IS NOT NULL OR f.email IS NOT NULL OR f.notes IS NOT NULL);
UPDATE public.recipients k SET is_favorite = true
  WHERE k.id IN (SELECT keep_id FROM _rm_member WHERE is_favorite) AND NOT COALESCE(k.is_favorite, false);
UPDATE public.remittances r SET recipient_id = d.keep_id FROM _rm_dup d WHERE r.recipient_id = d.dup_id;

-- 5. nothing may still point at a duplicate or at a merged copy
DO $check$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.remittances r
    WHERE r.recipient_id IN (SELECT dup_id FROM _rm_dup)
       OR r.recipient_address_id IN (SELECT addr_id FROM _rm_addr WHERE target_id <> addr_id)
       OR r.recipient_bank_account_id IN (SELECT link_id FROM _rm_link WHERE target_id <> link_id)
  ) OR EXISTS (
    SELECT 1 FROM public.remittance_bank_transfers t
    WHERE t.recipient_bank_account_id IN (SELECT link_id FROM _rm_link WHERE target_id <> link_id)
  ) THEN
    RAISE EXCEPTION 'merge_duplicate_recipients: a reference to a duplicate was left behind; rolling back';
  END IF;
END
$check$;

DELETE FROM public.recipients WHERE id IN (SELECT dup_id FROM _rm_dup);

-- 6. post-condition: no duplicate group is left
DO $post$
DECLARE
  v_left integer;
BEGIN
  SELECT count(*) INTO v_left FROM (
    SELECT 1 FROM public.recipients
    GROUP BY user_id, lower(regexp_replace(btrim(full_name), '\s+', ' ', 'g')), regexp_replace(phone, '\D', '', 'g')
    HAVING count(*) > 1
  ) g;
  IF v_left > 0 THEN
    RAISE EXCEPTION 'merge_duplicate_recipients: % duplicate group(s) remain after the merge; rolling back', v_left;
  END IF;
END
$post$;

SELECT 'APPLIED: merge committed' AS result;
COMMIT;
\else
SELECT 'DRY-RUN: read only, nothing changed. Re-run with -v apply=1 to apply' AS result;
ROLLBACK;
\endif
