import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { LEGAL_VERSION } from '@/lib/legalConfig';

// Static text checks: they prove the guarantees are WRITTEN in the migration, not that Postgres
// enforces them. Behaviour must be verified against a real database before/after applying.
const MIGRATION = resolve(
  process.cwd(),
  'supabase/migrations/20261015110000_legal_acceptance_and_site_visits_retention.sql'
);
const sql = readFileSync(MIGRATION, 'utf8');
const code = sql
  .split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n');

const functionBody = (name) => {
  const start = code.indexOf(`CREATE OR REPLACE FUNCTION public.${name}`);
  expect(start).toBeGreaterThan(-1);
  const end = code.indexOf('$$;', code.indexOf('AS $$', start));
  return code.slice(start, end);
};

describe('legal_acceptances table', () => {
  it('is created idempotently with the audited columns', () => {
    expect(code).toMatch(/CREATE TABLE IF NOT EXISTS public\.legal_acceptances/);
    expect(code).toMatch(/user_id uuid NOT NULL REFERENCES auth\.users\(id\) ON DELETE CASCADE/);
    expect(code).toMatch(/document text NOT NULL CHECK \(document IN \('terms', 'privacy'\)\)/);
    expect(code).toMatch(/version text NOT NULL/);
    expect(code).toMatch(/accepted_at timestamptz NOT NULL DEFAULT now\(\)/);
    expect(code).toMatch(/char_length\(user_agent\) <= 300/);
    expect(code).toMatch(/source text NOT NULL CHECK \(source IN \('login', 'checkout', 'remittance', 'profile'\)\)/);
  });

  it('is unique per user, document and version', () => {
    expect(code).toMatch(/UNIQUE \(user_id, document, version\)/);
  });

  it('enables RLS and exposes only own rows plus admin read', () => {
    expect(code).toMatch(/ALTER TABLE public\.legal_acceptances ENABLE ROW LEVEL SECURITY/);
    expect(code).toMatch(/CREATE POLICY "legal_acceptances_select_own"[\s\S]*?FOR SELECT TO authenticated[\s\S]*?\(SELECT auth\.uid\(\)\)/);
    expect(code).toMatch(/CREATE POLICY "legal_acceptances_select_admin"[\s\S]*?FOR SELECT TO authenticated[\s\S]*?is_admin_user\(\)/);
  });

  it('grants clients SELECT only: no INSERT/UPDATE/DELETE and nothing for anon/PUBLIC', () => {
    expect(code).toMatch(/REVOKE ALL ON TABLE public\.legal_acceptances FROM PUBLIC, anon, authenticated/);
    expect(code).toMatch(/GRANT SELECT ON TABLE public\.legal_acceptances TO authenticated/);
    expect(code).not.toMatch(/GRANT[^;]*(INSERT|UPDATE|DELETE|ALL)[^;]*ON TABLE public\.legal_acceptances/);
    expect(code).not.toMatch(/CREATE POLICY[^;]*FOR (INSERT|UPDATE|DELETE|ALL)[^;]*legal_acceptances/);
  });
});

describe('record_legal_acceptance', () => {
  const body = () => functionBody('record_legal_acceptance');

  it('is SECURITY DEFINER with a pinned search_path and no user_id parameter', () => {
    const fn = body();
    expect(fn).toMatch(/record_legal_acceptance\(\s*p_terms_version text,\s*p_privacy_version text,\s*p_birth_date date,\s*p_source text\s*\)/);
    expect(fn).toMatch(/SECURITY DEFINER\s+SET search_path = public, pg_temp/);
    expect(fn).not.toMatch(/p_user_id/);
    expect(fn).toMatch(/v_uid uuid := auth\.uid\(\)/);
  });

  it('requires authentication and validates source and versions', () => {
    const fn = body();
    expect(fn).toMatch(/IF v_uid IS NULL THEN\s+RAISE EXCEPTION 'LEGAL_NOT_AUTHENTICATED'/);
    expect(fn).toMatch(/RAISE EXCEPTION 'LEGAL_INVALID_SOURCE'/);
    expect(fn).toMatch(/RAISE EXCEPTION 'LEGAL_INVALID_VERSION'/);
  });

  it('rejects a missing, future, implausible or under-18 date of birth server-side', () => {
    const fn = body();
    expect(fn).toMatch(/p_birth_date IS NULL[\s\S]*?RAISE EXCEPTION 'LEGAL_BIRTH_DATE_REQUIRED'/);
    expect(fn).toMatch(/p_birth_date > current_date[\s\S]*?RAISE EXCEPTION 'LEGAL_BIRTH_DATE_INVALID'/);
    expect(fn).toMatch(/age\(current_date, p_birth_date\)/);
    expect(fn).toMatch(/v_age < 18[\s\S]*?RAISE EXCEPTION 'LEGAL_UNDER_AGE'/);
    expect(fn).toMatch(/v_age > 120/);
  });

  it('never leaks PII in error messages', () => {
    const raises = functionBody('record_legal_acceptance').match(/RAISE EXCEPTION[^;]*;/g) || [];
    expect(raises.length).toBeGreaterThan(5);
    raises.forEach((r) => {
      expect(r).toMatch(/RAISE EXCEPTION 'LEGAL_[A-Z_]+'/);
      expect(r).not.toMatch(/%|p_birth_date|v_existing|email/);
    });
  });

  it('writes birth_date when empty, and allows a bounded, audited correction to another valid adult date', () => {
    const fn = body();
    expect(fn).toMatch(/FROM public\.user_profiles WHERE id = v_uid FOR UPDATE/);
    expect(fn).toMatch(/v_existing IS NULL[\s\S]*?UPDATE public\.user_profiles SET birth_date = p_birth_date WHERE id = v_uid/);
    // The 18+ check runs BEFORE any write, so a correction can never lower the age below 18
    expect(fn.indexOf("RAISE EXCEPTION 'LEGAL_UNDER_AGE'")).toBeLessThan(fn.indexOf('UPDATE public.user_profiles'));
    expect(fn).toMatch(/v_existing <> p_birth_date[\s\S]*?count\(\*\)[\s\S]*?public\.birth_date_corrections/);
    expect(fn).toMatch(/v_corrections >= 2[\s\S]*?RAISE EXCEPTION 'LEGAL_BIRTH_DATE_CONFLICT'/);
    expect(fn).toMatch(/INSERT INTO public\.birth_date_corrections \(user_id\) VALUES \(v_uid\)/);
  });

  it('only accepts versions from the server-side allowlist', () => {
    const fn = body();
    expect(fn).toMatch(/v_current_versions constant text\[\] := ARRAY\[/);
    expect(fn).toMatch(/p_terms_version <> ALL \(v_current_versions\)/);
    expect(fn).toMatch(/p_privacy_version <> ALL \(v_current_versions\)/);
  });

  it('inserts one row per document idempotently', () => {
    const fn = body();
    expect(fn.match(/INSERT INTO public\.legal_acceptances/g)).toHaveLength(2);
    expect(fn.match(/ON CONFLICT \(user_id, document, version\) DO NOTHING/g)).toHaveLength(2);
    expect(fn).toMatch(/'terms'/);
    expect(fn).toMatch(/'privacy'/);
  });

  it('is executable only by authenticated and service_role', () => {
    expect(code).toMatch(
      /REVOKE ALL ON FUNCTION public\.record_legal_acceptance\(text, text, date, text\) FROM PUBLIC, anon, authenticated/
    );
    expect(code).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.record_legal_acceptance\(text, text, date, text\) TO authenticated, service_role/
    );
  });
});

describe('has_current_legal_acceptance', () => {
  it('is STABLE SECURITY DEFINER, pinned and scoped to auth.uid()', () => {
    const fn = functionBody('has_current_legal_acceptance');
    expect(fn).toMatch(/RETURNS boolean/);
    expect(fn).toMatch(/STABLE\s+SECURITY DEFINER\s+SET search_path = public, pg_temp/);
    expect(fn).toMatch(/user_id = auth\.uid\(\)/);
    expect(fn).not.toMatch(/p_user_id/);
  });

  it('is executable only by authenticated and service_role', () => {
    expect(code).toMatch(
      /REVOKE ALL ON FUNCTION public\.has_current_legal_acceptance\(text, text\) FROM PUBLIC, anon, authenticated/
    );
    expect(code).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.has_current_legal_acceptance\(text, text\) TO authenticated, service_role/
    );
  });
});

describe('purge_old_site_visits', () => {
  it('is SECURITY DEFINER, pinned, batched and validates the retention argument', () => {
    const fn = functionBody('purge_old_site_visits');
    expect(fn).toMatch(/purge_old_site_visits\(p_retention_days integer DEFAULT 90\)/);
    expect(fn).toMatch(/SECURITY DEFINER\s+SET search_path = public, pg_temp/);
    expect(fn).toMatch(/p_retention_days < 1 OR p_retention_days > 3650[\s\S]*?RAISE EXCEPTION/);
    expect(fn).toMatch(/LIMIT v_batch_size/);
    expect(fn).toMatch(/EXIT WHEN v_batch_rows < v_batch_size/);
    expect(fn).toMatch(/DELETE FROM public\.site_visits/);
  });

  it('filters on the indexed NOT NULL visit_date only (no OR that defeats the index)', () => {
    const fn = functionBody('purge_old_site_visits');
    expect(fn).toMatch(/WHERE visit_date < v_cutoff_date/);
    expect(fn).not.toMatch(/visit_time/);
    expect(sql).toMatch(/idx_site_visits_date/);
    expect(sql).toMatch(/EXPLAIN/);
  });

  it('cannot be executed by clients, only by service_role', () => {
    expect(code).toMatch(/REVOKE ALL ON FUNCTION public\.purge_old_site_visits\(integer\) FROM PUBLIC, anon, authenticated/);
    expect(code).toMatch(/GRANT EXECUTE ON FUNCTION public\.purge_old_site_visits\(integer\) TO service_role/);
  });

  it('leaves the pg_cron schedule commented out for the owner to apply', () => {
    expect(code).not.toMatch(/cron\.schedule/);
    expect(sql).toMatch(/^-- SELECT cron\.schedule\(\s*$/m);
    expect(sql).toMatch(/'purge-old-site-visits'/);
    expect(sql).toMatch(/\$\$SELECT public\.purge_old_site_visits\(90\)\$\$/);
    expect(sql).toMatch(/cron\.unschedule\('purge-old-site-visits'\)/);
  });
});

describe('birth_date protection', () => {
  it('blocks direct client changes with a trigger (a column REVOKE is ineffective: table-level UPDATE exists)', () => {
    const fn = functionBody('guard_user_profiles_birth_date');
    expect(fn).toMatch(/SECURITY INVOKER\s+SET search_path = public, pg_temp/);
    expect(fn).toMatch(/current_user IN \('postgres', 'service_role', 'supabase_admin'\)/);
    expect(fn).toMatch(/is_super_admin\(\)/);
    expect(fn).toMatch(/NEW\.birth_date IS DISTINCT FROM OLD\.birth_date/);
    expect(fn).toMatch(/RAISE EXCEPTION 'birth_date can only be changed through record_legal_acceptance'/);
    expect(code).toMatch(/CREATE TRIGGER guard_user_profiles_birth_date\s+BEFORE UPDATE OF birth_date ON public\.user_profiles/);
    expect(code).toMatch(/DROP TRIGGER IF EXISTS guard_user_profiles_birth_date ON public\.user_profiles/);
    expect(sql).toMatch(/DROP TRIGGER IF EXISTS guard_user_profiles_birth_date/);
  });

  it('keeps an audit table without dates (no extra PII), RLS on, no client writes', () => {
    expect(code).toMatch(/CREATE TABLE IF NOT EXISTS public\.birth_date_corrections/);
    const table = code.slice(code.indexOf('CREATE TABLE IF NOT EXISTS public.birth_date_corrections'));
    expect(table.slice(0, table.indexOf(');'))).not.toMatch(/birth_date\b|date_of_birth|old_|new_/);
    expect(code).toMatch(/ALTER TABLE public\.birth_date_corrections ENABLE ROW LEVEL SECURITY/);
    expect(code).toMatch(/REVOKE ALL ON TABLE public\.birth_date_corrections FROM PUBLIC, anon, authenticated/);
    expect(code).not.toMatch(/GRANT[^;]*(INSERT|UPDATE|DELETE|ALL)[^;]*ON TABLE public\.birth_date_corrections/);
  });
});

describe('migration hygiene', () => {
  it('follows the newest neighbours: no explicit BEGIN/COMMIT, documents rollback and unapplied status', () => {
    expect(code).not.toMatch(/^\s*(BEGIN|COMMIT);/m);
    expect(sql).toMatch(/ROLLBACK/);
    expect(sql).toMatch(/DROP FUNCTION IF EXISTS public\.record_legal_acceptance/);
    expect(sql).toMatch(/DROP TABLE IF EXISTS public\.legal_acceptances/);
    expect(sql).toMatch(/DROP TABLE IF EXISTS public\.birth_date_corrections/);
    expect(sql).toMatch(/NOT APPLIED/);
  });

  it('does not touch the Privacy retention text or any other existing object', () => {
    expect(code).not.toMatch(/ALTER TABLE public\.(?!legal_acceptances|birth_date_corrections)/);
    expect(code).not.toMatch(/DROP (TABLE|FUNCTION) (?!IF EXISTS public\.(legal_acceptances|birth_date_corrections|record_legal|has_current|purge_old_site))/);
  });
});

describe('front/back version contract', () => {
  it('the front sends LEGAL_VERSION, which the RPC accepts as a short token', () => {
    expect(LEGAL_VERSION).toMatch(/^[0-9A-Za-z._-]{1,32}$/);
    expect(code).toMatch(/\^\[0-9A-Za-z\._-\]\{1,32\}\$/);
  });

  it('the server allowlist contains the front LEGAL_VERSION (update both together)', () => {
    const match = /v_current_versions constant text\[\] := ARRAY\[([^\]]*)\]/.exec(code);
    expect(match).not.toBeNull();
    const versions = match[1].split(',').map((v) => v.trim().replace(/^'|'$/g, ''));
    expect(versions).toContain(LEGAL_VERSION);
  });
});
