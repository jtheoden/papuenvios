import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const SRC = path.resolve(__dirname, '../..');

// Modules allowed to talk to the zelle_accounts table directly (admin-only surfaces).
const ALLOWED = new Set([
  'lib/zelleService.js', // admin CRUD helpers; customer reads go through the RPC
]);

const walk = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === 'tests' ? [] : walk(full);
    }
    return /\.(js|jsx)$/.test(entry.name) ? [full] : [];
  });

describe('customer-facing code and the zelle_accounts table', () => {
  const files = walk(SRC).map((f) => ({
    rel: path.relative(SRC, f).split(path.sep).join('/'),
    content: fs.readFileSync(f, 'utf8')
  }));

  it('only allow-listed modules call .from(\'zelle_accounts\') or embed zelle_accounts(...)', () => {
    const offenders = files
      .filter(({ rel }) => !ALLOWED.has(rel))
      .filter(({ content }) => /from\(\s*['"`]zelle_accounts['"`]\s*\)/.test(content) || /\bzelle_accounts\s*\(/.test(content))
      .map(({ rel }) => rel);

    expect(offenders).toEqual([]);
  });

  it('does not subscribe to zelle_accounts realtime outside the generic hook definition', () => {
    const offenders = files
      .filter(({ rel }) => rel !== 'hooks/useRealtimeSubscription.js')
      .filter(({ content }) => /table:\s*['"`]zelle_accounts['"`]/.test(content))
      .map(({ rel }) => rel);

    expect(offenders).toEqual([]);
  });

  it('ZelleAccountSelector uses the customer RPC service, not getAllZelleAccounts', () => {
    const selector = files.find(({ rel }) => rel === 'components/ZelleAccountSelector.jsx');
    expect(selector).toBeDefined();
    expect(selector.content).toContain('getZelleAccountsForCustomer');
    expect(selector.content).not.toContain('getAllZelleAccounts');
    expect(selector.content).not.toContain('useRealtimeZelleAccounts');
  });

  it('getAllZelleAccounts is only used by admin screens', () => {
    const adminCallers = new Set([
      'lib/zelleService.js',
      'components/settings/SettingsZelleTab.jsx',
      'components/admin/ZellePaymentHistoryTab.jsx'
    ]);
    const offenders = files
      .filter(({ rel }) => !adminCallers.has(rel))
      .filter(({ content }) => content.includes('getAllZelleAccounts'))
      .map(({ rel }) => rel);

    expect(offenders).toEqual([]);
  });
});
