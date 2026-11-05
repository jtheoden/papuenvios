import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

// Home hero + carousel brand theme (S2/S3). Supabase is fully mocked with page.route: no network, no real data.
// Set HOME_SHOTS_DIR to also save screenshots (evidence only, never a gate).
// Spec: no horizontal overflow at 320/768/1280 in ES and EN; text and carousel never overlap (side by side from
// lg, stacked below); the production row keeps its blue/violet CTA and gradient page; the preset shows the brand
// CTA (gold, charcoal text, AA contrast), the ivory page and a gold active dot; dots are >= 24px targets;
// autoplay stops with prefers-reduced-motion and with the pause button.

const SHOTS_DIR = process.env.HOME_SHOTS_DIR;

// Literal values on purpose: Playwright does not resolve the '@/' alias and this keeps the check independent of brandPalette.js.
const BRAND_PRESET = {
  pageBgColor: '#FAF7F0',
  cardBgColor: '#FFFFFF',
  accentColor: '#FFA500',
  useGradient: false,
  useHeaderGradient: false,
  headerBgColor: '#FFFFFF',
  headerTextColor: '#171717',
  headerMenuBgColor: '#FFFFFF',
  headerMenuTextColor: '#171717',
  headerMenuHoverBgColor: '#FAF7F0',
  headerMenuHoverTextColor: '#171717',
  headerMenuActiveBgColor: '#FFF1CC',
  headerMenuActiveColor: '#171717',
  navBarActiveBgColor: '#FFF1CC',
  navBarActiveTextColor: '#171717',
  headingColor: '#171717',
  useHeadingGradient: false,
  buttonBgColor: '#FFA500',
  buttonTextColor: '#171717',
  buttonHoverBgColor: '#E59400',
  useButtonGradient: false,
  cartBadgeBgColor: '#FFA500',
  cartBadgeTextColor: '#171717',
  carouselDotActiveColor: '#FFA500',
  borderColor: '#E8E0D2',
  mutedTextColor: '#605B52',
  softAccentColor: '#FFF1CC',
  focusRingColor: '#171717',
};

// Row stored in production today (the app merges it over its code defaults).
const PROD_ROW = {
  useGradient: true,
  useButtonGradient: true,
  useHeadingGradient: true,
  logo: '',
  primaryColor: '#3499dc',
  secondaryColor: '#9333ea',
  accentColor: '#9333ea',
  headerGradientColor: '#9333ea',
  gradientDirection: '320',
  navBarActiveBgColor: '#2563eb',
  navBarActiveTextColor: '#ffffff',
  headerMenuActiveBgColor: '#eff6ff',
  headerMenuActiveColor: '#2563eb',
  buttonBgColor: '#2563eb',
  buttonTextColor: '#ffffff',
  buttonHoverBgColor: '#1d4ed8',
  headerBgColor: '#ffffff',
  headerTextColor: '#1f2937',
  pageBgColor: '#f9fafb',
};

// A 3.8:1 poster (the real banners are wide), served from a fake CDN.
const POSTER = (n) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1520 400"><rect width="1520" height="400" fill="#${['1d4ed8', '0f766e', '9a3412'][n]}"/><text x="60" y="230" font-size="90" fill="#fff" font-family="sans-serif">Poster ${n + 1}</text></svg>`;
const SLIDES = [0, 1, 2].map((n) => ({
  id: `s${n + 1}`, is_active: true, display_order: n,
  image_url: `https://cdn.example.test/poster-${n + 1}.svg`,
  title_es: `Anuncio ${n + 1}`, title_en: `Announcement ${n + 1}`, subtitle_es: 'sub', subtitle_en: 'sub',
}));
const OFFERS = [{ id: 'o1', code: 'PAPU10', is_active: true, discount_type: 'percentage', discount_value: 10, end_date: '2099-01-31T00:00:00Z', max_usage_global: 5 }];
const PUBLICATIONS = [{ id: 'p1', is_published: true, title_es: 'Guía para enviar', title_en: 'How to send', content_es: 'Contenido de la guía', content_en: 'Guide content', cover_image_url: null }];
const TESTIMONIALS = [{ id: 't1', is_visible: true, user_name: 'Ana', rating: 5, comment: 'Todo llegó perfecto', user_avatar: null }];
const STATS = { users: 120, remittances_completed: 340, orders_completed: 560, first_year: 2023 };

const json = (route, body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

const mockSupabase = async (page, settings) => {
  await page.route('https://cdn.example.test/**', (route) => {
    const n = Number(route.request().url().match(/poster-(\d)/)?.[1] ?? 1) - 1;
    return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: POSTER(n) });
  });
  await page.route(/\/(rest|auth|functions|storage)\/v1\//, async (route) => {
    const request = route.request();
    const url = request.url();
    const wantsObject = (request.headers().accept || '').includes('pgrst.object');
    if (url.includes('/rest/v1/business_visual_settings')) {
      if (!settings) return route.fulfill({ status: 406, contentType: 'application/json', body: JSON.stringify({ code: 'PGRST116', message: 'no rows', details: null, hint: null }) });
      return json(route, wantsObject ? { settings } : [{ settings }]);
    }
    if (url.includes('/auth/v1/')) return route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ message: 'not authenticated' }) });
    if (url.includes('/rest/v1/carousel_slides')) return json(route, SLIDES);
    if (url.includes('/rest/v1/offers')) return json(route, OFFERS);
    if (url.includes('/rest/v1/publications')) return json(route, PUBLICATIONS);
    if (url.includes('/rest/v1/testimonials')) return json(route, TESTIMONIALS);
    if (url.includes('/rpc/get_public_landing_stats')) return json(route, STATS);
    return json(route, wantsObject ? {} : []);
  });
};

const open = async (page, { settings, language = 'es' } = {}) => {
  await mockSupabase(page, settings);
  await page.addInitScript((lang) => localStorage.setItem('preferredLanguage', lang), language);
  const loaded = page.waitForResponse((r) => r.url().includes('/rest/v1/business_visual_settings'));
  await page.goto('/');
  await loaded;
  await expect(page.locator('[data-testid="hero-carousel"]')).toBeVisible();
  await expect(page.locator('[data-testid="hero-slide-image"]')).toBeVisible();
  await expect(page.locator('[data-testid="hero-slide-image"]')).toHaveJSProperty('complete', true);
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

const pageOverflow = (page) => page.evaluate(() => {
  const vw = document.documentElement.clientWidth;
  const offenders = [...document.querySelectorAll('body *')]
    .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.right > vw + 0.5; })
    .slice(0, 8)
    .map((el) => `${el.tagName}.${String(el.className).slice(0, 60)} right=${Math.round(el.getBoundingClientRect().right)}`);
  return { scroll: document.documentElement.scrollWidth - vw, offenders };
});

const activeDotIndex = (page) => page.evaluate(() => [...document.querySelectorAll('[data-testid="hero-carousel"] button[aria-current="true"]')].length
  ? [...document.querySelectorAll('[data-testid="hero-carousel"] button')].filter((b) => /\d/.test(b.getAttribute('aria-label') || '')).findIndex((b) => b.getAttribute('aria-current') === 'true')
  : -1);

const shot = async (page, name) => {
  if (!SHOTS_DIR) return;
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(SHOTS_DIR, name), fullPage: false });
};

const VARIANTS = { preset: BRAND_PRESET, prod: PROD_ROW };

for (const width of [320, 768, 1280]) {
  for (const language of ['es', 'en']) {
    for (const [variant, settings] of Object.entries(VARIANTS)) {
      test.describe(`layout ${width}px ${language} (${variant})`, () => {
        test.use({ viewport: { width, height: 900 } });

        test('no horizontal overflow; text and carousel do not overlap; one h1; poster shown whole', async ({ page }) => {
          await open(page, { settings, language });
          await shot(page, `home-${variant}-${width}-${language}.png`);

          const overflow = await pageOverflow(page);
          expect(overflow.offenders, `page scrolls ${overflow.scroll}px`).toEqual([]);
          expect(overflow.scroll).toBeLessThanOrEqual(0);

          await expect(page.locator('h1')).toHaveCount(1);
          const h1 = await box(page.locator('[data-testid="home-hero"] h1'));
          const cta = await box(page.locator('[data-testid="home-hero"] button').first());
          const carousel = await box(page.locator('[data-testid="hero-carousel"]'));
          const textBottom = Math.max(h1.bottom, cta.bottom);
          const textRight = Math.max(h1.right, cta.right);
          if (width >= 1024) {
            expect(textRight, 'side by side from lg').toBeLessThanOrEqual(carousel.x + 0.5);
          } else {
            expect(textBottom, 'stacked below lg').toBeLessThanOrEqual(carousel.y + 0.5);
          }

          const img = page.locator('[data-testid="hero-slide-image"]');
          await expect(img).toHaveCSS('object-fit', 'contain');
          const frame = await box(page.locator('[data-testid="hero-carousel-frame"]'));
          expect(Math.abs(frame.width / frame.height - 16 / 9)).toBeLessThan(0.05);
          const poster = await box(img);
          expect(poster.x).toBeGreaterThanOrEqual(frame.x - 0.5);
          expect(poster.right).toBeLessThanOrEqual(frame.right + 0.5);
          await expect(page.locator('[data-testid="home-hero"] .bg-black\\/50')).toHaveCount(0);
        });
      });
    }
  }
}

test.describe('colours follow the Visual settings', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('production row: blue/violet gradient CTA, gradient page, gold dot', async ({ page }) => {
    await open(page, { settings: PROD_ROW });
    const cta = page.locator('[data-testid="home-hero"] button').first();
    await expect(cta).toHaveCSS('background-image', /linear-gradient\(.*rgb\(52, 153, 220\).*rgb\(147, 51, 234\)/);
    await expect(cta).toHaveCSS('color', 'rgb(255, 255, 255)');
    await expect(page.locator('body')).toHaveCSS('background-image', /linear-gradient/);
    await expect(page.locator('[data-testid="hero-carousel"] button[aria-current="true"]')).toHaveCSS('background-color', 'rgb(255, 165, 0)');
  });

  test('no row at all (code defaults) keeps the same legacy CTA and gradient page', async ({ page }) => {
    await open(page, { settings: null });
    await expect(page.locator('[data-testid="home-hero"] button').first()).toHaveCSS('background-image', /linear-gradient/);
    await expect(page.locator('body')).toHaveCSS('background-image', /linear-gradient/);
  });

  test('preset: gold CTA with charcoal text (AA), hover darkens it, ivory page, gold active dot', async ({ page }) => {
    await open(page, { settings: BRAND_PRESET });
    const cta = page.locator('[data-testid="home-hero"] button').first();
    await expect(cta).toHaveCSS('background-color', 'rgb(255, 165, 0)');
    await expect(cta).toHaveCSS('color', 'rgb(23, 23, 23)');
    await expect(cta).toHaveCSS('background-image', 'none');
    expect(ratio('rgb(23, 23, 23)', 'rgb(255, 165, 0)')).toBeGreaterThanOrEqual(4.5);
    await cta.hover();
    await expect(cta).toHaveCSS('background-color', 'rgb(229, 148, 0)');
    await expect(page.locator('body')).toHaveCSS('background-image', 'none');
    await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(250, 247, 240)');
    await expect(page.locator('[data-testid="hero-carousel"] button[aria-current="true"]')).toHaveCSS('background-color', 'rgb(255, 165, 0)');
    await expect(page.locator('h1')).toHaveCSS('color', 'rgb(23, 23, 23)');
    for (const h2 of await page.locator('h2').all()) await expect(h2).toHaveCSS('color', 'rgb(23, 23, 23)');
  });

  test('a customised palette reaches the hero (not the preset values)', async ({ page }) => {
    await open(page, { settings: { ...BRAND_PRESET, buttonBgColor: '#112233', buttonTextColor: '#fefefe', carouselDotActiveColor: '#445566', pageBgColor: '#eeddcc' } });
    const cta = page.locator('[data-testid="home-hero"] button').first();
    await expect(cta).toHaveCSS('background-color', 'rgb(17, 34, 51)');
    await expect(cta).toHaveCSS('color', 'rgb(254, 254, 254)');
    await expect(page.locator('[data-testid="hero-carousel"] button[aria-current="true"]')).toHaveCSS('background-color', 'rgb(68, 85, 102)');
    await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(238, 221, 204)');
    await expect(page.locator('body')).toHaveCSS('background-image', 'none');
  });
});

test.describe('carousel controls', () => {
  test.use({ viewport: { width: 1280, height: 800 } });
  const FAST = { ...BRAND_PRESET, carouselAutoplaySpeed: 1000, carouselTransitionSpeed: 200 };

  test('every dot, arrow and the pause button is at least 24x24 CSS px', async ({ page }) => {
    await open(page, { settings: FAST });
    const buttons = page.locator('[data-testid="hero-carousel"] button');
    expect(await buttons.count()).toBeGreaterThanOrEqual(3 + 3);
    for (const button of await buttons.all()) {
      const b = await box(button);
      expect(b.width, await button.getAttribute('aria-label')).toBeGreaterThanOrEqual(24);
      expect(b.height, await button.getAttribute('aria-label')).toBeGreaterThanOrEqual(24);
    }
  });

  test('the active dot differs from the others by more than colour (wider)', async ({ page }) => {
    await open(page, { settings: BRAND_PRESET });
    const active = await box(page.locator('[data-testid="hero-carousel"] button[aria-current="true"]'));
    const other = await box(page.locator('[data-testid="hero-carousel"] button[aria-label*="2"]').first());
    expect(active.width).toBeGreaterThan(other.width);
  });

  test('autoplay advances, and the pause button stops it', async ({ page }) => {
    await open(page, { settings: FAST });
    await page.mouse.move(5, 5);
    await expect.poll(() => activeDotIndex(page), { timeout: 4000 }).toBeGreaterThan(0);
    await page.getByRole('button', { name: /Pausar|Pause/ }).click();
    await page.mouse.move(5, 5);
    const frozen = await activeDotIndex(page);
    await page.waitForTimeout(2500);
    expect(await activeDotIndex(page)).toBe(frozen);
    await expect(page.getByRole('button', { name: /Reanudar|Resume/ })).toBeVisible();
  });

  test('prefers-reduced-motion: the carousel does not auto-advance', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await open(page, { settings: FAST });
    await page.mouse.move(5, 5);
    await page.waitForTimeout(3000);
    expect(await activeDotIndex(page)).toBe(0);
    await expect(page.getByRole('button', { name: /Reanudar|Resume/ })).toBeVisible();
  });
});
