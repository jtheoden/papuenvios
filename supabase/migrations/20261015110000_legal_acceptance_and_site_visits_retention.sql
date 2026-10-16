-- SLICE D: auditable legal acceptance, 18+ confirmation and site_visits retention.
--
-- *** STATUS: PREPARED, NOT APPLIED. Applying it to the remote project is a separate action that
-- *** needs the owner's explicit approval. The front end keeps working before it is applied: when the
-- *** RPCs do not exist (42883 / PGRST202) the gate treats acceptance as "unavailable" and does not
-- *** block checkout or remittances.
--
-- Objects:
--   1. public.legal_acceptances            who / which document / which version / when / source.
--   2. public.record_legal_acceptance()    the ONLY write path (SECURITY DEFINER). Validates 18+ server-side,
--                                          stores birth_date in user_profiles only when empty, inserts one
--                                          row per document idempotently.
--   3. public.has_current_legal_acceptance()  boolean for auth.uid(), so the front can gate without rows.
--   4. public.purge_old_site_visits()      retention purge (default 90 days = PROPOSAL, same as activity_logs;
--                                          needs owner confirmation). pg_cron schedule left COMMENTED below.
--   5. public.birth_date_corrections       minimal audit (user_id + timestamp, NO dates) of corrected birth dates.
--   6. trigger guard_user_profiles_birth_date  blocks direct client writes to user_profiles.birth_date.
--
-- Data minimization: only the date of birth (needed for the 18+ check) and a truncated user agent are
-- collected. IP address is NOT stored. Error messages are stable codes and never echo input.
--
-- Known tradeoffs:
--   * ON DELETE CASCADE: deleting an auth user also deletes their acceptance trail (consistent with
--     user_profiles). If the owner needs to keep evidence after account deletion, switch to a nullable
--     user_id with ON DELETE SET NULL plus a pseudonymous key before applying.
--   * current_date uses the database time zone (UTC on Supabase): the 18th birthday may be recognised up
--     to a few hours earlier/later than in the user's local time zone. The server value is authoritative.
--   * birth_date is a SELF-DECLARATION, not an identity check. authenticated holds a TABLE-level UPDATE on
--     user_profiles, so a column-level REVOKE UPDATE (birth_date) would have no effect (verified against
--     information_schema); revoking table-level UPDATE and re-granting every other column would risk breaking
--     live profile edits. No UI or service edits birth_date (rg over src/), so a BEFORE UPDATE trigger now
--     blocks direct client changes (except service_role/postgres/super admin); the only client write path is
--     record_legal_acceptance(). An honest user who typed a wrong date can correct it through the RPC, only
--     to another date that is still >= 18, at most 2 times, each logged in birth_date_corrections.
--   * Versions: the RPC only accepts the versions in v_current_versions inside the function. When
--     LEGAL_VERSION changes in src/lib/legalConfig.js, ship a new migration that CREATE OR REPLACEs
--     record_legal_acceptance with the new value BEFORE (or together with) the front deploy; otherwise users
--     cannot accept (fail-closed). A unit test compares both constants.
--   * purge_old_site_visits filters on the indexed NOT NULL visit_date. Verified with a read-only
--     EXPLAIN of the equivalent SELECT: "Index Scan using idx_site_visits_date, Index Cond:
--     (visit_date < (CURRENT_DATE - 90))" (the previous OR on visit_time produced a BitmapOr).
--   * This does NOT enforce acceptance on orders/remittances at the database level (a trigger could break
--     live checkouts). Recommended follow-up after the front has been live for a while.
--
-- ROLLBACK (manual, in this order):
--   DROP FUNCTION IF EXISTS public.purge_old_site_visits(integer);
--   DROP FUNCTION IF EXISTS public.has_current_legal_acceptance(text, text);
--   DROP FUNCTION IF EXISTS public.record_legal_acceptance(text, text, date, text);
--   DROP TRIGGER IF EXISTS guard_user_profiles_birth_date ON public.user_profiles;
--   DROP FUNCTION IF EXISTS public.guard_user_profiles_birth_date();
--   DROP TABLE IF EXISTS public.birth_date_corrections;
--   DROP TABLE IF EXISTS public.legal_acceptances;
--   -- user_profiles.birth_date values written by the RPC are NOT reverted automatically.
--   -- If the cron job was scheduled: SELECT cron.unschedule('purge-old-site-visits');

-- ----------------------------------------------------------------------------
-- 1. Table
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.legal_acceptances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  document text NOT NULL CHECK (document IN ('terms', 'privacy')),
  version text NOT NULL CHECK (version ~ '^[0-9A-Za-z._-]{1,32}$'),
  accepted_at timestamptz NOT NULL DEFAULT now(),
  user_agent text CHECK (user_agent IS NULL OR char_length(user_agent) <= 300),
  source text NOT NULL CHECK (source IN ('login', 'checkout', 'remittance', 'profile')),
  CONSTRAINT legal_acceptances_user_document_version_key UNIQUE (user_id, document, version)
);

ALTER TABLE public.legal_acceptances ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "legal_acceptances_select_own" ON public.legal_acceptances;
CREATE POLICY "legal_acceptances_select_own" ON public.legal_acceptances
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "legal_acceptances_select_admin" ON public.legal_acceptances;
CREATE POLICY "legal_acceptances_select_admin" ON public.legal_acceptances
  FOR SELECT TO authenticated
  USING ((SELECT public.is_admin_user()));

-- Clients read only; every write goes through record_legal_acceptance().
REVOKE ALL ON TABLE public.legal_acceptances FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.legal_acceptances TO authenticated;

-- Audit of birth-date corrections: who and when only (no old/new dates, to avoid extra PII).
CREATE TABLE IF NOT EXISTS public.birth_date_corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  corrected_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_birth_date_corrections_user_id ON public.birth_date_corrections (user_id);

ALTER TABLE public.birth_date_corrections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "birth_date_corrections_select_admin" ON public.birth_date_corrections;
CREATE POLICY "birth_date_corrections_select_admin" ON public.birth_date_corrections
  FOR SELECT TO authenticated
  USING ((SELECT public.is_admin_user()));

REVOKE ALL ON TABLE public.birth_date_corrections FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.birth_date_corrections TO authenticated;

-- ----------------------------------------------------------------------------
-- 2. record_legal_acceptance
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_legal_acceptance(
  p_terms_version text,
  p_privacy_version text,
  p_birth_date date,
  p_source text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_age integer;
  v_existing date;
  v_corrections integer;
  v_ua text;
  -- Versions of the legal texts currently published. Keep in sync with LEGAL_VERSION in
  -- src/lib/legalConfig.js (a unit test compares them).
  v_current_versions constant text[] := ARRAY['2026-10-15'];
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'LEGAL_NOT_AUTHENTICATED' USING ERRCODE = '28000';
  END IF;

  IF p_source IS NULL OR p_source NOT IN ('login', 'checkout', 'remittance', 'profile') THEN
    RAISE EXCEPTION 'LEGAL_INVALID_SOURCE' USING ERRCODE = '22023';
  END IF;

  IF p_terms_version IS NULL OR p_terms_version !~ '^[0-9A-Za-z._-]{1,32}$'
     OR p_privacy_version IS NULL OR p_privacy_version !~ '^[0-9A-Za-z._-]{1,32}$'
     OR p_terms_version <> ALL (v_current_versions)
     OR p_privacy_version <> ALL (v_current_versions) THEN
    RAISE EXCEPTION 'LEGAL_INVALID_VERSION' USING ERRCODE = '22023';
  END IF;

  IF p_birth_date IS NULL THEN
    RAISE EXCEPTION 'LEGAL_BIRTH_DATE_REQUIRED' USING ERRCODE = '22023';
  END IF;

  IF p_birth_date > current_date THEN
    RAISE EXCEPTION 'LEGAL_BIRTH_DATE_INVALID' USING ERRCODE = '22023';
  END IF;

  v_age := extract(year FROM age(current_date, p_birth_date))::integer;

  IF v_age > 120 THEN
    RAISE EXCEPTION 'LEGAL_BIRTH_DATE_INVALID' USING ERRCODE = '22023';
  END IF;

  IF v_age < 18 THEN
    RAISE EXCEPTION 'LEGAL_UNDER_AGE' USING ERRCODE = '22023';
  END IF;

  -- Lock the caller's own profile row; never accept a user id from the client.
  SELECT birth_date INTO v_existing FROM public.user_profiles WHERE id = v_uid FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'LEGAL_PROFILE_NOT_FOUND' USING ERRCODE = '22023';
  END IF;

  IF v_existing IS NULL THEN
    UPDATE public.user_profiles SET birth_date = p_birth_date WHERE id = v_uid;
  ELSIF v_existing <> p_birth_date THEN
    -- Honest correction: the new date already passed the 18+ check above. Bounded and logged.
    SELECT count(*) INTO v_corrections FROM public.birth_date_corrections WHERE user_id = v_uid;
    IF v_corrections >= 2 THEN
      RAISE EXCEPTION 'LEGAL_BIRTH_DATE_CONFLICT' USING ERRCODE = '22023';
    END IF;
    UPDATE public.user_profiles SET birth_date = p_birth_date WHERE id = v_uid;
    INSERT INTO public.birth_date_corrections (user_id) VALUES (v_uid);
  END IF;

  BEGIN
    v_ua := left(nullif(current_setting('request.headers', true)::json ->> 'user-agent', ''), 300);
  EXCEPTION WHEN OTHERS THEN
    v_ua := NULL;
  END;

  INSERT INTO public.legal_acceptances (user_id, document, version, user_agent, source)
  VALUES (v_uid, 'terms', p_terms_version, v_ua, p_source)
  ON CONFLICT (user_id, document, version) DO NOTHING;

  INSERT INTO public.legal_acceptances (user_id, document, version, user_agent, source)
  VALUES (v_uid, 'privacy', p_privacy_version, v_ua, p_source)
  ON CONFLICT (user_id, document, version) DO NOTHING;

  RETURN jsonb_build_object('terms', p_terms_version, 'privacy', p_privacy_version, 'source', p_source);
END;
$$;

REVOKE ALL ON FUNCTION public.record_legal_acceptance(text, text, date, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_legal_acceptance(text, text, date, text) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 3. has_current_legal_acceptance
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.has_current_legal_acceptance(
  p_terms_version text,
  p_privacy_version text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    (
      SELECT count(DISTINCT la.document) = 2
      FROM public.legal_acceptances la
      WHERE la.user_id = auth.uid()
        AND (
          (la.document = 'terms' AND la.version = p_terms_version)
          OR (la.document = 'privacy' AND la.version = p_privacy_version)
        )
    ),
    false
  );
$$;

REVOKE ALL ON FUNCTION public.has_current_legal_acceptance(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.has_current_legal_acceptance(text, text) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 3b. Guard: user_profiles.birth_date can only change through record_legal_acceptance()
-- ----------------------------------------------------------------------------
-- SECURITY INVOKER on purpose: inside the SECURITY DEFINER RPC current_user is the function owner
-- (postgres), which passes; a direct client UPDATE runs as authenticated and is rejected.
CREATE OR REPLACE FUNCTION public.guard_user_profiles_birth_date()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF current_user IN ('postgres', 'service_role', 'supabase_admin')
     OR auth.uid() IS NULL
     OR public.is_super_admin() THEN
    RETURN NEW;
  END IF;

  IF NEW.birth_date IS DISTINCT FROM OLD.birth_date THEN
    RAISE EXCEPTION 'birth_date can only be changed through record_legal_acceptance'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_user_profiles_birth_date ON public.user_profiles;
CREATE TRIGGER guard_user_profiles_birth_date
  BEFORE UPDATE OF birth_date ON public.user_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_user_profiles_birth_date();

-- ----------------------------------------------------------------------------
-- 4. site_visits retention
-- ----------------------------------------------------------------------------
-- Deletes in bounded batches so each statement stays small. 90 days is a PROPOSAL (same as
-- activity_logs) pending owner confirmation. The Privacy page retention text is NOT changed here:
-- it must only be updated after the owner applies this migration AND schedules the job.
CREATE OR REPLACE FUNCTION public.purge_old_site_visits(p_retention_days integer DEFAULT 90)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_cutoff_date date;
  v_batch_size constant integer := 5000;
  v_batch_rows integer;
  v_total integer := 0;
BEGIN
  IF p_retention_days IS NULL OR p_retention_days < 1 OR p_retention_days > 3650 THEN
    RAISE EXCEPTION 'purge_old_site_visits: p_retention_days must be between 1 and 3650';
  END IF;

  v_cutoff_date := current_date - p_retention_days;

  LOOP
    DELETE FROM public.site_visits
    WHERE id IN (
      SELECT id FROM public.site_visits
      WHERE visit_date < v_cutoff_date
      LIMIT v_batch_size
    );
    GET DIAGNOSTICS v_batch_rows = ROW_COUNT;
    v_total := v_total + v_batch_rows;
    EXIT WHEN v_batch_rows < v_batch_size;
  END LOOP;

  RETURN v_total;
END;
$$;

REVOKE ALL ON FUNCTION public.purge_old_site_visits(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_old_site_visits(integer) TO service_role;


-- ----------------------------------------------------------------------------
-- 5. Scheduling (NOT applied; owner approval required, same as the stock reservation job).
--    pg_cron is already installed (jobs: purge-old-activity-logs, expire-stale-order-reservations).
--    Daily at 03:30 UTC:
--
-- SELECT cron.schedule(
--   'purge-old-site-visits',
--   '30 3 * * *',
--   $$SELECT public.purge_old_site_visits(90)$$
-- );
-- -- To remove:  SELECT cron.unschedule('purge-old-site-visits');
-- ----------------------------------------------------------------------------
