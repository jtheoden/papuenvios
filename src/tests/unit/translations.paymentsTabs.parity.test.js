import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ES from '@/translations/ES.json';
import EN from '@/translations/EN.json';

const flatten = (obj, prefix = '') =>
  Object.entries(obj).flatMap(([key, value]) =>
    value && typeof value === 'object' ? flatten(value, `${prefix}${key}.`) : [`${prefix}${key}`]
  );

const REQUIRED = ['label', 'zelle', 'bizum'];

describe('settings.payments.tabs translations', () => {
  it('exist in both languages with identical keys', () => {
    expect(ES.settings.payments?.tabs).toBeDefined();
    expect(EN.settings.payments?.tabs).toBeDefined();
    expect(flatten(ES.settings.payments.tabs).sort()).toEqual(flatten(EN.settings.payments.tabs).sort());
  });

  it('contain every key the UI needs, with non-empty strings', () => {
    REQUIRED.forEach((key) => {
      expect(EN.settings.payments.tabs[key]?.trim()).toBeTruthy();
      expect(ES.settings.payments.tabs[key]?.trim()).toBeTruthy();
    });
  });

  it('keep the method names untranslated', () => {
    expect(EN.settings.payments.tabs.zelle).toBe('Zelle');
    expect(ES.settings.payments.tabs.zelle).toBe('Zelle');
    expect(EN.settings.payments.tabs.bizum).toBe('Bizum');
    expect(ES.settings.payments.tabs.bizum).toBe('Bizum');
  });
});

describe('PaymentsTabs is mobile friendly (400 px)', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/components/settings/PaymentsTabs.jsx'), 'utf8');

  it('wraps instead of overflowing and uses no fixed pixel widths', () => {
    expect(source).toContain('flex-wrap');
    expect(source).not.toMatch(/\b(?:min-w|max-w|w)-\[\d+px\]/);
    expect(source).not.toMatch(/whitespace-nowrap|overflow-x-/);
  });

  it('keeps 44 px touch targets', () => {
    expect(source).toContain('min-h-[44px]');
  });
});
