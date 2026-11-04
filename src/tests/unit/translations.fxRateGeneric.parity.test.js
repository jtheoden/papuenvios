import { describe, it, expect } from 'vitest';
import ES from '@/translations/ES.json';
import EN from '@/translations/EN.json';

const STATES = ['none', 'ok', 'warn', 'blocked'];
const KEYS = [
  'title', 'intro', 'noneHelp', 'warnHelp', 'blockedHelp', 'ageNote', 'loadError', 'retry', 'managedCentrally',
  'labels.rate',
  ...STATES.map((s) => `state.${s}`),
  ...STATES.map((s) => `badge.${s}`)
];

const lookup = (dict, path) => path.split('.').reduce((node, part) => node?.[part], dict);
const placeholders = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('settings.fxRate.generic (rate card for any pair)', () => {
  it.each(KEYS)('%s exists in ES and EN with the same placeholders', (key) => {
    const es = lookup(ES.settings.fxRate.generic, key);
    const en = lookup(EN.settings.fxRate.generic, key);
    expect(es, `ES ${key}`).toBeTypeOf('string');
    expect(en, `EN ${key}`).toBeTypeOf('string');
    expect(placeholders(es)).toEqual(placeholders(en));
  });

  it('has no extra keys on either side', () => {
    const flat = (node, prefix = '') =>
      Object.entries(node).flatMap(([k, v]) => (typeof v === 'object' ? flat(v, `${prefix}${k}.`) : [`${prefix}${k}`]));
    expect(flat(ES.settings.fxRate.generic).sort()).toEqual([...KEYS].sort());
    expect(flat(EN.settings.fxRate.generic).sort()).toEqual([...KEYS].sort());
  });

  it('Spanish copy addresses the user as "usted" (no voseo, no informal imperative)', () => {
    const text = JSON.stringify(ES.settings.fxRate.generic);
    expect(text).not.toMatch(/\b(cargá|actualizá|reintentá|tenés|podés|cárgala|actualízala|reintenta|comprueba)\b/i);
  });
});
