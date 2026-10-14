import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ES from '@/translations/ES.json';
import EN from '@/translations/EN.json';

const flatten = (node, prefix = '') =>
  Object.entries(node).flatMap(([key, value]) =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? flatten(value, `${prefix}${key}.`)
      : [`${prefix}${key}`]
  );

const lookup = (dict, path) => path.split('.').reduce((acc, k) => (acc ? acc[k] : undefined), dict);

const SOURCES = [
  'src/components/settings/PaymentMethodsStatusCard.jsx',
  'src/components/PaymentMethodsUnavailable.jsx',
  'src/components/CartPage.jsx',
  'src/components/SendRemittancePage.jsx',
  'src/components/SettingsPage.jsx',
];

describe('paymentMethods translation namespace', () => {
  it('exists in both languages', () => {
    expect(ES.paymentMethods).toBeTypeOf('object');
    expect(EN.paymentMethods).toBeTypeOf('object');
  });

  it('has exactly the same keys in ES and EN (no known gaps)', () => {
    const es = flatten(ES.paymentMethods).sort();
    const en = flatten(EN.paymentMethods).sort();
    expect(es).toEqual(en);
  });

  it('has no empty strings and keeps the same {placeholders} in both languages', () => {
    for (const path of flatten(ES.paymentMethods)) {
      const es = lookup(ES.paymentMethods, path);
      const en = lookup(EN.paymentMethods, path);
      expect(es.trim().length, `ES ${path}`).toBeGreaterThan(0);
      expect(en.trim().length, `EN ${path}`).toBeGreaterThan(0);
      const holders = (s) => (s.match(/\{[a-zA-Z]+\}/g) ?? []).sort();
      expect(holders(es), path).toEqual(holders(en));
    }
  });

  it('defines every paymentMethods.* key referenced by the components', () => {
    const used = new Set();
    for (const file of SOURCES) {
      let source;
      try {
        source = readFileSync(resolve(process.cwd(), file), 'utf8');
      } catch {
        continue;
      }
      for (const match of source.matchAll(/['"`](paymentMethods\.[A-Za-z0-9_.]+)['"`]/g)) {
        used.add(match[1]);
      }
    }
    expect(used.size).toBeGreaterThan(0);
    for (const key of used) {
      const path = key.replace(/^paymentMethods\./, '');
      expect(lookup(ES.paymentMethods, path), `ES ${key}`).toBeTypeOf('string');
      expect(lookup(EN.paymentMethods, path), `EN ${key}`).toBeTypeOf('string');
    }
  });
});
