-- ============================================================================
-- Bizum S4: bizum_accounts (receiving accounts) + internal account picker
-- ============================================================================
-- Context: design_bizum_p2p_v2 sections 2.1 (R-02), 3.1 (M3). PREPARED, NOT APPLIED to the hosted
-- project. Nothing reads this table yet: it is configuration for the later Bizum slices.
--
-- Access model
--   * The table is admin-only through RLS: ONE policy FOR ALL TO authenticated whose USING and
--     WITH CHECK are is_admin_user() OR is_super_admin() (is_admin_user() requires is_enabled).
--     A non-admin authenticated user reads 0 rows, cannot insert (RLS violation, 42501) and updates
--     0 rows. anon has no privileges at all.
--   * Privileges: authenticated gets SELECT, INSERT, UPDATE only (RLS filters; no DELETE, no
--     TRUNCATE); service_role keeps ALL. The default ACL of the project grants everything to
--     anon / authenticated on new tables, hence the explicit REVOKE first.
--   * No physical delete for ANY role: a BEFORE DELETE row trigger and a BEFORE TRUNCATE statement
--     trigger raise bizum_accounts_no_delete. Accounts are retired with is_active = false because
--     orders / remittances will reference them (ON DELETE RESTRICT in a later slice) and the
--     historical phone must stay resolvable. Owner maintenance (fixtures) uses SET LOCAL
--     session_replication_role = 'replica'.
--   * Not added to supabase_realtime: the phone must not be broadcast.
--   * Writes here are direct table writes under RLS (CRUD form), so there is no RPC to audit from;
--     the row keeps created_by / created_at / updated_at. An audit trigger would have to avoid
--     logging the phone (PII) and is out of scope for this slice.
--
-- per_operation_limit has NO column default on purpose: 0 means "no cap" and the suggested value
-- (bizum_settings.default_per_operation_limit) is resolved by the UI / RPC that creates accounts,
-- so changing the setting never silently rewrites how a missing limit is read.
--
-- _pick_bizum_account(p_flow, p_eur): internal (SECURITY DEFINER, no client EXECUTE). Active
-- account serving the flow ('products' -> for_products, 'remittances' -> for_remittances) whose
-- per_operation_limit is 0 or >= the EUR amount, ordered by priority_order ascending with id as a
-- stable tie-break. Returns NULL when none fits or the amount is NULL / NaN / Infinity / <= 0. An unknown flow is a
-- programming error and raises bizum_invalid_flow instead of silently returning NULL.
--
-- Idempotent (IF NOT EXISTS, CREATE OR REPLACE, DROP POLICY / TRIGGER IF EXISTS).
--
-- ROLLBACK (exact inverse; drops the configured accounts, export them first)
-- DROP FUNCTION IF EXISTS public._pick_bizum_account(text, numeric);
-- DROP TABLE IF EXISTS public.bizum_accounts;  -- also drops the policy and its five triggers
-- DROP FUNCTION IF EXISTS public.bizum_accounts_no_delete();
-- DROP FUNCTION IF EXISTS public.bizum_accounts_guard();
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.bizum_accounts (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_name        text NOT NULL,
  holder_name         text NOT NULL,
  phone               text NOT NULL,
  bank_name           text,
  is_active           boolean NOT NULL DEFAULT true,
  for_products        boolean NOT NULL DEFAULT true,
  for_remittances     boolean NOT NULL DEFAULT true,
  priority_order      integer NOT NULL DEFAULT 0,
  -- EUR per operation; 0 = no cap
  per_operation_limit numeric(10,2) NOT NULL,
  notes               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid DEFAULT auth.uid(),
  CONSTRAINT bizum_accounts_phone_e164 CHECK (phone ~ '^\+[1-9][0-9]{7,14}$'),
  CONSTRAINT bizum_accounts_phone_key UNIQUE (phone),
  CONSTRAINT bizum_accounts_limit_nonneg CHECK (per_operation_limit >= 0),
  CONSTRAINT bizum_accounts_account_name_len CHECK (char_length(btrim(account_name)) BETWEEN 1 AND 120),
  CONSTRAINT bizum_accounts_holder_name_len CHECK (char_length(btrim(holder_name)) BETWEEN 1 AND 120),
  CONSTRAINT bizum_accounts_bank_name_len CHECK (bank_name IS NULL OR char_length(bank_name) <= 120),
  CONSTRAINT bizum_accounts_notes_len CHECK (notes IS NULL OR char_length(notes) <= 500)
);

CREATE INDEX IF NOT EXISTS idx_bizum_accounts_pick
  ON public.bizum_accounts (priority_order, id) WHERE is_active;

ALTER TABLE public.bizum_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bizum_accounts_admin_all ON public.bizum_accounts;
CREATE POLICY bizum_accounts_admin_all ON public.bizum_accounts
  FOR ALL TO authenticated
  USING (public.is_admin_user() OR public.is_super_admin())
  WITH CHECK (public.is_admin_user() OR public.is_super_admin());

REVOKE ALL ON public.bizum_accounts FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.bizum_accounts TO authenticated;
GRANT ALL ON public.bizum_accounts TO service_role;

DROP TRIGGER IF EXISTS trigger_update_bizum_accounts_updated_at ON public.bizum_accounts;
CREATE TRIGGER trigger_update_bizum_accounts_updated_at
  BEFORE UPDATE ON public.bizum_accounts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Provenance cannot be forged: on INSERT created_by / created_at are forced (a client-supplied value
-- is ignored), on UPDATE id, created_by and created_at are immutable.
CREATE OR REPLACE FUNCTION public.bizum_accounts_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.created_by := auth.uid();
    NEW.created_at := now();
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'bizum_accounts_immutable_columns' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.bizum_accounts_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS bizum_accounts_guard_insert ON public.bizum_accounts;
CREATE TRIGGER bizum_accounts_guard_insert
  BEFORE INSERT ON public.bizum_accounts
  FOR EACH ROW EXECUTE FUNCTION public.bizum_accounts_guard();

DROP TRIGGER IF EXISTS bizum_accounts_guard_update ON public.bizum_accounts;
CREATE TRIGGER bizum_accounts_guard_update
  BEFORE UPDATE ON public.bizum_accounts
  FOR EACH ROW EXECUTE FUNCTION public.bizum_accounts_guard();

CREATE OR REPLACE FUNCTION public.bizum_accounts_no_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
BEGIN
  RAISE EXCEPTION 'bizum_accounts_no_delete' USING ERRCODE = 'P0001';
END;
$function$;

REVOKE ALL ON FUNCTION public.bizum_accounts_no_delete() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS bizum_accounts_no_delete_row ON public.bizum_accounts;
CREATE TRIGGER bizum_accounts_no_delete_row
  BEFORE DELETE ON public.bizum_accounts
  FOR EACH ROW EXECUTE FUNCTION public.bizum_accounts_no_delete();

DROP TRIGGER IF EXISTS bizum_accounts_no_truncate ON public.bizum_accounts;
CREATE TRIGGER bizum_accounts_no_truncate
  BEFORE TRUNCATE ON public.bizum_accounts
  FOR EACH STATEMENT EXECUTE FUNCTION public.bizum_accounts_no_delete();

CREATE OR REPLACE FUNCTION public._pick_bizum_account(p_flow text, p_eur numeric)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF p_flow IS NULL OR p_flow NOT IN ('products', 'remittances') THEN
    RAISE EXCEPTION 'bizum_invalid_flow' USING ERRCODE = 'P0001';
  END IF;

  IF p_eur IS NULL OR p_eur <= 0 OR p_eur IN ('NaN'::numeric, 'Infinity'::numeric) THEN
    RETURN NULL;
  END IF;

  RETURN (
    SELECT a.id
      FROM public.bizum_accounts a
     WHERE a.is_active
       AND CASE p_flow WHEN 'products' THEN a.for_products ELSE a.for_remittances END
       AND (a.per_operation_limit = 0 OR a.per_operation_limit >= p_eur)
     ORDER BY a.priority_order ASC, a.id ASC
     LIMIT 1
  );
END;
$function$;

REVOKE ALL ON FUNCTION public._pick_bizum_account(text, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._pick_bizum_account(text, numeric) TO service_role;
