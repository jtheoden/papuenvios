import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import fs from 'node:fs';
import path from 'node:path';
import ES from '@/translations/ES.json';
import { PROD, PRESET, colorSignature } from './homeTestKit';

// Spec (S2): with the row stored in production (blue/violet, useGradient on) every part of the Home
// outside the hero keeps the exact colours it has on main. The fixture was generated from main's
// HomePage before any change (do not regenerate it to make this test pass); it only holds colour classes and colour-ish
// inline declarations, so responsive/layout fixes do not affect it.
// With the preset applied the same sections lose every legacy blue/violet/gradient colour.

const FIXTURE = path.resolve(__dirname, '__fixtures__/homeProdColorSignature.json');

const state = vi.hoisted(() => ({ settings: {}, isAdmin: false }));

const translate = (key, params = {}) => {
  const value = key.split('.').reduce((acc, k) => (acc ? acc[k] : undefined), ES);
  if (typeof value !== 'string') return key;
  return Object.entries(params).reduce((acc, [k, v]) => acc.replace(`{${k}}`, v), value);
};

vi.mock('@/contexts/LanguageContext', () => ({ useLanguage: () => ({ t: translate, language: 'es' }) }));
vi.mock('@/contexts/BusinessContext', () => ({ useBusiness: () => ({ visualSettings: state.settings }) }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ isAdmin: state.isAdmin }) }));
vi.mock('@/contexts/CurrencyContext', () => ({
  useCurrency: () => ({ currency: 'USD', currencySymbol: '$', formatCurrency: String, convertCurrency: (v) => v }),
}));
vi.mock('@/lib/carouselService', async () => {
  const { SLIDES: slides } = await import('./homeTestKit');
  return { getActiveCarouselSlides: vi.fn(() => Promise.resolve(slides)) };
});
vi.mock('@/lib/publicationService', () => ({
  getPublications: vi.fn(() => Promise.resolve([
    { id: 'p1', title_es: 'Guía uno', title_en: 'Guide one', content_es: 'Contenido uno', content_en: 'Content one', cover_image_url: null },
    { id: 'p2', title_es: 'Guía dos', title_en: 'Guide two', content_es: 'Contenido dos', content_en: 'Content two', cover_image_url: 'https://cdn.example.test/cover.png' },
  ])),
}));
vi.mock('@/lib/testimonialService', () => ({
  getTestimonials: vi.fn(() => Promise.resolve([
    { id: 't1', user_name: 'Ana', rating: 4, comment: 'Muy bien', user_avatar: 'https://cdn.example.test/a.png' },
  ])),
}));
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => Promise.resolve({
          data: [{ id: 'o1', code: 'PAPU10', discount_type: 'percentage', discount_value: 10, end_date: '2030-01-31T00:00:00Z', max_usage_global: 5 }],
          error: null,
        }),
      }),
    }),
    rpc: () => Promise.resolve({ data: { users: 42, remittances_completed: 17, orders_completed: 9, first_year: 2024 }, error: null }),
  },
}));
vi.mock('@/hooks/useRealtimeSubscription', () => ({
  useRealtimeSubscription: vi.fn(),
  useRealtimeCarouselSlides: vi.fn(),
}));
vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} });

import HomePage from '@/components/HomePage';

const mountHome = async (settings, { isAdmin = false } = {}) => {
  state.settings = settings;
  state.isAdmin = isAdmin;
  const view = render(<HomePage onNavigate={vi.fn()} />);
  // every async block of the page has landed: slides, offers, stats, guides, testimonials
  await screen.findByText('PAPU10');
  await screen.findByText(ES.home.stats.title);
  await screen.findByText('Guía uno');
  await screen.findByText('Muy bien', { exact: false });
  await new Promise((resolve) => setTimeout(resolve, 20)); // let the slides promise settle
  return view;
};

// everything after the hero: the notice strip and the content sections
const belowHero = (container, { withNotice = true } = {}) => {
  const [, ...rest] = container.firstElementChild.children;
  const holder = document.createElement('div');
  rest.filter((el) => withNotice || el.getAttribute('role') !== 'note').forEach((el) => holder.appendChild(el.cloneNode(true)));
  return holder;
};

afterEach(() => vi.useRealTimers());

describe('Home outside the hero, production row', () => {
  it('keeps exactly the colours it has on main', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-06-15T12:00:00Z') });
    const { container } = await mountHome(PROD);
    const signature = colorSignature(belowHero(container));
    expect(signature).toEqual(JSON.parse(fs.readFileSync(FIXTURE, 'utf8')));
    // sanity: the fixture really is the legacy look
    expect(signature.join('\n')).toMatch(/from-blue-500/);
    expect(signature.join('\n')).toMatch(/linear-gradient/);
  });

  it('admin button keeps the stored button colours (now through the brand variables)', async () => {
    const { container } = await mountHome(PROD, { isAdmin: true });
    const root = container.firstElementChild;
    const manage = screen.getByRole('button', { name: ES.home.offers.manage });
    expect(manage.className).toContain('bg-brand');
    expect(manage.style.backgroundColor).toBe('');
    expect(root.style.getPropertyValue('--brand-button-bg')).toBe('#2563eb');
    expect(root.style.getPropertyValue('--brand-button-hover-bg')).toBe('#1d4ed8');
    expect(root.style.getPropertyValue('--brand-button-text')).toBe('#ffffff');
  });
});

describe('Home outside the hero, brand preset applied', () => {
  it('has no legacy blue/violet/slate colours, no gradients and no stored-colour tints', async () => {
    const { container } = await mountHome(PRESET, { isAdmin: true });
    // the RegulatoryNotice strip keeps its own blue/slate colours until S4 (ND-A)
    const sections = belowHero(container, { withNotice: false });
    const html = sections.innerHTML.toLowerCase();
    const classes = [...sections.querySelectorAll('[class]')].flatMap((el) => el.getAttribute('class').split(/\s+/));
    const legacyClass = classes.filter((c) => /(^|:)(bg|text|border|from|via|to|ring)-(blue|indigo|violet|purple|cyan|slate|emerald|orange|amber)-\d/.test(c));
    expect(legacyClass).toEqual([]);
    expect(classes.filter((c) => /(^|:)(from|via|to)-/.test(c))).toEqual([]);
    expect(html).not.toContain('linear-gradient');
    for (const legacy of ['rgb(37, 99, 235)', 'rgb(147, 51, 234)', 'rgb(52, 153, 220)', 'rgb(29, 78, 216)', '#2563eb', '#9333ea', '#3499dc']) {
      expect(html).not.toContain(legacy);
    }
  });

  it('headings are solid charcoal, not gradient text', async () => {
    const { container } = await mountHome(PRESET);
    const h2s = [...container.querySelectorAll('h2')];
    expect(h2s.length).toBeGreaterThan(2);
    for (const h2 of h2s) {
      expect(h2.style.color).toBe('rgb(23, 23, 23)');
      expect(h2.style.backgroundClip).not.toBe('text');
    }
  });

  it('a customised palette reaches the sections (poisoned settings, not the preset values)', async () => {
    const custom = { ...PRESET, buttonBgColor: '#112233', buttonTextColor: '#fefefe', buttonHoverBgColor: '#334455', headingColor: '#778899', softAccentColor: '#abcdef', borderColor: '#123abc' };
    const { container } = await mountHome(custom, { isAdmin: true });
    const root = container.firstElementChild;
    expect(root.style.getPropertyValue('--brand-button-bg')).toBe('#112233');
    expect(root.style.getPropertyValue('--brand-button-text')).toBe('#fefefe');
    expect(root.style.getPropertyValue('--brand-button-hover-bg')).toBe('#334455');
    for (const h2 of container.querySelectorAll('h2')) expect(h2.style.color).toBe('rgb(119, 136, 153)');
    const html = belowHero(container, { withNotice: false }).innerHTML.toLowerCase();
    // soft accent (offer tag / guide cover) and border colour are read from their settings
    expect(html).toContain('rgb(171, 205, 239)');
    expect(html).toContain('rgb(18, 58, 188)');
  });
});
