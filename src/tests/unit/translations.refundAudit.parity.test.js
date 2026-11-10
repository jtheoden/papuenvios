import { describe, it, expect } from 'vitest';
import ES from '@/translations/ES.json';
import EN from '@/translations/EN.json';

const flatten = (obj, prefix = '') =>
  Object.entries(obj).flatMap(([key, value]) =>
    value && typeof value === 'object' ? flatten(value, `${prefix}${key}.`) : [[`${prefix}${key}`, value]]
  );
const placeholders = (text) => [...String(text).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe.each(['refundAudit', 'myRefund'])('translations parity: %s', (namespace) => {
  const es = Object.fromEntries(flatten(ES[namespace] ?? {}));
  const en = Object.fromEntries(flatten(EN[namespace] ?? {}));

  it('exists in both languages with the same keys', () => {
    expect(Object.keys(es).length).toBeGreaterThan(0);
    expect(Object.keys(es).sort()).toEqual(Object.keys(en).sort());
  });
  it('has no empty strings and the same {placeholders} in both languages', () => {
    for (const key of Object.keys(es)) {
      expect(String(es[key]).trim(), `ES ${key}`).not.toBe('');
      expect(String(en[key]).trim(), `EN ${key}`).not.toBe('');
      expect(placeholders(es[key]), key).toEqual(placeholders(en[key]));
    }
  });
});
