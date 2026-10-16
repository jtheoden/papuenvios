-- ============================================================================
-- Bizum S5a: payment quotes (pay-first) + server-side sealing of Bizum ORDERS
-- ============================================================================
-- Context: design_bizum_p2p_v2 sections 2.3 (R-20..R-28), 3.1 (M4, M5, M6 partial, M7), 3.3, 3.13.
-- APPLIED to the hosted project (version 20261016183509, 2026-10-16). Bizum stays available = false, so nothing here is
-- reachable by a customer until slice S16 flips the flag.
--
-- DEPLOYMENT ORDER (design 3.14)
--   1. 20261015120000_bizum_s3_currency_settings_fx_rates.sql   (settings, rates, _bizum_amount)
--   2. 20261015130000_bizum_s4_accounts.sql                      (bizum_accounts, _pick_bizum_account)
--   3. THIS FILE
--   4. 20261015150100_bizum_s5a_orders_checks.sql                (CHECKs NOT VALID + VALIDATE on orders)
--   5. 20261016120000_bizum_central_fx_rate.sql                  (the rate comes from exchange_rates; apply in the same push)
--   The rate: file 5 redefines _payment_fx_latest() to read the central USD->EUR rate of exchange_rates;
--   _current_payment_fx() (called below) is unchanged and inherits that source.
--   fx_rate_id / payment_fx_rate_id therefore hold an exchange_rates.id as PROVENANCE ONLY, with no foreign key
--   (exchange_rates rows are edited in place and deletable by admins); the sealed value is effective_rate /
--   payment_fx_rate. Details and rationale: header of file 5.
--   Migration BEFORE front end; the front end degrades when these objects are missing.
--   Needs a Postgres where gen_random_uuid() is built in (13+).
--
-- Remittances (columns, CHECKs, sealing trigger, requote, expiry) are slice S5b, not here.
--
-- What it adds
--   M4  payment_quotes: the price agreement of a Bizum ORDER, created BEFORE the order exists. Client
--       access only through SECURITY DEFINER RPCs (RLS on, no policy, no privileges for clients).
--   M5  orders: bizum_account_id, payment_currency, payment_amount, payment_usd_reference,
--       payment_fx_rate, payment_fx_rate_id, payment_quote_id, payment_concept_code (all NULLable, so
--       Zelle rows keep NULL) + two partial UNIQUE indexes (one order per quote, unique concept code).
--   M6  payment_reviews (partial): admin-only table that holds the flags raised at sealing time
--       (quote_expired, quote_rate_moved). Decision columns are for slice S6; no RPC writes them yet.
--   M7  _seal_bizum_payment (pricing + account assignment, shared with S5b), seal_bizum_payment
--       (BEFORE INSERT trigger on orders, WHEN payment_method = 'bizum'), guard_bizum_quote_immutable
--       (BEFORE UPDATE with a WHEN on the sealed columns), create_bizum_quote, attach_quote_proof,
--       report_paid_quote_failure, get_order_by_quote, admin_list_orphan_quotes, get_payment_instructions.
--
-- Access model (C14): every SECURITY DEFINER function pins search_path = public, pg_temp and has EXECUTE
-- revoked from PUBLIC, anon and authenticated explicitly (the project ACL hands EXECUTE to them), then
-- granted back only to the client RPCs. New tables: RLS on, REVOKE ALL FROM PUBLIC, anon, authenticated.
--
-- Sealing contract (R-21, R-22)
--   * The trigger never trusts payment_*: it overwrites them from the quote. A foreign, unknown or
--     missing quote is ONE uniform error (payment_quote_required): no oracle about other users' quotes.
--   * The quote is consumed in the same statement (row lock FOR UPDATE + UNIQUE index backstop).
--   * Past expires_at but inside bizum_settings.quote_grace_hours the QUOTED amount is honoured and a
--     payment_reviews row carries the flags; if the live rate moved more than 2 % (or no usable rate
--     exists, fail closed) quote_rate_moved is added. Past the grace: payment_quote_expired and the
--     quote stays unconsumed, so the proof is never lost (admin_list_orphan_quotes).
--   * The proof must live at {uid}/quotes/{quote_id}/{file}: ^[A-Za-z0-9_-][A-Za-z0-9._-]{0,127}$ as file name.
--
-- Immutability (R-26, C17): any UPDATE that changes a sealed column fails payment_quote_immutable unless
-- current_user is the OWNER of public.orders (that is, a SECURITY DEFINER RPC created by this owner, or an
-- owner session). A GUC would be forgeable by any session; current_user is not. The trigger WHEN clause makes
-- status / payment_status / cancel / reopen UPDATEs skip the function altogether, and so does every Zelle
-- row (live Zelle UPDATE behaviour is byte-identical). Known gap, by design: a trusted role (service_role,
-- admin) could rewrite a Zelle row into a FULLY forged bizum row; orders_bizum_coherence (next file) rejects
-- any incomplete forgery, and those roles are already trusted with the whole table.
--
-- Error tokens (P0001 unless noted; uniform towards the customer, no PII in messages)
--   bizum_unavailable, payment_fx_unavailable, bizum_amount_over_limit, bizum_limit_reached,
--   payment_quote_required, payment_quote_consumed, payment_quote_expired, payment_quote_mismatch,
--   payment_quote_invalid_amount, payment_quote_invalid_reason, payment_currency_unsupported,
--   payment_proof_invalid, payment_quote_immutable, payment_source_not_found, payment_source_unsupported,
--   bizum_forbidden (42501), bizum_invalid_flow.
--
-- Platform reset decision: execute_platform_reset is NOT touched. It deletes orders, which cascades to
-- payment_reviews (ON DELETE CASCADE); the FK direction (orders -> payment_quotes) means deleting orders
-- never blocks. Unconsumed quotes are ephemeral and harmless; the reset leaves them (verified by test).
--
-- Idempotent: IF NOT EXISTS, CREATE OR REPLACE, DROP ... IF EXISTS.
--
-- ROLLBACK (exact inverse; run the 20261015150100 rollback first). Drops quotes and reviews: export them first.
-- DROP TRIGGER IF EXISTS guard_bizum_quote_immutable ON public.orders;
-- DROP TRIGGER IF EXISTS seal_bizum_payment ON public.orders;
-- DROP FUNCTION IF EXISTS public.get_payment_instructions(text, uuid);
-- DROP FUNCTION IF EXISTS public.admin_list_orphan_quotes();
-- DROP FUNCTION IF EXISTS public.get_order_by_quote(uuid);
-- DROP FUNCTION IF EXISTS public.report_paid_quote_failure(uuid, text);
-- DROP FUNCTION IF EXISTS public.attach_quote_proof(uuid, text);
-- DROP FUNCTION IF EXISTS public.create_bizum_quote(numeric);
-- DROP FUNCTION IF EXISTS public.seal_bizum_payment();
-- DROP FUNCTION IF EXISTS public.guard_bizum_quote_immutable();
-- DROP FUNCTION IF EXISTS public._seal_bizum_payment(text, numeric);
-- DROP FUNCTION IF EXISTS public._bizum_proof_path_ok(uuid, uuid, text);
-- DROP FUNCTION IF EXISTS public._bizum_new_concept_code(text);
-- DROP TABLE IF EXISTS public.payment_reviews;
-- DROP INDEX IF EXISTS public.uq_orders_payment_quote_id;
-- DROP INDEX IF EXISTS public.uq_orders_payment_concept_code;
-- ALTER TABLE public.orders DROP COLUMN IF EXISTS payment_quote_id, DROP COLUMN IF EXISTS payment_concept_code, DROP COLUMN IF EXISTS payment_fx_rate_id, DROP COLUMN IF EXISTS payment_fx_rate, DROP COLUMN IF EXISTS payment_usd_reference, DROP COLUMN IF EXISTS payment_amount, DROP COLUMN IF EXISTS payment_currency, DROP COLUMN IF EXISTS bizum_account_id;
-- DROP TABLE IF EXISTS public.payment_quotes;
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. M4: payment_quotes
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.payment_quotes (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL,
  usd_amount        numeric(12,2) NOT NULL CHECK (usd_amount > 0),
  payment_amount    numeric(12,2) NOT NULL CHECK (payment_amount > 0),
  -- exchange_rates.id the rate came from: provenance only, NO foreign key (see 20261016120000 header)
  fx_rate_id        uuid NOT NULL,
  effective_rate    numeric(14,6) NOT NULL CHECK (effective_rate > 0),
  bizum_account_id  uuid NOT NULL REFERENCES public.bizum_accounts (id) ON DELETE RESTRICT,
  concept_code      text NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  expires_at        timestamptz NOT NULL,
  consumed_at       timestamptz,
  proof_path        text CHECK (proof_path IS NULL OR char_length(proof_path) <= 300),
  failure_reason    text CHECK (failure_reason IS NULL OR failure_reason ~ '^[a-z_]{1,60}$'),
  CONSTRAINT payment_quotes_concept_code_key UNIQUE (concept_code),
  CONSTRAINT payment_quotes_validity CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS idx_payment_quotes_user_created ON public.payment_quotes (user_id, created_at DESC);

ALTER TABLE public.payment_quotes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.payment_quotes FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.payment_quotes TO service_role;

-- ----------------------------------------------------------------------------
-- 2. M5: sealed columns on orders (NULL for Zelle) + partial unique indexes
-- ----------------------------------------------------------------------------
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS bizum_account_id      uuid REFERENCES public.bizum_accounts (id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS payment_currency      text,
  ADD COLUMN IF NOT EXISTS payment_amount        numeric(12,2),
  ADD COLUMN IF NOT EXISTS payment_usd_reference numeric(12,2),
  ADD COLUMN IF NOT EXISTS payment_fx_rate       numeric(14,6),
  ADD COLUMN IF NOT EXISTS payment_fx_rate_id    uuid,   -- exchange_rates.id, provenance only (no FK)
  ADD COLUMN IF NOT EXISTS payment_quote_id      uuid REFERENCES public.payment_quotes (id),
  ADD COLUMN IF NOT EXISTS payment_concept_code  text;

CREATE UNIQUE INDEX IF NOT EXISTS uq_orders_payment_quote_id
  ON public.orders (payment_quote_id) WHERE payment_quote_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_orders_payment_concept_code
  ON public.orders (payment_concept_code) WHERE payment_concept_code IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 3. M6 (partial): payment_reviews, admin-only. Written by SECURITY DEFINER code only.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.payment_reviews (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- DEFERRABLE: the sealing trigger writes the review BEFORE the order row exists.
  order_id            uuid REFERENCES public.orders (id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
  remittance_id       uuid REFERENCES public.remittances (id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
  decision            text NOT NULL DEFAULT 'pending' CHECK (decision IN ('pending', 'validated', 'rejected')),
  flags               text[] NOT NULL DEFAULT '{}',
  expected_amount     numeric(12,2),
  received_amount     numeric(12,2),
  bank_reference      text CHECK (bank_reference IS NULL OR char_length(bank_reference) <= 64),
  bank_reference_norm text,
  payer_phone_norm    text,
  payer_paid_at       timestamptz,
  usd_recognized      numeric(12,2),
  note                text CHECK (note IS NULL OR char_length(note) <= 500),
  decided_by          uuid,
  decided_at          timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payment_reviews_one_source CHECK (num_nonnulls(order_id, remittance_id) = 1),
  CONSTRAINT payment_reviews_order_key UNIQUE (order_id),
  CONSTRAINT payment_reviews_remittance_key UNIQUE (remittance_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_reviews_validated_reference
  ON public.payment_reviews (bank_reference_norm)
  WHERE decision = 'validated' AND bank_reference_norm IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payment_reviews_duplicate_key
  ON public.payment_reviews (payer_phone_norm, received_amount, payer_paid_at);

ALTER TABLE public.payment_reviews ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.payment_reviews FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.payment_reviews TO authenticated;
GRANT ALL ON public.payment_reviews TO service_role;

DROP POLICY IF EXISTS payment_reviews_admin_select ON public.payment_reviews;
CREATE POLICY payment_reviews_admin_select ON public.payment_reviews
  FOR SELECT TO authenticated
  USING (public.is_admin_user() OR public.is_super_admin());

-- ----------------------------------------------------------------------------
-- 4. Internal helpers
-- ----------------------------------------------------------------------------
-- 8-char code, 1 prefix char (V orders / R remittances) + 7 from a 31-symbol alphabet without look-alikes
-- (no 0 1 I L O). Not a secret: uniqueness is enforced by unique indexes, this only avoids collisions.
CREATE OR REPLACE FUNCTION public._bizum_new_concept_code(p_prefix text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  c_alphabet CONSTANT text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  v_bytes bytea;
  v_code  text;
  i       integer;
BEGIN
  IF p_prefix IS NULL OR p_prefix NOT IN ('V', 'R') THEN
    RAISE EXCEPTION 'bizum_invalid_flow' USING ERRCODE = 'P0001';
  END IF;
  LOOP
    v_bytes := decode(replace(gen_random_uuid()::text, '-', ''), 'hex');
    v_code := p_prefix;
    FOR i IN 0..6 LOOP
      v_code := v_code || substr(c_alphabet, 1 + (get_byte(v_bytes, i) % 31), 1);
    END LOOP;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.payment_quotes q WHERE q.concept_code = v_code)
          AND NOT EXISTS (SELECT 1 FROM public.orders o WHERE o.payment_concept_code = v_code);
  END LOOP;
  RETURN v_code;
END;
$function$;

REVOKE ALL ON FUNCTION public._bizum_new_concept_code(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._bizum_new_concept_code(text) TO service_role;

-- True when p_path is {user}/quotes/{quote}/{file} with a plain file name (no traversal, no nesting).
CREATE OR REPLACE FUNCTION public._bizum_proof_path_ok(p_user uuid, p_quote uuid, p_path text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_prefix text;
BEGIN
  IF p_user IS NULL OR p_quote IS NULL OR p_path IS NULL OR char_length(p_path) > 300 THEN
    RETURN false;
  END IF;
  v_prefix := p_user::text || '/quotes/' || p_quote::text || '/';
  RETURN left(p_path, char_length(v_prefix)) = v_prefix
     AND substr(p_path, char_length(v_prefix) + 1) ~ '^[A-Za-z0-9_-][A-Za-z0-9._-]{0,127}$';
END;
$function$;

REVOKE ALL ON FUNCTION public._bizum_proof_path_ok(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._bizum_proof_path_ok(uuid, uuid, text) TO service_role;

-- Pricing + account assignment for ONE Bizum operation (shared by create_bizum_quote and, in S5b, by the
-- remittance trigger). p_flow: 'products' | 'remittances'. Fails closed with the customer-facing tokens.
CREATE OR REPLACE FUNCTION public._seal_bizum_payment(p_flow text, p_usd numeric)
RETURNS TABLE (s_fx_rate_id uuid, s_rate numeric, s_eur numeric, s_account_id uuid, s_concept text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_fx   record;
  v_eur  numeric;
  v_acc  uuid;
BEGIN
  IF p_flow IS NULL OR p_flow NOT IN ('products', 'remittances') THEN
    RAISE EXCEPTION 'bizum_invalid_flow' USING ERRCODE = 'P0001';
  END IF;

  IF NOT public.payment_method_allowed('bizum', CASE p_flow WHEN 'products' THEN 'orders' ELSE 'remittances' END) THEN
    RAISE EXCEPTION 'bizum_unavailable' USING ERRCODE = 'P0001';
  END IF;

  SELECT c.id, c.effective_rate INTO v_fx FROM public._current_payment_fx() c;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'payment_fx_unavailable' USING ERRCODE = 'P0001';
  END IF;

  v_eur := public._bizum_amount(p_usd, v_fx.effective_rate);
  IF v_eur IS NULL OR v_eur <= 0 THEN
    RAISE EXCEPTION 'payment_quote_invalid_amount' USING ERRCODE = 'P0001';
  END IF;

  v_acc := public._pick_bizum_account(p_flow, v_eur);
  IF v_acc IS NULL THEN
    IF EXISTS (
      SELECT 1 FROM public.bizum_accounts a
       WHERE a.is_active AND CASE p_flow WHEN 'products' THEN a.for_products ELSE a.for_remittances END
    ) THEN
      RAISE EXCEPTION 'bizum_amount_over_limit' USING ERRCODE = 'P0001';
    END IF;
    RAISE EXCEPTION 'bizum_unavailable' USING ERRCODE = 'P0001';
  END IF;

  RETURN QUERY SELECT v_fx.id, v_fx.effective_rate, v_eur, v_acc,
                      public._bizum_new_concept_code(CASE p_flow WHEN 'products' THEN 'V' ELSE 'R' END);
END;
$function$;

REVOKE ALL ON FUNCTION public._seal_bizum_payment(text, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._seal_bizum_payment(text, numeric) TO service_role;

-- ----------------------------------------------------------------------------
-- 5. Triggers on orders
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.seal_bizum_payment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_quote    public.payment_quotes%ROWTYPE;
  v_code     text;
  v_flags    text[] := ARRAY[]::text[];
  v_cur_rate numeric;
BEGIN
  IF NEW.payment_quote_id IS NULL THEN
    RAISE EXCEPTION 'payment_quote_required' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_quote FROM public.payment_quotes q WHERE q.id = NEW.payment_quote_id FOR UPDATE;
  IF NOT FOUND
     OR v_quote.user_id IS DISTINCT FROM NEW.user_id
     OR (auth.uid() IS NOT NULL AND v_quote.user_id <> auth.uid()) THEN
    RAISE EXCEPTION 'payment_quote_required' USING ERRCODE = 'P0001';
  END IF;
  IF v_quote.consumed_at IS NOT NULL THEN
    RAISE EXCEPTION 'payment_quote_consumed' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.total_amount IS DISTINCT FROM v_quote.usd_amount THEN
    RAISE EXCEPTION 'payment_quote_mismatch' USING ERRCODE = 'P0001';
  END IF;

  SELECT c.code INTO v_code FROM public.currencies c WHERE c.id = NEW.currency_id;
  IF v_code IS DISTINCT FROM 'USD' THEN
    RAISE EXCEPTION 'payment_currency_unsupported' USING ERRCODE = 'P0001';
  END IF;

  IF NOT public._bizum_proof_path_ok(v_quote.user_id, v_quote.id, NEW.payment_proof_url) THEN
    RAISE EXCEPTION 'payment_proof_invalid' USING ERRCODE = 'P0001';
  END IF;

  IF now() > v_quote.expires_at THEN
    IF now() > v_quote.expires_at + make_interval(hours => public._bizum_setting('quote_grace_hours')::integer) THEN
      RAISE EXCEPTION 'payment_quote_expired' USING ERRCODE = 'P0001';
    END IF;
    v_flags := array_append(v_flags, 'quote_expired');
    SELECT c.effective_rate INTO v_cur_rate FROM public._current_payment_fx() c;
    -- |current - quoted| / quoted > 2 %, without division. No usable rate counts as moved (fail closed).
    IF v_cur_rate IS NULL OR abs(v_cur_rate - v_quote.effective_rate) * 100 > v_quote.effective_rate * 2 THEN
      v_flags := array_append(v_flags, 'quote_rate_moved');
    END IF;
  END IF;

  -- Everything below is copied from the quote; whatever the client sent is discarded.
  NEW.payment_currency      := 'EUR';
  NEW.payment_amount        := v_quote.payment_amount;
  NEW.payment_fx_rate       := v_quote.effective_rate;
  NEW.payment_fx_rate_id    := v_quote.fx_rate_id;
  NEW.payment_usd_reference := v_quote.usd_amount;
  NEW.payment_concept_code  := v_quote.concept_code;
  NEW.bizum_account_id      := v_quote.bizum_account_id;
  NEW.zelle_account_id      := NULL;

  UPDATE public.payment_quotes q SET consumed_at = now() WHERE q.id = v_quote.id;

  IF cardinality(v_flags) > 0 THEN
    INSERT INTO public.payment_reviews (order_id, flags, decision, expected_amount)
    VALUES (NEW.id, v_flags, 'pending', v_quote.payment_amount);
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.seal_bizum_payment() FROM PUBLIC, anon, authenticated;

-- 'seal_' sorts after every guard_* (payment_method_enabled, owner and stock guards run first) and before
-- every trigger_* (order number).
DROP TRIGGER IF EXISTS seal_bizum_payment ON public.orders;
CREATE TRIGGER seal_bizum_payment
  BEFORE INSERT ON public.orders
  FOR EACH ROW
  WHEN (NEW.payment_method = 'bizum')
  EXECUTE FUNCTION public.seal_bizum_payment();

CREATE OR REPLACE FUNCTION public.guard_bizum_quote_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF current_user = (SELECT pg_get_userbyid(c.relowner) FROM pg_class c WHERE c.oid = TG_RELID) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'payment_quote_immutable' USING ERRCODE = 'P0001';
END;
$function$;

REVOKE ALL ON FUNCTION public.guard_bizum_quote_immutable() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS guard_bizum_quote_immutable ON public.orders;
CREATE TRIGGER guard_bizum_quote_immutable
  BEFORE UPDATE ON public.orders
  FOR EACH ROW
  WHEN (
    OLD.payment_method = 'bizum'
    AND (
      NEW.payment_method IS DISTINCT FROM OLD.payment_method
      OR NEW.payment_amount IS DISTINCT FROM OLD.payment_amount
      OR NEW.payment_currency IS DISTINCT FROM OLD.payment_currency
      OR NEW.payment_fx_rate IS DISTINCT FROM OLD.payment_fx_rate
      OR NEW.payment_fx_rate_id IS DISTINCT FROM OLD.payment_fx_rate_id
      OR NEW.payment_usd_reference IS DISTINCT FROM OLD.payment_usd_reference
      OR NEW.payment_quote_id IS DISTINCT FROM OLD.payment_quote_id
      OR NEW.payment_concept_code IS DISTINCT FROM OLD.payment_concept_code
      OR NEW.bizum_account_id IS DISTINCT FROM OLD.bizum_account_id
    )
  )
  EXECUTE FUNCTION public.guard_bizum_quote_immutable();

-- ----------------------------------------------------------------------------
-- 6. Client RPCs
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_bizum_quote(p_usd numeric)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid     uuid := auth.uid();
  v_seal    record;
  v_account public.bizum_accounts%ROWTYPE;
  v_quote   public.payment_quotes%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'bizum_forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_usd IS NULL OR p_usd IN ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
     OR p_usd <= 0 OR p_usd > 99999999.99 OR p_usd <> round(p_usd, 2) THEN
    RAISE EXCEPTION 'payment_quote_invalid_amount' USING ERRCODE = 'P0001';
  END IF;

  -- Serializes this user's quotes so the caps below cannot be raced.
  PERFORM pg_advisory_xact_lock(hashtext('bizum_quote:' || v_uid::text));

  SELECT * INTO v_seal FROM public._seal_bizum_payment('products', p_usd);

  IF (SELECT count(*) FROM public.payment_quotes q
       WHERE q.user_id = v_uid AND q.consumed_at IS NULL AND q.expires_at > now())
       >= public._bizum_setting('max_open_quotes_per_user')
     OR (SELECT count(*) FROM public.payment_quotes q
          WHERE q.user_id = v_uid AND q.created_at > now() - interval '1 hour')
          >= public._bizum_setting('max_quotes_per_hour')
     OR (
       (SELECT count(*) FROM public.orders o
         WHERE o.user_id = v_uid AND o.payment_method = 'bizum' AND o.payment_proof_url IS NULL
           AND COALESCE(o.status, '') <> 'cancelled')
       + (SELECT count(*) FROM public.remittances r
           WHERE r.user_id = v_uid AND r.payment_method = 'bizum' AND r.status = 'payment_pending'
             AND r.payment_proof_url IS NULL)
     ) >= public._bizum_setting('max_unpaid_ops_per_user') THEN
    RAISE EXCEPTION 'bizum_limit_reached' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.payment_quotes (user_id, usd_amount, payment_amount, fx_rate_id, effective_rate,
                                     bizum_account_id, concept_code, expires_at)
  VALUES (v_uid, p_usd, v_seal.s_eur, v_seal.s_fx_rate_id, v_seal.s_rate, v_seal.s_account_id, v_seal.s_concept,
          now() + make_interval(mins => public._bizum_setting('quote_validity_minutes')::integer))
  RETURNING * INTO v_quote;

  SELECT * INTO v_account FROM public.bizum_accounts a WHERE a.id = v_quote.bizum_account_id;

  RETURN jsonb_build_object(
    'quote_id', v_quote.id,
    'eur_amount', v_quote.payment_amount,
    'rate', v_quote.effective_rate,
    'expires_at', v_quote.expires_at,
    'concept_code', v_quote.concept_code,
    'phone', v_account.phone,
    'holder_name', v_account.holder_name
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.create_bizum_quote(numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_bizum_quote(numeric) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.attach_quote_proof(p_quote_id uuid, p_path text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid   uuid := auth.uid();
  v_quote public.payment_quotes%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'bizum_forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_quote FROM public.payment_quotes q WHERE q.id = p_quote_id AND q.user_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'payment_quote_required' USING ERRCODE = 'P0001';
  END IF;
  IF v_quote.consumed_at IS NOT NULL THEN
    RAISE EXCEPTION 'payment_quote_consumed' USING ERRCODE = 'P0001';
  END IF;
  IF now() > v_quote.expires_at + make_interval(hours => public._bizum_setting('quote_grace_hours')::integer) THEN
    RAISE EXCEPTION 'payment_quote_expired' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public._bizum_proof_path_ok(v_uid, v_quote.id, p_path) THEN
    RAISE EXCEPTION 'payment_proof_invalid' USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.payment_quotes q SET proof_path = p_path WHERE q.id = v_quote.id;
  RETURN jsonb_build_object('quote_id', v_quote.id, 'proof_path', p_path);
END;
$function$;

REVOKE ALL ON FUNCTION public.attach_quote_proof(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.attach_quote_proof(uuid, text) TO authenticated, service_role;

-- "Paid but the order could not be created" (stock gone, reservation cap, quote past the grace): the
-- customer's proof stays attached to the quote and the admin queue picks it up.
CREATE OR REPLACE FUNCTION public.report_paid_quote_failure(p_quote_id uuid, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid   uuid := auth.uid();
  v_quote public.payment_quotes%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'bizum_forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_quote FROM public.payment_quotes q WHERE q.id = p_quote_id AND q.user_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'payment_quote_required' USING ERRCODE = 'P0001';
  END IF;
  IF p_reason IS NULL OR p_reason !~ '^[a-z_]{1,60}$' THEN
    RAISE EXCEPTION 'payment_quote_invalid_reason' USING ERRCODE = 'P0001';
  END IF;
  IF v_quote.consumed_at IS NOT NULL THEN
    RAISE EXCEPTION 'payment_quote_consumed' USING ERRCODE = 'P0001';
  END IF;
  IF v_quote.proof_path IS NULL THEN
    RAISE EXCEPTION 'payment_proof_invalid' USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.payment_quotes q SET failure_reason = p_reason WHERE q.id = v_quote.id;
  RETURN jsonb_build_object('quote_id', v_quote.id, 'failure_reason', p_reason);
END;
$function$;

REVOKE ALL ON FUNCTION public.report_paid_quote_failure(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.report_paid_quote_failure(uuid, text) TO authenticated, service_role;

-- Idempotency after a lost response: the owner finds the order a consumed quote produced (NULL otherwise).
CREATE OR REPLACE FUNCTION public.get_order_by_quote(p_quote_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'bizum_forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN (
    SELECT jsonb_build_object('order_id', o.id, 'order_number', o.order_number)
      FROM public.orders o
     WHERE o.payment_quote_id = p_quote_id AND o.user_id = v_uid
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_order_by_quote(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_order_by_quote(uuid) TO authenticated, service_role;

-- Paid quotes that never became an order: reported by the customer, or left past the grace period.
-- No PII (no phone, no name): the admin resolves the user through the user id.
CREATE OR REPLACE FUNCTION public.admin_list_orphan_quotes()
RETURNS TABLE (
  quote_id uuid, user_id uuid, usd_amount numeric, payment_amount numeric, concept_code text,
  proof_path text, failure_reason text, created_at timestamptz, expires_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT (public.is_admin_user() OR public.is_super_admin()) THEN
    RAISE EXCEPTION 'bizum_forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT q.id, q.user_id, q.usd_amount, q.payment_amount, q.concept_code, q.proof_path, q.failure_reason,
         q.created_at, q.expires_at
    FROM public.payment_quotes q
   WHERE q.proof_path IS NOT NULL
     AND q.consumed_at IS NULL
     AND (q.failure_reason IS NOT NULL
          OR now() > q.expires_at + make_interval(hours => public._bizum_setting('quote_grace_hours')::integer))
   ORDER BY q.created_at DESC
   LIMIT 200;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_list_orphan_quotes() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_orphan_quotes() TO authenticated, service_role;

-- Instructions for an existing Bizum operation. Orders only until S5b adds the remittance columns
-- (the 'remittance' branch fails closed). Tolerates an account retired after sealing. The receiving phone
-- is declared non-secret (D4): every payer sees it.
CREATE OR REPLACE FUNCTION public.get_payment_instructions(p_source_type text, p_source_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid    uuid := auth.uid();
  v_result jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'bizum_forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_source_type IS DISTINCT FROM 'order' THEN
    RAISE EXCEPTION 'payment_source_unsupported' USING ERRCODE = 'P0001';
  END IF;

  SELECT jsonb_build_object(
           'source_type', 'order',
           'source_id', o.id,
           'phone', a.phone,
           'holder_name', a.holder_name,
           'amount', o.payment_amount,
           'currency', o.payment_currency,
           'concept_code', o.payment_concept_code,
           'fx_rate', o.payment_fx_rate
         )
    INTO v_result
    FROM public.orders o
    JOIN public.bizum_accounts a ON a.id = o.bizum_account_id
   WHERE o.id = p_source_id
     AND o.payment_method = 'bizum'
     AND (o.user_id = v_uid OR public.is_admin_user() OR public.is_super_admin());

  IF v_result IS NULL THEN
    RAISE EXCEPTION 'payment_source_not_found' USING ERRCODE = 'P0001';
  END IF;
  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_payment_instructions(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_payment_instructions(text, uuid) TO authenticated, service_role;
