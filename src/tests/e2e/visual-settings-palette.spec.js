import { test, expect } from '@playwright/test';
import fs from 'node:fs';

const ES = JSON.parse(fs.readFileSync(new URL('../../translations/ES.json', import.meta.url), 'utf8'));
const copy = ES.settings.visual;

// Run via playwright.theme.config.js with THEME_E2E_MATCH=visual-settings-palette.
// Real component/providers/CSS; every external request is intercepted, and Save is only a callback spy.
for (const width of [320, 768, 1280]) {
  for (const theme of ['classic', 'papuenvios']) {
    test(`${theme} Visual Settings at ${width}px: palette, chrome and explicit-save boundary`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      const writes = [];
      await page.route('**/*', (route) => {
        const request = route.request();
        const url = new URL(request.url());
        if (url.port === '54321') {
          if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) writes.push(request.method());
          return route.fulfill({ contentType: 'application/json', body: '[]' });
        }
        if (url.origin === new URL(test.info().project.use.baseURL).origin) return route.continue();
        return route.abort();
      });
      await page.routeWebSocket('**/*', (socket) => socket.close());
      await page.addInitScript((id) => {
        window.__previewTheme = id;
        localStorage.setItem('preferredLanguage', 'es');
      }, theme);
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto('/src/tests/e2e/fixtures/visual-settings-preview.html');
      await expect.poll(() => page.evaluate(() => Array.isArray(window.__visualSaves)), { message: 'Browser fixture should mount without module/runtime errors' }).toBe(true);
      expect(errors).toEqual([]);
      const primary = page.getByLabel(copy.primaryColor, { exact: true });
      const secondary = page.getByLabel(copy.secondaryColor, { exact: true });
      await expect(primary).toHaveValue(theme === 'classic' ? '#3499dc' : '#171717');
      await expect(secondary).toHaveValue(theme === 'classic' ? '#9333ea' : '#605b52');
      await expect(page.getByRole('heading', { name: copy.appearance, exact: true }).locator('svg')).toHaveCSS('color', theme === 'classic' ? 'rgb(147, 51, 234)' : 'rgb(255, 165, 0)');
      const pill = page.getByText(copy.livePreview, { exact: true }).locator('..');
      await expect(pill).toHaveCSS('background-color', theme === 'classic' ? 'rgb(239, 246, 255)' : 'rgb(255, 241, 204)');
      const identity = page.getByRole('heading', { name: copy.brandIdentity, exact: true }).locator('../..');
      await identity.scrollIntoViewIfNeeded();
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      await page.screenshot({ path: test.info().outputPath(`${theme}-${width}.png`), fullPage: false });

      await page.getByRole('button', { name: copy.brand.applyPalette }).click();
      await expect(page.getByLabel(copy.livePreview, { exact: true })).toBeDisabled();
      await secondary.fill('#123456');
      expect(await page.evaluate(() => window.__visualSaves.length)).toBe(0);
      expect(writes).toEqual([]);
      await page.getByText(copy.saveCustomization, { exact: true }).locator('..').click();
      expect(await page.evaluate(() => window.__visualSaves.length)).toBe(1);
      expect(await page.evaluate(() => window.__visualSaves[0].secondaryColor)).toBe('#123456');
      expect(writes).toEqual([]);
    });
  }
}
