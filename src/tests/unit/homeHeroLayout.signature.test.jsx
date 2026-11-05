import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import fs from 'node:fs';
import path from 'node:path';
import ES from '@/translations/ES.json';
import { PRESET, layoutSignature } from './homeTestKit';

// Spec (hero layout S2/S3): the structure of [data-testid=home-hero] is pinned by a fixture, like
// homeProdColorSignature.json pins the colours. The first `spaced` entry was generated from main's HomePage before
// the hero was extracted into HomeHero (S2, no visual change: the extraction commit passed against it). S3 then
// regenerated `spaced` once, on purpose, for the agreed improvements (shared width, card frame, caption, arrows,
// gap-6 md:gap-8) and added `classic`. Do not regenerate either to make a test pass.

const FIXTURE = path.resolve(__dirname, '__fixtures__/homeHeroLayoutSignature.json');

const state = vi.hoisted(() => ({ settings: {} }));

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
vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} });

import HomePage from '@/components/HomePage';

const withoutHeroLayout = (settings) => {
  const { heroLayout: _dropped, ...rest } = settings;
  return rest;
};

const heroSignature = async (settings) => {
  state.settings = settings;
  const { unmount } = render(<HomePage onNavigate={vi.fn()} />);
  await screen.findByTestId('hero-carousel');
  const signature = layoutSignature(screen.getByTestId('home-hero'));
  unmount();
  return signature;
};

const fixture = () => JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));

describe('hero structure signature', () => {
  it('the row stored in production (brand preset, no heroLayout key) keeps exactly the structure of today', async () => {
    expect(await heroSignature(withoutHeroLayout(PRESET))).toEqual(fixture().spaced);
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
