import { describe, it, expect } from 'vitest';
import ES from '@/translations/ES.json';
import EN from '@/translations/EN.json';

// Sending from Spain (Bizum) is not live yet: public Home and remittance copy must not offer it.
const flatten = (node, prefix = '') =>
  Object.entries(node).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return value && typeof value === 'object' ? flatten(value, path) : [[path, String(value)]];
  });

describe('public Home and remittance copy does not mention Spain', () => {
  it.each([
    ['ES', ES],
    ['EN', EN],
  ])('%s home.* and remittances.* have no España/Spain', (_name, dict) => {
    const hits = flatten({ home: dict.home, remittances: dict.remittances }).filter(([, text]) =>
      /españa|spain/i.test(text)
    );
    expect(hits).toEqual([]);
  });
});
