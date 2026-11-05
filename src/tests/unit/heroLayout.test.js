import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/supabase', () => ({ supabase: {} }));

import { resolveHeroLayout, HERO_LAYOUTS, DEFAULT_HERO_LAYOUT } from '@/lib/heroLayout';
import { DEFAULT_VISUAL_SETTINGS } from '@/lib/businessVisualSettingsService';
import { BRAND_PRESET } from '@/lib/brandPalette';

// Spec (hero layout S1): a closed enumeration. Anything that is not exactly 'classic' or 'spaced' resolves to
// 'spaced' (what production shows today), and the stored value is never echoed back.
describe('resolveHeroLayout', () => {
  it('is a closed enumeration whose default is spaced', () => {
    expect(HERO_LAYOUTS).toEqual(['classic', 'spaced']);
    expect(DEFAULT_HERO_LAYOUT).toBe('spaced');
  });

  it.each(['classic', 'spaced'])('accepts %s', (layout) => {
    expect(resolveHeroLayout({ heroLayout: layout })).toBe(layout);
  });

  it.each([
    ['missing key', {}],
    ['undefined', { heroLayout: undefined }],
    ['null', { heroLayout: null }],
    ['number', { heroLayout: 1 }],
    ['boolean', { heroLayout: true }],
    ['object with toString', { heroLayout: { toString: () => 'classic' } }],
    ['array', { heroLayout: ['classic'] }],
    ['empty string', { heroLayout: '' }],
    ['uppercase', { heroLayout: 'SPACED' }],
    ['padded', { heroLayout: ' classic ' }],
    ['markup', { heroLayout: '<script>alert(1)</script>' }],
    ['prototype key', { heroLayout: '__proto__' }],
  ])('falls back to spaced for %s', (_label, settings) => {
    expect(resolveHeroLayout(settings)).toBe('spaced');
  });

  it('survives a missing or non-object settings value', () => {
    expect(resolveHeroLayout()).toBe('spaced');
    expect(resolveHeroLayout(null)).toBe('spaced');
    expect(resolveHeroLayout('classic')).toBe('spaced');
  });
});

describe('heroLayout in the visual settings', () => {
  it('is a default of the settings, so every merged row carries it', () => {
    expect(DEFAULT_VISUAL_SETTINGS.heroLayout).toBe('spaced');
  });

  it('is not part of the brand preset: applying the palette must not touch it', () => {
    expect(BRAND_PRESET).not.toHaveProperty('heroLayout');
  });
});
