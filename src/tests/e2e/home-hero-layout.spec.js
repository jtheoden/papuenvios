import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

// Home hero compositions (heroLayout = 'spaced' | 'classic'). Supabase is fully mocked with page.route: no network,
// no real data. Set HOME_SHOTS_DIR to also save screenshots (evidence only, never a gate).
// Spec: no horizontal overflow from 320 to 414 in both; classic is a full-bleed cover whose h1, controls and
// arrows never collide; spaced aligns cards and carousel, frames the poster with its real ratio, shows arrows over the
// sides from md, and captions only when they exist; neither moves the page when the image or a slide loads
// (layout shift observed with delayed responses so it cannot pass vacuously; the spaced frame is sized once from every
// poster and then never changes); controls have 44px touch targets; classic text reads AA over a white poster; the pause button works from the
// keyboard and stays paused; an unknown heroLayout renders spaced.

const SHOTS_DIR = process.env.HOME_SHOTS_DIR;

test.describe.configure({ timeout: 60000 });

// Literal values on purpose: Playwright does not resolve the '@/' alias.
const PRESET_ROW = {
  pageBgColor: '#FAF7F0', cardBgColor: '#FFFFFF', accentColor: '#FFA500', useGradient: false, useHeaderGradient: false,
  headerBgColor: '#FFFFFF', headerTextColor: '#171717', headingColor: '#171717', useHeadingGradient: false,
  buttonBgColor: '#FFA500', buttonTextColor: '#171717', buttonHoverBgColor: '#E59400', useButtonGradient: false,
  carouselDotActiveColor: '#FFA500', borderColor: '#E8E0D2', mutedTextColor: '#605B52', softAccentColor: '#FFF1CC', focusRingColor: '#171717',
};
const PROD_ROW = {
  useGradient: true, useButtonGradient: true, useHeadingGradient: true, logo: '', primaryColor: '#3499dc', secondaryColor: '#9333ea',
  accentColor: '#9333ea', buttonBgColor: '#2563eb', buttonTextColor: '#ffffff', buttonHoverBgColor: '#1d4ed8', headerBgColor: '#ffffff',
  headerTextColor: '#1f2937', pageBgColor: '#f9fafb',
};

const poster = (n, w, h) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="#${['1d4ed8', '0f766e', '9a3412'][n]}"/><text x="40" y="${h / 2}" font-size="${h / 4}" fill="#fff" font-family="sans-serif">Poster ${n + 1}</text></svg>`;
const SIZES = [[1520, 400], [1520, 400], [1520, 400]];
const slidesFor = (captions) => [0, 1, 2].map((n) => ({
  id: `s${n + 1}`, is_active: true, display_order: n, image_url: `https://cdn.example.test/poster-${n + 1}.svg`,
  title_es: captions ? `Anuncio ${n + 1}` : '', title_en: captions ? `Announcement ${n + 1}` : '',
  subtitle_es: captions ? 'Entrega en 7 días a toda Cuba' : '', subtitle_en: captions ? 'Delivery in 7 days all over Cuba' : '',
}));
const json = (route, body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const mockSupabase = async (page, { settings, captions, sizes, slidesDelay, imageDelay }) => {
  await page.route('https://cdn.example.test/**', async (route) => {
    const n = Number(route.request().url().match(/poster-(\d)/)?.[1] ?? 1) - 1;
    if (imageDelay) await sleep(imageDelay);
    return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: poster(n, ...sizes[n]) });
  });
  await page.route(/\/(rest|auth|functions|storage)\/v1\//, async (route) => {
    const request = route.request();
    const url = request.url();
    const wantsObject = (request.headers().accept || '').includes('pgrst.object');
    if (url.includes('/rest/v1/business_visual_settings')) {
      if (!settings) return route.fulfill({ status: 406, contentType: 'application/json', body: JSON.stringify({ code: 'PGRST116', message: 'no rows' }) });
      return json(route, wantsObject ? { settings } : [{ settings }]);
    }
    if (url.includes('/auth/v1/')) return route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ message: 'not authenticated' }) });
    if (url.includes('/rest/v1/carousel_slides')) {
      if (slidesDelay) await sleep(slidesDelay);
      return json(route, slidesFor(captions));
    }
    if (url.includes('/rest/v1/offers')) return json(route, []);
    if (url.includes('/rest/v1/publications')) return json(route, []);
    if (url.includes('/rest/v1/testimonials')) return json(route, []);
    if (url.includes('/rpc/get_public_landing_stats')) return json(route, { users: 1, remittances_completed: 1, orders_completed: 1, first_year: 2023 });
    return json(route, wantsObject ? {} : []);
  });
};

// Layout shifts that touch the hero or the strip right after it, recorded from the start of the page.
const observeShifts = (page) => page.addInitScript(() => {
  window.__shifts = [];
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      if (entry.hadRecentInput) continue;
      const hero = document.querySelector('[data-testid="home-hero"]');
      const relevant = (entry.sources || []).some((source) => {
        const el = source.node && (source.node.nodeType === 1 ? source.node : source.node.parentElement);
        const top = el && el.closest('[data-testid="home-page"] > *');
        return top && hero && (top === hero || top === hero.nextElementSibling);
      });
      window.__shifts.push({ at: entry.startTime, value: entry.value, relevant });
    }
  }).observe({ type: 'layout-shift', buffered: true });
});
const shiftsSince = (page, mark) => page.evaluate((m) => window.__shifts.filter((s) => s.relevant && s.at > m).reduce((sum, s) => sum + s.value, 0), mark);

const open = async (page, { heroLayout, settings = PRESET_ROW, language = 'es', captions = true, sizes = SIZES, slidesDelay = 0, imageDelay = 0, waitImage = true, shape } = {}) => {
  const row = heroLayout === undefined ? settings : { ...settings, heroLayout };
  await mockSupabase(page, { settings: row, captions, sizes, slidesDelay, imageDelay });
  await observeShifts(page);
  await page.addInitScript((lang) => localStorage.setItem('preferredLanguage', lang), language);
  // a previous visit: the skeleton follows what the carousel looked like then (see heroShape.js)
  if (shape) await page.addInitScript((value) => localStorage.setItem('hero-carousel-shape', JSON.stringify(value)), shape);
  await page.goto('/');
  if (!waitImage) return;
  await expect(page.locator('[data-testid="hero-carousel"]')).toBeVisible({ timeout: 20000 });
  await expect(page.locator('[data-testid="hero-slide-image"]')).toHaveJSProperty('complete', true, { timeout: 15000 });
  // spaced sizes its frame once from every poster; classic has no frame to wait for
  if (await page.locator('[data-testid="hero-carousel-frame"]').count()) {
    await expect(page.locator('[data-testid="hero-carousel-frame"]')).toHaveAttribute('data-frame-ready', 'true', { timeout: 15000 });
  }
};

const box = async (locator) => {
  const b = await locator.boundingBox();
  if (!b) throw new Error('element has no box');
  return { ...b, right: b.x + b.width, bottom: b.y + b.height };
};
const channel = (c) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const luminance = ([r, g, b]) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
const rgbOf = (css) => css.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number);
const ratio = (a, b) => { const [x, y] = [luminance(rgbOf(a)), luminance(rgbOf(b))].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const activeDot = (page) => page.evaluate(() => [...document.querySelectorAll('[data-testid="hero-carousel"] button')].filter((b) => /\d/.test(b.getAttribute('aria-label') || '')).findIndex((b) => b.getAttribute('aria-current') === 'true'));
const heroHeight = async (page) => (await box(page.locator('[data-testid="home-hero"]'))).height;
const shot = async (page, name) => {
  if (!SHOTS_DIR) return;
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
  await page.waitForTimeout(400);
  await page.locator('[data-testid="home-hero"]').screenshot({ path: path.join(SHOTS_DIR, name) });
};

const LAYOUTS = ['spaced', 'classic'];

for (const heroLayout of LAYOUTS) {
  for (const width of [320, 360, 390, 414, 768, 1280]) {
    test.describe(`${heroLayout} at ${width}px`, () => {
      test.use({ viewport: { width, height: 800 } });

      test('no horizontal overflow, one h1, pause visible and inside the viewport (ES)', async ({ page }) => {
        await open(page, { heroLayout });
        await shot(page, `hero-${heroLayout}-${width}.png`);
        expect(await overflow(page)).toBeLessThanOrEqual(0);
        await expect(page.locator('h1')).toHaveCount(1);
        const pause = page.getByRole('button', { name: /Pausar|Reanudar/ });
        await expect(pause).toBeVisible();
        const b = await box(pause);
        expect(b.x).toBeGreaterThanOrEqual(0);
        expect(b.right).toBeLessThanOrEqual(width);
      });
    });
  }

  test.describe(`${heroLayout} in English at 320px`, () => {
    test.use({ viewport: { width: 320, height: 800 } });
    test('no horizontal overflow and translated control names', async ({ page }) => {
      await open(page, { heroLayout, language: 'en' });
      expect(await overflow(page)).toBeLessThanOrEqual(0);
      for (const name of [/Pause carousel/, /Previous announcement/, /Next announcement/, /Go to announcement 1/]) {
        await expect(page.getByRole('button', { name })).toBeVisible();
      }
    });
  });
}

test.describe('classic composition', () => {
  for (const width of [320, 390, 768, 1280]) {
    test.describe(`at ${width}px`, () => {
      test.use({ viewport: { width, height: 800 } });

      test('is a full-bleed cover with the veil, and h1, controls and arrows do not collide or hide under the header', async ({ page }) => {
        await open(page, { heroLayout: 'classic' });
        const hero = await box(page.locator('[data-testid="home-hero"]'));
        expect(Math.abs(hero.x)).toBeLessThan(1);
        expect(Math.abs(hero.width - width)).toBeLessThan(1);
        expect(hero.height).toBeGreaterThanOrEqual(Math.min(480, 800 * (width >= 768 ? 0.8 : 0.6)) - 1);
        await expect(page.locator('[data-testid="hero-slide-image"]')).toHaveCSS('object-fit', 'cover');
        await expect(page.locator('[data-testid="hero-slide-image"]')).toHaveAttribute('fetchpriority', 'high');
        await expect(page.locator('[data-testid="hero-veil"]')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0.6)');
        await expect(page.locator('[data-testid="hero-card"]')).toHaveCount(0);

        const header = await box(page.locator('header').first());
        const h1 = await box(page.locator('[data-testid="home-hero"] h1'));
        expect(h1.y).toBeGreaterThanOrEqual(header.bottom + 16 - 0.5);
        expect(h1.x).toBeGreaterThanOrEqual(0);
        expect(h1.right).toBeLessThanOrEqual(width + 0.5);
        const prev = await box(page.getByRole('button', { name: /Anuncio anterior/ }));
        const next = await box(page.getByRole('button', { name: /Anuncio siguiente/ }));
        expect(prev.width).toBeGreaterThanOrEqual(44 - 0.5);
        expect(h1.x).toBeGreaterThanOrEqual(prev.right - 0.5);
        expect(h1.right).toBeLessThanOrEqual(next.x + 0.5);
        const cta = await box(page.getByRole('button', { name: 'Ver Productos' }));
        const pause = await box(page.getByRole('button', { name: /Pausar/ }));
        expect(cta.bottom).toBeLessThanOrEqual(pause.y + 0.5);
        const dots = await box(page.getByRole('button', { name: /Ir al anuncio 1/ }));
        expect(pause.right).toBeLessThanOrEqual(dots.x + 0.5);
        expect(hero.bottom).toBeGreaterThanOrEqual(dots.bottom);
      });
    });
  }

  test.describe('text', () => {
    test.use({ viewport: { width: 1280, height: 800 } });

    test('white text reads at least 4.5:1 over the veil in the worst case, a pure white poster (title, subtitle)', async ({ page }) => {
      await open(page, { heroLayout: 'classic' });
      const alpha = await page.locator('[data-testid="hero-veil"]').evaluate((el) => Number(getComputedStyle(el).backgroundColor.match(/[\d.]+/g)[3]));
      const worst = Math.round(255 * (1 - alpha));
      const background = `rgb(${worst}, ${worst}, ${worst})`;
      for (const locator of [page.locator('[data-testid="home-hero"] h1'), page.getByRole('heading', { level: 2, name: 'Anuncio 1' }), page.locator('[data-testid="hero-slide-text"] p').first()]) {
        const color = await locator.evaluate((el) => getComputedStyle(el).color);
        expect(ratio(color, background), color).toBeGreaterThanOrEqual(4.5);
      }
    });

    test('page title is the only h1; the slide title is an h2 and changes with the slide; the CTA goes to products', async ({ page }) => {
      await open(page, { heroLayout: 'classic' });
      await expect(page.locator('h1')).toHaveCount(1);
      const h1 = await page.locator('h1').elementHandle();
      await expect(page.getByRole('heading', { level: 2, name: 'Anuncio 1' })).toBeVisible();
      await expect(page.getByText('Entrega en 7 días a toda Cuba').first()).toBeVisible();
      await page.getByRole('button', { name: /Anuncio siguiente/ }).click();
      await expect(page.getByRole('heading', { level: 2, name: 'Anuncio 2' })).toBeVisible();
      await expect(page.locator('[data-testid="home-hero"]').getByRole('heading', { level: 2 })).toHaveCount(1); // the other slides are hidden from the tree
      expect(await page.locator('h1').elementHandle().then((handle) => handle.evaluate((el, original) => el === original, h1))).toBe(true);
    });
  });
});

test.describe('spaced composition', () => {
  for (const width of [390, 768, 1280]) {
    test.describe(`at ${width}px`, () => {
      test.use({ viewport: { width, height: 900 } });

      test('cards and carousel share one width; card padding; frame takes the poster ratio; arrows where they belong', async ({ page }) => {
        await open(page, { heroLayout: 'spaced' });
        const cards = page.locator('[data-testid="hero-card"]');
        const cardsRow = await box(cards.first().locator('xpath=..'));
        const carousel = await box(page.locator('[data-testid="hero-carousel"]'));
        expect(Math.abs(cardsRow.x - carousel.x)).toBeLessThan(1);
        expect(Math.abs(cardsRow.width - carousel.width)).toBeLessThan(1);
        expect(Math.abs(carousel.x + carousel.width / 2 - width / 2)).toBeLessThan(2);

        const card = page.locator('[data-testid="hero-carousel-card"]');
        await expect(card).toHaveCSS('padding-top', width >= 768 ? '12px' : '8px');
        await expect(card).toHaveCSS('padding-left', width >= 768 ? '12px' : '8px');
        const frame = await box(page.locator('[data-testid="hero-carousel-frame"]'));
        expect(Math.abs(frame.width / frame.height - 1520 / 400)).toBeLessThan(0.05);

        const arrows = [page.getByRole('button', { name: /Anuncio anterior/ }), page.getByRole('button', { name: /Anuncio siguiente/ })];
        for (const arrow of arrows) {
          const b = await box(arrow);
          expect(b.width).toBeGreaterThanOrEqual(44 - 0.5);
          expect(b.height).toBeGreaterThanOrEqual(44 - 0.5);
          if (width >= 768) {
            // overlaid on the poster, at its sides, vertically centred
            expect(b.x).toBeGreaterThanOrEqual(frame.x - 0.5);
            expect(b.right).toBeLessThanOrEqual(frame.right + 0.5);
            expect(Math.abs(b.y + b.height / 2 - (frame.y + frame.height / 2))).toBeLessThan(2);
            const bg = await arrow.evaluate((el) => getComputedStyle(el).backgroundColor);
            expect(bg).not.toMatch(/rgba\(.*, 0(\.\d+)?\)/);
            expect(bg).toMatch(/^rgb\(/);
          } else {
            expect(b.y).toBeGreaterThanOrEqual(frame.bottom); // below the card, with the pause button and the dots
          }
        }
        const pause = await box(page.getByRole('button', { name: /Pausar/ }));
        expect(pause.y).toBeGreaterThanOrEqual(frame.bottom);
        expect(pause.width).toBeGreaterThanOrEqual(44 - 0.5);
        expect(pause.height).toBeGreaterThanOrEqual(44 - 0.5);
        const dot = await box(page.getByRole('button', { name: /Ir al anuncio 1/ }));
        expect(dot.y).toBeGreaterThanOrEqual(frame.bottom);
        await expect(page.locator('[data-testid="home-hero"] .bg-black\\/50')).toHaveCount(0);
        await shot(page, `hero-spaced-captioned-${width}.png`);
      });
    });
  }

  test.describe('caption', () => {
    test.use({ viewport: { width: 1280, height: 900 } });

    for (const [name, row] of [['brand preset', PRESET_ROW], ['production row', PROD_ROW]]) {
      test(`shows the slide title and subtitle under the poster with AA contrast (${name})`, async ({ page }) => {
        await open(page, { heroLayout: 'spaced', settings: row });
        const caption = page.locator('[data-testid="hero-slide-caption"]');
        await expect(caption.getByText('Anuncio 1')).toBeVisible();
        await expect(caption.getByText('Entrega en 7 días a toda Cuba').first()).toBeVisible();
        const frame = await box(page.locator('[data-testid="hero-carousel-frame"]'));
        const captionBox = await box(caption);
        const card = await box(page.locator('[data-testid="hero-carousel-card"]'));
        expect(captionBox.y).toBeGreaterThanOrEqual(frame.bottom - 0.5);
        expect(captionBox.bottom).toBeLessThanOrEqual(card.bottom + 0.5);
        const cardBg = await page.locator('[data-testid="hero-carousel-card"]').evaluate((el) => getComputedStyle(el).backgroundColor);
        for (const text of [caption.getByText('Anuncio 1'), caption.getByText('Entrega en 7 días a toda Cuba').first()]) {
          const color = await text.evaluate((el) => getComputedStyle(el).color);
          expect(ratio(color, cardBg), color).toBeGreaterThanOrEqual(4.5);
        }
      });
    }

    test('does not exist when no slide has a title or subtitle', async ({ page }) => {
      await open(page, { heroLayout: 'spaced', captions: false });
      await expect(page.locator('[data-testid="hero-slide-caption"]')).toHaveCount(0);
    });
  });
});

test.describe('touch targets', () => {
  for (const heroLayout of LAYOUTS) {
    test.describe(`${heroLayout} at 390px`, () => {
      test.use({ viewport: { width: 390, height: 900 } });

      test('pause, arrows and dots offer at least 44x44 CSS px to the finger (dots through an invisible ::before)', async ({ page }) => {
        await open(page, { heroLayout });
        for (const name of [/Pausar/, /Anuncio anterior/, /Anuncio siguiente/]) {
          const b = await box(page.getByRole('button', { name }));
          expect(b.width, String(name)).toBeGreaterThanOrEqual(44 - 0.5);
          expect(b.height, String(name)).toBeGreaterThanOrEqual(44 - 0.5);
        }
        const dots = page.getByRole('button', { name: /Ir al anuncio/ });
        const areas = [];
        for (const dot of await dots.all()) {
          const area = await dot.evaluate((el) => {
            const own = el.getBoundingClientRect();
            const hit = getComputedStyle(el, '::before');
            return { x: own.x - 10, width: parseFloat(hit.width), height: parseFloat(hit.height) };
          });
          expect(area.width).toBeGreaterThanOrEqual(44);
          expect(area.height).toBeGreaterThanOrEqual(44);
          areas.push(area);
        }
        // neighbouring touch areas never overlap
        for (let i = 1; i < areas.length; i += 1) expect(areas[i].x).toBeGreaterThanOrEqual(areas[i - 1].x + areas[i - 1].width - 0.5);
      });
    });
  }
});

test.describe('unknown heroLayout values render spaced in the browser', () => {
  test.use({ viewport: { width: 1280, height: 800 } });
  for (const heroLayout of ['<script>alert(1)</script>', 'CLASSIC', 7, null]) {
    test(`heroLayout ${JSON.stringify(heroLayout)}`, async ({ page }) => {
      await open(page, { heroLayout });
      await expect(page.locator('[data-testid="hero-card"]')).toHaveCount(2);
      await expect(page.locator('[data-testid="hero-veil"]')).toHaveCount(0);
      await expect(page.locator('[data-testid="hero-carousel-card"]')).toHaveCount(1);
    });
  }
});

test.describe('layout shift', () => {
  // tall on purpose: Chrome only reports shifts of what is inside the viewport, and the carousel is below the fold on a phone
  test.use({ viewport: { width: 390, height: 2400 } });

  for (const heroLayout of LAYOUTS) {
    test(`${heroLayout}: the image landing late moves nothing (slides ready, image delayed 2.5 s)`, async ({ page }) => {
      await open(page, { heroLayout, imageDelay: 2500, waitImage: false });
      await expect(page.locator('[data-testid="hero-carousel"]')).toBeVisible({ timeout: 20000 });
      const complete = await page.locator('[data-testid="hero-slide-image"]').evaluate((img) => img.complete);
      expect(complete, 'the image must still be loading for this test to mean anything').toBe(false);
      const mark = await page.evaluate(() => performance.now());
      await expect(page.locator('[data-testid="hero-slide-image"]')).toHaveJSProperty('complete', true, { timeout: 15000 });
      await page.waitForTimeout(600);
      expect(await shiftsSince(page, mark)).toBeLessThan(0.001);
    });
  }

  test('control: a poster whose ratio differs from the 3.8:1 skeleton IS detected as a shift (the observer is not blind)', async ({ page }) => {
    await open(page, { heroLayout: 'spaced', imageDelay: 2500, waitImage: false, sizes: [[1000, 500], [1000, 500], [1000, 500]] });
    await expect(page.locator('[data-testid="hero-carousel"]')).toBeVisible({ timeout: 20000 });
    const mark = await page.evaluate(() => performance.now());
    await expect(page.locator('[data-testid="hero-slide-image"]')).toHaveJSProperty('complete', true, { timeout: 15000 });
    await page.waitForTimeout(600);
    expect(await shiftsSince(page, mark)).toBeGreaterThan(0.001);
  });

  for (const width of [390, 1280]) {
    test(`spaced at ${width}px: the skeleton and the loaded carousel have the same height with captions (first visit, no hint)`, async ({ page }) => {
      await page.setViewportSize({ width, height: 2400 });
      await open(page, { heroLayout: 'spaced', captions: true, slidesDelay: 2000, waitImage: false });
      await expect(page.locator('[data-testid="hero-carousel-skeleton"]')).toBeVisible({ timeout: 20000 });
      await expect(page.locator('[data-testid="hero-caption-placeholder"]')).toBeVisible();
      await expect(page.locator('[data-testid="hero-controls-placeholder"]')).toBeVisible();
      const skeleton = await heroHeight(page);
      await expect(page.locator('[data-testid="hero-carousel-frame"]')).toHaveAttribute('data-frame-ready', 'true', { timeout: 15000 });
      await page.waitForTimeout(300);
      expect(Math.abs((await heroHeight(page)) - skeleton)).toBeLessThanOrEqual(1);
    });
  }

  test('spaced: with the shape of a previous visit (no captions) the skeleton has the same height as the loaded carousel', async ({ page }) => {
    await open(page, { heroLayout: 'spaced', captions: false, slidesDelay: 2000, waitImage: false, shape: { caption: false, multiple: true } });
    await expect(page.locator('[data-testid="hero-carousel-skeleton"]')).toBeVisible({ timeout: 20000 });
    await expect(page.locator('[data-testid="hero-caption-placeholder"]')).toHaveCount(0);
    const skeleton = await heroHeight(page);
    await expect(page.locator('[data-testid="hero-carousel-frame"]')).toHaveAttribute('data-frame-ready', 'true', { timeout: 15000 });
    await page.waitForTimeout(300);
    expect(Math.abs((await heroHeight(page)) - skeleton)).toBeLessThanOrEqual(1);
  });

  test('classic: loading and loaded states are the same height (slides delayed 2 s)', async ({ page }) => {
    await open(page, { heroLayout: 'classic', slidesDelay: 2000, waitImage: false });
    await expect(page.locator('[data-testid="home-hero"]')).toBeVisible({ timeout: 20000 });
    await expect(page.locator('[data-testid="hero-slide-image"]')).toHaveCount(0);
    const loading = await heroHeight(page);
    await expect(page.locator('[data-testid="hero-slide-image"]')).toHaveJSProperty('complete', true, { timeout: 15000 });
    expect(Math.abs((await heroHeight(page)) - loading)).toBeLessThanOrEqual(1);
  });

  test('spaced: posters of different ratios size the frame once; after the first paint of content nothing shifts (autoplay through every slide)', async ({ page }) => {
    await open(page, { heroLayout: 'spaced', captions: false, sizes: [[1520, 400], [1000, 500], [1520, 400]], settings: { ...PRESET_ROW, carouselAutoplaySpeed: 2000, carouselTransitionSpeed: 100 }, shape: { caption: false, multiple: true } });
    await page.mouse.move(5, 5);
    const frameBox = await box(page.locator('[data-testid="hero-carousel-frame"]'));
    expect(Math.abs(frameBox.width / frameBox.height - 2)).toBeLessThan(0.05); // the tallest of all, from the first paint
    const mark = await page.evaluate(() => performance.now());
    const settled = await heroHeight(page);
    const seen = new Set();
    const until = Date.now() + 8000; // more than a full cycle of 3 slides at 2 s
    while (Date.now() < until) {
      seen.add(await activeDot(page));
      expect(Math.abs((await heroHeight(page)) - settled)).toBeLessThanOrEqual(1);
      await page.waitForTimeout(250);
    }
    expect([...seen].sort()).toEqual([0, 1, 2]);
    expect(await shiftsSince(page, mark)).toBeLessThan(0.001);
  });

  test('spaced: captions of different length do not change the height across slides', async ({ page }) => {
    await open(page, { heroLayout: 'spaced' });
    await page.getByRole('button', { name: /Pausar/ }).click();
    const settled = await heroHeight(page);
    for (const index of [1, 2, 0]) {
      await page.getByRole('button', { name: /Ir al anuncio/ }).nth(index).click();
      await page.waitForTimeout(200);
      expect(Math.abs((await heroHeight(page)) - settled)).toBeLessThanOrEqual(1);
    }
  });
});

test.describe('keyboard: the pause button really pauses', () => {
  test.use({ viewport: { width: 1280, height: 800 } });
  const FAST = { ...PRESET_ROW, carouselAutoplaySpeed: 2000, carouselTransitionSpeed: 100 };

  for (const heroLayout of LAYOUTS) {
    test(`${heroLayout}: Enter pauses, it stays paused after focus leaves, Space resumes`, async ({ page }) => {
      await open(page, { heroLayout, settings: FAST });
      await page.mouse.move(5, 5);
      await expect.poll(() => activeDot(page), { timeout: 6000 }).toBeGreaterThan(0);

      const pause = page.getByRole('button', { name: /Pausar/ });
      await pause.focus();
      await page.keyboard.press('Enter');
      await expect(page.getByRole('button', { name: /Reanudar/ })).toBeVisible();
      // focus inside already pauses the carousel, so leave: only the user's pause can keep it still now
      await page.evaluate(() => document.activeElement.blur());
      await page.mouse.move(5, 5);
      const frozen = await activeDot(page);
      await page.waitForTimeout(3500);
      expect(await activeDot(page)).toBe(frozen);

      await page.getByRole('button', { name: /Reanudar/ }).focus();
      await page.keyboard.press('Space');
      await expect(page.getByRole('button', { name: /Pausar/ })).toBeVisible();
      await page.evaluate(() => document.activeElement.blur());
      await page.mouse.move(5, 5);
      await expect.poll(() => activeDot(page), { timeout: 6000 }).not.toBe(frozen);
    });

    test(`${heroLayout}: prefers-reduced-motion starts paused and the button resumes it`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await open(page, { heroLayout, settings: FAST });
      await page.mouse.move(5, 5);
      await page.waitForTimeout(3500);
      expect(await activeDot(page)).toBe(0);
      await expect(page.getByRole('button', { name: /Reanudar/ })).toBeVisible();
    });

    test(`${heroLayout}: arrows and dots show a visible focus ring from the keyboard`, async ({ page }) => {
      await open(page, { heroLayout, settings: FAST });
      await page.getByRole('button', { name: /Pausar/ }).click();
      for (const name of [/Anuncio siguiente/, /Ir al anuncio 2/]) {
        const control = page.getByRole('button', { name });
        await control.focus();
        await page.keyboard.press('Shift+Tab');
        await page.keyboard.press('Tab'); // arrives by keyboard, so :focus-visible matches
        await expect(control).toBeFocused();
        const shadow = await control.evaluate((el) => getComputedStyle(el).boxShadow);
        expect(shadow, String(name)).not.toBe('none');
      }
    });
  }
});
