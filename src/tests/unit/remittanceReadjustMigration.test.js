import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const UP = resolve(process.cwd(), 'supabase/migrations/20261112120000_superadmin_readjust_remittance.sql');
const DOWN = resolve(process.cwd(), 'supabase/rollbacks/20261112120000_superadmin_readjust_remittance_down.sql');
const read = (path) => readFileSync(path, 'utf8');

const STATUSES = [
  'payment_pending',
  'payment_proof_uploaded',
  'payment_validated',
  'payment_rejected',
  'processing',
  'delivered',
  'completed',
  'cancelled'
];

describe('super admin remittance readjustment migration (slice 1)', () => {
  it('ships the migration and its rollback, marked as not applied', () => {
    expect(existsSync(UP)).toBe(true);
    expect(existsSync(DOWN)).toBe(true);
    expect(read(UP)).toMatch(/PREPARED, NOT APPLIED/);
  });

  describe('RPC superadmin_readjust_remittance', () => {
    it('is SECURITY DEFINER with a pinned search_path', () => {
      const sql = read(UP);
      expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.superadmin_readjust_remittance\(/);
      expect(sql).toMatch(/SECURITY DEFINER\s+SET search_path = public, pg_temp/);
    });

    it('lets only a super admin through (an ordinary admin is refused)', () => {
      const sql = read(UP);
      expect(sql).toMatch(/v_uid IS NULL OR NOT public\.is_super_admin\(\)/);
      expect(sql).not.toMatch(/is_admin_user\(\)/);
      expect(sql).toMatch(/insufficient_privilege/);
    });

    it('refuses the super admin own operation (separation of duties)', () => {
      expect(read(UP)).toMatch(/v_rem\.user_id = v_uid[\s\S]*?own_operation_not_allowed/);
    });

    it('serializes against itself and locks the remittance row', () => {
      const sql = read(UP);
      expect(sql).toMatch(/pg_advisory_xact_lock\(hashtext\('remittance_readjust'\)\)/);
      expect(sql).toMatch(/FROM public\.remittances WHERE id = p_remittance_id FOR UPDATE/);
    });

    it('requires a reason of 10 to 500 characters and at least one change', () => {
      const sql = read(UP);
      expect(sql).toMatch(/char_length\(v_reason\) < 10 OR char_length\(v_reason\) > 500/);
      expect(sql).toMatch(/invalid_reason/);
      expect(sql).toMatch(/nothing_to_change/);
    });

    it('accepts exactly the 8 statuses of remittances_status_check', () => {
      const sql = read(UP);
      for (const status of STATUSES) expect(sql).toContain(`'${status}'`);
      expect(sql).toMatch(/invalid_status/);
    });

    it('validates rate, commission and amounts like the table constraints', () => {
      const sql = read(UP);
      expect(sql).toMatch(/invalid_rate/);
      expect(sql).toMatch(/invalid_commission/);
      expect(sql).toMatch(/invalid_amount/);
      expect(sql).toMatch(/round\(v_sent - v_comm\) \* round\(v_rate, 4\), 2\)|round\(\(v_sent - v_comm\) \* round\(v_rate, 4\), 2\)/);
    });

    it('records the status change note so the status history shows the reason', () => {
      const sql = read(UP);
      expect(sql).toMatch(/set_config\('app\.status_note'/);
    });

    it('is executable only by authenticated users', () => {
      const sql = read(UP);
      expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.superadmin_readjust_remittance\([^)]*\) FROM PUBLIC, anon;/);
      expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.superadmin_readjust_remittance\([^)]*\) TO authenticated;/);
    });
  });

  describe('remittance_readjustments history', () => {
    it('is an append-only table with before/after snapshots and the reason', () => {
      const sql = read(UP);
      expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.remittance_readjustments/);
      for (const col of ['remittance_id', 'set_by', 'reason', 'before', 'after', 'created_at']) {
        expect(sql).toMatch(new RegExp(`\\b${col}\\b`));
      }
      expect(sql).toMatch(/REVOKE ALL ON public\.remittance_readjustments FROM PUBLIC, anon, authenticated;/);
    });

    it('is readable only by super admins through RLS', () => {
      const sql = read(UP);
      expect(sql).toMatch(/ALTER TABLE public\.remittance_readjustments ENABLE ROW LEVEL SECURITY;/);
      expect(sql).toMatch(/CREATE POLICY[\s\S]*?FOR SELECT[\s\S]*?is_super_admin\(\)/);
      expect(sql).toMatch(/GRANT SELECT ON public\.remittance_readjustments TO authenticated;/);
      expect(sql).not.toMatch(/GRANT (INSERT|UPDATE|DELETE)[^;]*remittance_readjustments/);
    });
  });

  it('the rollback drops the function and the table', () => {
    const sql = read(DOWN);
    expect(sql).toMatch(/DROP FUNCTION IF EXISTS public\.superadmin_readjust_remittance\(/);
    expect(sql).toMatch(/DROP TABLE IF EXISTS public\.remittance_readjustments/);
  });
});
