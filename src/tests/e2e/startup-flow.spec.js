import { test, expect, devices } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { authFile } from './helpers/auth.js';
import { assertLocalSupabaseUrl } from './helpers/localGuard.js';

// Startup acceptance on the PRODUCTION bundle (vite build + vite preview, served by scripts/e2e-local.sh) against the
// LOCAL Supabase stack. Real sessions/roles come from auth.setup (QA users of the local stack). Only the visual settings
// row is answered by page.route, to choose the look/latency of each scenario. Every request that is not the app itself
// or the local API is aborted and reported: nothing can reach a hosted project.
// Run: npm run test:e2e:startup  (add -- --headed to watch it). See .claude/docs/runbook_e2e-local.md.

const API = process.env.VITE_SUPABASE_URL;
assertLocalSupabaseUrl(API);
const API_ORIGIN = new URL(API).origin;

const ES = JSON.parse(fs.readFileSync(path.resolve('src/translations/ES.json'), 'utf8'));
const INDEX_HTML = fs.readFileSync(path.resolve('index.html'), 'utf8');
// The inline first-paint script embeds exactly BRAND_PRESET (themeCompliance.test.js): the production brand row.
const BRAND_ROW = JSON.parse(INDEX_HTML.match(/var P = (\{[^\n]*\});/)[1]);
const CLASSIC_ROW = { useGradient: true };
const CACHE_KEY = 'business_visual_settings_cache';

const IVORY = 'rgb(250, 247, 240)';
const WHITE = 'rgb(255, 255, 255)';
const CLASSIC_STOPS = /rgb\(37, 99, 235\)|rgb\(147, 51, 234\)/;
const LOADING_TEXTS = [ES.common.loadingPlatform, ES.auth.authenticating, ES.auth.verifyingPermissions];
const FORBIDDEN_TEXTS = ['Acceso restringido', ES.dashboard.privateAccess];

// ---- network: local only ---------------------------------------------------------------------------------------
const guardNetwork = async (page, appOrigin) => {
  const external = [];
  await page.route('**/*', (route) => {
    const { origin } = new URL(route.request().url());
    if (origin === API_ORIGIN || origin === appOrigin) return route.fallback();
    external.push(route.request().url());
    return route.abort('blockedbyclient');
  });
  return external;
};

// settings: row to answer with; delay (ms) before answering; status 500 = failure; hang = never answer.
const routeSettings = (page, { row = BRAND_ROW, delay = 0, status = 200, hang = false } = {}) =>
  page.route(`${API_ORIGIN}/rest/v1/business_visual_settings*`, async (route) => {
    if (hang) return undefined;
    if (delay) await new Promise((r) => setTimeout(r, delay));
    const wantsObject = (route.request().headers().accept || '').includes('pgrst.object');
    if (status !== 200) {
      return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ message: 'boom' }) }).catch(() => {});
    }
    const body = wantsObject ? { settings: row } : [{ settings: row }];
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) }).catch(() => {});
  });

const seedCache = (page, data) => page.addInitScript(({ key, value }) => {
  if (sessionStorage.getItem('__seeded')) return; // only on the first navigation of the test
  sessionStorage.setItem('__seeded', '1');
  if (value) localStorage.setItem(key, JSON.stringify({ data: value, timestamp: 0 }));
  else localStorage.removeItem(key);
}, { key: CACHE_KEY, value: data });

// ---- what the browser really painted, frame by frame ---------------------------------------------------------
// phase: 'splash' (static #ps), 'app' (header mounted), else 'loading'. bg: backdrop under the top-left corner while
// something covers the page, the body once the app is there; 'none' = nothing painted (blank canvas).
const instrument = (page) => page.addInitScript(({ loadingTexts, forbiddenTexts }) => {
  const s = {
    samples: [], psGoneAt: null, headerAt: null, firstPhase: null,
    sawLoading: false, loadingAfterApp: false, psAfterApp: false, sawForbidden: false, sawAdminButton: false,
  };
  window.__startup = s;
  const paint = (el) => {
    for (; el; el = el.parentElement) {
      const st = getComputedStyle(el);
      if (st.backgroundImage !== 'none') return st.backgroundImage;
      if (st.backgroundColor !== 'rgba(0, 0, 0, 0)') return st.backgroundColor;
    }
    return 'none';
  };
  const observe = () => {
    const root = document.getElementById('root');
    const ps = document.getElementById('ps');
    const header = document.querySelector('header');
    const text = document.body?.textContent || '';
    if (s.psGoneAt === null && root?.firstElementChild && !ps) s.psGoneAt = performance.now();
    if (s.headerAt === null && header) s.headerAt = performance.now();
    if (loadingTexts.some((t) => text.includes(t))) {
      s.sawLoading = true;
      if (s.headerAt !== null && !header) s.loadingAfterApp = true;
    }
    if (s.headerAt !== null && ps) s.psAfterApp = true;
    if (forbiddenTexts.some((t) => text.includes(t))) s.sawForbidden = true;
    if (header && [...header.querySelectorAll('button')].some((b) => b.textContent.trim().startsWith('Admin'))) s.sawAdminButton = true;
  };
  new MutationObserver(observe).observe(document, { childList: true, subtree: true, characterData: true });
  const tick = () => {
    if (document.body && s.samples.length < 4000) {
      observe();
      const phase = document.getElementById('ps') ? 'splash' : document.querySelector('header') ? 'app' : 'loading';
      if (s.firstPhase === null) s.firstPhase = phase;
      const bg = phase === 'app' ? paint(document.body) : paint(document.elementFromPoint(2, 2));
      s.samples.push({ phase, bg });
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}, { loadingTexts: LOADING_TEXTS, forbiddenTexts: FORBIDDEN_TEXTS });

const errorsOf = (page) => {
  const errors = { console: [], page: [], failed: [], http: [] };
  page.on('console', (m) => { if (m.type() === 'error') errors.console.push(m.text()); });
  page.on('pageerror', (e) => errors.page.push(e.message));
  page.on('requestfailed', (r) => { if (r.failure()?.errorText !== 'net::ERR_BLOCKED_BY_CLIENT') errors.failed.push(`${r.failure()?.errorText} ${r.url()}`); });
  page.on('response', (r) => { if (r.status() >= 400) errors.http.push(`${r.status()} ${r.url()}`); });
  return errors;
};

const state = (page) => page.evaluate(() => window.__startup);
const appReady = async (page, timeout = 15000) => {
  await expect(page.locator('header')).toBeVisible({ timeout });
  await expect(page.locator('main')).toBeVisible({ timeout });
};
const covered = (s) => s.samples.filter((x) => x.phase !== 'app');
const distinct = (xs) => [...new Set(xs)];

// The static splash alone: the app bundle is blocked, so this is the served HTML before any JS runs.
const staticSplash = async (page) => {
  await page.route(/\/(assets\/index-[^/]*\.js|src\/main\.jsx)/, (route) => route.abort('blockedbyclient'));
  await page.goto('/');
  return page.evaluate(() => {
    const ps = document.getElementById('ps');
    if (!ps) return null;
    const st = getComputedStyle(ps);
    const r = ps.getBoundingClientRect();
    return {
      visible: r.width > 0 && r.height > 0 && st.visibility !== 'hidden',
      theme: document.documentElement.dataset.theme ?? null,
      backgroundImage: st.backgroundImage,
      backgroundColor: st.backgroundColor,
      fill: getComputedStyle(ps.querySelector('text')).fill,
      arrowAnimation: getComputedStyle(ps.querySelector('.ps-arrow')).animationName,
    };
  });
};

test.beforeEach(async ({ page, baseURL }, testInfo) => {
  // Desktop project only (the full local suite also runs mobile-chrome): (i) emulates the phone itself.
  test.skip(testInfo.project.name !== 'chromium', 'startup acceptance runs in the chromium project');
  page.__external = await guardNetwork(page, new URL(baseURL).origin);
});
// Third-party assets (e.g. the dicebear avatar fallback) are aborted too and only listed; a hosted Supabase is a failure.
test.afterEach(async ({ page }, testInfo) => {
  const external = page.__external || [];
  if (external.length) testInfo.annotations.push({ type: 'aborted-external', description: distinct(external.map((u) => new URL(u).host)).join(', ') });
  expect(external.filter((u) => /\.supabase\.(co|in)\b/.test(new URL(u).host)), 'requests to a hosted Supabase').toEqual([]);
});

// ---- (a) cold load, no cache, brand settings -----------------------------------------------------------------
test.describe('(a) cold load without cache, brand settings', () => {
  test('the served HTML paints the ivory splash before any JS runs', async ({ page }) => {
    await seedCache(page, null);
    const splash = await staticSplash(page);
    expect(splash, '#ps must be in the served HTML').not.toBeNull();
    expect(splash.visible).toBe(true);
    expect(splash.backgroundImage).toBe('none');
    expect(splash.backgroundColor).toBe(IVORY);
  });

  test('splash -> React -> header and Home content, every frame ivory, never blank, white or blue/violet', async ({ page }) => {
    await seedCache(page, null);
    await routeSettings(page, { row: BRAND_ROW });
    await instrument(page);
    await page.goto('/');
    await appReady(page);
    await expect(page.locator('main h1').first()).toBeVisible();
    const s = await state(page);
    // Soft: report every broken guarantee in one run (also when this runs against older code).
    expect.soft(s.firstPhase, 'first painted frame is the static splash').toBe('splash');
    expect(s.psGoneAt).not.toBeNull();
    expect.soft(s.headerAt - s.psGoneAt, 'React mount -> header (main waited a fixed 2.5 s here)').toBeLessThan(2500);
    expect(s.samples.filter((x) => CLASSIC_STOPS.test(x.bg)), 'no blue/violet frame').toEqual([]);
    expect(distinct(covered(s).map((x) => x.bg)), 'splash/loading frames').toEqual([IVORY]);
    expect(distinct(s.samples.filter((x) => x.phase === 'app').map((x) => x.bg)), 'body once the app is up').toEqual([IVORY]);
    expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('papuenvios');
  });
});

// ---- (b) classic cache -------------------------------------------------------------------------------------------
test.describe('(b) classic cached', () => {
  test('first paint: the classic gradient splash and a white wordmark', async ({ page }) => {
    await seedCache(page, CLASSIC_ROW);
    const splash = await staticSplash(page);
    expect(splash).not.toBeNull();
    expect(splash.theme).toBe('classic');
    expect(splash.backgroundImage).toMatch(/linear-gradient\(to right, rgb\(37, 99, 235\), rgb\(147, 51, 234\)\)/);
    expect(splash.fill).toBe(WHITE);
  });

  test('the whole startup stays classic: never an ivory frame before the app', async ({ page }) => {
    await seedCache(page, CLASSIC_ROW);
    await routeSettings(page, { row: CLASSIC_ROW });
    await instrument(page);
    await page.goto('/');
    await appReady(page);
    const s = await state(page);
    expect(s.firstPhase).toBe('splash');
    expect(covered(s).filter((x) => x.bg === IVORY || x.bg === 'none'), 'ivory/blank frames').toEqual([]);
    expect(covered(s).every((x) => CLASSIC_STOPS.test(x.bg))).toBe(true);
    expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('classic');
  });
});

// ---- (c) real sessions of the local stack ------------------------------------------------------------------------
test.describe('(c) signed in as a customer (real local session)', () => {
  test.use({ storageState: authFile('user') });

  test('protected page without any flash of another role, then SPA navigation without reload or splash', async ({ page }) => {
    await seedCache(page, null);
    await routeSettings(page, { row: BRAND_ROW });
    await instrument(page);
    await page.goto('/user-panel');
    await appReady(page);
    await expect(page.locator('main h1').first()).toBeVisible({ timeout: 15000 });
    await page.evaluate(() => { window.__noReload = true; });

    const nav = page.locator('header nav');
    await nav.getByRole('button', { name: ES.nav.home }).click();
    await expect(page).toHaveURL(/\/$/);
    await nav.getByRole('button', { name: ES.nav.products }).click();
    await expect(page).toHaveURL(/\/products$/);
    await page.locator('header').getByRole('button', { name: ES.nav.cart }).first().click();
    await expect(page).toHaveURL(/\/cart$/);
    await page.goBack();
    await expect(page).toHaveURL(/\/products$/);
    await page.goBack();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator('main')).toBeVisible();

    const s = await state(page);
    expect(await page.evaluate(() => window.__noReload), 'no full reload during navigation').toBe(true);
    expect(s.sawForbidden, 'access-denied content shown').toBe(false);
    expect(s.sawAdminButton, 'admin menu shown to a customer').toBe(false);
    expect(s.psAfterApp, 'static splash came back').toBe(false);
    expect(s.loadingAfterApp, 'loading screen came back after the app').toBe(false);
  });
});

test.describe('(c) signed in as an admin (real local session)', () => {
  test.use({ storageState: authFile('admin') });

  test('the admin page loads without ever showing access-denied content', async ({ page }) => {
    await seedCache(page, null);
    await routeSettings(page, { row: BRAND_ROW });
    await instrument(page);
    await page.goto('/admin');
    await appReady(page);
    await expect(page.locator('header').getByRole('button', { name: /^Admin/ })).toBeVisible({ timeout: 15000 });
    await expect(page.locator('main')).toBeVisible();
    const s = await state(page);
    expect(s.sawForbidden, 'access-denied content shown').toBe(false);
    expect(s.psAfterApp).toBe(false);
  });
});

// ---- (d) language ----------------------------------------------------------------------------------------------
test('(d) <html lang> is es by default, follows the switch to en and survives a reload', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await seedCache(page, null);
  await routeSettings(page, { row: BRAND_ROW });
  await page.goto('/');
  await appReady(page);
  expect(await page.evaluate(() => document.documentElement.lang)).toBe('es');
  await page.locator('header').getByRole('button', { name: /^ES$/ }).click();
  await expect.poll(() => page.evaluate(() => document.documentElement.lang)).toBe('en');
  await page.reload();
  await appReady(page);
  expect(await page.evaluate(() => document.documentElement.lang)).toBe('en');
});

// ---- (e) slow settings -----------------------------------------------------------------------------------------
test('(e) slow settings (1.2 s): loading screen in the brand look, then the app, no theme jump', async ({ page }) => {
  await seedCache(page, null);
  await routeSettings(page, { row: BRAND_ROW, delay: 1200 });
  await instrument(page);
  await page.goto('/');
  await appReady(page);
  const s = await state(page);
  expect(s.sawLoading).toBe(true);
  expect(s.samples.filter((x) => CLASSIC_STOPS.test(x.bg))).toEqual([]);
  expect(distinct(covered(s).map((x) => x.bg))).toEqual([IVORY]);
  expect(distinct(s.samples.filter((x) => x.phase === 'app').map((x) => x.bg))).toEqual([IVORY]);
});

// ---- (f) failing / hung settings with a brand cache ------------------------------------------------------------
for (const [label, options] of [['fail with 500', { status: 500 }], ['hang', { hang: true }]]) {
  test(`(f) settings that ${label}, brand cached: the app appears with the brand look`, async ({ page }) => {
    await seedCache(page, BRAND_ROW);
    await routeSettings(page, options);
    await instrument(page);
    await page.goto('/');
    await appReady(page, 10000); // auth (local, no session) + the 3.5 s settings cap, well under the ~10 s worst case
    const s = await state(page);
    expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('papuenvios');
    expect(distinct(s.samples.filter((x) => x.phase === 'app').map((x) => x.bg))).toEqual([IVORY]);
    expect(s.samples.filter((x) => CLASSIC_STOPS.test(x.bg))).toEqual([]);
  });
}

// ---- (g) clean run --------------------------------------------------------------------------------------------------
for (const width of [320, 414]) {
  test(`(g) ${width}px: no console error, page error or failed request, no horizontal scroll`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    const errors = errorsOf(page);
    await seedCache(page, null);
    await routeSettings(page, { row: BRAND_ROW });
    await page.goto('/');
    await appReady(page);
    await expect(page.locator('main h1').first()).toBeVisible();
    await page.waitForLoadState('networkidle');
    // The local stack runs without the realtime service (runbook: -x realtime): its websocket/channel errors are the
    // only ones tolerated, and only those exact messages.
    const realtimeOnly = (m) => /\/realtime\/v1\/websocket.*503|^\[Realtime\] Subscription channel_error for /.test(m);
    expect({ ...errors, console: errors.console.filter((m) => !realtimeOnly(m)) }).toEqual({ console: [], page: [], failed: [], http: [] });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
}

// ---- (h) reduced motion ----------------------------------------------------------------------------------------
test('(h) the static splash arrow animates, except with prefers-reduced-motion: reduce', async ({ page }) => {
  await seedCache(page, null);
  expect((await staticSplash(page)).arrowAnimation).toBe('ps-nudge');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect((await staticSplash(page)).arrowAnimation).toBe('none');
});

// ---- (i) Slow 3G on a phone ----------------------------------------------------------------------------------------
test.describe('(i) Slow 3G on a phone', () => {
  const { defaultBrowserType, ...pixel } = devices['Pixel 5']; // eslint-disable-line no-unused-vars
  test.use(pixel);

  test('splash from the first frame; the app comes right after React mounts (no fixed wait)', async ({ page }, testInfo) => {
    test.slow();
    await seedCache(page, null);
    await routeSettings(page, { row: BRAND_ROW });
    await instrument(page);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Network.enable');
    // DevTools "Slow 3G": 2 s RTT, ~400 kbit/s.
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 2000, downloadThroughput: 50000, uploadThroughput: 50000 });
    await page.goto('/', { timeout: 120000 });
    await appReady(page, 120000);
    const s = await state(page);
    const mountToHeader = Math.round(s.headerAt - s.psGoneAt);
    testInfo.annotations.push({ type: 'slow3g', description: `psGoneAt=${Math.round(s.psGoneAt)} headerAt=${Math.round(s.headerAt)} mountToHeader=${mountToHeader}` });
    expect.soft(s.firstPhase, 'the splash is the first frame, while the bundle downloads').toBe('splash');
    // main started a fixed 2.5 s timer when React mounted: its header always came >= 2500 ms after the first commit.
    expect.soft(mountToHeader, 'React mount -> header').toBeLessThan(2500);
    expect.soft(s.samples.filter((x) => CLASSIC_STOPS.test(x.bg))).toEqual([]);
  });
});
