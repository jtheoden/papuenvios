-- PREPARED, NOT APPLIED
-- Manual financial entries (super admin): incomes and expenses, in USD, that add to or subtract from the
-- dashboard net profit. Append-only: a wrong entry is voided with an opposite counter-entry, never edited or deleted.

CREATE TABLE IF NOT EXISTS public.financial_entries (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind            text NOT NULL CHECK (kind IN ('income', 'expense')),
  amount          numeric(12,2) NOT NULL CHECK (amount > 0),
  entry_date      date NOT NULL,
  category        text NOT NULL DEFAULT 'other' CHECK (char_length(category) BETWEEN 1 AND 60),
  reason          text NOT NULL CHECK (char_length(reason) BETWEEN 10 AND 500),
  voids_entry_id  uuid REFERENCES public.financial_entries(id),
  created_by      uuid NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- One counter-entry per original entry.
CREATE UNIQUE INDEX IF NOT EXISTS financial_entries_voids_uidx
  ON public.financial_entries (voids_entry_id) WHERE voids_entry_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS financial_entries_date_idx
  ON public.financial_entries (entry_date DESC);

ALTER TABLE public.financial_entries ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.financial_entries FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.financial_entries TO authenticated;

DROP POLICY IF EXISTS financial_entries_select_super_admin ON public.financial_entries;
CREATE POLICY financial_entries_select_super_admin ON public.financial_entries
  FOR SELECT TO authenticated
  USING ((SELECT public.is_super_admin()));

-- The ledger is append-only for EVERY role (service_role and postgres bypass RLS and keep their default grants).
CREATE OR REPLACE FUNCTION public.financial_entries_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
BEGIN
  RAISE EXCEPTION 'financial_entries is append-only: void an entry with a counter-entry instead' USING ERRCODE = '42501';
END;
$function$;

DROP TRIGGER IF EXISTS financial_entries_no_update_delete ON public.financial_entries;
CREATE TRIGGER financial_entries_no_update_delete
  BEFORE UPDATE OR DELETE ON public.financial_entries
  FOR EACH ROW EXECUTE FUNCTION public.financial_entries_append_only();

DROP TRIGGER IF EXISTS financial_entries_no_truncate ON public.financial_entries;
CREATE TRIGGER financial_entries_no_truncate
  BEFORE TRUNCATE ON public.financial_entries
  FOR EACH STATEMENT EXECUTE FUNCTION public.financial_entries_append_only();

CREATE OR REPLACE FUNCTION public.superadmin_add_financial_entry(
  p_kind       text,
  p_amount     numeric,
  p_entry_date date,
  p_category   text,
  p_reason     text
)
RETURNS public.financial_entries
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid      uuid := auth.uid();
  v_reason   text := btrim(COALESCE(p_reason, ''));
  v_category text := COALESCE(NULLIF(btrim(COALESCE(p_category, '')), ''), 'other');
  -- Business calendar (same zone as the Dashboard windows), not the UTC date of the database server.
  v_today    date := (now() AT TIME ZONE 'America/New_York')::date;
  v_row      public.financial_entries;
BEGIN
  IF v_uid IS NULL OR NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'insufficient_privilege: only a super administrator can record a financial entry' USING ERRCODE = '42501';
  END IF;
  IF p_kind IS NULL OR p_kind NOT IN ('income', 'expense') THEN
    RAISE EXCEPTION 'invalid_kind: must be income or expense' USING ERRCODE = '22023';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 OR p_amount > 9999999999.99 OR p_amount <> round(p_amount, 2) THEN
    RAISE EXCEPTION 'invalid_amount: must be greater than 0 and at most 9999999999.99, with at most 2 decimals' USING ERRCODE = '22023';
  END IF;
  IF char_length(v_reason) < 10 OR char_length(v_reason) > 500 THEN
    RAISE EXCEPTION 'invalid_reason: a reason of 10 to 500 characters is required' USING ERRCODE = '22023';
  END IF;
  IF char_length(v_category) > 60 THEN
    RAISE EXCEPTION 'invalid_category: at most 60 characters' USING ERRCODE = '22023';
  END IF;
  IF p_entry_date IS NULL OR p_entry_date < DATE '2020-01-01' OR p_entry_date > v_today THEN
    RAISE EXCEPTION 'invalid_date: a date from 2020-01-01 up to today is required' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.financial_entries (kind, amount, entry_date, category, reason, created_by)
  VALUES (p_kind, p_amount, p_entry_date, v_category, v_reason, v_uid)
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$function$;

CREATE OR REPLACE FUNCTION public.superadmin_void_financial_entry(
  p_entry_id uuid,
  p_reason   text
)
RETURNS public.financial_entries
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid    uuid := auth.uid();
  v_reason text := btrim(COALESCE(p_reason, ''));
  v_orig   public.financial_entries%ROWTYPE;
  v_today  date := (now() AT TIME ZONE 'America/New_York')::date;
  v_row    public.financial_entries;
BEGIN
  IF v_uid IS NULL OR NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'insufficient_privilege: only a super administrator can void a financial entry' USING ERRCODE = '42501';
  END IF;
  IF char_length(v_reason) < 10 OR char_length(v_reason) > 500 THEN
    RAISE EXCEPTION 'invalid_reason: a reason of 10 to 500 characters is required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_orig FROM public.financial_entries WHERE id = p_entry_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'entry_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_orig.voids_entry_id IS NOT NULL THEN
    RAISE EXCEPTION 'cannot_void_a_void: this entry already is a counter-entry' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.financial_entries WHERE voids_entry_id = p_entry_id) THEN
    RAISE EXCEPTION 'already_voided: this entry was already voided' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.financial_entries (kind, amount, entry_date, category, reason, voids_entry_id, created_by)
  VALUES (
    CASE WHEN v_orig.kind = 'income' THEN 'expense' ELSE 'income' END,
    v_orig.amount, v_today, v_orig.category, v_reason, p_entry_id, v_uid
  )
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$function$;

REVOKE ALL ON FUNCTION public.superadmin_add_financial_entry(text, numeric, date, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.superadmin_add_financial_entry(text, numeric, date, text, text) TO authenticated;
REVOKE ALL ON FUNCTION public.superadmin_void_financial_entry(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.superadmin_void_financial_entry(uuid, text) TO authenticated;
