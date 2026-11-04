import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// RB-17: rates are READ through currencyService only. UI components may touch exchange_rates solely in the
// Financial Settings save paths (deactivate-then-insert), which are super_admin-only and already hardened.
const SRC = join(process.cwd(), 'src');
const ALLOWED = new Set([
  'src/lib/currencyService.js',
  'src/components/SettingsPage.jsx',
  'src/components/settings/SettingsPageFinancial.jsx'
]);

const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (name === 'tests') return [];
    return statSync(full).isDirectory() ? walk(full) : [full];
  });

describe('exchange_rates single read source', () => {
  it("only services and the Financial save paths call from('exchange_rates')", () => {
    const offenders = walk(SRC)
      .filter((file) => /\.(js|jsx)$/.test(file))
      .map((file) => relative(process.cwd(), file))
      .filter((file) => /from\(\s*['"]exchange_rates['"]\s*\)/.test(readFileSync(join(process.cwd(), file), 'utf8')))
      .filter((file) => !ALLOWED.has(file));
    expect(offenders).toEqual([]);
  });

  it('the allowed UI files only write (update) exchange_rates, they never read it', () => {
    for (const file of ['src/components/SettingsPage.jsx', 'src/components/settings/SettingsPageFinancial.jsx']) {
      const source = readFileSync(join(process.cwd(), file), 'utf8');
      const uses = [...source.matchAll(/from\(\s*['"]exchange_rates['"]\s*\)\s*\.(\w+)/g)].map((m) => m[1]);
      expect(uses.length, file).toBeGreaterThan(0);
      expect(uses.every((method) => method === 'update' || method === 'insert'), file).toBe(true);
    }
  });
});
