import { describe, it, expect } from 'vitest';
import { contrastRatio } from '@/lib/contrast';

const MIN_TEXT = 4.5;

describe('contrastRatio', () => {
  it('matches the WCAG reference values', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 1);
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
  });

  it('accepts short hex and blends an alpha over the background', () => {
    expect(contrastRatio('#000', '#fff')).toBeCloseTo(21, 1);
    expect(contrastRatio('#000000', '#ffffff', 0.5)).toBeLessThan(contrastRatio('#000000', '#ffffff'));
  });
});

describe('footer default tokens', () => {
  it('keeps the default text readable on white at the copyright alpha', () => {
    expect(contrastRatio('#374151', '#ffffff')).toBeGreaterThanOrEqual(MIN_TEXT);
    expect(contrastRatio('#374151', '#ffffff', 0.8)).toBeGreaterThanOrEqual(MIN_TEXT);
  });

  it('keeps the default link readable on white at full opacity', () => {
    expect(contrastRatio('#2563eb', '#ffffff')).toBeGreaterThanOrEqual(MIN_TEXT);
  });

  it('keeps a dark sample theme readable for text and link separately', () => {
    expect(contrastRatio('#e5e7eb', '#111827')).toBeGreaterThanOrEqual(MIN_TEXT);
    expect(contrastRatio('#93c5fd', '#111827')).toBeGreaterThanOrEqual(MIN_TEXT);
  });
});
