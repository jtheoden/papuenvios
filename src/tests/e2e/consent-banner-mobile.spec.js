import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

// Cookie/analytics consent bar on a small phone (320x568): it must take at most 20% of the viewport height,
// keep both choices equally weighted and never block the page. Supabase is fully mocked: no network, no real data.
//
// Run it in isolation (same as footer-brand.spec.js):
//   VITE_SUPABASE_URL=http://127.0.0.1:56321 VITE_SUPABASE_ANON_KEY=any npx vite build --outDir .e2e-dist
//   E2E_PREVIEW=1 VITE_SUPABASE_URL=http://127.0.0.1:56321 VITE_SUPABASE_ANON_KEY=any \
//     npx playwright test src/tests/e2e/consent-banner-mobile.spec.js --project=chromium --no-deps

const ES = JSON.parse(fs.readFileSync(path.resolve('src/translations/ES.json'), 'utf8'));
const EN = JSON.parse(fs.readFileSync(path.resolve('src/translations/EN.json'), 'utf8'));
const VIEWPORT = { width: 320, height: 568 };
const MAX_SHARE = 0.2;

const json = (route, body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

const open = async (page, language) => {
  await page.route(/\/(rest|auth|functions|storage)\/v1\//, async (route) => {
    const request = route.request();
    if (request.url().includes('/auth/v1/')) {
      return route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ message: 'not authenticated' }) });
    }
    const wantsObject = (request.headers().accept || '').includes('pgrst.object');
    return json(route, wantsObject ? {} : []);
  });
  await page.addInitScript((lang) => localStorage.setItem('preferredLanguage', lang), language);
  // Home, checkout and admin suppress the first-visit prompt (shouldShowFooterNotice); the public remittances page shows it.
  await page.goto('/remittances');
  const dict = language === 'es' ? ES : EN;
  const banner = page.getByRole('region', { name: dict.cookieConsent.title });
  await expect(banner).toBeVisible();
  // Measure with the final web font, not the fallback (line wrapping decides the height).
  await page.evaluate(() => document.fonts.ready);
  return { banner, dict };
};

test.describe('consent banner at 320x568', () => {
  test.use({ viewport: VIEWPORT });

  for (const language of ['es', 'en']) {
    test(`takes at most 20% of the height, with equal choices (${language})`, async ({ page }) => {
      const { banner, dict } = await open(page, language);
      const box = await banner.boundingBox();
      const share = box.height / VIEWPORT.height;
      test.info().annotations.push({ type: 'banner-height', description: `${box.height}px = ${(share * 100).toFixed(1)}%` });
      expect(share).toBeLessThanOrEqual(MAX_SHARE);
      expect(box.y + box.height).toBeLessThanOrEqual(VIEWPORT.height + 0.5);

      const accept = await banner.getByRole('button', { name: dict.cookieConsent.accept }).boundingBox();
      const reject = await banner.getByRole('button', { name: dict.cookieConsent.reject }).boundingBox();
      expect(Math.abs(accept.width - reject.width)).toBeLessThanOrEqual(1);
      expect(accept.height).toBeGreaterThanOrEqual(44);
      expect(reject.height).toBeGreaterThanOrEqual(44);
    });
  }

  test('"more information" expands in place, keeps focus on the toggle and reserves the new height', async ({ page }) => {
    const { banner, dict } = await open(page, 'es');
    const toggle = banner.getByRole('button', { name: dict.cookieConsent.moreInfo });
    await toggle.focus();
    await page.keyboard.press('Enter');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(toggle).toBeFocused();
    await expect(banner.getByRole('link', { name: dict.cookieConsent.privacyLink })).toBeVisible();
    const height = (await banner.boundingBox()).height;
    await expect.poll(() => page.evaluate(() => parseFloat(document.body.style.paddingBottom))).toBeCloseTo(height, 0);
  });

  test('does not block the page: content above the bar stays interactive', async ({ page }) => {
    const { banner } = await open(page, 'es');
    const top = (await banner.boundingBox()).y;
    const hit = await page.evaluate((y) => {
      const el = document.elementFromPoint(160, Math.max(1, y - 10));
      return Boolean(el) && !el.closest('[role="region"][aria-labelledby="cookie-consent-title"]');
    }, top);
    expect(hit).toBe(true);
    await page.mouse.wheel(0, 400);
    await expect(banner).toBeVisible();
  });
});
