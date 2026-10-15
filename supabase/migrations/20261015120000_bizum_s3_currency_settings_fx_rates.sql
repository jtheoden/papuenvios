-- ============================================================================
-- Bizum S3: payment_methods.currency + bizum_settings + payment_fx_rates (+ RPCs)
-- ============================================================================
-- Context: design_bizum_p2p_v2 sections 2.1, 3.1 (M1, M2), 3.2, 5. PREPARED, NOT APPLIED to the
-- hosted project: nothing here is wired to the live Zelle flow and Bizum stays available = false.
--
-- What it adds
--   M1  payment_methods.currency ('USD' | 'EUR'); bizum = 'EUR', zelle keeps 'USD'.
--       public.list_payment_methods_public() is deliberately NOT touched: it returns an explicit
--       RETURNS TABLE, so exposing the new column needs a different return type (CREATE OR REPLACE
--       cannot change it, a DROP would break the characterized shape). The slice that needs the
--       currency client-side (S11/S12) adds it together with its own characterization update.
--   --  bizum_settings: ONE row (boolean PK pinned to true) with every tunable Bizum parameter,
--       typed and range-checked. The recommended values of the design are the column DEFAULTs. It
--       REPLACES the "_payment_fx_limits() constants" idea: nothing is hardcoded, an admin changes
--       values through set_bizum_settings() without a migration.
--   M2  payment_fx_rates: append-only ledger of the USD->EUR rate. effective_rate is generated.
--
-- Access model (same pattern as set_payment_method_enabled)
--   * Both new tables: RLS ON, no policies, no privileges for PUBLIC / anon / authenticated,
--     ALL for service_role. Every client path goes through a SECURITY DEFINER RPC that re-checks
--     auth.uid() + is_admin_user() / is_super_admin() (is_admin_user() already includes
--     super_admin and requires is_enabled = true).
--   * Every SECURITY DEFINER function: SET search_path = public, pg_temp; EXECUTE revoked from
--     PUBLIC, anon, authenticated explicitly (the project ACL hands EXECUTE on new functions to
--     anon / authenticated) and granted back only where intended. Internal helpers are not
--     callable by clients at all (EXECUTE for service_role is granted explicitly so it does not
--     depend on the default ACL of the environment).
--   * Writes are audited INSIDE the RPC into activity_logs (client-written log lines could be
--     forged because activity_logs INSERT is open to authenticated). No PII: the actor is the
--     auth uid, payloads are numeric diffs.
--
-- Error contract (all P0001 unless noted)
--   bizum_settings_forbidden (42501), bizum_settings_invalid_patch, bizum_settings_unknown_key,
--   bizum_settings_out_of_range (DETAIL 'key=<name>'), payment_fx_forbidden (42501),
--   payment_fx_invalid_rate, payment_fx_invalid_spread, payment_fx_invalid_source,
--   payment_fx_note_too_long, payment_fx_large_change, payment_fx_rates_append_only.
--
-- Append-only decision (payment_fx_rates)
--   A BEFORE UPDATE / DELETE row trigger plus a BEFORE TRUNCATE statement trigger (two triggers) refuse every
--   role, service_role and the owner included: the table is the audit trail of the money rate
--   an order was sealed with. The repo has no append-only precedent to follow (the other guards
--   exempt service_role), so this one is stricter on purpose. Legitimate maintenance (test
--   fixtures, a platform reset) runs as the owner with SET LOCAL session_replication_role =
--   'replica', which skips these triggers by design and leaves a deliberate, greppable trace.
--
-- Other guards added after review
--   * created_at of a rate is clock_timestamp() (statement time), not now() (transaction start): the
--     "latest" rate is the last one WRITTEN even when its transaction began before a competing one.
--   * The large-change guard compares the EFFECTIVE rate (mid * (1 + spread/100), rounded like the
--     column), so a spread-only jump is guarded as well. Token: payment_fx_large_change.
--   * bizum_settings cannot be deleted / truncated (triggers). If the row is missing anyway, every
--     reader and writer raises bizum_settings_missing (fail closed) instead of returning NULL / no rows.
--   * _bizum_amount returns NULL for NaN / Infinity and outside the sanity caps |usd| <= 99999999.99
--     and |rate| <= 99999999.999999 (the widest values the money columns can hold).
--
-- FX freshness (get_payment_fx_status / _current_payment_fx)
--   age >= fx_warn_hours => 'warn' (still usable), age >= fx_block_hours => 'blocked' (not
--   usable), no rate => 'none'. A rate dated in the future (negative age) is 'blocked'. _current_payment_fx() returns ZERO rows for none / blocked and
--   exactly one row for ok / warn (S5a uses it to refuse sealing a payment without a usable rate).
--
-- Idempotent: CREATE ... IF NOT EXISTS, CREATE OR REPLACE, DROP TRIGGER IF EXISTS, seed rows with
-- ON CONFLICT DO NOTHING (a re-run never resets values an admin changed).
--
-- ROLLBACK (exact inverse; drops the rate history and the settings, so export them first)
-- DROP FUNCTION IF EXISTS public.get_payment_fx_status();
-- DROP FUNCTION IF EXISTS public.set_payment_fx_rate(numeric, numeric, text, text, boolean);
-- DROP FUNCTION IF EXISTS public._current_payment_fx();
-- DROP FUNCTION IF EXISTS public._payment_fx_latest();
-- DROP FUNCTION IF EXISTS public._bizum_amount(numeric, numeric);
-- DROP FUNCTION IF EXISTS public.set_bizum_settings(jsonb);
-- DROP FUNCTION IF EXISTS public.get_bizum_settings();
-- DROP FUNCTION IF EXISTS public._bizum_setting(text);
-- DROP FUNCTION IF EXISTS public._bizum_setting_keys();
-- DROP TABLE IF EXISTS public.payment_fx_rates;   -- also drops its two append-only triggers (row + TRUNCATE)
-- DROP FUNCTION IF EXISTS public.payment_fx_rates_append_only();
-- DROP TABLE IF EXISTS public.bizum_settings;   -- also drops its two no-delete triggers (row + TRUNCATE)
-- DROP FUNCTION IF EXISTS public.bizum_settings_no_delete();
-- ALTER TABLE public.payment_methods DROP CONSTRAINT IF EXISTS payment_methods_currency_check;
-- ALTER TABLE public.payment_methods DROP COLUMN IF EXISTS currency;
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. M1: payment_methods.currency
-- ----------------------------------------------------------------------------
ALTER TABLE public.payment_methods
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'USD';

DO $mig$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'payment_methods_currency_check'
       AND conrelid = 'public.payment_methods'::regclass
  ) THEN
    ALTER TABLE public.payment_methods
      ADD CONSTRAINT payment_methods_currency_check CHECK (currency IN ('USD', 'EUR')) NOT VALID;
  END IF;
END
$mig$;

UPDATE public.payment_methods SET currency = 'EUR' WHERE code = 'bizum' AND currency <> 'EUR';

-- Every row holds 'USD' (constant default) or 'EUR' (bizum, set above): 0 violators.
ALTER TABLE public.payment_methods VALIDATE CONSTRAINT payment_methods_currency_check;

-- ----------------------------------------------------------------------------
-- 2. bizum_settings: one row, every tunable parameter
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.bizum_settings (
  id boolean PRIMARY KEY DEFAULT true,
  -- D1: spread added on top of the mid rate when an admin does not type one
  default_spread_pct          numeric(5,2) NOT NULL DEFAULT 1.5,
  -- D2: quote validity and the grace period after it (a flag, not a block)
  quote_validity_minutes      integer NOT NULL DEFAULT 240,
  quote_grace_hours           integer NOT NULL DEFAULT 24,
  -- D3: rate freshness thresholds and the largest jump accepted without confirmation
  fx_warn_hours               integer NOT NULL DEFAULT 24,
  fx_block_hours              integer NOT NULL DEFAULT 96,
  fx_max_change_pct           numeric(5,2) NOT NULL DEFAULT 5,
  -- D5: suggested per-operation limit when creating an account (the real limit is per account)
  default_per_operation_limit numeric(10,2) NOT NULL DEFAULT 1000,
  -- D6: Bizum remittances without proof: warning and expiry
  remittance_warn_hours       integer NOT NULL DEFAULT 48,
  remittance_expire_hours     integer NOT NULL DEFAULT 72,
  -- D7 + abuse limits for quotes
  max_unpaid_ops_per_user     integer NOT NULL DEFAULT 3,
  max_open_quotes_per_user    integer NOT NULL DEFAULT 3,
  max_quotes_per_hour         integer NOT NULL DEFAULT 10,
  -- D8: informative only, nothing deletes proofs automatically
  proof_retention_years       integer NOT NULL DEFAULT 5,
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  updated_by                  uuid,
  CONSTRAINT bizum_settings_singleton CHECK (id),
  CONSTRAINT bizum_settings_default_spread_pct_range CHECK (default_spread_pct BETWEEN 0 AND 10),
  CONSTRAINT bizum_settings_quote_validity_minutes_range CHECK (quote_validity_minutes BETWEEN 15 AND 1440),
  CONSTRAINT bizum_settings_quote_grace_hours_range CHECK (quote_grace_hours BETWEEN 0 AND 72),
  CONSTRAINT bizum_settings_fx_warn_hours_range CHECK (fx_warn_hours BETWEEN 1 AND 720),
  CONSTRAINT bizum_settings_fx_block_hours_range CHECK (fx_block_hours BETWEEN 1 AND 720),
  CONSTRAINT bizum_settings_fx_max_change_pct_range CHECK (fx_max_change_pct BETWEEN 0.5 AND 20),
  CONSTRAINT bizum_settings_default_per_operation_limit_range CHECK (default_per_operation_limit > 0),
  CONSTRAINT bizum_settings_remittance_warn_hours_range CHECK (remittance_warn_hours BETWEEN 1 AND 720),
  CONSTRAINT bizum_settings_remittance_expire_hours_range CHECK (remittance_expire_hours BETWEEN 1 AND 720),
  CONSTRAINT bizum_settings_max_unpaid_ops_per_user_range CHECK (max_unpaid_ops_per_user BETWEEN 1 AND 20),
  CONSTRAINT bizum_settings_max_open_quotes_per_user_range CHECK (max_open_quotes_per_user BETWEEN 1 AND 20),
  CONSTRAINT bizum_settings_max_quotes_per_hour_range CHECK (max_quotes_per_hour BETWEEN 1 AND 100),
  CONSTRAINT bizum_settings_proof_retention_years_range CHECK (proof_retention_years BETWEEN 1 AND 15),
  CONSTRAINT bizum_settings_fx_window_order CHECK (fx_warn_hours < fx_block_hours),
  CONSTRAINT bizum_settings_remittance_window_order CHECK (remittance_warn_hours < remittance_expire_hours)
);

-- Seed only when missing: a re-run must never reset values an admin changed.
INSERT INTO public.bizum_settings (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.bizum_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.bizum_settings FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.bizum_settings TO service_role;

CREATE OR REPLACE FUNCTION public.bizum_settings_no_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
BEGIN
  RAISE EXCEPTION 'bizum_settings_no_delete' USING ERRCODE = 'P0001';
END;
$function$;

REVOKE ALL ON FUNCTION public.bizum_settings_no_delete() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS bizum_settings_no_delete_row ON public.bizum_settings;
CREATE TRIGGER bizum_settings_no_delete_row
  BEFORE DELETE ON public.bizum_settings
  FOR EACH ROW EXECUTE FUNCTION public.bizum_settings_no_delete();

DROP TRIGGER IF EXISTS bizum_settings_no_truncate ON public.bizum_settings;
CREATE TRIGGER bizum_settings_no_truncate
  BEFORE TRUNCATE ON public.bizum_settings
  FOR EACH STATEMENT EXECUTE FUNCTION public.bizum_settings_no_delete();

-- Single source of truth for the configurable keys (used by the reader and the writer).
CREATE OR REPLACE FUNCTION public._bizum_setting_keys()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $function$
  SELECT ARRAY[
    'default_spread_pct', 'quote_validity_minutes', 'quote_grace_hours',
    'fx_warn_hours', 'fx_block_hours', 'fx_max_change_pct',
    'default_per_operation_limit', 'remittance_warn_hours', 'remittance_expire_hours',
    'max_unpaid_ops_per_user', 'max_open_quotes_per_user', 'max_quotes_per_hour',
    'proof_retention_years'
  ]::text[];
$function$;

REVOKE ALL ON FUNCTION public._bizum_setting_keys() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._bizum_setting_keys() TO service_role;

-- Internal reader for other functions: one value as numeric.
CREATE OR REPLACE FUNCTION public._bizum_setting(p_key text)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_value numeric;
BEGIN
  IF p_key IS NULL OR NOT (p_key = ANY (public._bizum_setting_keys())) THEN
    RAISE EXCEPTION 'bizum_settings_unknown_key' USING ERRCODE = 'P0001';
  END IF;
  SELECT (to_jsonb(s) ->> p_key)::numeric INTO v_value FROM public.bizum_settings s;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'bizum_settings_missing' USING ERRCODE = 'P0001';
  END IF;
  RETURN v_value;
END;
$function$;

REVOKE ALL ON FUNCTION public._bizum_setting(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._bizum_setting(text) TO service_role;

CREATE OR REPLACE FUNCTION public.get_bizum_settings()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_row jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT (public.is_admin_user() OR public.is_super_admin()) THEN
    RAISE EXCEPTION 'bizum_settings_forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT to_jsonb(s) INTO v_row FROM public.bizum_settings s;
  IF v_row IS NULL THEN
    RAISE EXCEPTION 'bizum_settings_missing' USING ERRCODE = 'P0001';
  END IF;
  RETURN v_row;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_bizum_settings() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_bizum_settings() TO authenticated, service_role;

-- Partial update: merges ONLY the known keys of p_patch. The merged row is validated by the table
-- CHECKs (single source of the ranges); a violation is re-raised as bizum_settings_out_of_range
-- naming the key, never echoing the value.
CREATE OR REPLACE FUNCTION public.set_bizum_settings(p_patch jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  c_integer_keys CONSTANT text[] := ARRAY[
    'quote_validity_minutes', 'quote_grace_hours', 'fx_warn_hours', 'fx_block_hours',
    'remittance_warn_hours', 'remittance_expire_hours', 'max_unpaid_ops_per_user',
    'max_open_quotes_per_user', 'max_quotes_per_hour', 'proof_retention_years'
  ];
  v_key       text;
  v_val       jsonb;
  v_norm      jsonb := '{}'::jsonb;
  v_num       numeric;
  v_cap       numeric;
  v_old       public.bizum_settings%ROWTYPE;
  v_new       public.bizum_settings%ROWTYPE;
  v_changes   jsonb := '{}'::jsonb;
  v_constraint text;
  v_bad_key   text;
BEGIN
  IF auth.uid() IS NULL OR NOT (public.is_admin_user() OR public.is_super_admin()) THEN
    RAISE EXCEPTION 'bizum_settings_forbidden' USING ERRCODE = '42501';
  END IF;

  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' THEN
    RAISE EXCEPTION 'bizum_settings_invalid_patch' USING ERRCODE = 'P0001';
  END IF;

  FOR v_key IN SELECT jsonb_object_keys(p_patch) LOOP
    IF NOT (v_key = ANY (public._bizum_setting_keys())) THEN
      RAISE EXCEPTION 'bizum_settings_unknown_key' USING ERRCODE = 'P0001';
    END IF;
  END LOOP;

  -- Shape check before touching the row: JSON numbers only, whole numbers for integer columns,
  -- at most 2 decimals for the numeric(_,2) columns (no silent rounding), and a cap that keeps the
  -- value inside the column type so the table CHECK, not a type overflow, decides the range.
  FOR v_key, v_val IN SELECT * FROM jsonb_each(p_patch) LOOP
    IF jsonb_typeof(v_val) <> 'number' THEN
      RAISE EXCEPTION 'bizum_settings_out_of_range' USING ERRCODE = 'P0001', DETAIL = 'key=' || v_key;
    END IF;
    v_num := (v_val #>> '{}')::numeric;
    v_cap := CASE
      WHEN v_key = ANY (c_integer_keys) THEN 2147483647
      WHEN v_key = 'default_per_operation_limit' THEN 99999999.99
      ELSE 999.99
    END;
    IF abs(v_num) > v_cap
       OR (v_key = ANY (c_integer_keys) AND v_num <> trunc(v_num))
       OR (NOT (v_key = ANY (c_integer_keys)) AND v_num <> round(v_num, 2)) THEN
      RAISE EXCEPTION 'bizum_settings_out_of_range' USING ERRCODE = 'P0001', DETAIL = 'key=' || v_key;
    END IF;
    -- Normalized value: 12.0 / 3.00 become the plain integer 12 / 3 so the cast into an integer
    -- column cannot fail with a raw 22P02 (the shape check above already proved it is whole).
    v_norm := v_norm || jsonb_build_object(
      v_key,
      CASE WHEN v_key = ANY (c_integer_keys) THEN to_jsonb(trunc(v_num)::bigint) ELSE to_jsonb(v_num) END
    );
  END LOOP;

  PERFORM pg_advisory_xact_lock(hashtext('bizum_settings'));

  SELECT * INTO v_old FROM public.bizum_settings WHERE id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'bizum_settings_missing' USING ERRCODE = 'P0001';
  END IF;
  v_new := jsonb_populate_record(v_old, v_norm);

  FOREACH v_key IN ARRAY public._bizum_setting_keys() LOOP
    IF (to_jsonb(v_old) ->> v_key)::numeric IS DISTINCT FROM (to_jsonb(v_new) ->> v_key)::numeric THEN
      v_changes := v_changes || jsonb_build_object(
        v_key,
        jsonb_build_object('before', to_jsonb(v_old) -> v_key, 'after', to_jsonb(v_new) -> v_key)
      );
    END IF;
  END LOOP;

  -- Nothing changed: no write, no audit noise.
  IF v_changes = '{}'::jsonb THEN
    RETURN to_jsonb(v_old);
  END IF;

  BEGIN
    UPDATE public.bizum_settings SET
      default_spread_pct          = v_new.default_spread_pct,
      quote_validity_minutes      = v_new.quote_validity_minutes,
      quote_grace_hours           = v_new.quote_grace_hours,
      fx_warn_hours               = v_new.fx_warn_hours,
      fx_block_hours              = v_new.fx_block_hours,
      fx_max_change_pct           = v_new.fx_max_change_pct,
      default_per_operation_limit = v_new.default_per_operation_limit,
      remittance_warn_hours       = v_new.remittance_warn_hours,
      remittance_expire_hours     = v_new.remittance_expire_hours,
      max_unpaid_ops_per_user     = v_new.max_unpaid_ops_per_user,
      max_open_quotes_per_user    = v_new.max_open_quotes_per_user,
      max_quotes_per_hour         = v_new.max_quotes_per_hour,
      proof_retention_years       = v_new.proof_retention_years,
      updated_at                  = now(),
      updated_by                  = auth.uid()
    WHERE id;
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
    v_bad_key := CASE v_constraint
      WHEN 'bizum_settings_fx_window_order' THEN
        CASE WHEN p_patch ? 'fx_warn_hours' THEN 'fx_warn_hours' ELSE 'fx_block_hours' END
      WHEN 'bizum_settings_remittance_window_order' THEN
        CASE WHEN p_patch ? 'remittance_warn_hours' THEN 'remittance_warn_hours' ELSE 'remittance_expire_hours' END
      ELSE regexp_replace(regexp_replace(v_constraint, '^bizum_settings_', ''), '_range$', '')
    END;
    RAISE EXCEPTION 'bizum_settings_out_of_range' USING ERRCODE = 'P0001', DETAIL = 'key=' || v_bad_key;
  END;

  INSERT INTO public.activity_logs (action, entity_type, entity_id, performed_by, description, metadata)
  VALUES (
    'bizum_settings_updated',
    'bizum_settings',
    NULL,
    auth.uid()::text,
    format('Bizum settings updated (%s keys)', (SELECT count(*) FROM jsonb_object_keys(v_changes))),
    jsonb_build_object('changes', v_changes)
  );

  RETURN (SELECT to_jsonb(s) FROM public.bizum_settings s);
END;
$function$;

REVOKE ALL ON FUNCTION public.set_bizum_settings(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_bizum_settings(jsonb) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 3. M2: payment_fx_rates (append-only)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.payment_fx_rates (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  to_currency    text NOT NULL CHECK (to_currency = 'EUR'),
  -- EUR per 1 USD. The 0.5..1.5 band is a fixed absolute sanity bound (typo guard), not a policy.
  mid_rate       numeric(14,6) NOT NULL CHECK (mid_rate BETWEEN 0.5 AND 1.5),
  spread_pct     numeric(5,2) NOT NULL CHECK (spread_pct BETWEEN 0 AND 10),
  effective_rate numeric(14,6) GENERATED ALWAYS AS (round(mid_rate * (1 + spread_pct / 100), 6)) STORED,
  source         text NOT NULL CHECK (source IN ('manual', 'ecb_prefill')),
  note           text CHECK (char_length(note) <= 500),
  created_by     uuid,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payment_fx_rates_latest
  ON public.payment_fx_rates (created_at DESC, id DESC);

ALTER TABLE public.payment_fx_rates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.payment_fx_rates FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.payment_fx_rates TO service_role;

CREATE OR REPLACE FUNCTION public.payment_fx_rates_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
BEGIN
  RAISE EXCEPTION 'payment_fx_rates_append_only' USING ERRCODE = 'P0001';
END;
$function$;

REVOKE ALL ON FUNCTION public.payment_fx_rates_append_only() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS payment_fx_rates_no_update_delete ON public.payment_fx_rates;
CREATE TRIGGER payment_fx_rates_no_update_delete
  BEFORE UPDATE OR DELETE ON public.payment_fx_rates
  FOR EACH ROW EXECUTE FUNCTION public.payment_fx_rates_append_only();

DROP TRIGGER IF EXISTS payment_fx_rates_no_truncate ON public.payment_fx_rates;
CREATE TRIGGER payment_fx_rates_no_truncate
  BEFORE TRUNCATE ON public.payment_fx_rates
  FOR EACH STATEMENT EXECUTE FUNCTION public.payment_fx_rates_append_only();

-- Single rounding rule for every EUR amount (quote preview and sealing share it).
-- Example from the design: 100.00 USD at 0.933800 = 93.38 EUR. numeric round() is half away from zero.
CREATE OR REPLACE FUNCTION public._bizum_amount(usd numeric, rate numeric)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path = public, pg_temp
AS $function$
  SELECT CASE
           WHEN usd IN ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
             OR rate IN ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
             OR abs(usd) > 99999999.99
             OR abs(rate) > 99999999.999999
           THEN NULL
           ELSE round(usd * rate, 2)
         END;
$function$;

REVOKE ALL ON FUNCTION public._bizum_amount(numeric, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._bizum_amount(numeric, numeric) TO service_role;

-- Latest rate with its age and freshness state; always exactly one row (state 'none' when empty).
CREATE OR REPLACE FUNCTION public._payment_fx_latest()
RETURNS TABLE (
  id uuid,
  mid_rate numeric,
  spread_pct numeric,
  effective_rate numeric,
  source text,
  created_by uuid,
  created_at timestamptz,
  age_hours numeric,
  state text,
  fx_warn_hours integer,
  fx_block_hours integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.bizum_settings) THEN
    RAISE EXCEPTION 'bizum_settings_missing' USING ERRCODE = 'P0001';
  END IF;

  RETURN QUERY
  SELECT r.id, r.mid_rate, r.spread_pct, r.effective_rate, r.source, r.created_by, r.created_at,
         round(extract(epoch FROM (now() - r.created_at)) / 3600, 2),
         CASE
           WHEN r.id IS NULL THEN 'none'
           -- a rate dated in the future is not trustworthy
           WHEN extract(epoch FROM (now() - r.created_at)) < 0 THEN 'blocked'
           WHEN extract(epoch FROM (now() - r.created_at)) / 3600 >= s.fx_block_hours THEN 'blocked'
           WHEN extract(epoch FROM (now() - r.created_at)) / 3600 >= s.fx_warn_hours THEN 'warn'
           ELSE 'ok'
         END,
         s.fx_warn_hours,
         s.fx_block_hours
    FROM public.bizum_settings s
    LEFT JOIN LATERAL (
      SELECT f.* FROM public.payment_fx_rates f ORDER BY f.created_at DESC, f.id DESC LIMIT 1
    ) r ON true;
END;
$function$;

REVOKE ALL ON FUNCTION public._payment_fx_latest() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._payment_fx_latest() TO service_role;

-- The usable rate: zero rows when there is none or it is blocked, one row (ok / warn) otherwise.
CREATE OR REPLACE FUNCTION public._current_payment_fx()
RETURNS TABLE (
  id uuid,
  mid_rate numeric,
  spread_pct numeric,
  effective_rate numeric,
  created_at timestamptz,
  age_hours numeric,
  state text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT l.id, l.mid_rate, l.spread_pct, l.effective_rate, l.created_at, l.age_hours, l.state
    FROM public._payment_fx_latest() l
   WHERE l.state IN ('ok', 'warn');
$function$;

REVOKE ALL ON FUNCTION public._current_payment_fx() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._current_payment_fx() TO service_role;

CREATE OR REPLACE FUNCTION public.get_payment_fx_status()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT (public.is_admin_user() OR public.is_super_admin()) THEN
    RAISE EXCEPTION 'payment_fx_forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN (SELECT to_jsonb(l) FROM public._payment_fx_latest() l);
END;
$function$;

REVOKE ALL ON FUNCTION public.get_payment_fx_status() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_payment_fx_status() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.set_payment_fx_rate(
  p_mid numeric,
  p_spread numeric DEFAULT NULL,
  p_source text DEFAULT 'manual',
  p_note text DEFAULT NULL,
  p_confirm_large_change boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_note      text;
  v_spread    numeric;
  v_max_pct   numeric;
  v_prev_mid  numeric;
  v_prev_eff  numeric;
  v_new_eff   numeric;
  v_large     boolean := false;
  v_row       public.payment_fx_rates%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT (public.is_admin_user() OR public.is_super_admin()) THEN
    RAISE EXCEPTION 'payment_fx_forbidden' USING ERRCODE = '42501';
  END IF;

  IF p_mid IS NULL OR p_mid < 0.5 OR p_mid > 1.5 OR p_mid <> round(p_mid, 6) THEN
    RAISE EXCEPTION 'payment_fx_invalid_rate' USING ERRCODE = 'P0001';
  END IF;

  IF p_spread IS NOT NULL AND (p_spread < 0 OR p_spread > 10 OR p_spread <> round(p_spread, 2)) THEN
    RAISE EXCEPTION 'payment_fx_invalid_spread' USING ERRCODE = 'P0001';
  END IF;

  IF p_source IS NULL OR p_source NOT IN ('manual', 'ecb_prefill') THEN
    RAISE EXCEPTION 'payment_fx_invalid_source' USING ERRCODE = 'P0001';
  END IF;

  v_note := NULLIF(btrim(COALESCE(p_note, '')), '');
  IF v_note IS NOT NULL AND char_length(v_note) > 500 THEN
    RAISE EXCEPTION 'payment_fx_note_too_long' USING ERRCODE = 'P0001';
  END IF;

  -- Serialize rate changes so "previous rate" is well defined for concurrent callers.
  PERFORM pg_advisory_xact_lock(hashtext('payment_fx'));

  v_spread  := COALESCE(p_spread, public._bizum_setting('default_spread_pct'));
  v_max_pct := public._bizum_setting('fx_max_change_pct');

  SELECT r.mid_rate, r.effective_rate INTO v_prev_mid, v_prev_eff
    FROM public.payment_fx_rates r
   ORDER BY r.created_at DESC, r.id DESC
   LIMIT 1;

  -- The guard watches what customers pay: the EFFECTIVE rate, computed exactly like the generated
  -- column. |new - prev| / prev > max% without division, so the boundary (exactly max%) is exact.
  v_new_eff := round(p_mid * (1 + v_spread / 100), 6);
  IF v_prev_eff IS NOT NULL AND abs(v_new_eff - v_prev_eff) * 100 > v_prev_eff * v_max_pct THEN
    v_large := true;
    IF NOT COALESCE(p_confirm_large_change, false) THEN
      RAISE EXCEPTION 'payment_fx_large_change' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  INSERT INTO public.payment_fx_rates (to_currency, mid_rate, spread_pct, source, note, created_by, created_at)
  VALUES ('EUR', p_mid, v_spread, p_source, v_note, auth.uid(), clock_timestamp())
  RETURNING * INTO v_row;

  -- Audit INSIDE the function (see bizum_settings above). The free-text note is not copied.
  INSERT INTO public.activity_logs (action, entity_type, entity_id, performed_by, description, metadata)
  VALUES (
    'payment_fx_rate_set',
    'payment_fx_rate',
    v_row.id,
    auth.uid()::text,
    'Payment FX rate set',
    jsonb_build_object(
      'mid_rate', v_row.mid_rate,
      'spread_pct', v_row.spread_pct,
      'effective_rate', v_row.effective_rate,
      'source', v_row.source,
      'previous_mid', v_prev_mid,
      'previous_effective_rate', v_prev_eff,
      'confirmed_large_change', v_large,
      'note_present', v_note IS NOT NULL
    )
  );

  RETURN to_jsonb(v_row);
END;
$function$;

REVOKE ALL ON FUNCTION public.set_payment_fx_rate(numeric, numeric, text, text, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_payment_fx_rate(numeric, numeric, text, text, boolean)
  TO authenticated, service_role;
