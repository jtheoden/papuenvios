import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/lib/supabase', () => ({ supabase: {} }));

import { applyVisualSettingsToDOM } from '@/lib/businessVisualSettingsService';

// Spec (S2, ND-5): the brand ivory belongs to the Home only. applyVisualSettingsToDOM must never strip the
// stylesheet gradient of the body (index.css), whatever pageBgColor is, so admin and the other pages keep
// their look when the preset is applied. The Home root paints pageBgColor itself (see HomePage.hero.test.jsx).

describe('applyVisualSettingsToDOM leaves the body gradient alone', () => {
  beforeEach(() => {
    document.body.removeAttribute('style');
  });

  it.each(['#f9fafb', '#FAF7F0', undefined, 'red'])('pageBgColor %s does not set or remove background-image', (pageBgColor) => {
    applyVisualSettingsToDOM({ pageBgColor });
    expect(document.body.style.backgroundImage).toBe('');
  });
});
