import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

// Footer + loading screen brand theme (S4). Supabase is fully mocked with page.route: no network, no real data.
// Set FOOTER_SHOTS_DIR to also save screenshots (evidence only, never a gate).
//
// Run it in isolation (the default config also wants a local Supabase stack for the role-based suites):
//   npx vite build --outDir .e2e-dist        # with VITE_SUPABASE_URL=http://127.0.0.1:56321 VITE_SUPABASE_ANON_KEY=any (never used)
//   E2E_PREVIEW=1 VITE_SUPABASE_URL=http://127.0.0.1:56321 VITE_SUPABASE_ANON_KEY=any \
//     npx playwright test src/tests/e2e/footer-brand.spec.js --project=chromium --no-deps
// The loading-screen tests freeze the page clock and emulate reduced motion so the screen stays up and is painted in
// its final state: they check colours, text and layout, NOT the animated look (spinner, entry spring, progress bar).

const SHOTS_DIR = process.env.FOOTER_SHOTS_DIR;
const ES = JSON.parse(fs.readFileSync(path.resolve('src/translations/ES.json'), 'utf8'));
const EN = JSON.parse(fs.readFileSync(path.resolve('src/translations/EN.json'), 'utf8'));

// The footer/loading part of the "Paleta PapuEnvios" preset, spelled out on purpose: Playwright does not resolve
// the '@/' alias, and literal values keep this check independent of brandPalette.js.
const BRAND_PRESET = {
  useGradient: false,
  useHeaderGradient: false,
  pageBgColor: '#FAF7F0',
  cardBgColor: '#FFFFFF',
  headingColor: '#171717',
  mutedTextColor: '#605B52',
  borderColor: '#E8E0D2',
  focusRingColor: '#171717',
  footerBgColor: '#FFFFFF',
  footerTextColor: '#605B52',
  footerLinkColor: '#171717',
  footerLinkHoverColor: '#605B52',
};

// Row stored in production today (the app merges it over its code defaults).
const PROD_ROW = {
  useGradient: true,
  logo: '',
  primaryColor: '#3499dc',
  secondaryColor: '#9333ea',
  accentColor: '#9333ea',
  pageBgColor: '#f9fafb',
  footerLinkColor: '#2563eb',
  footerLinkHoverColor: '#9333ea',
};

const CACHE_KEY = 'business_visual_settings_cache';
const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');

// Expired on purpose: supabase-js then has to refresh it over the (held) auth call, which keeps the app on the loading screen.
const session = () => {
  const exp = Math.floor(Date.now() / 1000) - 100;
  const user = { id: '00000000-0000-4000-8000-000000000001', aud: 'authenticated', role: 'authenticated', email: 'qa-user@example.test', app_metadata: {}, user_metadata: {} };
  return { access_token: `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: user.id, exp, role: 'authenticated' })}.sig`, token_type: 'bearer', expires_in: 3600, expires_at: exp, refresh_token: 'refresh', user };
};

const json = (route, body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

// `hold` (a promise) delays every auth call, so the app stays on the loading screen until it resolves.
const mockSupabase = async (page, { settings = null, hold = null } = {}) => {
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
    if (url.includes('/auth/v1/')) {
      if (hold) await hold;
      return route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ message: 'not authenticated' }) });
    }
    return json(route, wantsObject ? {} : []);
  });
};

const open = async (page, { settings, language = 'es', route = '/' } = {}) => {
  await mockSupabase(page, { settings });
  await page.addInitScript(({ lang }) => {
    localStorage.setItem('preferredLanguage', lang);
  }, { lang: language });
  const settingsLoaded = page.waitForResponse((r) => r.url().includes('/rest/v1/business_visual_settings'));
  await page.goto(route);
  await settingsLoaded;
  const footer = page.locator('footer');
  await footer.scrollIntoViewIfNeeded();
  await expect(footer).toBeVisible();
  return footer;
};

const signature = (footer) => footer.locator('a[href*="linkedin.com"]');
const companyName = (footer) => footer.locator('span.font-semibold', { hasText: /PapuEnvios/ }).first();

test.describe('footer, brand preset applied', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('white footer, grey text, charcoal underlined links and company name', async ({ page }) => {
    const footer = await open(page, { settings: BRAND_PRESET });
    await expect(footer).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    await expect(footer).toHaveCSS('border-top-color', 'rgb(232, 224, 210)');
    const link = signature(footer);
    await expect(link).toHaveCSS('color', 'rgb(23, 23, 23)');
    await expect(link).toHaveCSS('text-decoration-line', /underline/);
    await expect(companyName(footer)).toHaveCSS('color', 'rgb(23, 23, 23)');
    await expect(footer.getByText(ES.footer.copyright, { exact: false })).toHaveCSS('opacity', '1');
  });

  test('hover and keyboard focus are driven by classes', async ({ page }) => {
    const footer = await open(page, { settings: BRAND_PRESET });
    const link = signature(footer);
    await link.hover();
    await expect(link).toHaveCSS('color', 'rgb(96, 91, 82)');
    await page.mouse.move(0, 0);
    await page.keyboard.press('Shift');
    await link.focus();
    await expect(link).toHaveCSS('box-shadow', /rgb\(23, 23, 23\)/);
    const terms = footer.getByRole('link', { name: ES.legal.links.terms });
    await terms.focus();
    await expect(terms).toHaveCSS('box-shadow', /rgb\(23, 23, 23\)/);
  });

  test('legal links and the cookie button take the hover colour', async ({ page }) => {
    const footer = await open(page, { settings: BRAND_PRESET });
    const nav = footer.getByRole('navigation', { name: ES.legal.nav.label });
    const button = nav.getByRole('button', { name: ES.cookieConsent.preferencesLink });
    await button.hover();
    await expect(button).toHaveCSS('color', 'rgb(96, 91, 82)');
  });

  test('a customised link colour reaches the footer', async ({ page }) => {
    const footer = await open(page, { settings: { ...BRAND_PRESET, footerLinkColor: '#112233', footerLinkHoverColor: '#445566' } });
    const link = signature(footer);
    await expect(link).toHaveCSS('color', 'rgb(17, 34, 51)');
    await link.hover();
    await expect(link).toHaveCSS('color', 'rgb(68, 85, 102)');
  });

  test('keeps the legal notice text and legal links (Home shows the notice in its body, so use /terms)', async ({ page }) => {
    const footer = await open(page, { settings: BRAND_PRESET, route: '/terms' });
    const note = footer.getByRole('note');
    await expect(note).toContainText(ES.legal.notice.notBank);
    const nav = footer.getByRole('navigation', { name: ES.legal.nav.label });
    await expect(nav.getByRole('link', { name: ES.legal.links.terms })).toBeVisible();
    await expect(nav.getByRole('link', { name: ES.legal.links.privacy })).toBeVisible();
    await expect(nav.getByRole('button', { name: ES.cookieConsent.preferencesLink })).toBeVisible();
  });
});

test.describe('footer, production row (no preset applied) keeps its look', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('blue links with violet hover, primary-coloured name, plain signature link', async ({ page }) => {
    const footer = await open(page, { settings: PROD_ROW });
    await expect(footer).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    const link = signature(footer);
    await expect(link).toHaveCSS('color', 'rgb(37, 99, 235)');
    await expect(link).toHaveCSS('text-decoration-line', 'none');
    await link.hover();
    await expect(link).toHaveCSS('color', 'rgb(147, 51, 234)');
    await expect(companyName(footer)).toHaveCSS('color', 'rgb(52, 153, 220)');
  });

  test('legal links and the cookie button have no hover colour, as before', async ({ page }) => {
    const footer = await open(page, { settings: PROD_ROW });
    const nav = footer.getByRole('navigation', { name: ES.legal.nav.label });
    for (const el of [nav.getByRole('link').first(), nav.getByRole('button', { name: ES.cookieConsent.preferencesLink })]) {
      await el.hover();
      await expect(el).toHaveCSS('color', 'rgb(37, 99, 235)');
    }
  });

  test('no row at all (code defaults) renders the same blue links', async ({ page }) => {
    const footer = await open(page, { settings: null });
    await expect(signature(footer)).toHaveCSS('color', 'rgb(37, 99, 235)');
  });
});

// Everything the footer paints must stay inside the viewport.
const footerOverflow = (page) => page.evaluate(() => {
  const vw = document.documentElement.clientWidth;
  const footer = document.querySelector('footer');
  const outside = [...footer.querySelectorAll('*')]
    .filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && (r.right > vw + 0.5 || r.left < -0.5);
    })
    .map((el) => `${el.tagName}.${String(el.className).slice(0, 50)}`);
  return { outside, footerScroll: footer.scrollWidth - footer.clientWidth };
});

const VARIANTS = { preset: BRAND_PRESET, prod: PROD_ROW };

for (const width of [320, 768, 1280]) {
  for (const language of ['es', 'en']) {
    for (const [variant, settings] of Object.entries(VARIANTS)) {
      test.describe(`footer layout ${width}px ${language} (${variant})`, () => {
        test.use({ viewport: { width, height: 800 } });

        test('fits the viewport without horizontal overflow', async ({ page }) => {
          const footer = await open(page, { settings, language });
          const result = await footerOverflow(page);
          expect(result.outside).toEqual([]);
          expect(result.footerScroll).toBeLessThanOrEqual(0);
          if (SHOTS_DIR) {
            fs.mkdirSync(SHOTS_DIR, { recursive: true });
            await footer.screenshot({ path: path.join(SHOTS_DIR, `footer-${variant}-${width}-${language}.png`) });
          }
        });
      });
    }
  }
}

// Loading screen: every auth call is held and the page clock is frozen, so the app's 6 s safety timeout (which would
// swap the screen for the Home) cannot fire under a slow CI. Reduced motion is emulated so the card is painted in its
// final state without advancing time (this also exercises the reduced-motion path). Each check reads one atomic snapshot.
const openLoading = async (page, { settings, language = 'es' } = {}) => {
  await mockSupabase(page, { hold: new Promise(() => {}) });
  await page.clock.install();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(({ lang, cacheKey, cached, stored }) => {
    localStorage.setItem('preferredLanguage', lang);
    localStorage.setItem('papuenvios-auth', JSON.stringify(stored));
    if (cached) localStorage.setItem(cacheKey, JSON.stringify({ data: cached, timestamp: Date.now() - 3600_000 }));
  }, { lang: language, cacheKey: CACHE_KEY, cached: settings, stored: session() });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const handle = await page.waitForFunction(() => {
    const el = document.querySelector('[role="status"]');
    if (!el || !el.textContent) return null; // the announcement is filled after mount
    const style = getComputedStyle(el);
    const card = el.querySelector('.shadow-xl');
    return {
      text: el.textContent,
      live: el.getAttribute('aria-live'),
      backgroundColor: style.backgroundColor,
      backgroundImage: style.backgroundImage,
      spinnerColor: getComputedStyle(el.querySelector('.animate-spin')).borderTopColor,
      cardColor: getComputedStyle(card).backgroundColor,
      cardWidth: card.offsetWidth,
      viewport: document.documentElement.clientWidth,
      pageScroll: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
  return handle.jsonValue();
};

test.describe('loading screen', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('preset: ivory page, white card, charcoal spinner, accessible text', async ({ page }) => {
    const snap = await openLoading(page, { settings: BRAND_PRESET });
    expect(snap.backgroundColor).toBe('rgb(250, 247, 240)');
    expect(snap.cardColor).toBe('rgb(255, 255, 255)');
    expect(snap.spinnerColor).toBe('rgb(23, 23, 23)');
    expect(snap.text).toContain(ES.auth.authenticating);
    expect(snap.live).toBe('polite');
  });

  test('production row cached: the shipped blue to violet gradient, unchanged', async ({ page }) => {
    const snap = await openLoading(page, { settings: PROD_ROW });
    expect(snap.backgroundImage).toMatch(/linear-gradient\(.*rgb\(37, 99, 235\).*rgb\(147, 51, 234\)/);
    expect(snap.spinnerColor).toBe('rgb(37, 99, 235)');
    expect(snap.cardColor).toBe('rgb(255, 255, 255)');
  });

  test('no cached settings (first visit): the brand ivory, like the static splash', async ({ page }) => {
    const snap = await openLoading(page, { settings: null });
    expect(snap.backgroundImage).toBe('none');
    expect(snap.backgroundColor).toBe('rgb(250, 247, 240)');
    expect(snap.spinnerColor).toBe('rgb(23, 23, 23)');
  });
});

for (const width of [320, 768, 1280]) {
  for (const language of ['es', 'en']) {
    for (const [variant, settings] of Object.entries(VARIANTS)) {
      test.describe(`loading layout ${width}px ${language} (${variant})`, () => {
        test.use({ viewport: { width, height: 800 } });

        test('fits the viewport, announces the translated message', async ({ page }) => {
          const snap = await openLoading(page, { settings, language });
          expect(snap.text).toContain((language === 'es' ? ES : EN).auth.authenticating);
          expect(snap.pageScroll).toBeLessThanOrEqual(0);
          expect(snap.cardWidth).toBeLessThanOrEqual(snap.viewport);
          if (SHOTS_DIR) {
            fs.mkdirSync(SHOTS_DIR, { recursive: true });
            await page.screenshot({ path: path.join(SHOTS_DIR, `loading-${variant}-${width}-${language}.png`) });
          }
        });
      });
    }
  }
}
