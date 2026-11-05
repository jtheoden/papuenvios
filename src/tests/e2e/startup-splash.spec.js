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
const mockSupabase = (page, { settingsDelay = 0 } = {}) => page.route(/\/(rest|auth|functions|storage)\/v1\//, async (route) => {
  const request = route.request();
  const url = request.url();
  const wantsObject = (request.headers().accept || '').includes('pgrst.object');
  if (url.includes('/auth/v1/')) return route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ message: 'not authenticated' }) });
  if (url.includes('/rest/v1/business_visual_settings')) {
    if (settingsDelay === Infinity) return undefined; // never fulfilled
    if (settingsDelay) await new Promise((r) => setTimeout(r, settingsDelay));
    return json(route, wantsObject ? { settings: SETTINGS } : [{ settings: SETTINGS }]).catch(() => {});
  }
  return json(route, wantsObject ? {} : []);
});

// Records, from navigation start (performance.now()), when the header appears and whether the loading screen showed.
const instrument = (page) => page.addInitScript(({ loadingText, cacheKey }) => {
  localStorage.setItem('preferredLanguage', 'es');
  localStorage.removeItem(cacheKey); // the settings cache would skip the request
  window.__startup = { headerAt: null, sawLoading: false };
  new MutationObserver(() => {
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
  // main started a 2.5 s timer only after the JS loaded and React mounted, so it is always above 2500 ms here.
  expect(startup.headerAt).toBeLessThan(2500);
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
