import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import fs from 'node:fs';
import path from 'node:path';
import ES from '@/translations/ES.json';
import { PRESET, layoutSignature } from './homeTestKit';

// Spec (hero layout S2/S3): the structure of [data-testid=home-hero] is pinned by a fixture, like
// homeProdColorSignature.json pins the colours. The first `spaced` entry was generated from main's HomePage before
// the hero was extracted into HomeHero (S2, no visual change: the extraction commit passed against it). S3 then
// regenerated `spaced` on purpose for the agreed improvements (shared width, card frame, caption, arrows,
// gap-6 md:gap-8), added `classic`, and regenerated all of them once more after the review (44px targets, dot
// touch areas, preloaded frame ratio, empty alt, /60 veil) adding `spacedWide`. The row used is the brand preset
// (what production stores today) without the heroLayout key. Do not regenerate them to make a test pass.

const FIXTURE = path.resolve(__dirname, '__fixtures__/homeHeroLayoutSignature.json');

const state = vi.hoisted(() => ({ settings: {}, wide: false }));

const translate = (key, params = {}) => {
  const value = key.split('.').reduce((acc, k) => (acc ? acc[k] : undefined), ES);
  if (typeof value !== 'string') return key;
  return Object.entries(params).reduce((acc, [k, v]) => acc.replace(`{${k}}`, v), value);
};

vi.mock('@/contexts/LanguageContext', () => ({ useLanguage: () => ({ t: translate, language: 'es' }) }));
vi.mock('@/contexts/BusinessContext', () => ({ useBusiness: () => ({ visualSettings: state.settings }) }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ isAdmin: false }) }));
vi.mock('@/contexts/CurrencyContext', () => ({
  useCurrency: () => ({ currency: 'USD', currencySymbol: '$', formatCurrency: String, convertCurrency: (v) => v }),
}));
vi.mock('@/lib/carouselService', async () => {
  const { SLIDES: slides } = await import('./homeTestKit');
  return { getActiveCarouselSlides: vi.fn(() => Promise.resolve(slides)) };
});
vi.mock('@/lib/publicationService', () => ({ getPublications: vi.fn(() => new Promise(() => {})) }));
vi.mock('@/lib/testimonialService', () => ({ getTestimonials: vi.fn(() => new Promise(() => {})) }));
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => ({ select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }) }),
    rpc: () => Promise.resolve({ data: null, error: true }),
  },
}));
vi.mock('@/hooks/useRealtimeSubscription', () => ({
  useRealtimeSubscription: vi.fn(),
  useRealtimeCarouselSlides: vi.fn(),
}));
// jsdom neither loads images nor evaluates media queries: posters answer at once with the real 3.8:1 size, and
// `wide` decides whether the viewport counts as md (arrows over the poster) or not.
class AnsweringImage {
  set src(value) {
    this.srcValue = value;
    Object.assign(this, { naturalWidth: 1520, naturalHeight: 400 });
    queueMicrotask(() => this.onload?.());
  }
  get src() { return this.srcValue; }
}
vi.stubGlobal('Image', AnsweringImage);
window.matchMedia = (query) => ({
  matches: /min-width:\s*768px/.test(query) && state.wide,
  media: query,
  addEventListener: () => {},
  removeEventListener: () => {},
  addListener: () => {}, // framer-motion still calls the legacy API
  removeListener: () => {},
});
vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} });

import HomePage from '@/components/HomePage';

const withoutHeroLayout = (settings) => {
  const { heroLayout: _dropped, ...rest } = settings;
  return rest;
};

const heroSignature = async (settings, { wide = false } = {}) => {
  state.settings = settings;
  state.wide = wide;
  const { unmount } = render(<HomePage onNavigate={vi.fn()} />);
  await screen.findByTestId('hero-carousel');
  if (!screen.queryByTestId('hero-veil')) await waitFor(() => expect(screen.getByTestId('hero-carousel-frame').getAttribute('data-frame-ready')).toBe('true'));
  const signature = layoutSignature(screen.getByTestId('home-hero'));
  unmount();
  return signature;
};

const fixture = () => JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));

describe('hero structure signature', () => {
  it('the row stored in production (brand preset, no heroLayout key) keeps exactly the structure of today', async () => {
    expect(await heroSignature(withoutHeroLayout(PRESET))).toEqual(fixture().spaced);
  });

  it('spaced at md and above (arrows over the poster) has its own pinned structure', async () => {
    expect(await heroSignature(withoutHeroLayout(PRESET), { wide: true })).toEqual(fixture().spacedWide);
  });

  it('classic keeps its own structure (full-bleed cover with the controls over the image)', async () => {
    expect(await heroSignature({ ...PRESET, heroLayout: 'classic' })).toEqual(fixture().classic);
  });

  it('an explicit spaced, or a value that is not listed, gives the same structure as a missing key', async () => {
    const expected = fixture().spaced;
    for (const heroLayout of ['spaced', 'SPACED', '<script>', null, 7]) {
      expect(await heroSignature({ ...PRESET, heroLayout }), String(heroLayout)).toEqual(expected);
    }
  });
});
