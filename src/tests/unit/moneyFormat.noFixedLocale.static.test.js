import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// RB-17 R2: the app language decides the locale of money. These screens used a fixed 'en-US'.
const FILES = [
  'src/components/settings/SettingsZelleTab.jsx',
  'src/components/AdminOrdersTab.jsx',
  'src/components/admin/ZellePaymentHistoryTab.jsx',
  'src/components/AdminRemittancesTab.jsx'
];

describe('money is formatted with the app language, not a fixed locale', () => {
  it.each(FILES)('%s has no fixed en-US number format and uses formatMoney', (file) => {
    const source = readFileSync(join(process.cwd(), file), 'utf8');
    expect(source).not.toMatch(/NumberFormat\(\s*['"]en-US['"]/);
    expect(source).not.toMatch(/toLocaleString\(\s*['"]en-US['"]/);
    expect(source).toMatch(/formatMoney/);
  });
});
