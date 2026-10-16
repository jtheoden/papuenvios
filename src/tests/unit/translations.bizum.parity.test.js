import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/supabase', () => ({ supabase: { rpc: vi.fn(), from: vi.fn() } }));

import ES from '@/translations/ES.json';
import EN from '@/translations/EN.json';
import { BIZUM_SETTING_FIELDS } from '@/lib/bizumService';
import { BIZUM_ERROR_I18N_KEYS } from '@/lib/bizumErrors';

const flatten = (node, prefix = '') =>
  Object.entries(node).flatMap(([key, value]) =>
    value && typeof value === 'object' && !Array.isArray(value) ? flatten(value, `${prefix}${key}.`) : [`${prefix}${key}`]
  );
const lookup = (dict, path) => path.split('.').reduce((acc, k) => (acc ? acc[k] : undefined), dict);
const holders = (s) => (s.match(/\{[a-zA-Z]+\}/g) ?? []).sort();

describe.each(['bizum', 'fxRate'])('settings.%s translation namespace', (ns) => {
  it('exists in both languages with exactly the same keys', () => {
    expect(ES.settings[ns]).toBeTypeOf('object');
    expect(EN.settings[ns]).toBeTypeOf('object');
    expect(flatten(ES.settings[ns]).sort()).toEqual(flatten(EN.settings[ns]).sort());
  });

  it('has no empty strings and keeps the same placeholders', () => {
    for (const path of flatten(ES.settings[ns])) {
      const es = lookup(ES.settings[ns], path);
      const en = lookup(EN.settings[ns], path);
      expect(es.trim().length, `ES ${path}`).toBeGreaterThan(0);
      expect(en.trim().length, `EN ${path}`).toBeGreaterThan(0);
      expect(holders(es), path).toEqual(holders(en));
    }
  });
});

describe('keys used by the Bizum components', () => {
  it('defines label, help and unit for every setting field', () => {
    expect(BIZUM_SETTING_FIELDS.length).toBe(13);
    for (const { key, unit } of BIZUM_SETTING_FIELDS) {
      for (const dict of [ES, EN]) {
        expect(lookup(dict, `settings.bizum.fields.${key}.label`), key).toBeTypeOf('string');
        expect(lookup(dict, `settings.bizum.fields.${key}.help`), key).toBeTypeOf('string');
        expect(lookup(dict, `settings.bizum.units.${unit}`), unit).toBeTypeOf('string');
      }
    }
  });

  it('defines every error key of the token map', () => {
    expect(BIZUM_ERROR_I18N_KEYS.length).toBeGreaterThan(0);
    for (const key of BIZUM_ERROR_I18N_KEYS) {
      expect(lookup(ES, key), `ES ${key}`).toBeTypeOf('string');
      expect(lookup(EN, key), `EN ${key}`).toBeTypeOf('string');
    }
  });

  it('defines every literal settings.bizum.* / settings.fxRate.* key referenced in the new components', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const files = [
      'src/components/settings/SettingsBizumSection.jsx',
      'src/components/settings/PaymentFxRateCard.jsx',
      'src/components/settings/BizumSettingsCard.jsx',
      'src/components/settings/BizumAccountsTable.jsx',
      'src/components/settings/BizumDialog.jsx',
      'src/components/settings/BizumErrorBoundary.jsx'
    ];
    const used = new Set();
    for (const file of files) {
      const source = readFileSync(resolve(process.cwd(), file), 'utf8');
      for (const m of source.matchAll(/['"`](settings\.(?:bizum|fxRate)\.[A-Za-z0-9_.]+)['"`]/g)) used.add(m[1]);
    }
    expect(used.size).toBeGreaterThan(15);
    for (const key of used) {
      expect(lookup(ES, key), `ES ${key}`).toBeTypeOf('string');
      expect(lookup(EN, key), `EN ${key}`).toBeTypeOf('string');
    }
  });
});
