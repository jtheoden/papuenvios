/**
 * 20261105100000_remittance_admin_cancel: the rollback restores the exact previous helper body (20261025110000, live in
 * production before the change) and the migration only touches _remittance_transition + its new wrapper.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const helperBlock = (sql) => {
  const start = sql.indexOf('CREATE OR REPLACE FUNCTION public._remittance_transition');
  const bodyStart = sql.indexOf('AS $function$', start) + 'AS $function$'.length;
  return sql.slice(start, sql.indexOf('$function$;', bodyStart));
};

const UP = read('supabase/migrations/20261105100000_remittance_admin_cancel.sql');
const DOWN = read('supabase/rollbacks/20261105100000_remittance_admin_cancel_down.sql');
const PREVIOUS = read('supabase/migrations/20261025110000_delivery_proof_optional.sql');

describe('remittance admin cancel migration', () => {
  it('the rollback restores the previous _remittance_transition byte for byte and drops the wrapper', () => {
    expect(helperBlock(DOWN)).toBe(helperBlock(PREVIOUS));
    expect(DOWN).toMatch(/DROP FUNCTION IF EXISTS public\.remittance_admin_cancel\(uuid, text\);/);
  });

  it('only redefines the remittance helper and the new wrapper (never _order_transition or remittance_cancel)', () => {
    const defined = [...UP.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)/g)].map((m) => m[1]);
    expect(defined).toEqual(['_remittance_transition', 'remittance_admin_cancel']);
  });

  it('admin_cancel is admin-only, payment_pending-only and fails closed on an unknown action', () => {
    const body = helperBlock(UP);
    expect(body).toMatch(/WHEN 'admin_cancel', 'validate_payment'.*\n\s+IF NOT v_is_admin/);
    expect(body).toMatch(/WHEN 'admin_cancel' THEN v_rem\.status = 'payment_pending'/);
    expect(body).toMatch(/IF NOT COALESCE\(v_ok, false\) THEN/);
    expect(UP).toMatch(/REVOKE ALL ON FUNCTION public\.remittance_admin_cancel\(uuid, text\) FROM PUBLIC, anon;/);
    expect(UP).toMatch(/GRANT EXECUTE ON FUNCTION public\.remittance_admin_cancel\(uuid, text\) TO authenticated;/);
  });
});
