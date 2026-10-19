import { describe, it, expect } from 'vitest';
import ES from '@/translations/ES.json';
import EN from '@/translations/EN.json';

const KEYS = [
  'searchProducts',
  'searchProductsPlaceholder',
  'clearSearch',
  'selectedProducts',
  'removeProduct',
  'onlySelected',
  'resultsCount',
  'noProductResults',
  'quantity'
];

const placeholders = (text) => (text.match(/\{\w+\}/g) || []).sort();

describe('vendor.combos product search translations', () => {
  it.each(KEYS)('%s exists in ES and EN as a non-empty string', (key) => {
    [ES, EN].forEach((lang) => {
      const value = lang.vendor.combos[key];
      expect(typeof value).toBe('string');
      expect(value.trim()).not.toBe('');
    });
  });

  it('keeps the same {placeholders} in both languages', () => {
    KEYS.forEach((key) => {
      expect(placeholders(ES.vendor.combos[key])).toEqual(placeholders(EN.vendor.combos[key]));
    });
  });

  it('keeps the whole vendor.combos key set identical in ES and EN', () => {
    expect(Object.keys(ES.vendor.combos).sort()).toEqual(Object.keys(EN.vendor.combos).sort());
  });
});
