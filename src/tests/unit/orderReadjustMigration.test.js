import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const UP = resolve(process.cwd(), 'supabase/migrations/20261113120000_superadmin_readjust_order.sql');
const DOWN = resolve(process.cwd(), 'supabase/rollbacks/20261113120000_superadmin_readjust_order_down.sql');
const read = (path) => readFileSync(path, 'utf8');

describe('super admin order readjustment migration (slice 2)', () => {
  it('ships the migration and its rollback, marked as not applied', () => {
    expect(existsSync(UP)).toBe(true);
    expect(existsSync(DOWN)).toBe(true);
    expect(read(UP)).toMatch(/PREPARED, NOT APPLIED/);
  });

  describe('RPC superadmin_readjust_order', () => {
    it('is SECURITY DEFINER with a pinned search_path', () => {
      const sql = read(UP);
      expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.superadmin_readjust_order\(/);
      expect(sql).toMatch(/SECURITY DEFINER\s+SET search_path = public, pg_temp/);
    });

    it('lets only a super admin through and refuses the own order', () => {
      const sql = read(UP);
      expect(sql).toMatch(/v_uid IS NULL OR NOT public\.is_super_admin\(\)/);
      expect(sql).not.toMatch(/is_admin_user\(\)\s*(OR|THEN)/);
      expect(sql).toMatch(/v_ord\.user_id = v_uid[\s\S]*?own_operation_not_allowed/);
    });

    it('serializes and locks the order row', () => {
      const sql = read(UP);
      expect(sql).toMatch(/pg_advisory_xact_lock\(hashtext\('order_readjust'\)\)/);
      expect(sql).toMatch(/FROM public\.orders WHERE id = p_order_id FOR UPDATE/);
    });

    it('requires a reason of 10 to 500 characters and at least one change', () => {
      const sql = read(UP);
      expect(sql).toMatch(/char_length\(v_reason\) < 10 OR char_length\(v_reason\) > 500/);
      expect(sql).toMatch(/nothing_to_change/);
    });

    it('accepts exactly the statuses of orders_status_check and orders_payment_status_check', () => {
      const sql = read(UP);
      for (const status of ['pending', 'processing', 'dispatched', 'delivered', 'completed', 'cancelled']) {
        expect(sql).toContain(`'${status}'`);
      }
      for (const status of ['proof_uploaded', 'validated', 'rejected']) expect(sql).toContain(`'${status}'`);
      expect(sql).toMatch(/invalid_status/);
      expect(sql).toMatch(/invalid_payment_status/);
    });

    it('reprices only lines of this order and keeps the total identity of orders_money_total_identity_chk', () => {
      const sql = read(UP);
      expect(sql).toMatch(/invalid_item/);
      expect(sql).toMatch(/UPDATE public\.order_items/);
      expect(sql).toMatch(/total_price\s*=\s*round\(/);
      expect(sql).toMatch(/v_subtotal - v_discount \+ v_shipping \+ COALESCE\(v_ord\.tax_amount, 0\)/);
      expect(sql).toMatch(/invalid_discount/);
    });

    it('moves the status through an UPDATE so the reopen trigger closes the pending refund', () => {
      const sql = read(UP);
      expect(sql).toMatch(/UPDATE public\.orders/);
      expect(sql).not.toMatch(/UPDATE public\.refund_requests/);
      expect(sql).toMatch(/set_config\('app\.status_note'/);
    });

    it('consumes the stock of an active validated order through consume_order_inventory and refuses if it cannot', () => {
      const sql = read(UP);
      expect(sql).toMatch(/public\.consume_order_inventory\(p_order_id\)/);
      expect(sql).toMatch(/stock_refused/);
      expect(sql).toMatch(/v_status IN \('pending', 'processing'\)/);
    });

    it('is executable only by authenticated users', () => {
      const sql = read(UP);
      expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.superadmin_readjust_order\([^)]*\) FROM PUBLIC, anon;/);
      expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.superadmin_readjust_order\([^)]*\) TO authenticated;/);
    });
  });

  describe('order_readjustments history', () => {
    it('is append-only, with snapshots and the reason, readable by super admins only', () => {
      const sql = read(UP);
      expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.order_readjustments/);
      for (const col of ['order_id', 'set_by', 'reason', 'before', 'after', 'created_at']) {
        expect(sql).toMatch(new RegExp(`\\b${col}\\b`));
      }
      expect(sql).toMatch(/REVOKE ALL ON public\.order_readjustments FROM PUBLIC, anon, authenticated;/);
      expect(sql).toMatch(/ALTER TABLE public\.order_readjustments ENABLE ROW LEVEL SECURITY;/);
      expect(sql).toMatch(/CREATE POLICY[\s\S]*?FOR SELECT[\s\S]*?is_super_admin\(\)/);
      expect(sql).not.toMatch(/GRANT (INSERT|UPDATE|DELETE)[^;]*order_readjustments/);
    });
  });

  it('the rollback drops the function and the table', () => {
    const sql = read(DOWN);
    expect(sql).toMatch(/DROP FUNCTION IF EXISTS public\.superadmin_readjust_order\(/);
    expect(sql).toMatch(/DROP TABLE IF EXISTS public\.order_readjustments/);
  });
});
