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

  it('backs up flags, nullable contact_type, and whether each account was migrated; restricts backup access', () => {
    const sql = body(readSql('up'));
    expect(sql).toMatch(/contact_type text(?: NULL)?[,\s]/i);
    expect(sql).toMatch(/was_migrated boolean NOT NULL/i);
    expect(sql).toContain(`ALTER TABLE ${backup} ENABLE ROW LEVEL SECURITY;`);
    expect(sql).toContain(`REVOKE ALL ON TABLE ${backup} FROM PUBLIC, anon, authenticated;`);
    expect(sql).toContain(`GRANT ALL ON TABLE ${backup} TO service_role;`);
    expect(sql).toMatch(/ON CONFLICT \(account_id\) DO NOTHING\s+RETURNING account_id, was_migrated/);
  });

  it('only updates freshly backed-up usable-phone accounts, with drifted contact_type behind dynamic SQL', () => {
    const sql = body(readSql('up'));
    expect(sql).toMatch(/information_schema\.columns[\s\S]*column_name = 'contact_type'[\s\S]*THEN\s+EXECUTE/);
    expect(sql).toMatch(/regexp_replace\(phone, '\[\[:space:\] \]', '', 'g'\) ~ '\\d'/);
    expect(sql).toMatch(/SET show_email = false, show_phone = true, contact_type = 'phone'/);
    expect(sql).toMatch(/WHERE[\s\S]*was_migrated/);
    expect(sql).not.toMatch(/DELETE|DROP|CREATE (?:OR REPLACE )?FUNCTION/i);
    expect(sql).not.toMatch(/SET (?:email|phone)\s*=/i);
  });

  it('guards missing backup and restores only still-matching migrated rows before dropping it', () => {
    const sql = body(readSql('down'));
    expect(sql).toContain(`to_regclass('${backup}') IS NULL`);
    expect(sql).toMatch(/RAISE EXCEPTION '[^']*backup[^']*missing[^']*'/i);
    expect(sql).toMatch(/information_schema\.columns[\s\S]*column_name = 'contact_type'[\s\S]*THEN\s+EXECUTE/);
    expect(sql).toContain('contact_type = backup.contact_type');
    expect(sql).toContain('backup.was_migrated');
    expect(sql).toContain("za.contact_type = 'phone'");
    expect(sql).toMatch(/za\.show_email = false AND za\.show_phone = true/);
    expect(sql).toContain(`DROP TABLE ${backup};`);
    expect(sql.indexOf('RAISE EXCEPTION')).toBeLessThan(sql.indexOf('UPDATE public.zelle_accounts'));
    expect(sql.indexOf('UPDATE public.zelle_accounts')).toBeLessThan(sql.indexOf('DROP TABLE'));
  });
});
