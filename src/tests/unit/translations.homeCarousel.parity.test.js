import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import ES from '@/translations/ES.json';
import EN from '@/translations/EN.json';

const flatten = (obj, prefix = '') =>
  Object.entries(obj).flatMap(([k, v]) => (v && typeof v === 'object' ? flatten(v, `${prefix}${k}.`) : [[`${prefix}${k}`, v]]));

const CAROUSEL_KEYS = ['label', 'roleDescription', 'slide', 'slideOf', 'previous', 'next', 'pause', 'play', 'goTo'];

describe('home.hero.* and home.carousel.* translations', () => {
  it('have the same keys in ES and EN, all non-empty', () => {
    for (const ns of ['hero', 'carousel']) {
      const es = flatten(ES.home[ns] || {});
      const en = flatten(EN.home[ns] || {});
      expect(es.length).toBeGreaterThan(0);
      expect(es.map(([k]) => k).sort()).toEqual(en.map(([k]) => k).sort());
      for (const [, value] of [...es, ...en]) expect(String(value).trim()).not.toBe('');
    }
  });

  it.each(CAROUSEL_KEYS)('defines home.carousel.%s', (key) => {
    expect(ES.home.carousel?.[key]?.trim()).toBeTruthy();
    expect(EN.home.carousel?.[key]?.trim()).toBeTruthy();
  });

  it('goTo interpolates {count} (single braces, as the rest of the app)', () => {
    expect(ES.home.carousel?.goTo).toContain('{count}');
    expect(EN.home.carousel?.goTo).toContain('{count}');
  });
});

describe('index.css reduced motion (WCAG 2.3.3 / 2.2.2)', () => {
  const css = fs.readFileSync(path.resolve(__dirname, '../../index.css'), 'utf8');
  const block = css.match(/@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';

  it('has a prefers-reduced-motion block that calms the spinner, hover-lift and shimmer', () => {
    expect(block).toMatch(/\.loading-spinner/);
    expect(block).toMatch(/\.hover-lift/);
    expect(block).toMatch(/\.shimmer/);
  });
});
