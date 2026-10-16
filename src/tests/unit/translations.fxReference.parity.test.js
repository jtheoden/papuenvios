import { describe, it, expect } from 'vitest';
import ES from '@/translations/ES.json';
import EN from '@/translations/EN.json';

const flatten = (obj, prefix = '') =>
  Object.entries(obj).flatMap(([key, value]) =>
    value && typeof value === 'object' ? flatten(value, `${prefix}${key}.`) : [`${prefix}${key}`]
  );
const leaves = (obj, prefix = '') =>
  Object.entries(obj).flatMap(([key, value]) =>
    value && typeof value === 'object' ? leaves(value, `${prefix}${key}.`) : [[`${prefix}${key}`, value]]
  );

const REQUIRED = [
  'title', 'check', 'refresh', 'retry', 'idle', 'loading', 'source', 'providerUpdated', 'providerDate',
  'providerUnknown', 'fetchedAt', 'age', 'value', 'use', 'useHint', 'staleTitle', 'stale', 'staleUnknown',
  'refreshFailed', 'missingCurrencies', 'error.network', 'error.timeout', 'error.invalid_payload', 'error.out_of_band'
];

describe('settings.fxReference translations', () => {
  it('exist in both languages with identical keys', () => {
    expect(ES.settings.fxReference).toBeDefined();
    expect(EN.settings.fxReference).toBeDefined();
    expect(flatten(ES.settings.fxReference).sort()).toEqual(flatten(EN.settings.fxReference).sort());
  });

  it('contain every key the UI needs, with non-empty strings', () => {
    const keys = flatten(EN.settings.fxReference);
    REQUIRED.forEach((key) => expect(keys).toContain(key));
    [...leaves(ES.settings.fxReference), ...leaves(EN.settings.fxReference)].forEach(([, value]) => {
      expect(typeof value).toBe('string');
      expect(value.trim()).not.toBe('');
    });
  });

  it('keep the same {placeholders} in both languages', () => {
    const placeholders = (text) => (text.match(/\{\w+\}/g) || []).sort();
    const en = Object.fromEntries(leaves(EN.settings.fxReference));
    const es = Object.fromEntries(leaves(ES.settings.fxReference));
    Object.keys(en).forEach((key) => expect(placeholders(es[key])).toEqual(placeholders(en[key])));
  });

  it('always label the value as 1 USD = X EUR and not the operative rate', () => {
    expect(EN.settings.fxReference.value).toContain('1 USD = {rate} EUR');
    expect(EN.settings.fxReference.value).toContain('not the operative rate');
    expect(ES.settings.fxReference.value).toContain('1 USD = {rate} EUR');
    expect(ES.settings.fxReference.value).toContain('no es la tasa operativa');
  });
});
