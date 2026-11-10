import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (path) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('legacy "official rates" code is gone', () => {
  it('SettingsPage no longer carries the dead loadOfficialRates handler', () => {
    const page = read('src/components/SettingsPage.jsx');
    expect(page).not.toMatch(/loadOfficialRates|fetchOfficialRates|setOfficialRates|setLoadingRates\b/);
  });

  it('the only external rate fetch lives in fxReference (fixed host, validated, not persisted)', () => {
    expect(read('src/lib/currencyService.js')).not.toMatch(/fetchOfficialRates|exchangerate-api\.com/);
    expect(read('src/components/settings/SettingsPageFinancial.jsx')).not.toMatch(/fetchOfficialRates|exchangerate-api/);
  });

  it('the obsolete "official rates" labels are removed from both languages', () => {
    for (const file of ['ES', 'EN']) {
      const financial = JSON.parse(read(`src/translations/${file}.json`)).settings.financial;
      expect(financial.loadOfficialRates).toBeUndefined();
      expect(financial.officialRatesReference).toBeUndefined();
    }
  });
});
