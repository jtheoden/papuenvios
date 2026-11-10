import { describe, it, expect } from 'vitest';
import ES from '@/translations/ES.json';
import EN from '@/translations/EN.json';

const flatten = (node, prefix = '') =>
  Object.entries(node).flatMap(([key, value]) =>
    value && typeof value === 'object' && !Array.isArray(value) ? flatten(value, `${prefix}${key}.`) : [`${prefix}${key}`]
  );
const lookup = (dict, path) => path.split('.').reduce((acc, k) => (acc ? acc[k] : undefined), dict);

const REQUIRED = [
  'undoPreset',
  'theme.title', 'theme.hint', 'theme.classic.name', 'theme.classic.description',
  'theme.papuenvios.name', 'theme.papuenvios.description',
  'theme.inUse', 'theme.changes', 'theme.restricted', 'theme.pending', 'theme.customized',
  'reset.title', 'reset.description', 'reset.confirm', 'reset.cancel', 'reset.error',
  'sectionTitle', 'sectionHint',
  'cartBadgeBg', 'cartBadgeText', 'carouselDotActive', 'border', 'mutedText', 'softAccent', 'focusRing',
  'contrastWarning',
  'pair.header', 'pair.navActive', 'pair.menuActive', 'pair.tab', 'pair.button', 'pair.cartBadge',
  'pair.footerText', 'pair.footerLink', 'pair.footerLinkHover', 'pair.footerBrand',
];

describe('settings.visual.brand translations', () => {
  it('exists in both languages with exactly the same keys', () => {
    expect(ES.settings.visual.brand).toBeTypeOf('object');
    expect(flatten(ES.settings.visual.brand).sort()).toEqual(flatten(EN.settings.visual.brand).sort());
  });

  it('defines every key the component uses, non-empty', () => {
    for (const key of REQUIRED) {
      for (const dict of [ES, EN]) {
        const value = lookup(dict.settings.visual.brand, key);
        expect(value, key).toBeTypeOf('string');
        expect(value.trim().length, key).toBeGreaterThan(0);
      }
    }
  });

  it('uses "usted" register in Spanish (no tuteo)', () => {
    const tuteo = /\b(puedes|tienes|elige|elegiste|haz|usa|tu|tus|ten)\b/i;
    for (const key of flatten(ES.settings.visual.brand)) {
      expect(lookup(ES.settings.visual.brand, key), key).not.toMatch(tuteo);
    }
  });
});
