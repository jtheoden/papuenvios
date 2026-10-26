import { describe, it, expect } from 'vitest';
import ES from '@/translations/ES.json';
import EN from '@/translations/EN.json';

const sources = import.meta.glob(
  ['/src/components/settings/couriers/*.jsx', '/src/components/admin/DeliveryCourierSelect.jsx', '/src/components/admin/CourierMarginCard.jsx', '/src/lib/courier*.js'],
  { query: '?raw', import: 'default', eager: true }
);

const flatten = (obj, prefix = '') =>
  Object.entries(obj ?? {}).flatMap(([k, v]) => (v && typeof v === 'object' ? flatten(v, `${prefix}${k}.`) : [`${prefix}${k}`]));
const get = (obj, key) => key.split('.').reduce((acc, part) => acc?.[part], obj);
const scope = (tree) => flatten({ couriers: tree.couriers, dashboard: { courierMargin: tree.dashboard?.courierMargin } });

describe('courier translations', () => {
  it('ES and EN define exactly the same keys', () => {
    expect(scope(ES).sort()).toEqual(scope(EN).sort());
    expect(scope(ES).length).toBeGreaterThan(100);
  });

  it('every static key used by the courier screens exists in both languages and is not empty', () => {
    const used = new Set();
    Object.values(sources).forEach((src) => {
      for (const m of src.matchAll(/['"`]((?:couriers|dashboard\.courierMargin)\.[A-Za-z0-9_.]+)['"`]/g)) used.add(m[1]);
    });
    expect(used.size).toBeGreaterThan(50);
    used.forEach((key) => {
      expect(typeof get(ES, key), `ES ${key}`).toBe('string');
      expect(typeof get(EN, key), `EN ${key}`).toBe('string');
      expect(get(ES, key).length, `ES ${key}`).toBeGreaterThan(0);
    });
  });

  it('keeps placeholders identical in both languages', () => {
    scope(ES).forEach((key) => {
      const ph = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
      expect(ph(get(EN, key)), key).toEqual(ph(get(ES, key)));
    });
  });

  it('Spanish uses the formal register (usted), no voseo', () => {
    const voseo = /\b(tenés|podés|ingresá|seleccioná|hacé|querés|completá|revisá|vos)\b/i;
    scope(ES).forEach((key) => expect(get(ES, key), key).not.toMatch(voseo));
  });

  it('defines every dynamic key family (methods, bases, statuses, errors, report columns)', () => {
    ['fixed_cup', 'per_usd_delivered', 'percent_of_base'].forEach((m) => {
      expect(get(ES, `couriers.types.methods.${m}`)).toBeTruthy();
      expect(get(ES, `couriers.types.summary.${m}`)).toBeTruthy();
    });
    ['ok', 'warning', 'critical', 'unknown'].forEach((s) => expect(get(ES, `couriers.margin.${s}`)).toBeTruthy());
    ['critical', 'warning', 'unknown', 'unknownAmount'].forEach((s) => expect(get(ES, `dashboard.courierMargin.${s}`)).toBeTruthy());
    ['order', 'remittance'].forEach((k) => expect(get(ES, `couriers.common.kind.${k}`)).toBeTruthy());
  });
});
