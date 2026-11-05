import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

// Theme token infrastructure (T0). Supabase is fully mocked with page.route: no network, no real data.
// Run with: npx playwright test -c playwright.theme.config.js
// THEME_SHOTS_DIR saves screenshots (evidence only); THEME_NO_RADIUS=1 removes --radius again so a build that
// defines it can be compared pixel by pixel with one that does not.
const SHOTS_DIR = process.env.THEME_SHOTS_DIR;
const NO_RADIUS = process.env.THEME_NO_RADIUS === '1';

// Literal values on purpose: Playwright does not resolve the '@/' alias.
const BRAND_PRESET = {
  pageBgColor: '#FAF7F0', cardBgColor: '#FFFFFF', accentColor: '#FFA500', useGradient: false, useHeaderGradient: false,
  headerBgColor: '#FFFFFF', headerTextColor: '#171717', headerMenuBgColor: '#FFFFFF', headerMenuTextColor: '#171717',
  headerMenuHoverBgColor: '#FAF7F0', headerMenuHoverTextColor: '#171717', headerMenuActiveBgColor: '#FFF1CC',
  headerMenuActiveColor: '#171717', navBarActiveBgColor: '#FFF1CC', navBarActiveTextColor: '#171717',
  headingColor: '#171717', useHeadingGradient: false, tabActiveColor: '#171717', tabActiveBgColor: '#FFF1CC',
  tabInactiveColor: '#605B52', tabInactiveBgColor: '#FFFFFF', tabHoverColor: '#171717', tabHoverBgColor: '#FAF7F0',
  footerBgColor: '#FFFFFF', footerTextColor: '#605B52', footerLinkColor: '#171717', footerLinkHoverColor: '#605B52',
  buttonBgColor: '#FFA500', buttonTextColor: '#171717',
  buttonHoverBgColor: '#E59400', useButtonGradient: false, cartBadgeBgColor: '#FFA500', cartBadgeTextColor: '#171717',
  carouselDotActiveColor: '#FFA500', borderColor: '#E8E0D2', mutedTextColor: '#605B52', softAccentColor: '#FFF1CC',
  focusRingColor: '#171717',
};

// Row with useGradient on: the classic look stored before the brand preset.
const CLASSIC_ROW = {
  useGradient: true, useButtonGradient: true, useHeadingGradient: true, primaryColor: '#3499dc', secondaryColor: '#9333ea',
  accentColor: '#9333ea', headerGradientColor: '#9333ea', gradientDirection: '320', navBarActiveBgColor: '#2563eb',
  navBarActiveTextColor: '#ffffff', headerMenuActiveBgColor: '#eff6ff', headerMenuActiveColor: '#2563eb',
  buttonBgColor: '#2563eb', buttonTextColor: '#ffffff', buttonHoverBgColor: '#1d4ed8', headerBgColor: '#ffffff',
  headerTextColor: '#1f2937', pageBgColor: '#f9fafb',
};

const CLASSIC_GRADIENT = 'linear-gradient(to right bottom, rgb(248, 250, 252), rgb(239, 246, 255), rgb(224, 231, 255))';
const IVORY = 'rgb(250, 247, 240)';
const json = (route, body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

const mockSupabase = async (page, settings, { gate, fail } = {}) => {
  await page.route(/\/(rest|auth|functions|storage)\/v1\//, async (route) => {
    const request = route.request();
    const url = request.url();
    const wantsObject = (request.headers().accept || '').includes('pgrst.object');
    if (url.includes('/rest/v1/business_visual_settings')) {
      if (gate) await gate;
      if (fail) return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ code: 'XX000', message: 'boom', details: null, hint: null }) });
      return json(route, wantsObject ? { settings } : [{ settings }]);
    }
    if (url.includes('/auth/v1/')) return route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ message: 'not authenticated' }) });
    return json(route, wantsObject ? {} : []);
  });
};

const open = async (page, route, settings) => {
  await mockSupabase(page, settings);
  await page.addInitScript(() => localStorage.setItem('preferredLanguage', 'es'));
  const loaded = page.waitForResponse((r) => r.url().includes('/rest/v1/business_visual_settings'));
  await page.goto(route);
  await loaded;
  // applyVisualSettingsToDOM sets --gradient-direction on :root: the settings are applied once it is there
  await page.waitForFunction(() => document.documentElement.style.getPropertyValue('--gradient-direction') !== '');
  if (NO_RADIUS) await page.addStyleTag({ content: ':root{--radius:unset}' });
};

// Entrance animations (framer-motion) are not covered by `animations: 'disabled'`: wait for two identical frames in a row.
const stableScreenshot = async (page) => {
  await page.waitForLoadState('networkidle');
  let previous = await page.screenshot({ animations: 'disabled' });
  for (let i = 0; i < 30; i += 1) {
    await page.waitForTimeout(400);
    const next = await page.screenshot({ animations: 'disabled' });
    if (next.equals(previous)) return next;
    previous = next;
  }
  throw new Error('the page never settled: two consecutive screenshots keep differing');
};

const shot = async (page, name) => {
  if (!SHOTS_DIR) return;
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
  fs.writeFileSync(path.join(SHOTS_DIR, name), await stableScreenshot(page));
};

test.use({ viewport: { width: 1280, height: 800 } });

for (const route of ['/products', '/cart']) {
  test.describe(`colour signature on ${route}`, () => {
    test('classic row: data-theme=classic and the exact gradient of today', async ({ page }) => {
      await open(page, route, CLASSIC_ROW);
      await shot(page, `classic${route.replace('/', '-')}.png`);
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'classic');
      await expect(page.locator('body')).toHaveCSS('background-image', CLASSIC_GRADIENT);
    });

    test('brand preset: data-theme=papuenvios and a flat ivory page', async ({ page }) => {
      await open(page, route, BRAND_PRESET);
      await shot(page, `papuenvios${route.replace('/', '-')}.png`);
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'papuenvios');
      await expect(page.locator('body')).toHaveCSS('background-color', IVORY);
      await expect(page.locator('body')).toHaveCSS('background-image', 'none');
    });

    test('--radius is defined: rounded-lg is 8px, rounded-md 6px, rounded-sm 4px', async ({ page }) => {
      test.skip(NO_RADIUS, 'comparison mode removes --radius on purpose');
      await open(page, route, BRAND_PRESET);
      await expect(page.locator('html')).toHaveCSS('--radius', '0.5rem');
      // the three radii as real Tailwind utilities (rounded-lg/md/sm are used across src, so the classes exist)
      const radii = await page.evaluate(() => ['rounded-lg', 'rounded-md', 'rounded-sm'].map((cls) => {
        const button = document.createElement('button');
        button.className = cls;
        document.body.append(button);
        return getComputedStyle(button).borderTopLeftRadius;
      }));
      expect(radii).toEqual(['8px', '6px', '4px']);
    });
  });
}

// Owner evidence: with the brand theme a lavender strip stayed between the end of the ivory Home root and the footer
// (the body gradient showing through). Every pixel of that band must be the brand ivory.
const bandBetweenHomeAndFooter = async (page) => {
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(300);
  const band = await page.evaluate(() => {
    const home = document.querySelector('[data-testid="home-page"]').getBoundingClientRect();
    const footer = document.querySelector('footer').getBoundingClientRect();
    return { x: 0, y: Math.max(0, Math.floor(home.bottom)), width: document.documentElement.clientWidth, height: Math.floor(footer.top - Math.max(0, home.bottom)) };
  });
  if (band.height < 1) return { band, colours: [] };
  const png = await page.screenshot({ clip: band, animations: 'disabled' });
  const colours = await page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const seen = new Set();
    for (let y = 0; y < img.height; y += 2) {
      for (let x = 0; x < img.width; x += 16) {
        const [r, g, b] = ctx.getImageData(x, y, 1, 1).data;
        seen.add(`rgb(${r}, ${g}, ${b})`);
      }
    }
    return [...seen];
  }, png.toString('base64'));
  return { band, colours };
};

test.describe('Home: no body gradient strip above the footer', () => {
  test('brand preset: the whole band between the Home root and the footer is ivory', async ({ page }) => {
    await open(page, '/', BRAND_PRESET);
    await expect(page.locator('[data-testid="home-page"]')).toBeVisible();
    await shot(page, 'papuenvios-home-top.png');
    const { band, colours } = await bandBetweenHomeAndFooter(page);
    await shot(page, 'papuenvios-home-bottom.png');
    expect(colours, `band ${JSON.stringify(band)}`).toEqual(band.height < 1 ? [] : [IVORY]);
    await expect(page.locator('body')).toHaveCSS('background-image', 'none');
  });

  test('classic row: the band still shows the body gradient, as today', async ({ page }) => {
    await open(page, '/', CLASSIC_ROW);
    await expect(page.locator('[data-testid="home-page"]')).toBeVisible();
    await shot(page, 'classic-home-top.png');
    const { band, colours } = await bandBetweenHomeAndFooter(page);
    await shot(page, 'classic-home-bottom.png');
    await expect(page.locator('body')).toHaveCSS('background-image', CLASSIC_GRADIENT);
    if (band.height >= 1) expect(colours).not.toContain(IVORY);
  });
});

test.describe('brand links', () => {
  const underlineOf = (page) => page.evaluate(() => {
    document.body.insertAdjacentHTML('beforeend', '<a id="t-link" class="text-theme-link">a</a><a id="t-strong" class="text-theme-link-strong">b</a><a id="t-none" class="text-theme-link no-underline">c</a>');
    const line = (id) => getComputedStyle(document.getElementById(id)).textDecorationLine;
    return { link: line('t-link'), strong: line('t-strong'), none: line('t-none') };
  });

  test('brand look underlines text-theme-link (charcoal text), unless no-underline', async ({ page }) => {
    await open(page, '/products', BRAND_PRESET);
    expect(await underlineOf(page)).toEqual({ link: 'underline', strong: 'underline', none: 'none' });
  });

  test('classic keeps links as they are today (no underline added)', async ({ page }) => {
    await open(page, '/products', CLASSIC_ROW);
    expect(await underlineOf(page)).toEqual({ link: 'none', strong: 'none', none: 'none' });
  });
});

// A FAILED settings request must not flip the look: the code defaults are classic, the stored production row is the brand.
test.describe('settings request fails', () => {
  const openFailing = async (page, cached) => {
    await mockSupabase(page, null, { fail: true });
    if (cached) await page.addInitScript((data) => localStorage.setItem('business_visual_settings_cache', JSON.stringify({ data, timestamp: 0 })), cached);
    const failed = page.waitForResponse((r) => r.url().includes('/rest/v1/business_visual_settings'));
    await page.goto('/products');
    await failed;
    await page.waitForTimeout(1000); // the service has handled the error and the context has applied what it returned
  };

  test('brand look from an expired cache: data-theme stays papuenvios and the page stays flat ivory', async ({ page }) => {
    await openFailing(page, BRAND_PRESET);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'papuenvios');
    await expect(page.locator('body')).toHaveCSS('background-image', 'none');
    await expect(page.locator('body')).toHaveCSS('background-color', IVORY);
  });

  test('classic look from an expired cache stays classic, exactly as before', async ({ page }) => {
    await openFailing(page, CLASSIC_ROW);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'classic');
    await expect(page.locator('body')).toHaveCSS('background-image', CLASSIC_GRADIENT);
  });

  test('no cache at all: the first-paint brand look is kept, never flipped to classic', async ({ page }) => {
    await openFailing(page, null);
    await expect(page.locator('html')).not.toHaveAttribute('data-theme', 'classic');
    await expect(page.locator('body')).toHaveCSS('background-image', 'none');
  });
});

test.describe('first paint', () => {
  test('a cached classic look is applied before the settings request resolves, whatever its age', async ({ page }) => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    await mockSupabase(page, CLASSIC_ROW, { gate });
    // timestamp 0: far outside the 1 minute cache TTL, which the inline script must ignore
    await page.addInitScript(() => localStorage.setItem('business_visual_settings_cache', JSON.stringify({ data: { useGradient: true }, timestamp: 0 })));
    await page.goto('/products', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'classic');
    await expect(page.locator('body')).toHaveCSS('background-image', CLASSIC_GRADIENT);
    release();
  });

  test('a cached activeTheme wins over the values at first paint and after the settings load', async ({ page }) => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const marked = { ...BRAND_PRESET, activeTheme: 'classic' };
    await mockSupabase(page, marked, { gate });
    await page.addInitScript((data) => localStorage.setItem('business_visual_settings_cache', JSON.stringify({ data, timestamp: 0 })), marked);
    await page.goto('/products', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'classic');
    const loaded = page.waitForResponse((r) => r.url().includes('/rest/v1/business_visual_settings'));
    release();
    await loaded;
    await page.waitForFunction(() => document.documentElement.style.getPropertyValue('--gradient-direction') !== '');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'classic');
  });

  test('without any cache the first paint is the brand look', async ({ page }) => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    await mockSupabase(page, CLASSIC_ROW, { gate });
    await page.goto('/products', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('html')).not.toHaveAttribute('data-theme', 'classic');
    await expect(page.locator('body')).toHaveCSS('background-image', 'none');
    // the app has mounted (and run its own effects) but the settings are still pending: the page must still be ivory
    await expect(page.locator('#root > *').first()).toBeAttached();
    await page.waitForTimeout(700);
    await expect(page.locator('body')).toHaveCSS('background-color', IVORY);
    release();
  });
});
