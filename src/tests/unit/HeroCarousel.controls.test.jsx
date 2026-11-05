import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import ES from '@/translations/ES.json';
import EN from '@/translations/EN.json';
import { PRESET, SLIDES } from './homeTestKit';

// Spec (S3) - WCAG 2.2.2 (pause/stop/hide) + prefers-reduced-motion for the Home carousel.
// Contract: src/components/home/HeroCarousel.jsx, default export, props { slides, visualSettings }.
// Language comes from useLanguage(). Autoplay interval = visualSettings.carouselAutoplaySpeed (default 5000).
//  - Autoplay pauses on hover, on keyboard focus inside, when the tab is hidden and when the user
//    presses the pause button; the user's explicit pause survives hover/focus changes.
//  - prefers-reduced-motion: reduce => starts paused (no auto-advance); the user may still resume it.
//  - aria-live on the slide frame is "off" while it autoplays and "polite" when it does not.
//  - A single slide shows no controls.

const state = vi.hoisted(() => ({ language: 'es', reduce: false }));

const translate = (key, params = {}) => {
  const dict = state.language === 'es' ? ES : EN;
  const value = key.split('.').reduce((acc, k) => (acc ? acc[k] : undefined), dict);
  if (typeof value !== 'string') return key;
  return Object.entries(params).reduce((acc, [k, v]) => acc.replace(`{${k}}`, v), value);
};

vi.mock('@/lib/supabase', () => ({ supabase: {} }));
vi.mock('@/contexts/LanguageContext', () => ({ useLanguage: () => ({ t: translate, language: state.language }) }));

import HeroCarousel from '@/components/home/HeroCarousel';

const mm = (matches) => (query) => ({
  matches: matches && /prefers-reduced-motion/.test(query),
  media: query,
  addEventListener: () => {},
  removeEventListener: () => {},
  addListener: () => {},
  removeListener: () => {},
});

const setHidden = (hidden) => {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  document.dispatchEvent(new Event('visibilitychange'));
};

const activeAlt = () => screen.getByTestId('hero-slide-image').getAttribute('alt');
const tick = (ms) => act(() => { vi.advanceTimersByTime(ms); });
const names = (dict) => ({
  pause: dict.home.carousel.pause,
  play: dict.home.carousel.play,
  next: dict.home.carousel.next,
  previous: dict.home.carousel.previous,
});

const mount = (settings = {}, slides = SLIDES) =>
  render(<HeroCarousel slides={slides} visualSettings={{ ...PRESET, ...settings }} />);

beforeEach(() => {
  vi.useFakeTimers();
  Object.assign(state, { language: 'es', reduce: false });
  window.matchMedia = mm(false);
});

afterEach(() => {
  vi.useRealTimers();
  setHidden(false);
  delete window.matchMedia;
});

describe('LCP image', () => {
  it('the first poster loads eagerly with high fetch priority; later posters do not claim it', () => {
    mount();
    const first = screen.getByTestId('hero-slide-image');
    expect(first.getAttribute('loading')).not.toBe('lazy');
    expect(first.getAttribute('fetchpriority')).toBe('high');
    fireEvent.click(screen.getByRole('button', { name: names(ES).next }));
    expect(screen.getByTestId('hero-slide-image').getAttribute('fetchpriority')).not.toBe('high');
  });
});

describe('autoplay', () => {
  it('advances every carouselAutoplaySpeed ms (default 5000) and wraps', () => {
    mount();
    expect(activeAlt()).toBe(SLIDES[0].title_es);
    tick(4999);
    expect(activeAlt()).toBe(SLIDES[0].title_es);
    tick(1);
    expect(activeAlt()).toBe(SLIDES[1].title_es);
    tick(5000);
    tick(5000);
    expect(activeAlt()).toBe(SLIDES[0].title_es);
  });

  it('uses the configured speed', () => {
    mount({ carouselAutoplaySpeed: 2500 });
    tick(2499);
    expect(activeAlt()).toBe(SLIDES[0].title_es);
    tick(1);
    expect(activeAlt()).toBe(SLIDES[1].title_es);
  });

  it('clamps a too-fast speed to 2000 ms and falls back to 5000 ms for garbage', () => {
    const fast = mount({ carouselAutoplaySpeed: 500 });
    tick(1999);
    expect(activeAlt()).toBe(SLIDES[0].title_es);
    tick(1);
    expect(activeAlt()).toBe(SLIDES[1].title_es);
    fast.unmount();
    mount({ carouselAutoplaySpeed: 'abc' });
    tick(4999);
    expect(activeAlt()).toBe(SLIDES[0].title_es);
    tick(1);
    expect(activeAlt()).toBe(SLIDES[1].title_es);
  });

  it('manual navigation still works (next / previous / dots)', () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: names(ES).next }));
    expect(activeAlt()).toBe(SLIDES[1].title_es);
    fireEvent.click(screen.getByRole('button', { name: names(ES).previous }));
    fireEvent.click(screen.getByRole('button', { name: names(ES).previous }));
    expect(activeAlt()).toBe(SLIDES[2].title_es);
  });
});

describe('pause / resume button', () => {
  it('is a button named Pausar while it plays; pressing it stops the autoplay and renames it Reanudar', () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: names(ES).pause }));
    tick(30000);
    expect(activeAlt()).toBe(SLIDES[0].title_es);
    const resume = screen.getByRole('button', { name: names(ES).play });
    fireEvent.click(resume);
    tick(5000);
    expect(activeAlt()).toBe(SLIDES[1].title_es);
    expect(screen.getByRole('button', { name: names(ES).pause })).toBeTruthy();
  });

  it('is named in English too', () => {
    state.language = 'en';
    mount();
    expect(screen.getByRole('button', { name: names(EN).pause })).toBeTruthy();
    expect(screen.getByRole('button', { name: names(EN).next })).toBeTruthy();
    expect(screen.getByRole('button', { name: names(EN).previous })).toBeTruthy();
  });
});

describe('automatic pauses', () => {
  it('pauses while the pointer is over the carousel and resumes on leave', () => {
    mount();
    const region = screen.getByTestId('hero-carousel');
    fireEvent.mouseEnter(region);
    tick(20000);
    expect(activeAlt()).toBe(SLIDES[0].title_es);
    fireEvent.mouseLeave(region);
    tick(5000);
    expect(activeAlt()).toBe(SLIDES[1].title_es);
  });

  it('pauses while keyboard focus is inside and resumes on blur', () => {
    mount();
    const next = screen.getByRole('button', { name: names(ES).next });
    act(() => next.focus());
    tick(20000);
    expect(activeAlt()).toBe(SLIDES[0].title_es);
    act(() => next.blur());
    tick(5000);
    expect(activeAlt()).toBe(SLIDES[1].title_es);
  });

  it('pauses while the tab is hidden (document.hidden) and resumes when visible', () => {
    mount();
    act(() => setHidden(true));
    tick(20000);
    expect(activeAlt()).toBe(SLIDES[0].title_es);
    act(() => setHidden(false));
    tick(5000);
    expect(activeAlt()).toBe(SLIDES[1].title_es);
  });

  it('the user pause is not undone by leaving the carousel or blurring a control', () => {
    mount();
    const region = screen.getByTestId('hero-carousel');
    fireEvent.click(screen.getByRole('button', { name: names(ES).pause }));
    fireEvent.mouseEnter(region);
    fireEvent.mouseLeave(region);
    act(() => screen.getByRole('button', { name: names(ES).play }).blur());
    tick(30000);
    expect(activeAlt()).toBe(SLIDES[0].title_es);
  });
});

describe('prefers-reduced-motion', () => {
  it('starts paused: no auto-advance, and the button offers to resume', () => {
    window.matchMedia = mm(true);
    mount();
    tick(30000);
    expect(activeAlt()).toBe(SLIDES[0].title_es);
    expect(screen.getByRole('button', { name: names(ES).play })).toBeTruthy();
  });

  it('the user may still start it explicitly', () => {
    window.matchMedia = mm(true);
    mount();
    fireEvent.click(screen.getByRole('button', { name: names(ES).play }));
    tick(5000);
    expect(activeAlt()).toBe(SLIDES[1].title_es);
  });

  it('does not crash where matchMedia does not exist', () => {
    delete window.matchMedia;
    mount();
    tick(5000);
    expect(activeAlt()).toBe(SLIDES[1].title_es);
  });
});

describe('semantics', () => {
  it('region has a name and the slide frame is aria-live off while playing, polite when not', () => {
    mount();
    const region = screen.getByTestId('hero-carousel');
    expect(region.getAttribute('aria-label')).toBe(ES.home.carousel.label);
    const frame = screen.getByTestId('hero-carousel-frame');
    expect(frame.getAttribute('aria-live')).toBe('off');
    fireEvent.click(screen.getByRole('button', { name: names(ES).pause }));
    expect(frame.getAttribute('aria-live')).toBe('polite');
  });

  it('with a single slide there are no arrows, dots or pause button and nothing advances', () => {
    mount({}, [SLIDES[0]]);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    tick(20000);
    expect(activeAlt()).toBe(SLIDES[0].title_es);
  });

  it('control icons are hidden from assistive tech (the buttons carry the names)', () => {
    mount();
    const next = screen.getByRole('button', { name: names(ES).next });
    const svg = next.querySelector('svg');
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
  });
});

describe('explicit resume', () => {
  it('Reanudar really resumes while the pointer and the keyboard focus are still on the carousel', () => {
    mount();
    const region = screen.getByTestId('hero-carousel');
    fireEvent.mouseEnter(region);
    const pause = screen.getByRole('button', { name: names(ES).pause });
    act(() => pause.focus());
    fireEvent.click(pause); // pointer over, focus inside, user pauses
    tick(30000);
    expect(activeAlt()).toBe(SLIDES[0].title_es);
    const play = screen.getByRole('button', { name: names(ES).play });
    act(() => play.focus());
    fireEvent.click(play); // still hovering and focused
    expect(screen.getByRole('button', { name: names(ES).pause })).toBeTruthy();
    expect(screen.getByTestId('hero-carousel-frame').getAttribute('aria-live')).toBe('off');
    tick(5000);
    expect(activeAlt()).toBe(SLIDES[1].title_es);
  });

  it('the override ends with the next mouse leave / blur: hovering again pauses again', () => {
    mount();
    const region = screen.getByTestId('hero-carousel');
    fireEvent.mouseEnter(region);
    fireEvent.click(screen.getByRole('button', { name: names(ES).pause }));
    fireEvent.click(screen.getByRole('button', { name: names(ES).play }));
    fireEvent.mouseLeave(region);
    tick(5000);
    expect(activeAlt()).toBe(SLIDES[1].title_es);
    fireEvent.mouseEnter(region);
    tick(20000);
    expect(activeAlt()).toBe(SLIDES[1].title_es);
  });
});

describe('slides without a usable image', () => {
  const BROKEN = { id: 'broken', title_es: 'Sin imagen', title_en: 'No image' };

  it('are filtered out: no dot, never shown', () => {
    mount({}, [SLIDES[0], BROKEN, SLIDES[1]]);
    expect(screen.getAllByRole('button', { name: new RegExp(ES.home.carousel.goTo.replace('{count}', '\\d')) })).toHaveLength(2);
    tick(5000);
    expect(activeAlt()).toBe(SLIDES[1].title_es);
  });

  it('an image that fails to load is skipped (dot removed, next slide shown)', () => {
    mount();
    fireEvent.error(screen.getByTestId('hero-slide-image'));
    expect(screen.getAllByRole('button', { name: new RegExp(ES.home.carousel.goTo.replace('{count}', '\\d')) })).toHaveLength(2);
    expect(activeAlt()).toBe(SLIDES[1].title_es);
    tick(5000);
    expect(activeAlt()).toBe(SLIDES[2].title_es);
  });

  it('renders nothing when no slide has an image', () => {
    const { container } = mount({}, [BROKEN]);
    expect(container.firstChild).toBeNull();
  });
});

describe('translated semantics', () => {
  it('region and slide announce a translated role description and "N de M"', () => {
    mount();
    const region = screen.getByTestId('hero-carousel');
    expect(region.getAttribute('aria-roledescription')).toBe(ES.home.carousel.roleDescription);
    const slide = screen.getByTestId('hero-slide-image').closest('[role="group"]');
    expect(slide).toBeTruthy();
    expect(slide.getAttribute('aria-roledescription')).toBe(ES.home.carousel.slide);
    expect(slide.getAttribute('aria-label')).toBe(ES.home.carousel.slideOf.replace('{count}', '1').replace('{total}', String(SLIDES.length)));
  });

  it('is translated in English', () => {
    state.language = 'en';
    mount();
    expect(screen.getByTestId('hero-carousel').getAttribute('aria-roledescription')).toBe(EN.home.carousel.roleDescription);
    const slide = screen.getByTestId('hero-slide-image').closest('[role="group"]');
    expect(slide.getAttribute('aria-label')).toBe(EN.home.carousel.slideOf.replace('{count}', '1').replace('{total}', String(SLIDES.length)));
  });

  it('uses an empty alt (decorative) when the slide has no title', () => {
    mount({}, [{ id: 'a', image_url: 'https://cdn.example.test/a.png' }, SLIDES[1]]);
    expect(screen.getByTestId('hero-slide-image').getAttribute('alt')).toBe('');
  });
});
