import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { PUBLIC_READABLE_COLUMNS } from '@/lib/publicCatalogColumns';

// Static guards for the Phase 0b SQL files. The behavioural proof lives in the real-Postgres suites
// (src/tests/concurrency/adminCostReadRpcs.test.js, phase0bContract.test.js); these checks keep the
// files, the front-end column lists and the repo layout from drifting apart without a database.

const ROOT = resolve(process.cwd());
const read = (file) => readFileSync(resolve(ROOT, file), 'utf8');

const MIGRATION_A = 'supabase/migrations/20261016160000_phase0b_admin_cost_read_rpcs.sql';
const CONTRACT_B = 'supabase/contract/20261016160100_phase0b_contract_revoke_cost_columns.sql';
const ROLLBACK_A = 'supabase/rollbacks/20261016160000_phase0b_admin_cost_read_rpcs_down.sql';
const ROLLBACK_B = 'supabase/rollbacks/20261016160100_phase0b_contract_revoke_cost_columns_down.sql';

const HIDDEN = {
  products: ['base_price', 'cost_price', 'profit_margin'],
  combo_products: ['base_total_price', 'profit_margin'],
  product_categories: ['profit_margin'],
  inventory: ['cost_per_unit', 'supplier_reference'],
  shipping_zones: ['transport_cost']
};

const grantLists = (sql) => {
  const lists = {};
  for (const match of sql.matchAll(/GRANT SELECT \(([\s\S]*?)\) ON public\.(\w+) TO anon, authenticated;/g)) {
    lists[match[2]] = match[1].split(',').map((column) => column.trim()).filter(Boolean);
  }
  return lists;
};

describe('contract file B', () => {
  const sql = read(CONTRACT_B);
  const lists = grantLists(sql);

  it('lives outside supabase/migrations (db push and the bootstrap replay must never apply it by accident)', () => {
    const migrations = readdirSync(resolve(ROOT, 'supabase/migrations'));
    expect(migrations.some((name) => /contract_revoke_cost_columns/.test(name))).toBe(false);
    expect(existsSync(resolve(ROOT, CONTRACT_B))).toBe(true);
  });

  it('carries the "not applied / wait 48h" header and a rollback file', () => {
    expect(sql).toMatch(/PREPARED, NOT APPLIED/);
    expect(sql).toMatch(/DO NOT APPLY BEFORE 48h OBSERVATION/);
    expect(existsSync(resolve(ROOT, ROLLBACK_B))).toBe(true);
  });

  it('revokes the TABLE-level SELECT before granting columns (a column REVOKE alone is a no-op)', () => {
    Object.keys(HIDDEN).forEach((table) => {
      const revoke = sql.indexOf(`REVOKE SELECT ON public.${table} FROM anon, authenticated;`);
      const grant = sql.indexOf(`) ON public.${table} TO anon, authenticated;`);
      expect(revoke, `${table} table-level revoke`).toBeGreaterThan(-1);
      expect(grant, `${table} column grant`).toBeGreaterThan(revoke);
    });
  });

  it('covers exactly the guarded tables and never grants a hidden column', () => {
    expect(Object.keys(lists).sort()).toEqual(Object.keys(HIDDEN).sort());
    Object.entries(HIDDEN).forEach(([table, hidden]) => {
      hidden.forEach((column) => expect(lists[table], `${table}.${column}`).not.toContain(column));
    });
  });

  it('grants every column the public queries touch (PUBLIC_READABLE_COLUMNS) except combo_items, which keeps its table grant', () => {
    Object.entries(PUBLIC_READABLE_COLUMNS)
      .filter(([table]) => table !== 'combo_items')
      .forEach(([table, columns]) => {
        columns.forEach((column) => expect(lists[table], `${table}.${column}`).toContain(column));
      });
  });

  it('closes the dead view and the unused table', () => {
    expect(sql).toContain('REVOKE SELECT ON public.order_analytics FROM anon, authenticated;');
    expect(sql).toContain('REVOKE SELECT ON public.remittance_services FROM anon, authenticated;');
  });

  it('the rollback restores the table-level grants', () => {
    const down = read(ROLLBACK_B);
    Object.keys(HIDDEN).forEach((table) => {
      expect(down).toContain(`GRANT SELECT ON public.${table} TO anon, authenticated;`);
    });
  });
});

describe('migration A', () => {
  const sql = read(MIGRATION_A);

  it('is marked prepared / not applied and has its rollback file', () => {
    expect(sql).toMatch(/PREPARED, NOT APPLIED/);
    expect(existsSync(resolve(ROOT, ROLLBACK_A))).toBe(true);
  });

  it('every function follows the SECURITY DEFINER template', () => {
    const functions = [...sql.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)\(([\s\S]*?)\$fn\$;/g)];
    expect(functions.length).toBe(5);
    functions.forEach(([block, name]) => {
      expect(block, name).toContain('SECURITY DEFINER');
      expect(block, name).toContain('SET search_path = public, pg_temp');
      expect(block, name).toContain('STABLE');
      expect(block, name).toMatch(/auth\.uid\(\) IS NULL OR NOT \(public\.is_admin_user\(\) OR public\.is_super_admin\(\)\)/);
      expect(sql, name).toContain(`REVOKE ALL ON FUNCTION public.${name}(integer, integer, uuid[]) FROM PUBLIC, anon, authenticated, service_role;`);
      expect(sql, name).toContain(`GRANT EXECUTE ON FUNCTION public.${name}(integer, integer, uuid[]) TO authenticated;`);
    });
  });

  it('does not touch tables, policies or the contract (no REVOKE/GRANT on a table)', () => {
    expect(sql).not.toMatch(/(REVOKE|GRANT)\s+(ALL|SELECT|INSERT|UPDATE|DELETE)[^;]*\bON\s+(TABLE\s+)?public\.(products|combo_products|product_categories|inventory|shipping_zones)\b/i);
    expect(sql).not.toMatch(/CREATE POLICY|ALTER TABLE|DROP POLICY/i);
  });
});

describe('no migration re-opens a table-wide SELECT on the guarded tables', () => {
  // Historical grants, written before Phase 0b; the contract file supersedes them.
  const HISTORICAL = new Set([
    '20251007_orders_payment_system.sql',
    '20260210000001_security_hardening.sql'
  ]);
  const TABLE_WIDE = /grant\s+(all|select)[^;]*\bon\s+(table\s+)?(public\.)?(products|combo_products|product_categories|inventory|shipping_zones|remittance_services|order_analytics)\b/i;

  it('only the historical migrations contain one', () => {
    const offenders = readdirSync(resolve(ROOT, 'supabase/migrations'))
      .filter((name) => name.endsWith('.sql') && !HISTORICAL.has(name))
      .filter((name) => TABLE_WIDE.test(readFileSync(resolve(ROOT, 'supabase/migrations', name), 'utf8')));
    expect(offenders).toEqual([]);
  });
});
