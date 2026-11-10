import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import ES from '@/translations/ES.json';
import { PROD } from './homeTestKit';

// The features section (title + subtitle + cards) is only rendered when there is at least one card.

const state = vi.hoisted(() => ({ settings: {} }));

const translate = (key) => {
  const value = key.split('.').reduce((acc, k) => (acc ? acc[k] : undefined), ES);
  return typeof value === 'string' ? value : key;
};

vi.mock('@/contexts/LanguageContext', () => ({ useLanguage: () => ({ t: translate, language: 'es' }) }));
vi.mock('@/contexts/BusinessContext', () => ({ useBusiness: () => ({ visualSettings: state.settings }) }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ isAdmin: false }) }));
vi.mock('@/contexts/CurrencyContext', () => ({
  useCurrency: () => ({ currency: 'USD', currencySymbol: '$', formatCurrency: String, convertCurrency: (v) => v }),
}));
vi.mock('@/lib/carouselService', () => ({ getActiveCarouselSlides: vi.fn(() => Promise.resolve([])) }));
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

const mount = async (settings) => {
  state.settings = settings;
  render(<HomePage onNavigate={vi.fn()} />);
  await screen.findByRole('button', { name: ES.home.hero.cta.products });
};

const INACTIVE_FEATURE = {
  id: 'f1', icon: 'ShoppingBag', titleEs: 'X', titleEn: 'X', descriptionEs: 'Y', descriptionEn: 'Y',
  navigateTo: 'products', isActive: false, displayOrder: 1,
};

describe('HomePage features section', () => {
  it('hides the section title when every configured feature is inactive', async () => {
    await mount({ ...PROD, homeFeatures: [INACTIVE_FEATURE] });
    expect(screen.queryByText(ES.home.features.title)).toBeNull();
    expect(screen.queryByText(ES.home.features.subtitle)).toBeNull();
  });

  it('shows the section title when there are features (i18n defaults)', async () => {
    await mount({ ...PROD, homeFeatures: [] });
    expect(screen.getByText(ES.home.features.title)).toBeTruthy();
  });
});
