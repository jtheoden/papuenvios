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
};

const mockSupabase = async (page, { settings = null } = {}) => {
  await page.route(/\/(rest|auth|functions|storage)\/v1\//, async (route) => {
    const url = route.request().url();
    const wantsObject = (route.request().headers().accept || '').includes('pgrst.object');
    if (url.includes('/rest/v1/business_visual_settings')) {
      if (!settings) {
        return route.fulfill({ status: 406, contentType: 'application/json', body: JSON.stringify({ code: 'PGRST116', message: 'no rows', details: null, hint: null }) });
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(wantsObject ? { settings } : [{ settings }]) });
    }
    if (url.includes('/auth/v1/')) {
      return route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ message: 'not authenticated' }) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: wantsObject ? '{}' : '[]' });
  });
};

const open = async (page, { settings, language = 'es', cart = [] } = {}) => {
  await mockSupabase(page, { settings });
  await page.addInitScript(({ lang, items }) => {
    localStorage.setItem('preferredLanguage', lang);
    localStorage.setItem('cart', JSON.stringify(items));
  }, { lang: language, items: cart });
  await page.goto('/');
  await expect(page.locator('header')).toBeVisible();
  // wait for the visual settings to reach the header (CSS variable set from the settings row)
  await page.waitForFunction(() => document.querySelector('header')?.style.getPropertyValue('--hdr-active-bg'));
  // the header slides in with framer-motion; wait until it rests so colours and screenshots are final
  await page.waitForFunction(() => document.querySelector('header')?.style.transform === 'none');
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

  test('cart badge and language button use the brand gold with charcoal text', async ({ page }) => {
    await open(page, { settings: BRAND_PRESET, cart: [{ id: 'p1', quantity: 2 }, { id: 'p2', quantity: 1 }] });
    const badge = page.locator('header span.rounded-full', { hasText: '3' });
    await expect(badge).toBeVisible();
    await expect(badge).toHaveCSS('background-color', 'rgb(255, 165, 0)');
    await expect(badge).toHaveCSS('color', 'rgb(23, 23, 23)');
    const lang = page.locator('header button', { hasText: /^ES$/ }).first();
    await expect(lang).toHaveCSS('background-color', 'rgb(255, 165, 0)');
    await expect(lang).toHaveCSS('color', 'rgb(23, 23, 23)');
  });

  test('a customised active colour reaches the header', async ({ page }) => {
    await open(page, { settings: { ...BRAND_PRESET, navBarActiveBgColor: '#112233', navBarActiveTextColor: '#fefefe' } });
    const active = activeDesktopTab(page);
    await expect(active).toHaveCSS('background-color', 'rgb(17, 34, 51)');
    await expect(active).toHaveCSS('color', 'rgb(254, 254, 254)');
  });
});

test.describe('no preset applied (current defaults)', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('keeps the blue gradient active tab', async ({ page }) => {
    await open(page, { settings: null });
    const active = activeDesktopTab(page);
    await expect(active).toHaveCSS('background-image', /linear-gradient/);
    await expect(active).toHaveCSS('color', 'rgb(255, 255, 255)');
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

for (const width of [320, 768, 1280]) {
  for (const language of ['es', 'en']) {
    test.describe(`layout ${width}px ${language}`, () => {
      test.use({ viewport: { width, height: 800 } });

      test('the header fits the viewport without horizontal overflow', async ({ page }) => {
        await open(page, { settings: BRAND_PRESET, language, cart: [{ id: 'p1', quantity: 12 }] });
        await shot(page, `header-${width}-${language}.png`, width);
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
          await shot(page, `header-${width}-${language}-menu.png`, width);
        }
      });
    });
  }
}
