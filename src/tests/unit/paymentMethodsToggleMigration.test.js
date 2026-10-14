import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const MIGRATION = resolve(
  process.cwd(),
  'supabase/migrations/20261014170000_payment_methods_toggle.sql'
);

const read = () => readFileSync(MIGRATION, 'utf8');

/** Returns the SQL of one CREATE OR REPLACE FUNCTION public.<name>(...) ... $function$; block. */
const functionBlock = (sql, name) => {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  if (start === -1) return '';
  const end = sql.indexOf('$function$;', sql.indexOf('AS $function$', start) + 13);
  return sql.slice(start, end + '$function$;'.length);
};

describe('payment methods toggle migration (F0)', () => {
  it('exists', () => {
    expect(existsSync(MIGRATION)).toBe(true);
  });

  describe('payment_methods table', () => {
    it('is created idempotently with the agreed columns and code domain', () => {
      const sql = read();
      expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.payment_methods/);
      expect(sql).toMatch(/code\s+text PRIMARY KEY CHECK \(code IN \('zelle', 'bizum'\)\)/);
      for (const col of [
        'available',
        'enabled_for_orders',
        'enabled_for_remittances',
        'disabled_reason',
        'updated_at',
        'updated_by',
      ]) {
        expect(sql).toMatch(new RegExp(`\\b${col}\\b`));
      }
    });

    it('forbids enabling an unavailable method at the data level', () => {
      expect(read()).toMatch(
        /CHECK \(available OR \(NOT enabled_for_orders AND NOT enabled_for_remittances\)\)/
      );
    });

    it('seeds zelle (available) and bizum (coming soon) without clobbering admin state', () => {
      const sql = read();
      expect(sql).toMatch(/INSERT INTO public\.payment_methods/);
      expect(sql).toMatch(/\('zelle', true, true, true\)/);
      expect(sql).toMatch(/\('bizum', false, false, false\)/);
      expect(sql).toMatch(/ON CONFLICT \(code\) DO NOTHING/);
    });

    it('enables RLS with an admin-only read policy', () => {
      const sql = read();
      expect(sql).toMatch(/ALTER TABLE public\.payment_methods ENABLE ROW LEVEL SECURITY;/);
      expect(sql).toMatch(
        /CREATE POLICY payment_methods_admin_read ON public\.payment_methods\s+FOR SELECT TO authenticated\s+USING \(public\.is_admin_user\(\)\)/
      );
    });

    it('revokes every default privilege and grants SELECT only to authenticated (no client writes)', () => {
      const sql = read();
      expect(sql).toMatch(/REVOKE ALL ON public\.payment_methods FROM PUBLIC, anon, authenticated;/);
      expect(sql).toMatch(/GRANT SELECT ON public\.payment_methods TO authenticated;/);
      expect(sql).not.toMatch(/GRANT[^;]*\b(INSERT|UPDATE|DELETE|ALL)\b[^;]*ON public\.payment_methods/i);
      expect(sql).not.toMatch(/CREATE POLICY[^;]*FOR (INSERT|UPDATE|DELETE|ALL)[^;]*payment_methods/i);
      expect(sql).not.toMatch(/ON public\.payment_methods\s+FOR (INSERT|UPDATE|DELETE|ALL)/i);
    });
  });

  describe('set_payment_method_enabled RPC', () => {
    const fn = () => functionBlock(read(), 'set_payment_method_enabled');

    it('has the agreed signature', () => {
      expect(read()).toMatch(
        /set_payment_method_enabled\(\s*p_code text,\s*p_flow text,\s*p_enabled boolean,\s*p_reason text DEFAULT NULL,\s*p_confirm_last boolean DEFAULT false\s*\)/
      );
    });

    it('is SECURITY DEFINER with a pinned search_path', () => {
      expect(fn()).toMatch(/SECURITY DEFINER\s+SET search_path = public/);
    });

    it('re-verifies the admin role inside the function', () => {
      expect(fn()).toMatch(/auth\.uid\(\) IS NULL OR NOT public\.is_admin_user\(\)/);
      expect(fn()).toMatch(/ERRCODE = '42501'/);
    });

    it('serializes with an exclusive advisory lock and a row lock', () => {
      expect(fn()).toMatch(/pg_advisory_xact_lock\(hashtext\('payment_methods'\)\)/);
      expect(fn()).toMatch(/FOR UPDATE/);
    });

    it('refuses enabling an unavailable method and enforces the last-method rule', () => {
      expect(fn()).toMatch(/payment_method_unavailable/);
      expect(fn()).toMatch(/payment_method_last_enabled/);
      expect(fn()).toMatch(/p_confirm_last/);
    });

    it('writes the audit row inside the function without PII', () => {
      const body = fn();
      expect(body).toMatch(/INSERT INTO public\.activity_logs/);
      expect(body).toMatch(/auth\.uid\(\)::text/);
      expect(body).not.toMatch(/email/i);
    });

    it('returns the updated row as jsonb', () => {
      expect(fn()).toMatch(/RETURNS jsonb/);
    });

    it('is only executable by authenticated and service_role', () => {
      const sql = read();
      expect(sql).toMatch(
        /REVOKE ALL ON FUNCTION public\.set_payment_method_enabled\(text, text, boolean, text, boolean\)\s+FROM PUBLIC, anon, authenticated;/
      );
      expect(sql).toMatch(
        /GRANT EXECUTE ON FUNCTION public\.set_payment_method_enabled\(text, text, boolean, text, boolean\)\s+TO authenticated, service_role;/
      );
    });
  });

  describe('list_payment_methods_public', () => {
    it('is a SECURITY DEFINER function exposing only explicit columns', () => {
      const body = functionBlock(read(), 'list_payment_methods_public');
      expect(body).toMatch(/SECURITY DEFINER\s+SET search_path = public/);
      expect(body).toMatch(
        /RETURNS TABLE \(\s*code text,\s*available boolean,\s*enabled_for_orders boolean,\s*enabled_for_remittances boolean\s*\)/
      );
      expect(body).not.toMatch(/SELECT\s+\*/i);
      expect(body).not.toMatch(/disabled_reason|updated_by/);
    });

    it('is not callable by anon', () => {
      const sql = read();
      expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.list_payment_methods_public\(\)\s+FROM PUBLIC, anon, authenticated;/);
      expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.list_payment_methods_public\(\)\s+TO authenticated, service_role;/);
    });
  });

  describe('remittances.payment_method column', () => {
    it('adds a NOT NULL column with a permanent DEFAULT zelle', () => {
      expect(read()).toMatch(
        /ALTER TABLE public\.remittances\s+ADD COLUMN IF NOT EXISTS payment_method text NOT NULL DEFAULT 'zelle';/
      );
      expect(read()).not.toMatch(/ALTER COLUMN payment_method DROP DEFAULT/i);
    });

    it('adds the CHECK as NOT VALID and validates it separately', () => {
      const sql = read();
      expect(sql).toMatch(/CHECK \(payment_method IN \('zelle', 'bizum'\)\) NOT VALID/);
      expect(sql).toMatch(/VALIDATE CONSTRAINT remittances_payment_method_check/);
    });
  });

  describe('creation guard trigger', () => {
    const trg = () => functionBlock(read(), 'guard_payment_method_enabled');
    const helper = () => functionBlock(read(), 'payment_method_allowed');

    it('is SECURITY INVOKER so current_user still identifies the caller', () => {
      expect(trg()).toMatch(/RETURNS trigger\s+LANGUAGE plpgsql\s+SECURITY INVOKER\s+SET search_path = public/);
      expect(trg()).not.toMatch(/SECURITY DEFINER/i);
    });

    it('bypasses privileged contexts like guard_orders_owner_insert', () => {
      const body = trg();
      expect(body).toMatch(/current_user IN \('postgres', 'service_role', 'supabase_admin'\)/);
      expect(body).toMatch(/auth\.uid\(\) IS NULL/);
      expect(body).toMatch(/public\.is_admin_user\(\)/);
      expect(body).toMatch(/public\.is_super_admin\(\)/);
    });

    it('takes the shared advisory lock and rejects with the documented error', () => {
      const body = trg();
      expect(body).toMatch(/pg_advisory_xact_lock_shared\(hashtext\('payment_methods'\)\)/);
      expect(body).toMatch(/payment_method_disabled/);
      expect(body).toMatch(/ERRCODE = 'P0001'/);
      expect(body).toMatch(/TG_TABLE_NAME/);
    });

    it('reads the catalog through a definer helper that fails closed and is VOLATILE', () => {
      const body = helper();
      expect(body).toMatch(/SECURITY DEFINER\s+SET search_path = public/);
      expect(body).not.toMatch(/\bSTABLE\b|\bIMMUTABLE\b/);
      expect(body).toMatch(/COALESCE\(/);
      expect(read()).toMatch(
        /REVOKE ALL ON FUNCTION public\.payment_method_allowed\(text, text\)\s+FROM PUBLIC, anon, authenticated;/
      );
      expect(read()).toMatch(
        /GRANT EXECUTE ON FUNCTION public\.payment_method_allowed\(text, text\)\s+TO authenticated, service_role;/
      );
    });

    it('is registered idempotently as BEFORE INSERT on orders and remittances', () => {
      const sql = read();
      for (const table of ['orders', 'remittances']) {
        expect(sql).toMatch(new RegExp(`DROP TRIGGER IF EXISTS guard_payment_method_enabled ON public\\.${table};`));
        expect(sql).toMatch(
          new RegExp(
            `CREATE TRIGGER guard_payment_method_enabled\\s+BEFORE INSERT ON public\\.${table}\\s+FOR EACH ROW EXECUTE FUNCTION public\\.guard_payment_method_enabled\\(\\);`
          )
        );
      }
    });

    it('does not expose the trigger function to client roles', () => {
      expect(read()).toMatch(
        /REVOKE ALL ON FUNCTION public\.guard_payment_method_enabled\(\) FROM PUBLIC, anon, authenticated;/
      );
    });
  });

  describe('operational hygiene', () => {
    it('documents the alphabetical firing order against the live triggers', () => {
      const sql = read();
      expect(sql).toMatch(/alphabetical/i);
      for (const name of [
        'guard_orders_owner_insert',
        'guard_reset_lock_orders',
        'trigger_set_order_number',
        'guard_remittance_owner_insert',
        'guard_reset_lock_remittances',
        'trigger_generate_remittance_number',
      ]) {
        expect(sql).toContain(name);
      }
    });

    it('documents that the owner-update guard blocks payment_method by default', () => {
      expect(read()).toMatch(/guard_remittance_owner_update/);
    });

    it('includes an explicit rollback block', () => {
      const sql = read();
      expect(sql).toMatch(/-- ROLLBACK/);
      expect(sql).toMatch(/-- DROP TRIGGER IF EXISTS guard_payment_method_enabled ON public\.orders;/);
      expect(sql).toMatch(/-- DROP TRIGGER IF EXISTS guard_payment_method_enabled ON public\.remittances;/);
      expect(sql).toMatch(/-- DROP FUNCTION IF EXISTS public\.guard_payment_method_enabled\(\);/);
      expect(sql).toMatch(/-- DROP FUNCTION IF EXISTS public\.payment_method_allowed\(text, text\);/);
      expect(sql).toMatch(/-- DROP FUNCTION IF EXISTS public\.list_payment_methods_public\(\);/);
      expect(sql).toMatch(/-- DROP FUNCTION IF EXISTS public\.set_payment_method_enabled\(text, text, boolean, text, boolean\);/);
      expect(sql).toMatch(/-- ALTER TABLE public\.remittances DROP CONSTRAINT IF EXISTS remittances_payment_method_check;/);
      expect(sql).toMatch(/-- ALTER TABLE public\.remittances DROP COLUMN IF EXISTS payment_method;/);
      expect(sql).toMatch(/-- DROP TABLE IF EXISTS public\.payment_methods;/);
    });
  });
});
