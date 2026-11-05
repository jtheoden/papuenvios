import { test, expect } from '@playwright/test';

// Startup: the static splash is in the served HTML, and the app shows up as soon as auth + visual settings are
// ready (no fixed 2.5 s wait). Supabase is fully mocked with page.route: no network, no real data.

test.describe.configure({ timeout: 90000 }); // the dev server compiles on demand: first loads are slow

const json = (route, body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

const mockSupabase = (page) => page.route(/\/(rest|auth|functions|storage)\/v1\//, (route) => {
  const request = route.request();
  const url = request.url();
  const wantsObject = (request.headers().accept || '').includes('pgrst.object');
  if (url.includes('/auth/v1/')) return route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ message: 'not authenticated' }) });
  if (url.includes('/rest/v1/business_visual_settings')) return json(route, wantsObject ? { settings: { useGradient: true } } : [{ settings: { useGradient: true } }]);
  return json(route, wantsObject ? {} : []);
});

test('served HTML already paints the static splash inside #root', async ({ request }) => {
  const html = await (await request.get('/')).text();
  expect(html).toMatch(/<div id="root"><div id="ps" role="status">/);
});

test('the app appears without a fixed 2.5 s wait once settings are loaded', async ({ page }) => {
  await mockSupabase(page);
  await page.goto('/'); // warm-up: lets the dev server compile the modules
  await expect(page.locator('header')).toBeVisible({ timeout: 60000 });

  await page.evaluate(() => localStorage.clear()); // the settings cache would skip the request
  const settings = page.waitForResponse((r) => r.url().includes('/rest/v1/business_visual_settings'));
  await page.reload();
  await settings;
  const settingsAt = Date.now();
  await expect(page.locator('header')).toBeVisible({ timeout: 10000 });
  // Old behaviour: header only after a 2.5 s timer from mount. Now: settings ready -> header (plus fades).
  expect(Date.now() - settingsAt).toBeLessThan(1500);
});
