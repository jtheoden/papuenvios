import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

// Header brand theme (S1). Supabase is fully mocked with page.route: no network, no real data.
// Set HEADER_SHOTS_DIR to also save screenshots (evidence only, never a gate).

const SHOTS_DIR = process.env.HEADER_SHOTS_DIR;

// The header-related part of the "Paleta PapuEnvios" preset, spelled out on purpose: Playwright does not
// resolve the '@/' alias, and literal values keep this check independent of brandPalette.js.
const BRAND_PRESET = {
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
  buttonBgColor: '#FFA500',
  buttonTextColor: '#171717',
  buttonHoverBgColor: '#E59400',
  cartBadgeBgColor: '#FFA500',
  cartBadgeTextColor: '#171717',
  borderColor: '#E8E0D2',
  focusRingColor: '#171717',
  headingColor: '#171717',
  softAccentColor: '#FFF1CC',
};

// Row stored in production today (the app merges it over its code defaults).
const PROD_ROW = {
  useGradient: true,
  logo: '',
  primaryColor: '#3499dc',
  secondaryColor: '#9333ea',
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
};

const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');

// Fake signed-in admin: a session in the app's storage key + the three pending-work sources
// (orders + refunds pending = a numeric badge, plus the "!" badge for the overdue refund).
const adminSession = () => {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const user = { id: '00000000-0000-4000-8000-000000000001', aud: 'authenticated', role: 'authenticated', email: 'qa-admin@example.test', app_metadata: {}, user_metadata: {} };
  return { access_token: `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: user.id, exp, role: 'authenticated' })}.sig`, token_type: 'bearer', expires_in: 3600, expires_at: exp, refresh_token: 'refresh', user };
};

const json = (route, body, extra = {}) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body), ...extra });

const mockSupabase = async (page, { settings = null, admin = false } = {}) => {
  await page.route(/\/(rest|auth|functions|storage)\/v1\//, async (route) => {
    const request = route.request();
    const url = request.url();
    const wantsObject = (request.headers().accept || '').includes('pgrst.object');
    if (url.includes('/rest/v1/business_visual_settings')) {
      if (!settings) {
        return route.fulfill({ status: 406, contentType: 'application/json', body: JSON.stringify({ code: 'PGRST116', message: 'no rows', details: null, hint: null }) });
      }
      return json(route, wantsObject ? { settings } : [{ settings }]);
    }
    if (admin && url.includes('/auth/v1/user')) return json(route, adminSession().user);
    if (url.includes('/auth/v1/')) {
      return route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ message: 'not authenticated' }) });
    }
    if (admin && url.includes('/rest/v1/user_profiles')) {
      return json(route, { role: 'admin', is_enabled: true, avatar_url: null, full_name: 'QA Admin', email: 'qa-admin@example.test' });
    }
    if (admin && url.includes('/rpc/get_pending_orders_count')) return json(route, 2);
    if (admin && url.includes('/rpc/admin_refund_counts')) return json(route, { actionable: 1, on_hold: 0, due_soon: 0, overdue: 1, pending_amount_usd: 0 });
    if (admin && url.includes('/rest/v1/remittances') && request.method() === 'HEAD') {
      return route.fulfill({ status: 200, headers: { 'content-range': '0-0/1' }, body: '' });
    }
    return json(route, wantsObject ? {} : []);
  });
};

const open = async (page, { settings, language = 'es', cart = [], admin = false } = {}) => {
  await mockSupabase(page, { settings, admin });
  await page.addInitScript(({ lang, items, session }) => {
    localStorage.setItem('preferredLanguage', lang);
    localStorage.setItem('cart', JSON.stringify(items));
    if (session) localStorage.setItem('papuenvios-auth', JSON.stringify(session));
  }, { lang: language, items: cart, session: admin ? adminSession() : null });
  const settingsLoaded = page.waitForResponse((r) => r.url().includes('/rest/v1/business_visual_settings'));
  await page.goto('/');
  await settingsLoaded;
  await expect(page.locator('header')).toBeVisible();
  // the header slides in with framer-motion; wait until it rests so colours and screenshots are final
  await page.waitForFunction(() => document.querySelector('header')?.style.transform === 'none');
  if (admin) await expect(page.locator('header button', { hasText: /Admin/ })).toBeVisible();
};

const activeDesktopTab = (page) => page.locator('nav button[aria-current="page"]').first();

test.describe('brand preset applied', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('active tab: soft gold, charcoal text, underline and aria-current', async ({ page }) => {
    await open(page, { settings: BRAND_PRESET });
    const active = activeDesktopTab(page);
    await expect(active).toBeVisible();
    await expect(active).toHaveCSS('background-color', 'rgb(255, 241, 204)');
    await expect(active).toHaveCSS('color', 'rgb(23, 23, 23)');
    await expect(active).toHaveCSS('text-decoration-line', /underline/);
    await expect(active).toHaveCSS('font-weight', /^(600|700)$/);
    await expect(page.locator('nav button[aria-current="page"]')).toHaveCount(1);
  });

  test('hover and keyboard focus are driven by classes', async ({ page }) => {
    await open(page, { settings: BRAND_PRESET });
    const products = page.locator('header nav').first().locator('button:not([aria-current])').first();
    await products.hover();
    await expect(products).toHaveCSS('background-color', 'rgb(250, 247, 240)');
    await page.mouse.move(0, 400);
    await page.keyboard.press('Shift');
    await products.focus();
    await expect(products).toHaveCSS('box-shadow', /rgb\(23, 23, 23\)/);
  });

  test('cart badge is gold with charcoal text; the language button is neutral (beige border, charcoal text)', async ({ page }) => {
    await open(page, { settings: BRAND_PRESET, cart: [{ id: 'p1', quantity: 2 }, { id: 'p2', quantity: 1 }] });
    const badge = page.locator('header span.rounded-full', { hasText: '3' });
    await expect(badge).toBeVisible();
    await expect(badge).toHaveCSS('background-color', 'rgb(255, 165, 0)');
    await expect(badge).toHaveCSS('color', 'rgb(23, 23, 23)');
    const lang = page.locator('header button', { hasText: /^ES$/ }).first();
    await expect(lang).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await expect(lang).toHaveCSS('border-top-color', 'rgb(232, 224, 210)');
    await expect(lang).toHaveCSS('color', 'rgb(23, 23, 23)');
  });

  test('plain wordmark: no icon tile, no gradient text', async ({ page }) => {
    await open(page, { settings: BRAND_PRESET });
    await expect(page.locator('header .rounded-lg svg')).toHaveCount(0);
    const mark = page.locator('header span.font-bold', { hasText: /PapuEnvios/ });
    await expect(mark).toHaveCSS('background-image', 'none');
    await expect(mark).toHaveCSS('color', 'rgb(23, 23, 23)');
  });

  test('a customised active colour reaches the header', async ({ page }) => {
    await open(page, { settings: { ...BRAND_PRESET, navBarActiveBgColor: '#112233', navBarActiveTextColor: '#fefefe' } });
    const active = activeDesktopTab(page);
    await expect(active).toHaveCSS('background-color', 'rgb(17, 34, 51)');
    await expect(active).toHaveCSS('color', 'rgb(254, 254, 254)');
  });
});

test.describe('production row (no preset applied) keeps its look', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('blue/violet gradient active tab, gradient wordmark with icon tile', async ({ page }) => {
    await open(page, { settings: PROD_ROW });
    const active = activeDesktopTab(page);
    await expect(active).toHaveCSS('background-image', /linear-gradient\(.*rgb\(37, 99, 235\).*rgb\(147, 51, 234\)/);
    await expect(active).toHaveCSS('color', 'rgb(255, 255, 255)');
    const tile = page.locator('header .rounded-lg').first();
    await expect(tile.locator('svg')).toBeVisible();
    await expect(tile).toHaveCSS('background-image', /linear-gradient\(.*rgb\(52, 153, 220\).*rgb\(147, 51, 234\)/);
    const mark = page.locator('header span.font-bold', { hasText: /PapuEnvios/ });
    await expect(mark).toHaveCSS('background-image', /linear-gradient/);
    await expect(mark).toHaveCSS('color', 'rgba(0, 0, 0, 0)');
  });

  test('red cart badge with white text; neutral language button', async ({ page }) => {
    await open(page, { settings: PROD_ROW, cart: [{ id: 'p1', quantity: 2 }] });
    const badge = page.locator('header span.rounded-full', { hasText: '2' });
    await expect(badge).toHaveCSS('background-color', 'rgb(220, 38, 38)');
    await expect(badge).toHaveCSS('color', 'rgb(255, 255, 255)');
    const lang = page.locator('header button', { hasText: /^ES$/ }).first();
    await expect(lang).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await expect(lang).toHaveCSS('color', 'rgb(31, 41, 55)');
  });

  test('no row at all (code defaults) renders the same blue gradient tab', async ({ page }) => {
    await open(page, { settings: null });
    await expect(activeDesktopTab(page)).toHaveCSS('background-image', /linear-gradient/);
  });
});

// Everything the header paints must stay inside the viewport (also with the mobile menu open).
// The page below the header (Home content) is out of S1: its own overflow is reported, not asserted.
const headerOverflow = (page) => page.evaluate(() => {
  const vw = document.documentElement.clientWidth;
  const header = document.querySelector('header');
  const outside = [...header.querySelectorAll('*')]
    .filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && (r.right > vw + 0.5 || r.left < -0.5);
    })
    .map((el) => `${el.tagName}.${String(el.className).slice(0, 50)}`);
  return { outside, headerScroll: header.scrollWidth - header.clientWidth, pageScroll: document.documentElement.scrollWidth - vw };
});

const shot = async (page, name, width) => {
  if (!SHOTS_DIR) return;
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
  await page.waitForTimeout(700); // let the mobile menu / pills animations settle
  await page.screenshot({ path: path.join(SHOTS_DIR, name), clip: { x: 0, y: 0, width, height: 460 } });
};

const VARIANTS = { preset: BRAND_PRESET, prod: PROD_ROW };

for (const width of [320, 768, 1280]) {
  for (const language of ['es', 'en']) {
    for (const [variant, settings] of Object.entries(VARIANTS)) {
      test.describe(`layout ${width}px ${language} (${variant})`, () => {
        test.use({ viewport: { width, height: 800 } });

        test('the header fits the viewport without horizontal overflow', async ({ page }) => {
          await open(page, { settings, language, cart: [{ id: 'p1', quantity: 12 }] });
          await shot(page, `header-${variant}-${width}-${language}.png`, width);
          const closed = await headerOverflow(page);
          expect(closed.outside).toEqual([]);
          expect(closed.headerScroll).toBeLessThanOrEqual(0);
          if (closed.pageScroll > 0) {
            test.info().annotations.push({ type: 'page-overflow', description: `${closed.pageScroll}px from the page content, not the header` });
          }

          if (width < 768) {
            await page.locator('header button.md\\:hidden').click();
            await expect(page.locator('header nav button[aria-current="page"]').last()).toBeVisible();
            const withMenu = await headerOverflow(page);
            expect(withMenu.outside).toEqual([]);
            expect(withMenu.headerScroll).toBeLessThanOrEqual(0);
            await shot(page, `header-${variant}-${width}-${language}-menu.png`, width);
          }
        });
      });
    }
  }
}

// Busiest header: Home, Products, Blog, Admin, language, avatar and both pending badges.
for (const width of [768, 1280]) {
  for (const language of ['es', 'en']) {
    test.describe(`admin ${width}px ${language} (prod row)`, () => {
      test.use({ viewport: { width, height: 800 } });

      test('shows the admin entries and both badges without overflow', async ({ page }) => {
        await open(page, { settings: PROD_ROW, language, admin: true });
        await expect(page.locator('header span[aria-hidden="true"]', { hasText: /^[1-9]\d*$/ })).toBeVisible();
        await expect(page.locator('header span[aria-hidden="true"]', { hasText: /^!$/ })).toBeVisible();
        await expect(page.locator('header nav button[aria-current="page"]')).toHaveCount(1);
        const result = await headerOverflow(page);
        expect(result.outside).toEqual([]);
        expect(result.headerScroll).toBeLessThanOrEqual(0);
        await shot(page, `header-admin-prod-${width}-${language}.png`, width);
      });
    });
  }
}
