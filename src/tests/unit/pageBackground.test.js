import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/lib/supabase', () => ({ supabase: {} }));

import { applyVisualSettingsToDOM } from '@/lib/businessVisualSettingsService';

// Spec (S2, ND-5, updated by T0): applyVisualSettingsToDOM never touches the body's background-image, whatever
// pageBgColor is. Which look shows the stylesheet gradient is decided in index.css by data-theme (classic only;
// themeCompliance.test.js and theme-tokens.spec.js cover it). The Home root paints pageBgColor itself (HomePage.hero.test.jsx).

describe('applyVisualSettingsToDOM leaves the body gradient alone', () => {
  beforeEach(() => {
    document.body.removeAttribute('style');
  });

  it.each(['#f9fafb', '#FAF7F0', undefined, 'red'])('pageBgColor %s does not set or remove background-image', (pageBgColor) => {
    applyVisualSettingsToDOM({ pageBgColor });
    expect(document.body.style.backgroundImage).toBe('');
  });
});
