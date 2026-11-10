import { describe, it, expect } from 'vitest';
import ES from '@/translations/ES.json';
import EN from '@/translations/EN.json';

const KEYS = ['viewPricesIn', 'listPricesCue', 'priceCurrencyLabel', 'priceCurrencyHelp', 'priceConvertedNote', 'priceRateMissing', 'priceConverting'];
const holders = (s) => (s.match(/\{[a-zA-Z]+\}/g) ?? []).sort();

describe('vendor.inventory currency clarity translations', () => {
  it.each(KEYS)('%s exists in ES and EN with the same placeholders', (key) => {
    const es = ES.vendor.inventory[key];
    const en = EN.vendor.inventory[key];
    expect(es?.trim().length).toBeGreaterThan(0);
    expect(en?.trim().length).toBeGreaterThan(0);
    expect(holders(es)).toEqual(holders(en));
  });
});
