import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const readSql = (direction) => readFileSync(resolve(
  process.cwd(), `supabase/${direction === 'up' ? 'migrations/20261107100000_zelle_accounts_phone_first_visibility.sql' : 'rollbacks/20261107100000_zelle_accounts_phone_first_visibility_down.sql'}`
), 'utf8');
const body = (sql) => sql.replace(/--[^\n]*/g, '');
const backup = 'public.zelle_accounts_visibility_backup_20261107';

describe('prepared Zelle phone-first migration safety (static SQL contract)', () => {
  it.each(['up', 'down'])('%s is prepared-only and transactional with a bounded lock wait', (direction) => {
    const sql = readSql(direction);
    expect(sql).toContain('PREPARED, NOT APPLIED');
    expect(body(sql).trim()).toMatch(/^BEGIN;[\s\S]*COMMIT;$/);
    expect(sql).toContain("SET LOCAL lock_timeout = '5s';");
  });

  it('backs up all original flags before updating and restricts backup access', () => {
    const sql = body(readSql('up'));
    expect(sql).toMatch(/CREATE TABLE (?:IF NOT EXISTS )?public\.zelle_accounts_visibility_backup_20261107\s*\(\s*account_id uuid PRIMARY KEY,\s*show_email boolean NOT NULL,\s*show_phone boolean NOT NULL,\s*backed_up_at timestamptz NOT NULL DEFAULT now\(\)\s*\)/i);
    expect(sql).toContain(`ALTER TABLE ${backup} ENABLE ROW LEVEL SECURITY;`);
    expect(sql).toMatch(/REVOKE ALL ON (?:TABLE )?public\.zelle_accounts_visibility_backup_20261107 FROM PUBLIC, anon, authenticated;/);
    expect(sql).toMatch(/INSERT INTO public\.zelle_accounts_visibility_backup_20261107\s*\(account_id, show_email, show_phone\)\s*SELECT id, show_email, show_phone FROM public\.zelle_accounts\s*ON CONFLICT (?:\(account_id\) )?DO NOTHING;/);
    expect(sql.indexOf('INSERT INTO')).toBeLessThan(sql.indexOf('UPDATE public.zelle_accounts'));
  });

  it('only changes visibility on accounts with a usable phone', () => {
    const sql = body(readSql('up'));
    expect(sql).toMatch(/UPDATE public\.zelle_accounts\s*SET show_email = false, show_phone = true\s*WHERE phone IS NOT NULL AND btrim\(phone\) <> '';/i);
    expect(sql).not.toMatch(/DELETE|DROP|CREATE (?:OR REPLACE )?FUNCTION/i);
    expect(sql.match(/UPDATE /g)).toHaveLength(1);
  });

  it('guards a missing backup and restores flags by id before dropping it', () => {
    const sql = body(readSql('down'));
    expect(sql).toContain(`to_regclass('${backup}') IS NULL`);
    expect(sql).toMatch(/RAISE EXCEPTION '[^']*backup[^']*missing[^']*'/i);
    expect(sql).toMatch(/UPDATE public\.zelle_accounts AS za\s*SET show_email = backup\.show_email, show_phone = backup\.show_phone\s*FROM public\.zelle_accounts_visibility_backup_20261107 AS backup\s*WHERE za\.id = backup\.account_id;/);
    expect(sql).toContain(`DROP TABLE ${backup};`);
    expect(sql.indexOf('RAISE EXCEPTION')).toBeLessThan(sql.indexOf('UPDATE public.zelle_accounts'));
    expect(sql.indexOf('UPDATE public.zelle_accounts')).toBeLessThan(sql.indexOf('DROP TABLE'));
  });
});
