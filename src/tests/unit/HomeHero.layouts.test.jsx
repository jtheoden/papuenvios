import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within, act } from '@testing-library/react';
import ES from '@/translations/ES.json';
import EN from '@/translations/EN.json';
import { contrastRatio } from '@/lib/contrast';
import { PRESET, PROD, SLIDES } from './homeTestKit';

// Spec (hero layout S3): two compositions of the Home hero chosen by `heroLayout`.
//  spaced  the separated block: title, cards and a card-framed carousel that shares one max width with the cards,
//          p-2 md:p-3 padding, frame ratio computed ONCE from the size of every poster (preloaded; 3.8:1 skeleton
//          until then and fallback when one fails or times out) and never changed afterwards, arrows over the sides from md and pause + dots below, slide title and
//          subtitle as a caption under the poster only when they exist.
//  classic the original full-bleed cover (cover image, bg-black/60 veil (AA for white text on a white poster), slide text over it, "Ver Productos" CTA,
//          translucent arrows) keeping the accessibility of the carousel: one stable h1 (the slide title is an h2),
//          visible pause, pauses on hover/focus/hidden tab, reduced motion, 2 s minimum, dots as buttons.
// The stored value is never trusted: anything other than 'classic' renders spaced.

const state = vi.hoisted(() => ({ language: 'es', reduce: false, wide: false }));

const translate = (key, params = {}) => {
  const dict = state.language === 'es' ? ES : EN;
  const value = key.split('.').reduce((acc, k) => (acc ? acc[k] : undefined), dict);
  if (typeof value !== 'string') return key;
  return Object.entries(params).reduce((acc, [k, v]) => acc.replace(`{${k}}`, v), value);
};

vi.mock('@/lib/supabase', () => ({ supabase: {} }));
vi.mock('@/contexts/LanguageContext', () => ({ useLanguage: () => ({ t: translate, language: state.language }) }));

import HomeHero from '@/components/home/HomeHero';

const matchMediaStub = (query) => ({
  matches: /prefers-reduced-motion/.test(query) ? state.reduce : /min-width:\s*768px/.test(query) ? state.wide : false,
  media: query,
  addEventListener: () => {},
  removeEventListener: () => {},
  addListener: () => {},
  removeListener: () => {},
});

const CAPTIONED = [
  { id: 'c1', image_url: 'https://cdn.example.test/p1.png', title_es: 'Envíos a toda Cuba', title_en: 'Shipping all over Cuba', subtitle_es: 'Entrega en 7 días', subtitle_en: 'Delivery in 7 days' },
  { id: 'c2', image_url: 'https://cdn.example.test/p2.png', title_es: 'Remesas seguras', title_en: 'Safe remittances', subtitle_es: '', subtitle_en: '' },
  { id: 'c3', image_url: 'https://cdn.example.test/p3.png', title_es: '', title_en: '', subtitle_es: '', subtitle_en: '' },
];
const BARE = SLIDES.map((slide) => ({ ...slide, title_es: '', title_en: '', subtitle_es: '', subtitle_en: '' }));

const mount = ({ layout, slides = CAPTIONED, loading = false, settings = PRESET, onNavigate = vi.fn() } = {}) => {
  const visualSettings = layout === undefined ? settings : { ...settings, heroLayout: layout };
  return { onNavigate, ...render(<HomeHero slides={slides} loading={loading} visualSettings={visualSettings} onNavigate={onNavigate} />) };
};

// The carousel preloads every poster with `new Image()` to size the frame once; jsdom never loads images, so the
// tests answer for each one.
const preloaded = [];
class FakeImage {
  constructor() { preloaded.push(this); }
  set src(value) { this.srcValue = value; }
  get src() { return this.srcValue; }
}
const answer = (url, naturalWidth, naturalHeight) => act(() => {
  const img = preloaded.find((candidate) => candidate.src === url);
  Object.assign(img, { naturalWidth, naturalHeight });
  img.onload?.();
});
const fail = (url) => act(() => { preloaded.find((candidate) => candidate.src === url).onerror?.(); });
const URLS = CAPTIONED.map((slide) => slide.image_url);

// jsdom serialises inline colours as rgb(r, g, b); contrastRatio takes hex
const toHex = (css) => `#${css.match(/\d+/g).slice(0, 3).map((n) => Number(n).toString(16).padStart(2, '0')).join('')}`;

const poster = () => screen.getByTestId('hero-slide-image');
const tick = (ms) => act(() => { vi.advanceTimersByTime(ms); });
const names = (dict) => dict.home.carousel;

beforeEach(() => {
  preloaded.length = 0;
  vi.stubGlobal('Image', FakeImage);
  localStorage.clear();
  Object.assign(state, { language: 'es', reduce: false, wide: false });
  window.matchMedia = matchMediaStub;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete window.matchMedia;
});

describe('layout resolution', () => {
  it('renders spaced when the key is missing or is not exactly "classic"', () => {
    for (const heroLayout of [undefined, 'spaced', 'CLASSIC', ' classic', null, 3, '<img onerror=x>']) {
      const { unmount } = mount({ settings: { ...PRESET, heroLayout } });
      expect(screen.getAllByTestId('hero-card'), String(heroLayout)).toHaveLength(2);
      expect(screen.queryByTestId('hero-veil'), String(heroLayout)).toBeNull();
      unmount();
    }
  });

  it('renders classic only for "classic"', () => {
    mount({ layout: 'classic' });
    expect(screen.getByTestId('hero-veil')).toBeTruthy();
    expect(screen.queryByTestId('hero-card')).toBeNull();
  });

  it('classic falls back to spaced without usable slides or with the carousel disabled', () => {
    for (const props of [{ slides: [] }, { slides: [{ id: 'x', image_url: '', image_file: null, title_es: 'a' }] }, { settings: { ...PRESET, carouselEnabled: false } }]) {
      const { unmount } = mount({ layout: 'classic', ...props });
      expect(screen.getAllByTestId('hero-card')).toHaveLength(2);
      expect(screen.queryByTestId('hero-veil')).toBeNull();
      expect(screen.queryByTestId('hero-carousel')).toBeNull();
      expect(document.querySelectorAll('h1')).toHaveLength(1);
      unmount();
    }
  });
});

describe.each(['spaced', 'classic'])('%s: shared guarantees', (layout) => {
  it('has exactly one h1, the page title, outside the carousel and stable across slides', () => {
    mount({ layout });
    const h1s = document.querySelectorAll('h1');
    expect(h1s).toHaveLength(1);
    expect(h1s[0].textContent).toBe(ES.home.hero.title);
    expect(screen.getByTestId('hero-carousel').contains(h1s[0])).toBe(layout === 'classic' ? true : false);
    fireEvent.click(screen.getByRole('button', { name: names(ES).next }));
    expect(document.querySelector('h1')).toBe(h1s[0]);
    expect(document.querySelectorAll('h1')).toHaveLength(1);
  });

  it('keeps the section as the first element with the same test id', () => {
    const { container } = mount({ layout });
    expect(container.firstElementChild).toBe(screen.getByTestId('home-hero'));
    expect(container.firstElementChild.tagName).toBe('SECTION');
  });

  it('has a visible, operable pause button that stops and resumes the autoplay', () => {
    vi.useFakeTimers();
    mount({ layout });
    const pause = screen.getByRole('button', { name: names(ES).pause });
    expect(pause.disabled).toBe(false);
    fireEvent.click(pause);
    tick(30000);
    expect(screen.getByRole('button', { name: names(ES).play })).toBeTruthy();
    expect(screen.getByRole('button', { name: names(ES).goTo.replace('{count}', '1') }).getAttribute('aria-current')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: names(ES).play }));
    tick(5000);
    expect(screen.getByRole('button', { name: names(ES).goTo.replace('{count}', '2') }).getAttribute('aria-current')).toBe('true');
  });

  it('arrows and dots are buttons with translated names (ES and EN)', () => {
    for (const language of ['es', 'en']) {
      state.language = language;
      const dict = language === 'es' ? ES : EN;
      const { unmount } = mount({ layout });
      expect(screen.getByRole('button', { name: names(dict).previous })).toBeTruthy();
      expect(screen.getByRole('button', { name: names(dict).next })).toBeTruthy();
      const dots = screen.getAllByRole('button', { name: new RegExp(names(dict).goTo.replace('{count}', '\\d')) });
      expect(dots).toHaveLength(3);
      expect(dots.filter((dot) => dot.getAttribute('aria-current') === 'true')).toHaveLength(1);
      const region = screen.getByRole('region', { name: names(dict).label });
      expect(region.getAttribute('aria-roledescription')).toBe(names(dict).roleDescription);
      unmount();
    }
  });

  it('pauses on hover and on focus, resumes on leave, and never goes faster than 2 s', () => {
    vi.useFakeTimers();
    mount({ layout, settings: { ...PRESET, carouselAutoplaySpeed: 500 } });
    const region = screen.getByTestId('hero-carousel');
    const active = () => screen.getAllByRole('button', { name: /^Ir al anuncio/ }).findIndex((d) => d.getAttribute('aria-current') === 'true');
    fireEvent.mouseEnter(region);
    tick(10000);
    expect(active()).toBe(0);
    fireEvent.mouseLeave(region);
    tick(1999);
    expect(active()).toBe(0);
    tick(1);
    expect(active()).toBe(1);
    fireEvent.focus(screen.getByRole('button', { name: names(ES).next }));
    tick(10000);
    expect(active()).toBe(1);
  });

  it('starts paused with prefers-reduced-motion', () => {
    vi.useFakeTimers();
    state.reduce = true;
    mount({ layout });
    tick(30000);
    expect(screen.getByRole('button', { name: names(ES).play })).toBeTruthy();
    expect(screen.getByRole('button', { name: names(ES).goTo.replace('{count}', '1') }).getAttribute('aria-current')).toBe('true');
  });

  it('marks the first poster fetchpriority=high without React warnings', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    mount({ layout });
    expect(poster().getAttribute('fetchpriority')).toBe('high');
    fireEvent.click(screen.getByRole('button', { name: names(ES).next }));
    expect(poster().getAttribute('fetchpriority')).toBeNull();
    expect(errors).not.toHaveBeenCalled();
  });

  it('shows no controls and no pause with a single slide', () => {
    mount({ layout, slides: CAPTIONED.slice(0, 1) });
    expect(screen.queryByRole('button', { name: names(ES).pause })).toBeNull();
    expect(screen.queryByRole('button', { name: names(ES).next })).toBeNull();
  });

  it('the CTA goes to products and keeps the stored gradient look on the production row', () => {
    const { onNavigate } = mount({ layout, settings: PROD });
    const cta = screen.getByRole('button', { name: ES.home.hero.cta.products });
    expect(cta.style.background).toContain('linear-gradient');
    fireEvent.click(cta);
    expect(onNavigate).toHaveBeenCalledWith('products');
  });
});

describe('spaced composition', () => {
  it('keeps the h1, subtitle and CTA of the title block as they are', () => {
    mount({ layout: 'spaced' });
    const hero = screen.getByTestId('home-hero');
    expect(within(hero).getByRole('heading', { level: 1 }).textContent).toBe(ES.home.hero.title);
    expect(within(hero).getByText(ES.home.hero.subtitle)).toBeTruthy();
    expect(within(hero).getByRole('button', { name: ES.home.hero.cta.products })).toBeTruthy();
  });

  it('cards and carousel share one max width and the gaps are gap-6 md:gap-8', () => {
    mount({ layout: 'spaced' });
    const cards = screen.getAllByTestId('hero-card')[0].parentElement;
    const column = screen.getByTestId('hero-carousel').parentElement;
    const widthClass = (el) => el.className.split(/\s+/).filter((c) => /^max-w-/.test(c));
    expect(widthClass(cards)).toEqual(widthClass(column));
    expect(widthClass(cards)).toHaveLength(1);
    expect(screen.getByTestId('home-hero').firstElementChild.className.split(/\s+/)).toEqual(expect.arrayContaining(['gap-6', 'md:gap-8']));
  });

  it('frames the poster in a card with p-2 md:p-3 padding', () => {
    mount({ layout: 'spaced' });
    const card = screen.getByTestId('hero-carousel-card');
    expect(card.className.split(/\s+/)).toEqual(expect.arrayContaining(['rounded-2xl', 'border', 'p-2', 'md:p-3']));
    expect(card.contains(screen.getByTestId('hero-carousel-frame'))).toBe(true);
  });

  it('does not veil or cover the poster, and its alt is empty because the title is already the visible caption', () => {
    mount({ layout: 'spaced' });
    expect(poster().className).toContain('object-contain');
    expect(poster().getAttribute('alt')).toBe('');
    expect(within(screen.getByTestId('hero-slide-caption')).getByText(CAPTIONED[0].title_es)).toBeTruthy();
    expect(document.querySelector('.bg-black\\/50, .bg-black\\/60')).toBeNull();
  });

  it('announces a manual change of slide through the caption, a polite live region while paused', () => {
    mount({ layout: 'spaced' });
    const caption = screen.getByTestId('hero-slide-caption');
    expect(caption.getAttribute('aria-live')).toBe('off');
    fireEvent.click(screen.getByRole('button', { name: names(ES).pause }));
    expect(caption.getAttribute('aria-live')).toBe('polite');
  });

  describe('frame ratio', () => {
    const frame = () => screen.getByTestId('hero-carousel-frame');
    // jsdom drops aspect-ratio from inline styles, so the same value is exposed as data-frame-ratio
    const ratio = () => Number(frame().getAttribute('data-frame-ratio'));
    const ready = () => frame().getAttribute('data-frame-ready');

    it('preloads every poster and shows a 3.8:1 skeleton (poster hidden) until all of them have answered', () => {
      mount({ layout: 'spaced' });
      expect(preloaded.map((img) => img.src).sort()).toEqual([...URLS].sort());
      expect(ready()).toBe('false');
      expect(ratio()).toBeCloseTo(3.8, 5);
      expect(screen.getByTestId('hero-frame-skeleton')).toBeTruthy();
      expect(poster().className).toContain('invisible');
      answer(URLS[0], 1000, 500);
      answer(URLS[1], 1000, 500);
      expect(ready()).toBe('false');
      answer(URLS[2], 1000, 500);
      expect(ready()).toBe('true');
      expect(ratio()).toBeCloseTo(2, 5);
      expect(screen.queryByTestId('hero-frame-skeleton')).toBeNull();
      expect(poster().className).not.toContain('invisible');
    });

    it('is computed once from the tallest poster of all, not the visible one', () => {
      mount({ layout: 'spaced' });
      answer(URLS[0], 2000, 500); // 4:1
      answer(URLS[1], 1000, 800); // 1.25:1, the tallest
      answer(URLS[2], 1520, 400);
      expect(ratio()).toBeCloseTo(1.25, 5);
    });

    it('clamps absurd ratios', () => {
      mount({ layout: 'spaced' });
      URLS.forEach((url) => answer(url, 100, 1000));
      expect(ratio()).toBe(1);
    });

    it('never changes once ready: not on slide changes, not on the visible poster loading, not on late answers', () => {
      mount({ layout: 'spaced' });
      URLS.forEach((url) => answer(url, 1000, 500));
      expect(ratio()).toBeCloseTo(2, 5);
      fireEvent.click(screen.getByRole('button', { name: names(ES).next }));
      Object.defineProperty(poster(), 'naturalWidth', { configurable: true, value: 1000 });
      Object.defineProperty(poster(), 'naturalHeight', { configurable: true, value: 1000 });
      fireEvent.load(poster());
      answer(URLS[0], 1000, 1000);
      fireEvent.click(screen.getByRole('button', { name: names(ES).next }));
      expect(ratio()).toBeCloseTo(2, 5);
      expect(ready()).toBe('true');
    });

    it('falls back to 3.8:1 when a poster fails to load, and does not wait for the rest', () => {
      mount({ layout: 'spaced' });
      answer(URLS[0], 1000, 500);
      fail(URLS[1]);
      expect(ready()).toBe('true');
      expect(ratio()).toBeCloseTo(3.8, 5);
    });

    it('falls back to 3.8:1 after the timeout when a poster never answers', () => {
      vi.useFakeTimers();
      mount({ layout: 'spaced' });
      answer(URLS[0], 1000, 500);
      tick(2999);
      expect(ready()).toBe('false');
      tick(1);
      expect(ready()).toBe('true');
      expect(ratio()).toBeCloseTo(3.8, 5);
    });

    it('treats a poster without intrinsic size as a failure (3.8:1)', () => {
      mount({ layout: 'spaced' });
      answer(URLS[0], 0, 0);
      answer(URLS[1], 1000, 500);
      answer(URLS[2], 1000, 500);
      expect(ready()).toBe('true');
      expect(ratio()).toBeCloseTo(3.8, 5);
    });
  });

  describe('caption', () => {
    it('shows the slide title and subtitle under the poster, inside the card, in the current language', () => {
      mount({ layout: 'spaced' });
      const caption = screen.getByTestId('hero-slide-caption');
      expect(within(caption).getByText('Envíos a toda Cuba')).toBeTruthy();
      expect(within(caption).getByText('Entrega en 7 días')).toBeTruthy();
      expect(screen.getByTestId('hero-carousel-card').contains(caption)).toBe(true);
      expect(screen.getByTestId('hero-carousel-frame').contains(caption)).toBe(false);
    });

    it('uses the English texts in EN and is not an extra heading', () => {
      state.language = 'en';
      mount({ layout: 'spaced' });
      expect(within(screen.getByTestId('hero-slide-caption')).getByText('Shipping all over Cuba')).toBeTruthy();
      expect(document.querySelectorAll('h1')).toHaveLength(1);
      expect(screen.getByTestId('hero-slide-caption').querySelector('h1,h2,h3,h4')).toBeNull();
    });

    it('does not exist when no slide has a title or subtitle', () => {
      mount({ layout: 'spaced', slides: BARE });
      expect(screen.queryByTestId('hero-slide-caption')).toBeNull();
    });

    it('keeps its height constant across slides: every caption sits in the same grid cell and only the active one is visible', () => {
      mount({ layout: 'spaced' });
      const caption = screen.getByTestId('hero-slide-caption');
      const cells = [...caption.children];
      expect(cells).toHaveLength(3);
      expect(caption.className).toContain('grid');
      expect(cells.every((cell) => cell.className.split(/\s+/).includes('col-start-1') && cell.className.split(/\s+/).includes('row-start-1'))).toBe(true);
      expect(cells.map((cell) => cell.className.includes('invisible'))).toEqual([false, true, true]);
      expect(cells.map((cell) => cell.getAttribute('aria-hidden'))).toEqual([null, 'true', 'true']);
      fireEvent.click(screen.getByRole('button', { name: names(ES).next }));
      expect(cells.map((cell) => cell.className.includes('invisible'))).toEqual([true, false, true]);
    });

    it('reads at least 4.5:1 against the card colour (title and subtitle), also on the production row', () => {
      for (const settings of [PRESET, PROD]) {
        const { unmount } = mount({ layout: 'spaced', settings });
        const card = screen.getByTestId('hero-carousel-card');
        const background = card.style.backgroundColor;
        const [title, subtitle] = within(screen.getByTestId('hero-slide-caption')).getAllByText(/Envíos a toda Cuba|Entrega en 7 días/);
        expect(contrastRatio(toHex(title.style.color), toHex(background))).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(toHex(subtitle.style.color), toHex(background))).toBeGreaterThanOrEqual(4.5);
        unmount();
      }
    });
  });

  describe('controls', () => {
    it('below md the arrows sit with the pause button and the dots, below the card', () => {
      state.wide = false;
      mount({ layout: 'spaced' });
      const card = screen.getByTestId('hero-carousel-card');
      const next = screen.getByRole('button', { name: names(ES).next });
      const pause = screen.getByRole('button', { name: names(ES).pause });
      expect(card.contains(next)).toBe(false);
      expect(next.parentElement).toBe(pause.parentElement);
      expect(screen.getAllByRole('button', { name: names(ES).next })).toHaveLength(1);
    });

    it('from md the arrows are overlaid on the sides of the poster as opaque round buttons of at least 40px; pause and dots stay below', () => {
      state.wide = true;
      mount({ layout: 'spaced' });
      const frameWrapper = screen.getByTestId('hero-carousel-frame').parentElement;
      for (const name of [names(ES).previous, names(ES).next]) {
        const arrow = screen.getByRole('button', { name });
        expect(frameWrapper.contains(arrow), name).toBe(true);
        const classes = arrow.className.split(/\s+/);
        expect(classes).toEqual(expect.arrayContaining(['absolute', 'rounded-full', 'h-11', 'w-11']));
        expect(classes.some((c) => c.startsWith('focus-visible:ring'))).toBe(true);
        expect(arrow.style.backgroundColor).not.toBe('');
        expect(arrow.style.backgroundColor).not.toMatch(/rgba|transparent/);
      }
      expect(screen.getAllByRole('button', { name: names(ES).next })).toHaveLength(1);
      const pause = screen.getByRole('button', { name: names(ES).pause });
      expect(screen.getByTestId('hero-carousel-card').contains(pause)).toBe(false);
      expect(pause.parentElement.contains(screen.getAllByRole('button', { name: /Ir al anuncio/ })[0])).toBe(false);
    });

    it('pause and the below-md arrows are at least 44px; dots keep a 44px touch area through padding', () => {
      mount({ layout: 'spaced' });
      for (const name of [names(ES).pause, names(ES).previous, names(ES).next]) {
        expect(screen.getByRole('button', { name }).className.split(/\s+/), name).toEqual(expect.arrayContaining(['h-11', 'w-11']));
      }
      for (const dot of screen.getAllByRole('button', { name: /Ir al anuncio/ })) {
        expect(dot.className.split(/\s+/)).toEqual(expect.arrayContaining(['relative', 'before:absolute', 'before:-inset-3']));
      }
    });

    it('the active dot is wider than the others and is exposed with aria-current', () => {
      mount({ layout: 'spaced' });
      const [first, second] = screen.getAllByRole('button', { name: /Ir al anuncio/ });
      expect(first.className).toContain('w-8');
      expect(second.className).not.toContain('w-8');
    });
  });

  describe('loading skeleton', () => {
    const skeleton = () => screen.getByTestId('hero-carousel-skeleton');

    it('reserves the card, the 3.8:1 frame, the caption and the controls row when nothing is known', () => {
      mount({ layout: 'spaced', slides: [], loading: true });
      expect(skeleton().querySelector('[class*="p-2"][class*="md:p-3"]')).toBeTruthy();
      expect(Number(skeleton().querySelector('[data-frame-ratio]').getAttribute('data-frame-ratio'))).toBeCloseTo(3.8, 5);
      expect(within(skeleton()).getByTestId('hero-caption-placeholder')).toBeTruthy();
      expect(within(skeleton()).getByTestId('hero-controls-placeholder').className).toContain('min-h-[2.75rem]');
    });

    it('the caption placeholder is as tall as a one-line title plus a one-line subtitle', () => {
      mount({ layout: 'spaced', slides: [], loading: true });
      expect(within(skeleton()).getByTestId('hero-caption-placeholder').className.split(/\s+/)).toEqual(expect.arrayContaining(['min-h-[3.75rem]', 'md:min-h-[4.25rem]']));
    });

    it('the carousel remembers its shape for the next visit and the skeleton follows it', () => {
      const first = mount({ layout: 'spaced', slides: BARE.slice(0, 1) });
      expect(JSON.parse(localStorage.getItem('hero-carousel-shape'))).toEqual({ caption: false, multiple: false });
      first.unmount();
      const second = mount({ layout: 'spaced', slides: [], loading: true });
      expect(within(skeleton()).queryByTestId('hero-caption-placeholder')).toBeNull();
      expect(within(skeleton()).queryByTestId('hero-controls-placeholder')).toBeNull();
      second.unmount();
      mount({ layout: 'spaced' });
      expect(JSON.parse(localStorage.getItem('hero-carousel-shape'))).toEqual({ caption: true, multiple: true });
    });

    it('survives unreadable or hostile stored values', () => {
      for (const value of ['not json', '{"caption":"no"}', 'null', '[]']) {
        localStorage.setItem('hero-carousel-shape', value);
        const { unmount } = mount({ layout: 'spaced', slides: [], loading: true });
        expect(within(skeleton()).getByTestId('hero-caption-placeholder')).toBeTruthy();
        unmount();
      }
    });
  });
});

describe('classic composition', () => {
  it('is the original cover: cover image, bg-black/60 veil, 60vh / 80vh', () => {
    mount({ layout: 'classic' });
    const hero = screen.getByTestId('home-hero');
    expect(hero.className.split(/\s+/)).toEqual(expect.arrayContaining(['relative', 'w-full', 'overflow-hidden', 'h-[60vh]', 'md:h-[80vh]']));
    expect(poster().className.split(/\s+/)).toEqual(expect.arrayContaining(['absolute', 'inset-0', 'h-full', 'w-full', 'object-cover']));
    expect(poster().className).not.toContain('object-contain');
    const veil = screen.getByTestId('hero-veil');
    expect(veil.className.split(/\s+/)).toEqual(expect.arrayContaining(['absolute', 'inset-0', 'bg-black/60']));
    expect(veil.getAttribute('aria-hidden')).toBe('true');
    expect(screen.queryByTestId('hero-carousel-card')).toBeNull();
    expect(screen.queryByTestId('hero-slide-caption')).toBeNull();
  });

  it('white text over the veil reads at least 4.5:1 in the worst case, a pure white poster', () => {
    mount({ layout: 'classic' });
    const alpha = Number(screen.getByTestId('hero-veil').className.match(/bg-black\/(\d+)/)[1]) / 100;
    const worst = Math.round(255 * (1 - alpha)).toString(16).padStart(2, '0');
    expect(contrastRatio('#ffffff', `#${worst}${worst}${worst}`)).toBeGreaterThanOrEqual(4.5);
  });

  it('puts the page title as the only h1 and the slide title as an h2 over the image, with the slide subtitle', () => {
    mount({ layout: 'classic' });
    const hero = screen.getByTestId('home-hero');
    expect(within(hero).getAllByRole('heading', { level: 1 })).toHaveLength(1);
    const h2 = within(hero).getByRole('heading', { level: 2 });
    expect(h2.textContent).toBe('Envíos a toda Cuba');
    expect(within(hero).getByText('Entrega en 7 días')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: names(ES).next }));
    expect(within(hero).getByRole('heading', { level: 2 }).textContent).toBe('Remesas seguras');
    expect(within(hero).getByText('Entrega en 7 días').closest('[aria-hidden="true"]')).not.toBeNull(); // still laid out, but hidden
    expect(within(hero).getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('shows no slide heading for a slide without title, and no empty heading in the tree', () => {
    mount({ layout: 'classic', slides: BARE });
    expect(within(screen.getByTestId('home-hero')).queryByRole('heading', { level: 2 })).toBeNull();
    expect(document.querySelectorAll('h1')).toHaveLength(1);
  });

  it('keeps the height of the text block constant across slides (stacked in one grid cell)', () => {
    mount({ layout: 'classic' });
    const stack = screen.getByTestId('hero-slide-text');
    expect(stack.className).toContain('grid');
    expect([...stack.children].map((cell) => cell.className.includes('invisible'))).toEqual([false, true, true]);
  });

  it('has the CTA "Ver Productos" (ES) / its EN copy', () => {
    mount({ layout: 'classic' });
    expect(screen.getByRole('button', { name: 'Ver Productos' })).toBeTruthy();
    expect(ES.home.hero.cta.products).toBe('Ver Productos');
  });

  it('uses translucent arrows over the image, at least 40px, with a visible focus ring, named for assistive tech', () => {
    mount({ layout: 'classic' });
    for (const name of [names(ES).previous, names(ES).next]) {
      const arrow = screen.getByRole('button', { name });
      const classes = arrow.className.split(/\s+/);
      expect(classes).toEqual(expect.arrayContaining(['absolute', 'top-1/2', 'rounded-full', 'bg-white/20', 'h-11', 'w-11']));
      expect(classes.some((c) => c.startsWith('focus-visible:ring'))).toBe(true);
      expect(arrow.querySelector('svg').getAttribute('aria-hidden')).toBe('true');
    }
  });

  it('puts the pause button and the dots over the bottom of the image', () => {
    mount({ layout: 'classic' });
    const pause = screen.getByRole('button', { name: names(ES).pause });
    expect(screen.getByTestId('hero-carousel').contains(pause)).toBe(true);
    expect(pause.parentElement.className).toContain('absolute');
    expect(pause.className.split(/\s+/).some((c) => c.startsWith('focus-visible:ring'))).toBe(true);
  });

  it('uses an empty alt because the slide title is visible text; the text block is the polite live region while paused', () => {
    mount({ layout: 'classic' });
    expect(poster().getAttribute('alt')).toBe('');
    const text = screen.getByTestId('hero-slide-text');
    expect(text.getAttribute('aria-live')).toBe('off'); // playing
    fireEvent.click(screen.getByRole('button', { name: names(ES).pause }));
    expect(text.getAttribute('aria-live')).toBe('polite');
  });

  it('pause and arrows are at least 44px; dots keep a 44px touch area through padding', () => {
    mount({ layout: 'classic' });
    for (const name of [names(ES).pause, names(ES).previous, names(ES).next]) {
      expect(screen.getByRole('button', { name }).className.split(/\s+/), name).toEqual(expect.arrayContaining(['h-11', 'w-11']));
    }
    for (const dot of screen.getAllByRole('button', { name: /Ir al anuncio/ })) {
      expect(dot.className.split(/\s+/)).toEqual(expect.arrayContaining(['relative', 'before:absolute', 'before:-inset-3']));
    }
  });

  it('shows the h1 and the CTA over a dark fallback while loading, with the same height, and never a carousel', () => {
    mount({ layout: 'classic', slides: [], loading: true });
    const hero = screen.getByTestId('home-hero');
    expect(hero.className.split(/\s+/)).toEqual(expect.arrayContaining(['h-[60vh]', 'md:h-[80vh]']));
    expect(within(hero).getByRole('heading', { level: 1 }).textContent).toBe(ES.home.hero.title);
    expect(within(hero).getByRole('button', { name: ES.home.hero.cta.products })).toBeTruthy();
    expect(screen.queryByTestId('hero-slide-image')).toBeNull();
  });

  it('keeps the h1 and the CTA when every image fails to load', () => {
    mount({ layout: 'classic', slides: CAPTIONED.slice(0, 2) });
    fireEvent.error(poster());
    fireEvent.error(poster());
    const hero = screen.getByTestId('home-hero');
    expect(screen.queryByTestId('hero-slide-image')).toBeNull();
    expect(within(hero).getByRole('heading', { level: 1 })).toBeTruthy();
    expect(within(hero).getByRole('button', { name: ES.home.hero.cta.products })).toBeTruthy();
  });

  it('translates the region and the slide announcement', () => {
    state.language = 'en';
    mount({ layout: 'classic' });
    expect(screen.getByRole('region', { name: EN.home.carousel.label })).toBeTruthy();
    const group = screen.getByRole('group', { name: EN.home.carousel.slideOf.replace('{count}', '1').replace('{total}', '3') });
    expect(group.getAttribute('aria-roledescription')).toBe(EN.home.carousel.slide);
    expect(within(screen.getByTestId('home-hero')).getByRole('heading', { level: 2 }).textContent).toBe('Shipping all over Cuba');
  });
});
