import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import ES from '@/translations/ES.json';
import EN from '@/translations/EN.json';
import { PROD, PRESET, SLIDES } from './homeTestKit';
import { contrastRatio } from '@/lib/contrast';

// Spec (S2a/S2b) for the Home hero. Acceptance criteria:
//  1. Exactly one h1, from i18n (home.hero.title), outside the carousel and never re-mounted by slide changes.
//  2. Posters are shown whole: <img> with object-contain in a 16:9 frame, alt = slide title, no dark veil, no bg-cover.
//  3. Layout (ND-1 = option A, the mockup, decided by the owner): centered title block, two cards
//     ("Combos de comida", "Remesas a Cuba") and the carousel below at full width, all stacked in DOM order.
//  3b. The cards navigate with the existing routes, read their colours from the Visual settings and the
//     Home root (not the body) paints pageBgColor, except for the legacy default #f9fafb of production.
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

const mount = async ({ settings = PROD, slides = SLIDES, language = 'es', isAdmin = false, onNavigate = vi.fn() } = {}) => {
  Object.assign(state, { settings, slides, language, isAdmin });
  const view = render(<HomePage onNavigate={onNavigate} />);
  if (slides.some((slide) => slide.image_url || slide.image_file) && settings.carouselEnabled !== false) await screen.findByTestId('hero-carousel');
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

  it('stacks a centered title block, two cards and a full-width carousel (no side-by-side grid)', async () => {
    await mount();
    const hero = screen.getByTestId('home-hero');
    const h1 = hero.querySelector('h1');
    const carousel = screen.getByTestId('hero-carousel');
    const cards = screen.getAllByTestId('hero-card');
    expect([hero, ...hero.querySelectorAll('*')].some((el) => /lg:grid-cols-12|lg:col-span-(5|7)/.test(el.className))).toBe(false);
    expect(h1.closest('[class*="text-center"]')).toBeTruthy();
    expect(cards).toHaveLength(2);
    // reading order = stacked order: title, cards, carousel
    const before = (a, b) => a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING;
    expect(before(h1, cards[0])).toBeTruthy();
    expect(before(cards[1], carousel)).toBeTruthy();
    const column = carousel.parentElement;
    expect(column.className.split(/\s+/)).toEqual(expect.arrayContaining(['w-full', 'max-w-5xl', 'mx-auto']));
  });

  it('renders the two cards with i18n copy (ES and EN) and one button each', async () => {
    for (const language of ['es', 'en']) {
      const dict = language === 'es' ? ES : EN;
      const { unmount } = await mount({ language });
      const [combos, remittances] = screen.getAllByTestId('hero-card');
      for (const [card, key] of [[combos, 'combos'], [remittances, 'remittances']]) {
        const copy = dict.home.hero.cards[key];
        expect(within(card).getByRole('heading', { name: copy.title })).toBeTruthy();
        expect(within(card).getByText(copy.description)).toBeTruthy();
        expect(within(card).getAllByRole('button')).toHaveLength(1);
        expect(within(card).getByRole('button', { name: copy.cta })).toBeTruthy();
      }
      unmount();
    }
  });

  it('cards navigate through the existing routes: combos to products, remittances to remittances', async () => {
    const onNavigate = vi.fn();
    await mount({ onNavigate });
    const [combos, remittances] = screen.getAllByTestId('hero-card');
    fireEvent.click(within(combos).getByRole('button'));
    expect(onNavigate).toHaveBeenLastCalledWith('products');
    fireEvent.click(within(remittances).getByRole('button'));
    expect(onNavigate).toHaveBeenLastCalledWith('remittances');
  });

  it('card headings are not extra h1 and their colours come from the settings', async () => {
    const { container } = await mount({ settings: { ...PRESET, cardBgColor: '#abcdef', borderColor: '#123abc', headingColor: '#778899' } });
    expect(container.querySelectorAll('h1')).toHaveLength(1);
    const [card] = screen.getAllByTestId('hero-card');
    expect(card.style.backgroundColor).toBe('rgb(171, 205, 239)');
    expect(card.style.borderColor).toBe('rgb(18, 58, 188)');
    expect(within(card).getByRole('heading').style.color).toBe('rgb(119, 136, 153)');
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

  it('production row (legacy look): the active dot uses primaryColor, never the brand gold', async () => {
    await mount({ settings: PROD });
    expect(paint(dots()[0])).toBe('rgb(52, 153, 220)');
  });
});

describe('page background belongs to the Home, not to the body', () => {
  it('preset: the Home root paints pageBgColor (ivory)', async () => {
    const { container } = await mount({ settings: PRESET });
    expect(container.firstElementChild.style.backgroundColor).toBe('rgb(250, 247, 240)');
  });

  it('a customised pageBgColor reaches the Home root; an invalid one is ignored', async () => {
    const custom = await mount({ settings: { ...PRESET, pageBgColor: '#eeddcc' } });
    expect(custom.container.firstElementChild.style.backgroundColor).toBe('rgb(238, 221, 204)');
    custom.unmount();
    const bad = await mount({ settings: { ...PRESET, pageBgColor: 'red;} x{' } });
    expect(bad.container.firstElementChild.style.backgroundColor).toBe('');
  });

  it('production row (legacy default #f9fafb): the Home root stays transparent so the stylesheet gradient shows', async () => {
    const { container } = await mount({ settings: PROD });
    expect(container.firstElementChild.style.backgroundColor).toBe('');
  });
});

describe('legacy (production row) hero: readable title and no brand gold before the preset', () => {
  it('the new h1 is solid heading ink with AA contrast on the page colour (not gradient text)', async () => {
    const { container } = await mount({ settings: PROD });
    const h1 = container.querySelector('h1');
    expect(h1.style.color).toBe('rgb(31, 41, 55)');
    expect(h1.style.backgroundClip).not.toBe('text');
    expect(h1.getAttribute('style')).not.toContain('linear-gradient');
    expect(contrastRatio('#1f2937', PROD.pageBgColor)).toBeGreaterThanOrEqual(4.5);
  });

  it('the h2 of the sections keep the stored gradient (only the new h1 changes)', async () => {
    const { container } = await mount({ settings: PROD });
    const h2s = [...container.querySelectorAll('h2')].filter((h) => !h.closest('[data-testid="hero-card"]'));
    expect(h2s.length).toBeGreaterThan(2);
    for (const h2 of h2s) expect(h2.getAttribute('style')).toContain('linear-gradient');
  });

  it('no gold anywhere in the hero: soft accent is an accent tint, hover of the outline button is not gold', async () => {
    const { container } = await mount({ settings: PROD });
    const hero = screen.getByTestId('home-hero');
    const html = (hero.innerHTML + container.firstElementChild.getAttribute('style')).toLowerCase();
    for (const gold of ['rgb(255, 165, 0)', 'rgb(255, 241, 204)', '#ffa500', '#fff1cc', '#e59400']) expect(html).not.toContain(gold);
    const softVar = container.firstElementChild.style.getPropertyValue('--brand-soft-accent');
    expect(softVar.toLowerCase()).toBe('#9333ea20');
    // muted text keeps the legacy grey
    expect(within(hero).getByText(ES.home.hero.subtitle).style.color).toBe('rgb(75, 85, 99)');
  });

  it('the brand preset keeps the gold (dot, soft accent, muted warm grey)', async () => {
    const { container } = await mount({ settings: PRESET });
    expect(paint(dots()[0])).toBe('rgb(255, 165, 0)');
    expect(container.firstElementChild.style.getPropertyValue('--brand-soft-accent')).toBe('#FFF1CC');
    expect(within(screen.getByTestId('home-hero')).getByText(ES.home.hero.subtitle).style.color).toBe('rgb(96, 91, 82)');
  });
});

describe('mobile top padding and unusable slides', () => {
  it('the hero has a local top padding on mobile so the h1 clears the fixed header', async () => {
    await mount();
    expect(screen.getByTestId('home-hero').className.split(/\s+/)).toContain('pt-12');
  });

  it('slides without any image do not create a carousel', async () => {
    const { container } = await mount({ slides: [{ id: 'x', title_es: 'a', title_en: 'a' }] });
    expect(screen.queryByTestId('hero-carousel')).toBeNull();
    expect(container.querySelectorAll('h1')).toHaveLength(1);
  });
});
