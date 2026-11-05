import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import ES from '@/translations/ES.json';
import EN from '@/translations/EN.json';
import { PROD, PRESET, SLIDES } from './homeTestKit';

// Spec (S2a/S2b) for the Home hero. Acceptance criteria:
//  1. Exactly one h1, from i18n (home.hero.title), outside the carousel and never re-mounted by slide changes.
//  2. Posters are shown whole: <img> with object-contain in a 16:9 frame, alt = slide title, no dark veil, no bg-cover.
//  3. Layout (ND-1, owner's literal text): text column and carousel column in one 12-col grid from lg up
//     (text 5/12, carousel 7/12), stacked below lg.
//  4. The CTA follows the Visual settings: stored gradient look while useButtonGradient is on (decoupled from
//     useGradient), otherwise a class-driven brand button whose colours come from --brand-button-* on the Home root.
//  5. Carousel dots: <button> with a name, aria-current on the active one, active colour = carouselDotActiveColor.
//  6. The production row keeps the legacy CTA look; the preset shows the brand look.

const state = vi.hoisted(() => ({ settings: {}, language: 'es', slides: [], isAdmin: false }));

const translate = (key, params = {}) => {
  const dict = state.language === 'es' ? ES : EN;
  const value = key.split('.').reduce((acc, k) => (acc ? acc[k] : undefined), dict);
  if (typeof value !== 'string') return key;
  return Object.entries(params).reduce((acc, [k, v]) => acc.replace(`{${k}}`, v), value);
};

vi.mock('@/contexts/LanguageContext', () => ({ useLanguage: () => ({ t: translate, language: state.language }) }));
vi.mock('@/contexts/BusinessContext', () => ({ useBusiness: () => ({ visualSettings: state.settings }) }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ isAdmin: state.isAdmin }) }));
vi.mock('@/contexts/CurrencyContext', () => ({
  useCurrency: () => ({ currency: 'USD', currencySymbol: '$', formatCurrency: String, convertCurrency: (v) => v }),
}));
vi.mock('@/lib/carouselService', () => ({ getActiveCarouselSlides: vi.fn(() => Promise.resolve(state.slides)) }));
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
import SkeletonCard from '@/components/ui/SkeletonCard';

const mount = async ({ settings = PROD, slides = SLIDES, language = 'es', isAdmin = false } = {}) => {
  Object.assign(state, { settings, slides, language, isAdmin });
  const view = render(<HomePage onNavigate={vi.fn()} />);
  if (slides.length > 0 && settings.carouselEnabled !== false) await screen.findByTestId('hero-carousel');
  else await screen.findByRole('button', { name: translate('home.hero.cta.products') });
  return view;
};

const cta = () => screen.getByRole('button', { name: ES.home.hero.cta.products });
const goToName = (dict) => new RegExp(dict.home.carousel.goTo.replace('{count}', '\\d'));
const dots = () => screen.getAllByRole('button', { name: goToName(ES) });
// the dot IS the button: inline backgroundColor on it (min 24px, active one wider)
const paint = (dot) => dot.style.backgroundColor;

describe('hero structure', () => {
  beforeEach(() => vi.clearAllMocks());

  it('is the first child of the Home root and keeps the notice strip as its next sibling', async () => {
    const { container } = await mount();
    const [hero, strip] = Array.from(container.firstElementChild.children);
    expect(hero).toBe(screen.getByTestId('home-hero'));
    expect(hero.tagName).toBe('SECTION');
    expect(strip).toBe(screen.getByRole('note', { name: ES.legal.notice.title }));
  });

  it('has exactly one h1, from i18n, outside the carousel (ES and EN)', async () => {
    for (const language of ['es', 'en']) {
      const { container, unmount } = await mount({ language });
      const h1s = container.querySelectorAll('h1');
      expect(h1s).toHaveLength(1);
      expect(h1s[0].textContent).toBe((language === 'es' ? ES : EN).home.hero.title);
      expect(screen.getByTestId('hero-carousel').contains(h1s[0])).toBe(false);
      unmount();
    }
  });

  it('does not re-mount the h1 when the slide changes', async () => {
    const { container } = await mount();
    const before = container.querySelector('h1');
    fireEvent.click(screen.getByRole('button', { name: ES.home.carousel.next }));
    expect(container.querySelector('h1')).toBe(before);
    expect(container.querySelectorAll('h1')).toHaveLength(1);
  });

  it('shows the poster whole: object-contain img in a 16:9 frame, alt from the slide, no veil, no background image', async () => {
    const { container } = await mount();
    const img = screen.getByTestId('hero-slide-image');
    expect(img.tagName).toBe('IMG');
    expect(img.className.split(/\s+/)).toContain('object-contain');
    expect(img.className).not.toMatch(/object-cover/);
    expect(img.getAttribute('src')).toBe(SLIDES[0].image_url);
    expect(img.getAttribute('alt')).toBe(SLIDES[0].title_es);
    const frame = screen.getByTestId('hero-carousel-frame');
    expect(frame.contains(img)).toBe(true);
    expect(frame.className.split(/\s+/)).toContain('aspect-video');
    expect(container.querySelector('.bg-black\\/50, .bg-cover')).toBeNull();
    const hero = screen.getByTestId('home-hero');
    expect([hero, ...hero.querySelectorAll('*')].some((el) => el.style.backgroundImage.includes('url('))).toBe(false);
  });

  it('uses the English title as alt in EN', async () => {
    await mount({ language: 'en' });
    expect(screen.getByTestId('hero-slide-image').getAttribute('alt')).toBe(SLIDES[0].title_en);
  });

  it('puts text and carousel in one 12-column grid from lg (text 5/12, carousel 7/12) and stacks below', async () => {
    await mount();
    const hero = screen.getByTestId('home-hero');
    const h1 = hero.querySelector('h1');
    const carousel = screen.getByTestId('hero-carousel');
    const grid = [...hero.querySelectorAll('div')].find((d) => d.className.split(/\s+/).includes('lg:grid-cols-12'));
    expect(grid).toBeTruthy();
    const column = (el) => {
      let node = el;
      while (node.parentElement !== grid) node = node.parentElement;
      return node;
    };
    expect(column(h1).className.split(/\s+/)).toContain('lg:col-span-5');
    expect(column(carousel).className.split(/\s+/)).toContain('lg:col-span-7');
    expect(column(h1)).not.toBe(column(carousel));
    // DOM order = reading order = stacked order on mobile: text first
    expect(h1.compareDocumentPosition(carousel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('renders text and CTA but no carousel when there are no slides, or the carousel is disabled', async () => {
    for (const opts of [{ slides: [] }, { settings: { ...PROD, carouselEnabled: false } }]) {
      const { container, unmount } = await mount(opts);
      expect(container.querySelectorAll('h1')).toHaveLength(1);
      expect(screen.queryByTestId('hero-carousel')).toBeNull();
      expect(cta()).toBeTruthy();
      expect(container.querySelector('.bg-black\\/50')).toBeNull();
      unmount();
    }
  });

  it('the loading skeleton reserves the same 16:9 box (no layout shift)', () => {
    const { container } = render(<SkeletonCard variant="carousel" />);
    expect(container.querySelector('.aspect-video')).toBeTruthy();
    expect(container.innerHTML).not.toMatch(/\bh-64\b|\bh-96\b|md:h-80/);
  });
});

describe('hero CTA follows the Visual settings', () => {
  it('production row (useButtonGradient on): same gradient and text colour as on main', async () => {
    await mount({ settings: PROD });
    const style = cta().getAttribute('style');
    expect(style).toContain('linear-gradient(to right, rgb(52, 153, 220), rgb(147, 51, 234))');
    expect(cta().style.color).toBe('rgb(255, 255, 255)');
  });

  it('reads useButtonGradient, not useGradient', async () => {
    const solid = { ...PROD, useGradient: true, useButtonGradient: false };
    const { unmount } = await mount({ settings: solid });
    expect(cta().getAttribute('style') || '').not.toContain('linear-gradient');
    expect(cta().className).toContain('bg-brand');
    unmount();
    await mount({ settings: { ...PRESET, useGradient: false, useButtonGradient: true } });
    expect(cta().getAttribute('style')).toContain('linear-gradient');
  });

  it('preset: class-driven brand button (hover through classes), colours from the Home root variables', async () => {
    const { container } = await mount({ settings: PRESET });
    const button = cta();
    expect(button.className).toContain('bg-brand');
    expect(button.className).toContain('text-brand-foreground');
    expect(button.className).toContain('hover:bg-brand-hover');
    expect(button.style.background).toBe('');
    expect(button.style.backgroundColor).toBe('');
    const root = container.firstElementChild;
    expect(root.style.getPropertyValue('--brand-button-bg')).toBe('#FFA500');
    expect(root.style.getPropertyValue('--brand-button-text')).toBe('#171717');
    expect(root.style.getPropertyValue('--brand-button-hover-bg')).toBe('#E59400');
  });

  it('a customised button colour reaches the CTA (not the preset value)', async () => {
    const { container } = await mount({ settings: { ...PRESET, buttonBgColor: '#112233', buttonTextColor: '#fefefe' } });
    const root = container.firstElementChild;
    expect(root.style.getPropertyValue('--brand-button-bg')).toBe('#112233');
    expect(root.style.getPropertyValue('--brand-button-text')).toBe('#fefefe');
  });

  it('an invalid stored colour never reaches the style attribute; the brand fallback is used', async () => {
    const { container } = await mount({ settings: { ...PRESET, buttonBgColor: 'red;} body{display:none', buttonTextColor: 'nope' } });
    const root = container.firstElementChild;
    expect(root.style.getPropertyValue('--brand-button-bg')).toBe('#FFA500');
    expect(root.style.getPropertyValue('--brand-button-text')).toBe('#171717');
  });

  it('hero title and subtitle use the heading and muted colours from the settings', async () => {
    await mount({ settings: { ...PRESET, headingColor: '#778899', mutedTextColor: '#334455' } });
    const hero = screen.getByTestId('home-hero');
    expect(hero.querySelector('h1').style.color).toBe('rgb(119, 136, 153)');
    expect(within(hero).getByText(ES.home.hero.subtitle).style.color).toBe('rgb(51, 68, 85)');
  });

  it('title is not white (there is no dark veil any more) in either look', async () => {
    for (const settings of [PROD, PRESET]) {
      const { container, unmount } = await mount({ settings });
      expect(container.querySelector('h1').className).not.toMatch(/text-white/);
      expect(container.querySelector('h1').style.color).not.toBe('rgb(255, 255, 255)');
      unmount();
    }
  });
});

describe('carousel dots', () => {
  it('are buttons named "Ir al anuncio N" (EN: "Go to slide N") with aria-current on the active one', async () => {
    await mount();
    const list = dots();
    expect(list).toHaveLength(SLIDES.length);
    expect(list[0].getAttribute('aria-current')).toBe('true');
    expect(list[1].getAttribute('aria-current')).not.toBe('true');
    fireEvent.click(list[1]);
    expect(screen.getByTestId('hero-slide-image').getAttribute('alt')).toBe(SLIDES[1].title_es);
    expect(dots()[1].getAttribute('aria-current')).toBe('true');
  });

  it('are named in English too', async () => {
    await mount({ language: 'en' });
    expect(screen.getAllByRole('button', { name: goToName(EN) })).toHaveLength(SLIDES.length);
  });

  it('active colour comes from carouselDotActiveColor; the inactive ones do not use it', async () => {
    await mount({ settings: { ...PRESET, carouselDotActiveColor: '#123456' } });
    const [first, second] = dots();
    expect(paint(first)).toBe('rgb(18, 52, 86)');
    expect(paint(second)).not.toBe('rgb(18, 52, 86)');
    // not colour-only: the active dot has a different shape/border (WCAG 1.4.1), checked in the e2e by size
    const bare = (el) => el.outerHTML.replace(/ style="[^"]*"/g, '').replace(/ aria-current="[^"]*"/g, '').replace(/ aria-label="[^"]*"/g, '');
    expect(bare(first)).not.toBe(bare(second));
  });

  it('production row: the default brand dot colour (the key does not exist in the stored row)', async () => {
    await mount({ settings: PROD });
    expect(paint(dots()[0])).toBe('rgb(255, 165, 0)');
  });
});
