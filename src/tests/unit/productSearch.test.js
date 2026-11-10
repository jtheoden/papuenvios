import { describe, it, expect } from 'vitest';
import { filterProducts, normalizeSearchText } from '@/lib/productSearch';

const products = [
  { id: '1', name_es: 'Azúcar Blanca', name_en: 'White Sugar', sku: 'SUG-001' },
  { id: '2', name_es: 'Piña en almíbar', name_en: 'Pineapple syrup', sku: 'PIN-200' },
  { id: '3', name_es: 'Cañamo Premium', name_en: 'Hemp', sku: 'hmp-9' },
  { id: '4', name_es: 'Aceite', name_en: null, sku: null }
];

describe('normalizeSearchText', () => {
  it('lowercases, strips accents and trims', () => {
    expect(normalizeSearchText('  ÁZúcar ')).toBe('azucar');
  });

  it('returns an empty string for nullish input', () => {
    expect(normalizeSearchText(null)).toBe('');
    expect(normalizeSearchText(undefined)).toBe('');
  });

  it('folds the n tilde', () => {
    expect(normalizeSearchText('Cañamo')).toBe('canamo');
  });
});

describe('filterProducts', () => {
  const ids = (list) => list.map((p) => p.id);

  it('returns every product for an empty or whitespace-only query', () => {
    expect(ids(filterProducts(products, ''))).toEqual(['1', '2', '3', '4']);
    expect(ids(filterProducts(products, '   '))).toEqual(['1', '2', '3', '4']);
    expect(ids(filterProducts(products, undefined))).toEqual(['1', '2', '3', '4']);
  });

  it('ignores case', () => {
    expect(ids(filterProducts(products, 'AZUCAR'))).toEqual(['1']);
  });

  it('ignores accents in both the query and the data', () => {
    expect(ids(filterProducts(products, 'azúcar'))).toEqual(['1']);
    expect(ids(filterProducts(products, 'pina'))).toEqual(['2']);
    expect(ids(filterProducts(products, 'ALMIBAR'))).toEqual(['2']);
  });

  it('handles the n tilde', () => {
    expect(ids(filterProducts(products, 'cañ'))).toEqual(['3']);
    expect(ids(filterProducts(products, 'can'))).toEqual(['3']);
  });

  it('matches name_en', () => {
    expect(ids(filterProducts(products, 'pineapple'))).toEqual(['2']);
  });

  it('matches sku, case-insensitively', () => {
    expect(ids(filterProducts(products, 'sug-0'))).toEqual(['1']);
    expect(ids(filterProducts(products, 'HMP'))).toEqual(['3']);
  });

  it('tolerates null fields and falls back to the legacy name', () => {
    expect(ids(filterProducts(products, 'aceite'))).toEqual(['4']);
    expect(ids(filterProducts([{ id: 'x', name: 'Legacy' }], 'legacy'))).toEqual(['x']);
  });

  it('returns an empty array when nothing matches', () => {
    expect(filterProducts(products, 'zzz')).toEqual([]);
  });

  it('does not mutate the input and returns a new array', () => {
    const input = [...products];
    const snapshot = JSON.stringify(input);
    const out = filterProducts(input, '');
    expect(JSON.stringify(input)).toBe(snapshot);
    expect(out).not.toBe(input);
  });

  it('handles a nullish product list', () => {
    expect(filterProducts(undefined, 'a')).toEqual([]);
  });
});
