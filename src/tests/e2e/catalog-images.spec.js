import { test, expect } from '@playwright/test';

// Egress: how many catalog images (and bytes) does /products download on first load?
// Supabase is fully mocked with page.route: no network, no real data. Image sizes mirror production
// (product-images averages ~128 kB, 59 products + 9 combos). Run with:
//   THEME_E2E_MATCH='catalog-images\.spec\.js' npx playwright test -c playwright.theme.config.js
// The measured numbers are attached to the test as annotations (and logged in TRACKING_PROGRESS).

test.describe.configure({ timeout: 90000 });

const N_PRODUCTS = 59;
const N_COMBOS = 9;
const IMG_HOST = 'https://cdn.example.test';
// Deterministic "realistic" weights between 60 and 200 kB.
const weightOf = (i) => 60_000 + ((i * 37_919) % 140_000);

// A valid SVG padded with a comment up to the target byte size: decodes in every browser, weighs what a JPEG would.
const paddedSvg = (bytes, label) => {
  const head = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400"><rect width="400" height="400" fill="#cbd5e1"/><text x="20" y="200" font-size="40">${label}</text><!--`;
  const tail = '--></svg>';
  return head + 'x'.repeat(Math.max(0, bytes - head.length - tail.length)) + tail;
};

const PRODUCTS = Array.from({ length: N_PRODUCTS }, (_, i) => ({
  id: `p${i}`, sku: `SKU${i}`, name_es: `Producto ${i}`, name_en: `Product ${i}`, description_es: '', description_en: '',
  category_id: 'c1', base_currency_id: 'usd', final_price: 10 + i, weight: 1, unit: 'unit', dimensions: null,
  image_url: `${IMG_HOST}/product-${i}.svg`, requires_expiry: false, is_active: true, is_featured: false, tags: [],
  created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z',
  category: { id: 'c1', name_es: 'General', name_en: 'General', slug: 'general' }
}));
const COMBOS = Array.from({ length: N_COMBOS }, (_, i) => ({
  id: `k${i}`, name_es: `Combo ${i}`, name_en: `Combo ${i}`, description_es: '', description_en: '',
  image_url: `${IMG_HOST}/combo-${i}.svg`, final_price: 50 + i, shipping_free: false, shipping_discount_percent: 0,
  out_of_province_shipping: false, out_of_province_price: 0, is_active: true, is_featured: false,
  created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z'
}));
const INVENTORY = PRODUCTS.map((p) => ({ product_id: p.id, quantity: 10, available_quantity: 10, expiry_date: null }));
const CATEGORIES = [{ id: 'c1', slug: 'general', name_es: 'General', name_en: 'General', description_es: '', description_en: '', display_order: 1, is_active: true }];
const CURRENCIES = [{ id: 'usd', code: 'USD', name_es: 'Dólar', name_en: 'Dollar', symbol: '$', is_active: true, is_base: true }];

const json = (route, body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

const mockSupabase = async (page, served) => {
  await page.route(`${IMG_HOST}/**`, (route) => {
    const name = route.request().url().split('/').pop();
    const i = Number(name.match(/(\d+)/)?.[1] ?? 0) + (name.startsWith('combo') ? N_PRODUCTS : 0);
    const body = paddedSvg(weightOf(i), name);
    served.push({ name, bytes: body.length });
    return route.fulfill({ status: 200, contentType: 'image/svg+xml', body });
  });
  await page.route(/\/(rest|auth|functions|storage|realtime)\/v1\//, (route) => {
    const request = route.request();
    const url = request.url();
    const wantsObject = (request.headers().accept || '').includes('pgrst.object');
    if (url.includes('/auth/v1/')) return route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ message: 'not authenticated' }) });
    if (url.includes('/rest/v1/business_visual_settings')) return route.fulfill({ status: 406, contentType: 'application/json', body: JSON.stringify({ code: 'PGRST116', message: 'no rows', details: null, hint: null }) });
    if (url.includes('/rest/v1/products')) return json(route, PRODUCTS);
    if (url.includes('/rest/v1/combo_products')) return json(route, COMBOS);
    if (url.includes('/rest/v1/combo_items')) return json(route, []);
    if (url.includes('/rest/v1/inventory')) return json(route, INVENTORY);
    if (url.includes('/rest/v1/product_categories')) return json(route, CATEGORIES);
    if (url.includes('/rest/v1/currencies')) return json(route, CURRENCIES);
    return json(route, wantsObject ? {} : []);
  });
};

for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
  test.describe(`${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport });

    test('catalog downloads only the images near the viewport on first load (lazy), and the rest on scroll', async ({ page }) => {
      const served = [];
      await mockSupabase(page, served);
      await page.addInitScript(() => localStorage.setItem('preferredLanguage', 'es'));
      await page.goto('/products');

      const productImages = page.locator('img[src*="cdn.example.test/product-"]');
      await expect(productImages).toHaveCount(N_PRODUCTS, { timeout: 30000 });
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(1000);

      const total = N_PRODUCTS + N_COMBOS;
      const firstLoad = served.length;
      const firstBytes = served.reduce((sum, s) => sum + s.bytes, 0);
      const allBytes = Array.from({ length: total }, (_, i) => paddedSvg(weightOf(i), '').length).reduce((a, b) => a + b, 0);
      test.info().annotations.push({
        type: 'egress',
        description: `${viewport.width}px first load: ${firstLoad}/${total} images, ${(firstBytes / 1048576).toFixed(2)} MB of ${(allBytes / 1048576).toFixed(2)} MB`
      });

      // Every catalog image is lazy + async-decoded and reserves its box (aspect-square parent) to avoid CLS.
      const attrs = await productImages.evaluateAll((imgs) => imgs.map((img) => ({ loading: img.getAttribute('loading'), decoding: img.getAttribute('decoding') })));
      expect(attrs.every((a) => a.loading === 'lazy' && a.decoding === 'async')).toBe(true);

      // Chromium fetches lazy images ~1250-2500 px ahead of the viewport: far fewer than all of them.
      expect(firstLoad).toBeLessThan(total * 0.6);

      // Scrolling to the end fetches the rest (lazy, not missing).
      for (let y = 0; y < 30; y += 1) {
        await page.mouse.wheel(0, 1500);
        await page.waitForTimeout(100);
      }
      await expect.poll(() => new Set(served.map((s) => s.name)).size, { timeout: 15000 }).toBeGreaterThanOrEqual(N_PRODUCTS);
    });
  });
}
