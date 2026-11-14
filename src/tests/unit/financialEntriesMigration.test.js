import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const UP = resolve(process.cwd(), 'supabase/migrations/20261113214007_financial_entries.sql');
const DOWN = resolve(process.cwd(), 'supabase/rollbacks/20261113214007_financial_entries_down.sql');
const read = (path) => readFileSync(path, 'utf8');

describe('manual financial entries migration (slice 3)', () => {
  it('ships the migration and its rollback, marked as applied to production with the registered version', () => {
    expect(existsSync(UP)).toBe(true);
    expect(existsSync(DOWN)).toBe(true);
    expect(read(UP)).toMatch(/APPLIED to production on 2026-11-13 \(apply_migration name: financial_entries, version 20261113214007\)/);
    expect(read(UP)).not.toMatch(/PREPARED, NOT APPLIED/);
    expect(read(DOWN)).toMatch(/version 20261113214007/);
  });

  describe('table financial_entries', () => {
    it('stores kind, positive amount, date, category and a reason', () => {
      const sql = read(UP);
      expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.financial_entries/);
      expect(sql).toMatch(/kind\s+text NOT NULL CHECK \(kind IN \('income', 'expense'\)\)/);
      expect(sql).toMatch(/amount\s+numeric\(12,2\) NOT NULL CHECK \(amount > 0\)/);
      expect(sql).toMatch(/entry_date\s+date NOT NULL/);
      expect(sql).toMatch(/char_length\(reason\) BETWEEN 10 AND 500/);
    });

    it('is append-only: voiding links a counter-entry, nothing is deleted or updated by clients', () => {
      const sql = read(UP);
      expect(sql).toMatch(/voids_entry_id\s+uuid REFERENCES public\.financial_entries\(id\)/);
      expect(sql).toMatch(/REVOKE ALL ON public\.financial_entries FROM PUBLIC, anon, authenticated/);
      expect(sql).toMatch(/GRANT SELECT ON public\.financial_entries TO authenticated/);
      expect(sql).not.toMatch(/GRANT[^;]*(INSERT|UPDATE|DELETE)[^;]*ON public\.financial_entries/);
    });

    it('enables RLS with a single super admin SELECT policy', () => {
      const sql = read(UP);
      expect(sql).toMatch(/ALTER TABLE public\.financial_entries ENABLE ROW LEVEL SECURITY/);
      expect(sql).toMatch(/FOR SELECT TO authenticated\s+USING \(\(SELECT public\.is_super_admin\(\)\)\)/);
    });
  });

  describe('RPC superadmin_add_financial_entry', () => {
    it('is SECURITY DEFINER, pinned search_path, super admin only', () => {
      const sql = read(UP);
      expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.superadmin_add_financial_entry\(/);
      expect(sql).toMatch(/SECURITY DEFINER\s+SET search_path = public, pg_temp/);
      expect(sql).toMatch(/v_uid IS NULL OR NOT public\.is_super_admin\(\)/);
    });

    it('validates kind, amount, reason and refuses future dates', () => {
      const sql = read(UP);
      expect(sql).toMatch(/invalid_kind/);
      expect(sql).toMatch(/invalid_amount/);
      expect(sql).toMatch(/invalid_reason/);
      expect(sql).toMatch(/invalid_date/);
    });

    it('is not callable by anon', () => {
      const sql = read(UP);
      expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.superadmin_add_financial_entry\([^)]*\) FROM PUBLIC, anon/);
      expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.superadmin_add_financial_entry\([^)]*\) TO authenticated/);
    });
  });

  describe('RPC superadmin_void_financial_entry', () => {
    it('inserts the opposite entry once and refuses voiding a void or an already voided entry', () => {
      const sql = read(UP);
      expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.superadmin_void_financial_entry\(/);
      expect(sql).toMatch(/already_voided/);
      expect(sql).toMatch(/cannot_void_a_void/);
      expect(sql).toMatch(/CASE WHEN v_orig\.kind = 'income' THEN 'expense' ELSE 'income' END/);
    });
  });

  it('dates and validates entries on the business calendar (America/New_York), never on the UTC current_date', () => {
    const sql = read(UP);
    expect(sql).not.toMatch(/current_date/);
    expect(sql).toMatch(/v_today\s+date := \(now\(\) AT TIME ZONE 'America\/New_York'\)::date/);
    expect(sql).toMatch(/p_entry_date > v_today/);
    // the counter-entry is dated on the business "today", like the Dashboard windows
    expect(sql).toMatch(/v_orig\.amount, v_today, v_orig\.category/);
  });

  it('rollback refuses to drop a ledger that already holds entries', () => {
    const sql = read(DOWN);
    expect(sql).toMatch(/EXISTS \(SELECT 1 FROM public\.financial_entries\)/);
    expect(sql).toMatch(/RAISE EXCEPTION/);
    // the guard runs before the destructive statements
    expect(sql.indexOf('RAISE EXCEPTION')).toBeLessThan(sql.indexOf('DROP TABLE'));
  });

  it('rollback drops both functions and the table', () => {
    const sql = read(DOWN);
    expect(sql).toMatch(/DROP FUNCTION IF EXISTS public\.superadmin_void_financial_entry/);
    expect(sql).toMatch(/DROP FUNCTION IF EXISTS public\.superadmin_add_financial_entry/);
    expect(sql).toMatch(/DROP TABLE IF EXISTS public\.financial_entries/);
  });

  it('bounds the date and the amount with clear errors instead of a raw numeric overflow', () => {
    const sql = read(UP);
    expect(sql).toMatch(/p_entry_date < DATE '2020-01-01'/);
    expect(sql).toMatch(/p_amount > 9999999999\.99/);
  });

  it('is append-only for every role, service_role included: UPDATE, DELETE and TRUNCATE raise', () => {
    const sql = read(UP);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.financial_entries_append_only\(\)/);
    expect(sql).toMatch(/BEFORE UPDATE OR DELETE ON public\.financial_entries\s+FOR EACH ROW/);
    expect(sql).toMatch(/BEFORE TRUNCATE ON public\.financial_entries\s+FOR EACH STATEMENT/);
  });

  it('rollback drops the append-only function with the table', () => {
    expect(read(DOWN)).toMatch(/DROP FUNCTION IF EXISTS public\.financial_entries_append_only/);
  });
});
