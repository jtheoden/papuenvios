import { describe, it, expect } from 'vitest';
import ES from '@/translations/ES.json';
import EN from '@/translations/EN.json';

const REQUIRED = [
  'badge.ok',
  'badge.warn',
  'badge.blocked',
  'badge.none',
  'labels.source',
  'sourceCentral',
  'goToFinancial',
  'errors.managedCentrally'
];
const lookup = (dict, path) => path.split('.').reduce((acc, k) => (acc ? acc[k] : undefined), dict);

describe('settings.fxRate badge / read-only navigation translations', () => {
  it.each(REQUIRED)('has a non-empty %s in ES and EN', (key) => {
    expect(lookup(ES.settings.fxRate, key)?.trim()).toBeTruthy();
    expect(lookup(EN.settings.fxRate, key)?.trim()).toBeTruthy();
  });

  it('warnHelp interpolates the age in both languages', () => {
    expect(ES.settings.fxRate.warnHelp).toContain('{hours}');
    expect(EN.settings.fxRate.warnHelp).toContain('{hours}');
  });
});
