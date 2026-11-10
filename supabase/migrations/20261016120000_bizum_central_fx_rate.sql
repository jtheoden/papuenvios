-- ============================================================================
-- Bizum central FX: the USD->EUR rate comes from exchange_rates (option B)
-- ============================================================================
-- APPLIED to the hosted project (version 20261016183542, 2026-10-16). Bizum stays available = false, so nothing here is reachable
-- by a customer until the Bizum availability flag is flipped.
--
-- Decision (approved strategy, option B): the rate Bizum quotes with is the CENTRAL rate that admins already
-- maintain in Financial Settings (public.exchange_rates, direct pair USD -> EUR), not a second rate typed
-- elsewhere. There is exactly one place to load the rate.
--
-- What changes
--   * _payment_fx_latest() (the single reader behind _current_payment_fx() and get_payment_fx_status())
--     now reads exchange_rates. Same RETURNS TABLE as S3 (CREATE OR REPLACE keeps working for the callers):
--       id             = exchange_rates.id of the chosen row
--       mid_rate       = exchange_rates.rate
--       spread_pct     = bizum_settings.default_spread_pct   (the Bizum markup ALREADY in the S3 model;
--                        nothing new is invented. It is now the only spread, so changing it moves live quotes
--                        at once; previously each loaded rate carried its own spread)
--       effective_rate = round(rate * (1 + spread_pct / 100), 6)       (same formula as the old column)
--       source         = 'exchange_rates' (constant), created_by = NULL (the table keeps no author),
--       created_at     = the effective stamp of the row: its effective_date at 00:00 UTC, capped at now()
--                        (the age basis, see below).
--   * _current_payment_fx() is NOT redefined on purpose: it is a thin filter over _payment_fx_latest()
--     (zero rows unless state is ok / warn) and inherits the new source. S5a (_seal_bizum_payment and the
--     sealing trigger) keep calling it unchanged.
--   * set_payment_fx_rate(...) is kept with the same signature and ACL but no longer writes: after the admin
--     gate it raises payment_fx_managed_centrally. An old front-end bundle therefore gets a clear error
--     instead of silently filling a ledger nobody reads.
--   * payment_fx_rates (S3 ledger) is DEPRECATED, not dropped: it stays in place with its append-only
--     triggers and its history (empty in production). Nothing reads it any more. Drop it in a later,
--     separate migration once confirmed unused.
--
-- Which row is chosen (deterministic, fail closed)
--   Candidates: from = currency 'USD', to = currency 'EUR' (resolved by code), is_active IS TRUE, rate > 0,
--   effective_date <= CURRENT_DATE + 1 (one day of tolerance: the browser stamps the UTC date, so a client
--   ahead of the server clock must not lock Bizum out; a date further in the future is ignored).
--   Order: effective_date DESC, then coalesce(updated_at, created_at) DESC (tie-break only), then id DESC.
--   There is NO inverse fallback (1 / EUR->USD), no other pair, no official_currency_rates and no hardcoded
--   default: without a valid direct pair the function returns state 'none' and _current_payment_fx() returns
--   ZERO rows, so create_bizum_quote fails with payment_fx_unavailable.
--   State of the chosen row ('blocked' = not usable, 'warn' = usable):
--     * rate outside the sanity band 0.5 .. 1.5 (same band set_payment_fx_rate used) => blocked, so a typo
--       such as 92 instead of 0.92 can never be quoted. The newest valid-looking row wins even when it is
--       wrong; it does NOT silently fall back to an older, possibly stale, row.
--     * age >= bizum_settings.fx_block_hours => blocked; age >= fx_warn_hours => warn; otherwise ok.
--   Age basis = the EFFECTIVE DATE of the rate, not the last time the row was touched:
--       stamped_at = LEAST(effective_date at 00:00 UTC, now())
--       age        = now() - stamped_at
--     * Reactivating or otherwise touching an old row (toggling is_active, any UPDATE, a trigger-stamped
--       updated_at) does NOT make it look fresh: a rate dated 10 days ago stays blocked.
--     * There is no dependency on any updated_at trigger on exchange_rates.
--     * A date up to one day ahead (client clock/timezone ahead of the server) is capped at now(): age 0.
--   Granularity is DAILY: the age of a rate dated D is between 24*N and 24*N+24 hours (N = whole days since
--   D), so thresholds act at day boundaries, never at the hour.
--   Tradeoffs, accepted on purpose:
--     * Saving the same value again today counts as a current confirmation: Financial Settings stamps
--       effective_date = today on every save (saveExchangeRate / updateExchangeRatePair), which is the
--       admin's act of confirming the rate.
--     * A direct SQL edit that does not change effective_date does NOT refresh the age, even if it changes
--       the rate. Whoever edits by SQL must also set effective_date.
--
-- OPERATIONAL PRECONDITION (production): there is today NO active USD -> EUR row in exchange_rates (only an
-- inactive 0.92 from Oct 2025). Bizum fails closed (payment_fx_unavailable) until an admin loads an ACTIVE
-- USD -> EUR rate in Financial Settings. No data is loaded by this migration.
--
-- How S5a references the rate (decision: NO hard foreign key)
--   payment_quotes.fx_rate_id and orders.payment_fx_rate_id keep the exchange_rates.id as PROVENANCE only
--   (S5a is edited accordingly: the REFERENCES payment_fx_rates clauses are removed). Reasons:
--     1. exchange_rates is edited in place (updateExchangeRatePair UPDATEs rate and effective_date), so an id
--        does not pin a value; the authoritative sealed value is payment_quotes.effective_rate /
--        orders.payment_fx_rate, which are copied at quote time and never change.
--     2. exchange_rates_manage is FOR ALL: admins can DELETE rows. A NO ACTION foreign key would make that
--        delete fail as soon as one quote referenced the row, breaking the existing Financial Settings flow;
--        ON DELETE SET NULL contradicts the NOT NULL on payment_quotes.fx_rate_id.
--     3. The platform reset leaves exchange_rates untouched but deletes orders; no FK keeps both independent.
--   A dangling id after an admin deletes the row is acceptable: it only says which row the rate came from.
--
-- Behaviour changes to be aware of (also in the hand-off report)
--   * The large-change guard of S3 (fx_max_change_pct on the effective rate, confirmation token
--     payment_fx_large_change) no longer exists on this path: exchange_rates has no such guard. The 0.5..1.5
--     band, the freshness window and the 2 % quote_rate_moved check at sealing remain.
--     bizum_settings.fx_max_change_pct is left in place (unused by the database now).
--   * Access: exchange_rates is writable only by admins through the existing RLS policy
--     exchange_rates_manage (FOR ALL TO authenticated USING is_admin_user()); anon can only SELECT. This
--     migration adds no policy and no grant on it.
--   * SECURITY DEFINER hygiene unchanged: search_path = public, pg_temp, EXECUTE revoked from PUBLIC / anon /
--     authenticated for the internal readers (only service_role), and from PUBLIC / anon for the admin RPCs.
--
-- DEPLOYMENT ORDER (timestamp order, which is also what supabase db push applies)
--   1. 20261015120000_bizum_s3_currency_settings_fx_rates.sql   (already applied in production)
--   2. 20261015130000_bizum_s4_accounts.sql
--   3. 20261015150000_bizum_s5a_quotes_and_order_sealing.sql    (no FK to the ledger any more)
--   4. 20261015150100_bizum_s5a_orders_checks.sql
--   5. THIS FILE (20261016120000)
--   Between 3 and 5 S5a would read the (empty) ledger: harmless because Bizum is unavailable. Apply them in
--   the same push. Front-end: deploy the read-only FX card AFTER this migration.
--
-- Idempotent: CREATE OR REPLACE, COMMENT ON, REVOKE / GRANT.
--
-- ROLLBACK (exact inverse: the S3 bodies verbatim; the ledger table was never altered)
-- Re-create the S3 reader and writer:
-- CREATE OR REPLACE FUNCTION public._payment_fx_latest()
-- RETURNS TABLE (
--   id uuid,
--   mid_rate numeric,
--   spread_pct numeric,
--   effective_rate numeric,
--   source text,
--   created_by uuid,
--   created_at timestamptz,
--   age_hours numeric,
--   state text,
--   fx_warn_hours integer,
--   fx_block_hours integer
-- )
-- LANGUAGE plpgsql
-- STABLE
-- SECURITY DEFINER
-- SET search_path = public, pg_temp
-- AS $function$
-- BEGIN
--   IF NOT EXISTS (SELECT 1 FROM public.bizum_settings) THEN
--     RAISE EXCEPTION 'bizum_settings_missing' USING ERRCODE = 'P0001';
--   END IF;
--
--   RETURN QUERY
--   SELECT r.id, r.mid_rate, r.spread_pct, r.effective_rate, r.source, r.created_by, r.created_at,
--          round(extract(epoch FROM (now() - r.created_at)) / 3600, 2),
--          CASE
--            WHEN r.id IS NULL THEN 'none'
--            -- a rate dated in the future is not trustworthy
--            WHEN extract(epoch FROM (now() - r.created_at)) < 0 THEN 'blocked'
--            WHEN extract(epoch FROM (now() - r.created_at)) / 3600 >= s.fx_block_hours THEN 'blocked'
--            WHEN extract(epoch FROM (now() - r.created_at)) / 3600 >= s.fx_warn_hours THEN 'warn'
--            ELSE 'ok'
--          END,
--          s.fx_warn_hours,
--          s.fx_block_hours
--     FROM public.bizum_settings s
--     LEFT JOIN LATERAL (
--       SELECT f.* FROM public.payment_fx_rates f ORDER BY f.created_at DESC, f.id DESC LIMIT 1
--     ) r ON true;
-- END;
-- $function$;
--
-- CREATE OR REPLACE FUNCTION public.set_payment_fx_rate(
--   p_mid numeric,
--   p_spread numeric DEFAULT NULL,
--   p_source text DEFAULT 'manual',
--   p_note text DEFAULT NULL,
--   p_confirm_large_change boolean DEFAULT false
-- )
-- RETURNS jsonb
-- LANGUAGE plpgsql
-- SECURITY DEFINER
-- SET search_path = public, pg_temp
-- AS $function$
-- DECLARE
--   v_note      text;
--   v_spread    numeric;
--   v_max_pct   numeric;
--   v_prev_mid  numeric;
--   v_prev_eff  numeric;
--   v_new_eff   numeric;
--   v_large     boolean := false;
--   v_row       public.payment_fx_rates%ROWTYPE;
-- BEGIN
--   IF auth.uid() IS NULL OR NOT (public.is_admin_user() OR public.is_super_admin()) THEN
--     RAISE EXCEPTION 'payment_fx_forbidden' USING ERRCODE = '42501';
--   END IF;
--
--   IF p_mid IS NULL OR p_mid < 0.5 OR p_mid > 1.5 OR p_mid <> round(p_mid, 6) THEN
--     RAISE EXCEPTION 'payment_fx_invalid_rate' USING ERRCODE = 'P0001';
--   END IF;
--
--   IF p_spread IS NOT NULL AND (p_spread < 0 OR p_spread > 10 OR p_spread <> round(p_spread, 2)) THEN
--     RAISE EXCEPTION 'payment_fx_invalid_spread' USING ERRCODE = 'P0001';
--   END IF;
--
--   IF p_source IS NULL OR p_source NOT IN ('manual', 'ecb_prefill') THEN
--     RAISE EXCEPTION 'payment_fx_invalid_source' USING ERRCODE = 'P0001';
--   END IF;
--
--   v_note := NULLIF(btrim(COALESCE(p_note, '')), '');
--   IF v_note IS NOT NULL AND char_length(v_note) > 500 THEN
--     RAISE EXCEPTION 'payment_fx_note_too_long' USING ERRCODE = 'P0001';
--   END IF;
--
--   -- Serialize rate changes so "previous rate" is well defined for concurrent callers.
--   PERFORM pg_advisory_xact_lock(hashtext('payment_fx'));
--
--   v_spread  := COALESCE(p_spread, public._bizum_setting('default_spread_pct'));
--   v_max_pct := public._bizum_setting('fx_max_change_pct');
--
--   SELECT r.mid_rate, r.effective_rate INTO v_prev_mid, v_prev_eff
--     FROM public.payment_fx_rates r
--    ORDER BY r.created_at DESC, r.id DESC
--    LIMIT 1;
--
--   -- The guard watches what customers pay: the EFFECTIVE rate, computed exactly like the generated
--   -- column. |new - prev| / prev > max% without division, so the boundary (exactly max%) is exact.
--   v_new_eff := round(p_mid * (1 + v_spread / 100), 6);
--   IF v_prev_eff IS NOT NULL AND abs(v_new_eff - v_prev_eff) * 100 > v_prev_eff * v_max_pct THEN
--     v_large := true;
--     IF NOT COALESCE(p_confirm_large_change, false) THEN
--       RAISE EXCEPTION 'payment_fx_large_change' USING ERRCODE = 'P0001';
--     END IF;
--   END IF;
--
--   INSERT INTO public.payment_fx_rates (to_currency, mid_rate, spread_pct, source, note, created_by, created_at)
--   VALUES ('EUR', p_mid, v_spread, p_source, v_note, auth.uid(), clock_timestamp())
--   RETURNING * INTO v_row;
--
--   -- Audit INSIDE the function (see bizum_settings above). The free-text note is not copied.
--   INSERT INTO public.activity_logs (action, entity_type, entity_id, performed_by, description, metadata)
--   VALUES (
--     'payment_fx_rate_set',
--     'payment_fx_rate',
--     v_row.id,
--     auth.uid()::text,
--     'Payment FX rate set',
--     jsonb_build_object(
--       'mid_rate', v_row.mid_rate,
--       'spread_pct', v_row.spread_pct,
--       'effective_rate', v_row.effective_rate,
--       'source', v_row.source,
--       'previous_mid', v_prev_mid,
--       'previous_effective_rate', v_prev_eff,
--       'confirmed_large_change', v_large,
--       'note_present', v_note IS NOT NULL
--     )
--   );
--
--   RETURN to_jsonb(v_row);
-- END;
-- $function$;
-- (the REVOKE / GRANT lines below are unchanged by this migration, so nothing to undo there)
-- COMMENT ON TABLE public.payment_fx_rates IS NULL;
-- Note: rolling back reverts the Bizum rate source to the S3 ledger. Quotes sealed meanwhile keep their rate.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. The reader: latest usable central USD -> EUR rate (same shape as S3)
-- ----------------------------------------------------------------------------
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
  SELECT r.id,
         r.rate::numeric,
         s.default_spread_pct::numeric,
         round(r.rate * (1 + s.default_spread_pct / 100), 6),
         'exchange_rates'::text,
         NULL::uuid,
         r.stamped_at,
         round(extract(epoch FROM (now() - r.stamped_at)) / 3600, 2),
         CASE
           WHEN r.id IS NULL THEN 'none'
           -- a typo (92 instead of 0.92) must never be quoted
           WHEN r.rate < 0.5 OR r.rate > 1.5 THEN 'blocked'
           WHEN r.stamped_at IS NULL THEN 'blocked'
           WHEN extract(epoch FROM (now() - r.stamped_at)) / 3600 >= s.fx_block_hours THEN 'blocked'
           WHEN extract(epoch FROM (now() - r.stamped_at)) / 3600 >= s.fx_warn_hours THEN 'warn'
           ELSE 'ok'
         END,
         s.fx_warn_hours,
         s.fx_block_hours
    FROM public.bizum_settings s
    LEFT JOIN LATERAL (
      SELECT e.id, e.rate,
             LEAST((e.effective_date::timestamp AT TIME ZONE 'UTC'), now()) AS stamped_at
        FROM public.exchange_rates e
        JOIN public.currencies cf ON cf.id = e.from_currency_id AND cf.code = 'USD'
        JOIN public.currencies ct ON ct.id = e.to_currency_id AND ct.code = 'EUR'
       WHERE e.is_active IS TRUE
         AND e.rate > 0
         AND e.effective_date <= CURRENT_DATE + 1
       ORDER BY e.effective_date DESC, COALESCE(e.updated_at, e.created_at) DESC NULLS LAST, e.id DESC
       LIMIT 1
    ) r ON true;
END;
$function$;

REVOKE ALL ON FUNCTION public._payment_fx_latest() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._payment_fx_latest() TO service_role;

-- ----------------------------------------------------------------------------
-- 2. The old writer is retired: same signature and ACL, no write
-- ----------------------------------------------------------------------------
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
BEGIN
  IF auth.uid() IS NULL OR NOT (public.is_admin_user() OR public.is_super_admin()) THEN
    RAISE EXCEPTION 'payment_fx_forbidden' USING ERRCODE = '42501';
  END IF;

  RAISE EXCEPTION 'payment_fx_managed_centrally' USING ERRCODE = 'P0001';
END;
$function$;

REVOKE ALL ON FUNCTION public.set_payment_fx_rate(numeric, numeric, text, text, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_payment_fx_rate(numeric, numeric, text, text, boolean)
  TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 3. Mark the ledger deprecated (kept, append-only, unread)
-- ----------------------------------------------------------------------------
COMMENT ON TABLE public.payment_fx_rates IS
  'DEPRECATED (20261016120000): Bizum now quotes with exchange_rates (USD->EUR). Kept for history; nothing reads or writes it.';
