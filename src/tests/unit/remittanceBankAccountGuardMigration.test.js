import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const NAME = '20261111130000_remittance_bank_account_guard';
const MIGRATION = resolve(process.cwd(), `supabase/migrations/${NAME}.sql`);
const ROLLBACK = resolve(process.cwd(), `supabase/rollbacks/${NAME}_down.sql`);

const read = (file) => readFileSync(file, 'utf8');

describe('remittance bank account guard migration', () => {
  it('ships a migration and its rollback', () => {
    expect(existsSync(MIGRATION)).toBe(true);
    expect(existsSync(ROLLBACK)).toBe(true);
  });

  describe('migration', () => {
    const sql = () => read(MIGRATION);

    it('is a BEFORE INSERT row trigger on remittances: stored remittances are never touched', () => {
      expect(sql()).toMatch(/CREATE TRIGGER guard_remittance_bank_account\s+BEFORE INSERT ON public\.remittances\s+FOR EACH ROW/);
      expect(sql()).not.toMatch(/\b(UPDATE|DELETE FROM)\s+public\.remittances\b/i);
    });

    it('uses the same bypass as the pricing guard: no session, service roles and admins', () => {
      const s = sql();
      expect(s).toMatch(/auth\.uid\(\) IS NULL/);
      expect(s).toMatch(/'service_role', 'postgres', 'supabase_admin'/);
      expect(s).toMatch(/public\.is_admin_user\(\)/);
      expect(s).toMatch(/public\.is_super_admin\(\)/);
    });

    it('is not callable by clients: EXECUTE revoked from PUBLIC, anon and authenticated', () => {
      expect(sql()).toMatch(/REVOKE ALL ON FUNCTION public\.guard_remittance_bank_account\(\) FROM PUBLIC, anon, authenticated;/);
    });

    it('only checks non-cash delivery, read from the remittance type', () => {
      const s = sql();
      expect(s).toMatch(/FROM public\.remittance_types WHERE id = NEW\.remittance_type_id/);
      // cash returns early, so only the other delivery methods reach the account check
      expect(s).toMatch(/NOT FOUND OR v_type\.delivery_method = 'cash' THEN\s+RETURN NEW;/);
    });

    it('requires the link to exist for THIS recipient and be active, with an active, not deleted account', () => {
      const s = sql();
      expect(s).toMatch(/NEW\.recipient_id IS NULL OR NEW\.recipient_bank_account_id IS NULL/);
      expect(s).toMatch(/rba\.id = NEW\.recipient_bank_account_id/);
      expect(s).toMatch(/rba\.recipient_id = NEW\.recipient_id/);
      expect(s).toMatch(/rba\.is_active IS TRUE/);
      expect(s).toMatch(/ba\.is_active IS TRUE/);
      expect(s).toMatch(/ba\.deleted_at IS NULL/);
    });

    it('requires the account currency to be the delivery currency of the type', () => {
      const s = sql();
      expect(s).toMatch(/JOIN public\.currencies c ON c\.id = ba\.currency_id/);
      expect(s).toMatch(/c\.code = v_type\.delivery_currency/);
    });

    it('rejects with a stable message and a check violation code', () => {
      expect(sql()).toMatch(/RAISE EXCEPTION 'remittance_bank_account_required' USING ERRCODE = '23514'/);
    });

    it('is a hardened, idempotent, single transaction migration', () => {
      const s = sql();
      expect(s).toMatch(/SECURITY DEFINER/);
      expect(s).toMatch(/SET search_path = public, pg_temp/);
      expect(s).toMatch(/CREATE OR REPLACE FUNCTION public\.guard_remittance_bank_account\(\)/);
      expect(s).toMatch(/DROP TRIGGER IF EXISTS guard_remittance_bank_account ON public\.remittances/);
      expect(s).toMatch(/SET LOCAL lock_timeout/);
      expect(s).toMatch(/^BEGIN;/m);
      expect(s).toMatch(/^COMMIT;/m);
    });

    it('is marked as prepared and points at its rollback', () => {
      expect(sql()).toMatch(/PREPARED, NOT APPLIED/);
      expect(sql()).toMatch(new RegExp(`supabase/rollbacks/${NAME}_down\\.sql`));
    });
  });

  describe('rollback', () => {
    it('drops the trigger and the function only', () => {
      const s = read(ROLLBACK);
      expect(s).toMatch(/DROP TRIGGER IF EXISTS guard_remittance_bank_account ON public\.remittances/);
      expect(s).toMatch(/DROP FUNCTION IF EXISTS public\.guard_remittance_bank_account\(\)/);
      expect(s).not.toMatch(/\b(UPDATE|DELETE FROM|DROP TABLE)\b/i);
    });
  });
});
