import { test, expect } from '@playwright/test';

// Login card brand logo. Supabase is fully mocked with page.route: no network, no real data.
// Run: THEME_E2E_MATCH='login-brand\.spec\.js' npx playwright test -c playwright.theme.config.js

// 1x1 transparent PNG served for the "configured logo" case.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
const LOGO_URL = 'https://cdn.e2e.test/logo.png';

const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

const open = async (page, settings) => {
  await page.route(LOGO_URL, (route) => route.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
  await page.route(/\/(rest|auth|functions|storage)\/v1\//, (route) => {
    const request = route.request();
    const url = request.url();
    const wantsObject = (request.headers().accept || '').includes('pgrst.object');
    if (url.includes('/rest/v1/business_visual_settings')) return json(route, wantsObject ? { settings } : [{ settings }]);
    if (url.includes('/auth/v1/')) return json(route, { message: 'not authenticated' }, 401);
    return json(route, wantsObject ? {} : []);
  });
  await page.addInitScript(() => localStorage.setItem('preferredLanguage', 'es'));
  const settingsLoaded = page.waitForResponse((r) => r.url().includes('/rest/v1/business_visual_settings'));
  await page.goto('/login');
  await settingsLoaded;
};

const noHorizontalScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

for (const width of [320, 414]) {
  test.describe(`login card ${width}px`, () => {
    test.use({ viewport: { width, height: 800 } });

    test('empty logo (production row): brand wordmark, inside the card, no horizontal scroll', async ({ page }) => {
      await open(page, { logo: '', companyName: 'PapuEnvíos' });
      const img = page.locator('.glass-effect img[alt="PapuEnvíos"]');
      await expect(img).toBeVisible();
      await expect(img).toHaveAttribute('src', /papuenvios-wordmark-onlight/);
      await expect.poll(() => img.evaluate((el) => el.complete && el.naturalWidth > 0)).toBe(true);
      const card = await page.locator('.glass-effect').first().boundingBox();
      const box = await img.boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(card.x);
      expect(box.x + box.width).toBeLessThanOrEqual(card.x + card.width + 0.5);
      expect(box.width).toBeLessThanOrEqual(320);
      expect(await noHorizontalScroll(page)).toBeLessThanOrEqual(0);
      await expect(page.getByRole('button', { name: /Google/ })).toBeVisible();
    });

    test('configured logo is shown in the card', async ({ page }) => {
      await open(page, { logo: LOGO_URL, logoMaxHeight: 48, companyName: 'PapuEnvíos' });
      const img = page.locator(`.glass-effect img[src="${LOGO_URL}"]`);
      await expect(img).toBeVisible();
      await expect.poll(() => img.evaluate((el) => el.complete && el.naturalWidth > 0)).toBe(true);
      expect((await img.boundingBox()).height).toBeCloseTo(48, 0);
      expect(await noHorizontalScroll(page)).toBeLessThanOrEqual(0);
    });

    test('a broken logo URL falls back to the wordmark', async ({ page }) => {
      await page.route('https://cdn.e2e.test/broken.png', (route) => route.fulfill({ status: 404, body: '' }));
      await open(page, { logo: 'https://cdn.e2e.test/broken.png', companyName: 'PapuEnvíos' });
      await expect(page.locator('.glass-effect img[alt="PapuEnvíos"]')).toHaveAttribute('src', /papuenvios-wordmark-onlight/);
    });
  });
}
