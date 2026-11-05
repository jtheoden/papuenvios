import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

// Startup: the static splash is in the served HTML; the app shows up as soon as auth + visual settings are ready
// (no fixed 2.5 s wait); the loading screen only appears for loads over 300 ms; a hung settings query is capped.
// Supabase is fully mocked with page.route: no network, no real data.

test.describe.configure({ timeout: 90000 }); // the dev server compiles on demand: first loads are slow

const ES = JSON.parse(fs.readFileSync(path.resolve('src/translations/ES.json'), 'utf8'));
const LOADING_TEXT = ES.common.loadingPlatform;
const SETTINGS = { useGradient: true };

const json = (route, body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

// settingsDelay: ms before answering the settings query; Infinity = never answer (hung query).
const mockSupabase = (page, { settingsDelay = 0, settings = SETTINGS } = {}) => page.route(/\/(rest|auth|functions|storage)\/v1\//, async (route) => {
  const request = route.request();
  const url = request.url();
  const wantsObject = (request.headers().accept || '').includes('pgrst.object');
  if (url.includes('/auth/v1/')) return route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ message: 'not authenticated' }) });
  if (url.includes('/rest/v1/business_visual_settings')) {
    if (settingsDelay === Infinity) return undefined; // never fulfilled
    if (settingsDelay) await new Promise((r) => setTimeout(r, settingsDelay));
    return json(route, wantsObject ? { settings } : [{ settings }]).catch(() => {});
  }
  return json(route, wantsObject ? {} : []);
});

// Records (performance.now()) when React first commits and when the header appears, and whether the loading screen showed.
const instrument = (page) => page.addInitScript(({ loadingText, cacheKey }) => {
  localStorage.setItem('preferredLanguage', 'es');
  localStorage.removeItem(cacheKey); // the settings cache would skip the request
  window.__startup = { headerAt: null, sawLoading: false, psGoneAt: null };
  new MutationObserver(() => {
    // React's first commit: #root has content and the static splash (#ps) is gone. Main had no splash: its first commit.
    const root = document.getElementById('root');
    if (window.__startup.psGoneAt === null && root?.firstElementChild && !document.getElementById('ps')) window.__startup.psGoneAt = performance.now();
    if (!window.__startup.sawLoading && document.body?.textContent.includes(loadingText)) window.__startup.sawLoading = true;
    if (window.__startup.headerAt === null && document.querySelector('header')) window.__startup.headerAt = performance.now();
  }).observe(document, { childList: true, subtree: true, characterData: true });
}, { loadingText: LOADING_TEXT, cacheKey: 'business_visual_settings_cache' });

const openApp = async (page, options) => {
  await mockSupabase(page, options);
  await instrument(page);
  await page.goto('/'); // warm-up: lets the dev server compile the modules
  await expect(page.locator('header')).toBeVisible({ timeout: 60000 });
  await page.goto('/');
  await expect(page.locator('header')).toBeVisible({ timeout: 20000 });
  return page.evaluate(() => window.__startup);
};

test('served HTML already paints the static splash inside #root', async ({ request }) => {
  const html = await (await request.get('/')).text();
  expect(html).toMatch(/<div id="root"><div id="ps" role="status">/);
});

test('fast settings: the app appears without the fixed 2.5 s wait and no loading screen', async ({ page }) => {
  const startup = await openApp(page);
  // Event to event, not wall clock from navigation (the dev server under load can take seconds to serve the modules):
  // main started its fixed 2.5 s timer after React mounted, so its header came >= 2500 ms after the first commit.
  expect(startup.psGoneAt).not.toBeNull();
  expect(startup.headerAt - startup.psGoneAt).toBeLessThan(1000);
  expect(startup.sawLoading).toBe(false);
});

test('slow settings: the loading screen appears, then the app', async ({ page }) => {
  const startup = await openApp(page, { settingsDelay: 1200 });
  expect(startup.sawLoading).toBe(true);
  expect(startup.headerAt).not.toBeNull();
});

test('hung settings query: the app still appears after the cap', async ({ page }) => {
  const startup = await openApp(page, { settingsDelay: Infinity });
  expect(startup.sawLoading).toBe(true);
  expect(startup.headerAt).toBeGreaterThan(3500);
});

const IVORY = 'rgb(250, 247, 240)';
const CLASSIC_STOPS = /rgb\(37, 99, 235\)|rgb\(147, 51, 234\)/;

// Every frame from navigation: the backdrop (top-left corner) while the static splash or a loading screen covers the
// page, the body once the header is there. 'none' = nothing painted (the canvas).
const sampleBackdrop = (page) => page.addInitScript(() => {
  window.__bg = [];
  const paint = (el) => {
    for (; el; el = el.parentElement) {
      const style = getComputedStyle(el);
      if (style.backgroundImage !== 'none') return style.backgroundImage;
      if (style.backgroundColor !== 'rgba(0, 0, 0, 0)') return style.backgroundColor;
    }
    return 'none';
  };
  const tick = () => {
    if (document.body && window.__bg.length < 5000) {
      const phase = document.getElementById('ps') ? 'splash' : document.querySelector('header') ? 'app' : 'loading';
      const bg = phase === 'app' ? paint(document.body) : paint(document.elementFromPoint(2, 2));
      window.__bg.push({ phase, bg });
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});

test('first visit, no cache, slow settings: ivory from the static splash through the loading screen to the app', async ({ page }) => {
  await sampleBackdrop(page);
  // The brand row (production): activeTheme makes resolveLookId pick papuenvios once the settings load.
  const startup = await openApp(page, { settingsDelay: 1200, settings: { activeTheme: 'papuenvios', useGradient: false, pageBgColor: '#FAF7F0' } });
  expect(startup.sawLoading).toBe(true);
  await expect(page.locator('body')).toHaveCSS('background-color', IVORY);
  const samples = await page.evaluate(() => window.__bg);
  expect(samples.filter((s) => CLASSIC_STOPS.test(s.bg)), 'no blue/violet frame').toEqual([]);
  const covered = samples.filter((s) => s.phase !== 'app' && s.bg !== 'none');
  expect(covered.filter((s) => s.phase === 'loading').length).toBeGreaterThan(0);
  expect([...new Set(covered.map((s) => s.bg))]).toEqual([IVORY]);
  expect([...new Set(samples.filter((s) => s.phase === 'app').map((s) => s.bg))]).toEqual([IVORY]);
});

// The static splash alone (the app bundle is blocked): its look follows the data-theme the inline script picks from the cache.
const openStaticSplash = async (page, cachedData) => {
  await page.route(/\/src\/main\.jsx/, (route) => route.abort());
  await page.addInitScript(({ data }) => {
    localStorage.clear();
    if (data) localStorage.setItem('business_visual_settings_cache', JSON.stringify({ data, timestamp: 0 }));
  }, { data: cachedData });
  await page.goto('/');
  return page.evaluate(() => {
    const splash = getComputedStyle(document.getElementById('ps'));
    return {
      theme: document.documentElement.dataset.theme ?? null,
      backgroundImage: splash.backgroundImage,
      backgroundColor: splash.backgroundColor,
      fill: getComputedStyle(document.querySelector('#ps text')).fill,
    };
  });
};

for (const [label, data] of [['activeTheme classic', { activeTheme: 'classic' }], ['a gradient (pre-selector) row', { useGradient: true }]]) {
  test(`static splash with ${label} cached: the classic loading gradient and a white wordmark`, async ({ page }) => {
    const splash = await openStaticSplash(page, data);
    expect(splash.theme).toBe('classic');
    expect(splash.backgroundImage).toMatch(/linear-gradient\(to right, rgb\(37, 99, 235\), rgb\(147, 51, 234\)\)/);
    expect(splash.fill).toBe('rgb(255, 255, 255)');
  });
}

for (const [label, data] of [['no cache', null], ['activeTheme papuenvios', { activeTheme: 'papuenvios' }]]) {
  test(`static splash with ${label}: ivory and the charcoal wordmark`, async ({ page }) => {
    const splash = await openStaticSplash(page, data);
    expect(splash.backgroundImage).toBe('none');
    expect(splash.backgroundColor).toBe(IVORY);
    expect(splash.fill).toBe('rgb(23, 23, 23)');
  });
}
