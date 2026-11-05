import { test, expect } from '@playwright/test';
import path from 'node:path';

// Products page on a slow network. Supabase is fully mocked with page.route (no real data): the catalog
// requests are held until the test releases them (a fixed delay can end before the page mounts). Spec: while loading, a busy skeleton with a visible "Cargando..."
// label and never the "no products" state; it goes away when the data arrives; cards enter with a short
// stagger only without prefers-reduced-motion; no horizontal scroll at 320/390 px; CLS stays near 0.
// Set CATALOG_SHOTS_DIR to also save screenshots (evidence only, never a gate).
// Run: THEME_E2E_MATCH='catalog-loading\.spec\.js' npx playwright test -c playwright.theme.config.js

test.describe.configure({ timeout: 60000 }); // the dev server compiles on demand: first loads are slow

const SHOTS_DIR = process.env.CATALOG_SHOTS_DIR;
const shot = (page, name) => (SHOTS_DIR ? page.screenshot({ path: path.join(SHOTS_DIR, `${name}.png`) }) : null);
const MAX_HOLD_MS = 30000; // safety net: never hold a request forever
const USD = '00000000-0000-0000-0000-0000000000aa';
const PRODUCTS = Array.from({ length: 8 }, (_, i) => ({
  id: `00000000-0000-0000-0000-00000000000${i + 1}`,
  name_es: `Producto lento ${i + 1}`,
  name_en: `Slow product ${i + 1}`,
  final_price: 5 + i,
  base_currency_id: USD,
  is_active: true,
  created_at: '2026-01-01T00:00:00Z',
}));
const INVENTORY = PRODUCTS.map((p) => ({ product_id: p.id, available_quantity: 10, expiry_date: null }));
const CURRENCIES = [{ id: USD, code: 'USD', symbol: '$', name_es: 'Dólar', name_en: 'Dollar', is_base: true, is_active: true }];
const EMPTY_TEXT = 'No se encontraron productos';
const SLOW = ['/rest/v1/products', '/rest/v1/inventory', '/rest/v1/combo_products', '/rest/v1/combo_items'];

const json = (route, body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

const mockSupabase = async (page) => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; setTimeout(resolve, MAX_HOLD_MS); });
  await page.route(/\/(rest|auth|functions|storage)\/v1\//, async (route) => {
    const request = route.request();
    const url = request.url();
    const wantsObject = (request.headers().accept || '').includes('pgrst.object');
    if (url.includes('/auth/v1/')) return route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ message: 'not authenticated' }) });
    if (url.includes('/rest/v1/business_visual_settings')) return route.fulfill({ status: 406, contentType: 'application/json', body: JSON.stringify({ code: 'PGRST116', message: 'no rows', details: null, hint: null }) });
    if (SLOW.some((path) => url.includes(path))) {
      await gate;
      if (url.includes('/rest/v1/products')) return json(route, PRODUCTS);
      if (url.includes('/rest/v1/inventory')) return json(route, INVENTORY);
      return json(route, []);
    }
    if (url.includes('/rest/v1/currencies')) return json(route, wantsObject ? CURRENCIES[0] : CURRENCIES);
    return json(route, wantsObject ? {} : []);
  });
  return release;
};

const open = async (page, { width = 1280, reducedMotion = 'no-preference' } = {}) => {
  await page.setViewportSize({ width, height: 900 });
  await page.emulateMedia({ reducedMotion });
  const release = await mockSupabase(page);
  await page.addInitScript(() => {
    localStorage.setItem('preferredLanguage', 'es');
    window.__cls = 0;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) if (!entry.hadRecentInput) window.__cls += entry.value;
    }).observe({ type: 'layout-shift', buffered: true });
  });
  await page.goto('/products');
  return release;
};

const noHorizontalScroll = (page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

test('slow catalog: skeleton and label while loading, no premature empty state, list on arrival', async ({ page }) => {
  const release = await open(page);
  const status = page.locator('[role="status"][aria-busy="true"]');
  await expect(status).toBeVisible({ timeout: 20000 });
  await expect(status).toContainText('Cargando');
  await expect(status).toHaveAttribute('data-state', 'visible');
  await expect(page.getByText(EMPTY_TEXT)).toHaveCount(0);
  expect(await status.locator('[data-skeleton]').count()).toBeGreaterThan(0);

  // Skeleton pulses without reduced motion.
  const pulse = await status.locator('[data-skeleton]').first().evaluate((el) => getComputedStyle(el).animationName);
  expect(pulse).toBe('skeleton-pulse');
  await shot(page, 'catalog-loading-1280');

  release();
  await expect(page.getByText('Producto lento 1')).toBeVisible({ timeout: 15000 });
  await expect(status).toHaveCount(0);
  await expect(page.getByText(EMPTY_TEXT)).toHaveCount(0);

  // Staggered entrance on the first cards only.
  const card = (i) => page.getByText(`Producto lento ${i}`).locator('xpath=ancestor::div[contains(@class,"glass-effect")][1]');
  expect(await card(1).evaluate((el) => getComputedStyle(el).animationName)).toBe('enter-up');
  expect(await card(7).evaluate((el) => getComputedStyle(el).animationName)).toBe('none');

  await page.waitForTimeout(600); // let the entrance finish before reading the layout shifts
  const cls = await page.evaluate(() => window.__cls);
  test.info().annotations.push({ type: 'cls', description: String(cls) });
  await shot(page, 'catalog-loaded-1280');
  expect(cls, `CLS ${cls}`).toBeLessThan(0.1);
});

test('prefers-reduced-motion: no pulse and no entrance animation', async ({ page }) => {
  const release = await open(page, { reducedMotion: 'reduce' });
  const status = page.locator('[role="status"][aria-busy="true"]');
  await expect(status).toContainText('Cargando', { timeout: 20000 });
  expect(await status.locator('[data-skeleton]').first().evaluate((el) => getComputedStyle(el).animationName)).toBe('none');
  expect(await status.evaluate((el) => getComputedStyle(el).transitionDuration)).toBe('0s');
  release();

  await expect(page.getByText('Producto lento 1')).toBeVisible({ timeout: 15000 });
  const card = page.getByText('Producto lento 1').locator('xpath=ancestor::div[contains(@class,"glass-effect")][1]');
  expect(await card.evaluate((el) => getComputedStyle(el).animationName)).toBe('none');
  expect(await card.evaluate((el) => el.getAnimations().length)).toBe(0);
});

for (const width of [320, 390]) {
  test(`no horizontal scroll at ${width}px while loading and after`, async ({ page }) => {
    const release = await open(page, { width });
    await expect(page.locator('[role="status"][aria-busy="true"]')).toContainText('Cargando', { timeout: 20000 });
    expect(await noHorizontalScroll(page)).toBe(true);
    await shot(page, `catalog-loading-${width}`);
    release();
    await expect(page.getByText('Producto lento 1')).toBeVisible({ timeout: 15000 });
    expect(await noHorizontalScroll(page)).toBe(true);
  });
}
