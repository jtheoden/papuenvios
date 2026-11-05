import { describe, it, expect, beforeEach, vi } from 'vitest';
vi.mock('@/lib/supabase', () => ({ supabase: {} }));

import { applyVisualSettingsToDOM } from '@/lib/businessVisualSettingsService';

// Spec (S2): index.css paints the body with a blue gradient (background-image), which hides pageBgColor.
// Production keeps pageBgColor '#f9fafb' (the code default), so that value must keep the gradient;
// any other valid colour (the brand ivory from the preset) must actually be visible.

const body = () => document.body.style;

describe('applyVisualSettingsToDOM page background', () => {
  beforeEach(() => {
    document.body.removeAttribute('style');
  });

  it('keeps the stylesheet gradient for the production value (#f9fafb, any case)', () => {
    applyVisualSettingsToDOM({ pageBgColor: '#f9fafb' });
    expect(body().backgroundImage).toBe('');
    expect(body().backgroundColor).toBe('rgb(249, 250, 251)');
    applyVisualSettingsToDOM({ pageBgColor: '#F9FAFB' });
    expect(body().backgroundImage).toBe('');
  });

  it('removes the gradient when the colour is not the legacy default (brand ivory)', () => {
    applyVisualSettingsToDOM({ pageBgColor: '#FAF7F0' });
    expect(body().backgroundImage).toBe('none');
    expect(body().backgroundColor).toBe('rgb(250, 247, 240)');
  });

  it('is reversible: going back to the legacy value restores the gradient', () => {
    applyVisualSettingsToDOM({ pageBgColor: '#FAF7F0' });
    applyVisualSettingsToDOM({ pageBgColor: '#f9fafb' });
    expect(body().backgroundImage).toBe('');
  });

  it('keeps the gradient when the value is missing or not a HEX colour', () => {
    for (const pageBgColor of [undefined, '', 'red', 'url(javascript:1)']) {
      document.body.removeAttribute('style');
      applyVisualSettingsToDOM({ pageBgColor });
      expect(body().backgroundImage).toBe('');
    }
  });
});
