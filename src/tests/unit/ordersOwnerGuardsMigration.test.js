import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ORDERS_MIGRATION = resolve(
  process.cwd(),
  'supabase/migrations/20261014160000_orders_owner_guards.sql'
);
const STORAGE_MIGRATION = resolve(
  process.cwd(),
  'supabase/migrations/20261014160100_storage_owner_policies_scoped.sql'
);

const read = (path) => readFileSync(path, 'utf8');

/** Extract the body of `c_<name> constant text[] := ARRAY[ ... ];` */
const extractArray = (sql, name) => {
  const match = sql.match(new RegExp(`${name}\\s+constant\\s+text\\[\\]\\s*:=\\s*ARRAY\\[([\\s\\S]*?)\\]\\s*;`));
  return match ? match[1] : '';
};

describe('orders owner guards migration (F-1)', () => {
  it('exists', () => {
    expect(existsSync(ORDERS_MIGRATION)).toBe(true);
  });

  describe('UPDATE guard', () => {
    it('defines a SECURITY INVOKER trigger function with pinned search_path', () => {
      const sql = read(ORDERS_MIGRATION);
      expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.guard_orders_owner_update\(\)/);
      expect(sql).toMatch(/RETURNS trigger\s+LANGUAGE plpgsql\s+SECURITY INVOKER\s+SET search_path = public/);
      expect(sql).not.toMatch(/SECURITY DEFINER/i);
    });

    it('registers an idempotent BEFORE UPDATE trigger on public.orders', () => {
      const sql = read(ORDERS_MIGRATION);
      expect(sql).toMatch(/DROP TRIGGER IF EXISTS guard_orders_owner_update ON public\.orders;/);
      expect(sql).toMatch(
        /CREATE TRIGGER guard_orders_owner_update\s+BEFORE UPDATE ON public\.orders\s+FOR EACH ROW EXECUTE FUNCTION public\.guard_orders_owner_update\(\);/
      );
    });

    it('bypasses privileged contexts', () => {
      const sql = read(ORDERS_MIGRATION);
      expect(sql).toMatch(/current_user IN \('postgres', 'service_role', 'supabase_admin'\)/);
      expect(sql).toMatch(/auth\.uid\(\) IS NULL/);
      expect(sql).toMatch(/public\.is_admin_user\(\)/);
      expect(sql).toMatch(/public\.is_super_admin\(\)/);
    });

    it('whitelists only the columns an owner legitimately writes', () => {
      const allowed = extractArray(read(ORDERS_MIGRATION), 'c_allowed');
      for (const col of [
        'payment_proof_url',
        'payment_reference',
        'payment_status',
        'rejection_reason',
        'status',
        'updated_at',
      ]) {
        expect(allowed).toContain(`'${col}'`);
      }
    });

    it('does not whitelist sensitive columns', () => {
      const allowed = extractArray(read(ORDERS_MIGRATION), 'c_allowed');
      for (const col of [
        'user_id',
        'total_amount',
        'subtotal',
        'discount_amount',
        'shipping_cost',
        'payment_method',
        'zelle_account_id',
        'validated_by',
        'validated_at',
        'currency_id',
        'order_number',
        'admin_notes',
      ]) {
        expect(allowed).not.toContain(`'${col}'`);
      }
    });

    it('blocks non-whitelisted column changes with SQLSTATE 42501', () => {
      const sql = read(ORDERS_MIGRATION);
      expect(sql).toMatch(/orders_owner_update_forbidden: column %/);
      expect(sql).toMatch(/ERRCODE = '42501'/);
    });

    it('validates status transitions (pending->cancelled, cancelled->pending only)', () => {
      const sql = read(ORDERS_MIGRATION);
      expect(sql).toMatch(/OLD\.status = 'pending' AND NEW\.status = 'cancelled'/);
      expect(sql).toMatch(/OLD\.status = 'cancelled' AND NEW\.status = 'pending'/);
    });

    it('never lets an owner set payment_status to validated', () => {
      const sql = read(ORDERS_MIGRATION);
      expect(sql).toMatch(/NEW\.payment_status = 'proof_uploaded'/);
      expect(sql).toMatch(/NEW\.payment_status = 'rejected'/);
      expect(sql).not.toMatch(/NEW\.payment_status = 'validated'/);
    });
  });

  describe('INSERT guard', () => {
    it('defines a SECURITY INVOKER trigger function with pinned search_path', () => {
      const sql = read(ORDERS_MIGRATION);
      expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.guard_orders_owner_insert\(\)/);
    });

    it('registers an idempotent BEFORE INSERT trigger on public.orders', () => {
      const sql = read(ORDERS_MIGRATION);
      expect(sql).toMatch(/DROP TRIGGER IF EXISTS guard_orders_owner_insert ON public\.orders;/);
      expect(sql).toMatch(
        /CREATE TRIGGER guard_orders_owner_insert\s+BEFORE INSERT ON public\.orders\s+FOR EACH ROW EXECUTE FUNCTION public\.guard_orders_owner_insert\(\);/
      );
    });

    it('forces pending status and pending payment_status on owner insert', () => {
      const sql = read(ORDERS_MIGRATION);
      expect(sql).toMatch(/NEW\.status IS DISTINCT FROM 'pending'/);
      expect(sql).toMatch(/NEW\.payment_status IS DISTINCT FROM 'pending'/);
      expect(sql).toMatch(/orders_owner_insert_forbidden: %/);
    });

    it('rejects staff-only columns on owner insert', () => {
      const staff = extractArray(read(ORDERS_MIGRATION), 'c_staff_only');
      for (const col of [
        'validated_by',
        'validated_at',
        'rejection_reason',
        'delivered_at',
        'processing_started_at',
        'completed_at',
        'delivery_proof_url',
        'dispatched_by',
        'dispatched_at',
        'admin_notes',
        'tracking_number',
      ]) {
        expect(staff).toContain(`'${col}'`);
      }
    });

    it('bypasses privileged contexts', () => {
      const sql = read(ORDERS_MIGRATION);
      expect((sql.match(/current_user IN \('postgres', 'service_role', 'supabase_admin'\)/g) ?? []).length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('operational hygiene', () => {
    it('documents trigger ordering relative to existing orders triggers', () => {
      const sql = read(ORDERS_MIGRATION);
      expect(sql).toMatch(/alphabetical/i);
      expect(sql).toMatch(/guard_reset_lock_orders/);
      expect(sql).toMatch(/trigger_update_orders_updated_at/);
    });

    it('revokes direct EXECUTE on the trigger functions', () => {
      const sql = read(ORDERS_MIGRATION);
      expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.guard_orders_owner_update\(\) FROM PUBLIC, anon, authenticated;/);
      expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.guard_orders_owner_insert\(\) FROM PUBLIC, anon, authenticated;/);
    });

    it('includes an explicit rollback block', () => {
      const sql = read(ORDERS_MIGRATION);
      expect(sql).toMatch(/-- ROLLBACK/);
      expect(sql).toMatch(/-- DROP TRIGGER IF EXISTS guard_orders_owner_update ON public\.orders;/);
      expect(sql).toMatch(/-- DROP TRIGGER IF EXISTS guard_orders_owner_insert ON public\.orders;/);
      expect(sql).toMatch(/-- DROP FUNCTION IF EXISTS public\.guard_orders_owner_update\(\);/);
      expect(sql).toMatch(/-- DROP FUNCTION IF EXISTS public\.guard_orders_owner_insert\(\);/);
    });
  });
});

describe('storage owner policies scoped migration (F-1b)', () => {
  it('exists', () => {
    expect(existsSync(STORAGE_MIGRATION)).toBe(true);
  });

  it('drops the unscoped owner policies idempotently', () => {
    const sql = read(STORAGE_MIGRATION);
    expect(sql).toMatch(/DROP POLICY IF EXISTS "Users Can Update Their Own Files 16wiy3a_0" ON storage\.objects;/);
    expect(sql).toMatch(/DROP POLICY IF EXISTS "Users Can Delete Their Own Files 16wiy3a_0" ON storage\.objects;/);
  });

  it('recreates owner UPDATE/DELETE policies scoped to explicit buckets', () => {
    const sql = read(STORAGE_MIGRATION);
    expect(sql).toMatch(/FOR UPDATE\s+TO authenticated\s+USING \(\s*bucket_id IN \('product-images', 'remittance-delivery-proofs'\)\s+AND auth\.uid\(\) = owner/);
    expect(sql).toMatch(/FOR DELETE\s+TO authenticated\s+USING \(\s*bucket_id IN \('product-images', 'remittance-delivery-proofs'\)\s+AND auth\.uid\(\) = owner/);
    expect(sql).toMatch(/WITH CHECK \(\s*bucket_id IN \('product-images', 'remittance-delivery-proofs'\)/);
  });

  it('includes an explicit rollback block restoring the original policies', () => {
    const sql = read(STORAGE_MIGRATION);
    expect(sql).toMatch(/-- ROLLBACK/);
    expect(sql).toMatch(/-- CREATE POLICY "Users Can Update Their Own Files 16wiy3a_0" ON storage\.objects/);
    expect(sql).toMatch(/-- CREATE POLICY "Users Can Delete Their Own Files 16wiy3a_0" ON storage\.objects/);
  });
});
