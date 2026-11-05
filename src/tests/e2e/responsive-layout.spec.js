import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

// RB-04 responsive fixes: cart with items, product/combo detail, dashboard (tabs, stat cards, refresh button,
// activity-log filters) and Settings tab names. Supabase is fully mocked with page.route: no network, no real data.
// Every case measures the layout (scrollWidth vs clientWidth), it never inspects class names.
// Set RESPONSIVE_SHOTS_DIR to also save screenshots (evidence only, never a gate).

const SHOTS_DIR = process.env.RESPONSIVE_SHOTS_DIR;

const USD = 'f6edae3d-cb67-4d43-a8a1-f23f0c83fdfb';
const CUP = 'a5f61ff8-2a74-4442-82c0-8fdb14a423e6';
const USER_ID = '00000000-0000-4000-8000-000000000001';
const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');

const session = () => {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const user = { id: USER_ID, aud: 'authenticated', role: 'authenticated', email: 'qa-user@example.test', app_metadata: {}, user_metadata: {} };
  return { access_token: `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: user.id, exp, role: 'authenticated' })}.sig`, token_type: 'bearer', expires_in: 3600, expires_at: exp, refresh_token: 'refresh', user };
};

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="100%" height="100%" fill="#d9dde3"/></svg>';

const product = (n, name) => ({
  id: `00000000-0000-4000-8000-00000000010${n}`, sku: `SKU-${n}`, name_es: name, name_en: `${name} (EN)`, description_es: '', description_en: '',
  category_id: null, base_currency_id: USD, final_price: 7.02 * n, unit: 'unit', image_url: 'https://img.example.test/p.jpg',
  is_active: true, is_featured: false, created_at: '2026-10-22T12:22:28Z', updated_at: '2026-10-22T12:22:28Z', category: null,
});
const PRODUCTS = [
  product(1, 'Paquete familiar extra grande con aceite, arroz, frijoles y pollo'),
  product(2, 'Mortadella boloñesa en mitades'),
  product(3, 'Aceite de girasol refinado de un litro'),
];
const COMBO = {
  id: '00000000-0000-4000-8000-0000000002a1', name_es: 'COMBO SUPER ECONOMICO PARA TODA LA FAMILIA', name_en: 'SUPER SAVER COMBO FOR THE WHOLE FAMILY',
  description_es: '', description_en: '', image_url: 'https://img.example.test/c.jpg', final_price: 39.77, shipping_free: false,
  shipping_discount_percent: 0, out_of_province_shipping: true, out_of_province_price: null, is_active: true, is_featured: false,
  created_at: '2026-11-04T14:14:54Z', updated_at: '2026-11-04T14:14:54Z',
};
const COMBO_ITEMS = PRODUCTS.slice(0, 2).map((p, i) => ({ combo_id: COMBO.id, quantity: i + 1, products: p }));
const CURRENCIES = [
  { id: CUP, code: 'CUP', name_es: 'Peso Cubano', name_en: 'Cuban Peso', symbol: '$', is_base: false, is_active: true },
  { id: USD, code: 'USD', name_es: 'Dólar Estadounidense', name_en: 'US Dollar', symbol: '$', is_base: true, is_active: true },
];
const TABLES = {
  products: PRODUCTS,
  combo_products: [COMBO],
  combo_items: COMBO_ITEMS,
  currencies: CURRENCIES,
  exchange_rates: [
    { from_currency_id: CUP, to_currency_id: USD, rate: 0.0011, is_active: true },
    { from_currency_id: USD, to_currency_id: CUP, rate: 900, is_active: true },
  ],
};

const cartItems = () => PRODUCTS.map((p, i) => ({ ...p, quantity: i + 1 }));

const json = (route, body, headers = {}) => route.fulfill({ status: 200, contentType: 'application/json', headers, body: JSON.stringify(body) });

const mockSupabase = async (page, { role }) => {
  await page.route(/\/(rest|auth|functions|storage|realtime)\//, async (route) => {
    const request = route.request();
    const url = request.url();
    const wantsObject = (request.headers().accept || '').includes('pgrst.object');
    if (/\/auth\/v1\//.test(url)) {
      if (role && url.includes('/auth/v1/user')) return json(route, session().user);
      return route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ message: 'not authenticated' }) });
    }
    if (/\/(realtime|functions)\//.test(url)) return json(route, {});
    if (url.includes('/rest/v1/rpc/')) return json(route, wantsObject ? {} : []);
    const table = new URL(url).pathname.replace('/rest/v1/', '');
    let data = TABLES[table] || [];
    if (table === 'user_profiles') data = role ? [{ id: USER_ID, user_id: USER_ID, role, is_enabled: true, avatar_url: null, full_name: 'QA User', email: 'qa-user@example.test' }] : [];
    if (request.method() === 'HEAD') return route.fulfill({ status: 200, headers: { 'content-range': `0-0/${data.length}` }, body: '' });
    if (request.method() !== 'GET') return route.fulfill({ status: 201, contentType: 'application/json', body: '[]' });
    if (wantsObject) return data.length ? json(route, data[0]) : route.fulfill({ status: 406, contentType: 'application/json', body: JSON.stringify({ code: 'PGRST116', message: 'no rows' }) });
    return json(route, data, { 'content-range': `0-${Math.max(0, data.length - 1)}/${data.length}` });
  });
  // images are never fetched from the network
  await page.route(/img\.example\.test/, (route) => route.fulfill({ status: 200, contentType: 'image/svg+xml', body: SVG }));
};

const open = async (page, route, { language = 'es', role = null, cart = false } = {}) => {
  await mockSupabase(page, { role });
  await page.addInitScript(({ lang, sess, items }) => {
    localStorage.setItem('preferredLanguage', lang);
    if (sess) localStorage.setItem('papuenvios-auth', JSON.stringify(sess));
    if (items) localStorage.setItem('cart', JSON.stringify(items));
  }, { lang: language, sess: role ? session() : null, items: cart ? cartItems() : null });
  await page.goto(route);
  await expect(page.locator('header')).toBeVisible();
  await page.waitForFunction(() => document.querySelector('header')?.style.transform === 'none');
};

const pageOverflow = (page) => page.evaluate(() => ({
  doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  body: document.body.scrollWidth - document.documentElement.clientWidth,
}));

const expectNoPageOverflow = async (page) => {
  await page.waitForTimeout(600); // framer-motion entrances settle
  const o = await pageOverflow(page);
  expect(Math.max(o.doc, o.body), `page overflows horizontally (document ${o.doc}px, body ${o.body}px)`).toBeLessThanOrEqual(0);
};

const shot = async (page, name) => {
  if (!SHOTS_DIR) return;
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(SHOTS_DIR, name), fullPage: true });
};

const WIDTHS = [320, 375, 414];
const LANGS = ['es', 'en'];

for (const width of WIDTHS) {
  for (const language of LANGS) {
    test.describe(`cart with items ${width}px ${language}`, () => {
      test.use({ viewport: { width, height: 800 } });

      test('does not overflow and keeps summary and checkout reachable', async ({ page }) => {
        await open(page, '/cart', { language, cart: true });
        await expect(page.getByRole('heading', { level: 3 }).first()).toBeVisible();
        await expectNoPageOverflow(page);
        const checkout = page.getByRole('button', { name: language === 'es' ? 'Proceder al Pago' : /Proceed to (Payment|Checkout)|Checkout/ });
        await expect(checkout).toBeVisible();
        const box = await checkout.boundingBox();
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(width + 0.5);
        await shot(page, `cart-${width}-${language}.png`);
      });

      test('quantity and remove controls have a name and a 44px touch target', async ({ page }) => {
        await open(page, '/cart', { language, cart: true });
        const rows = page.locator('.glass-effect', { has: page.locator('h3') });
        await expect(rows).toHaveCount(3);
        const first = rows.first();
        const buttons = first.getByRole('button');
        await expect(buttons).toHaveCount(3);
        for (let i = 0; i < 3; i += 1) {
          const button = buttons.nth(i);
          const name = (await button.getAttribute('aria-label')) || '';
          expect(name.trim().length, `control ${i} has an accessible name`).toBeGreaterThan(0);
          const box = await button.boundingBox();
          expect(Math.min(box.width, box.height), `control ${i} touch target`).toBeGreaterThanOrEqual(44);
          expect(box.x + box.width).toBeLessThanOrEqual(width + 0.5);
        }
      });
    });

    test.describe(`product and combo detail ${width}px ${language}`, () => {
      test.use({ viewport: { width, height: 800 } });

      test('product detail does not overflow', async ({ page }) => {
        await open(page, `/product/${PRODUCTS[0].id}`, { language });
        await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
        await expectNoPageOverflow(page);
        const nav = page.getByRole('button', { name: language === 'es' ? /Siguiente/ : /Next/ });
        const box = await nav.boundingBox();
        expect(box.x + box.width).toBeLessThanOrEqual(width + 0.5);
        await shot(page, `product-${width}-${language}.png`);
      });

      test('combo detail does not overflow', async ({ page }) => {
        await open(page, `/combo/${COMBO.id}`, { language });
        await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
        await expectNoPageOverflow(page);
        await shot(page, `combo-${width}-${language}.png`);
      });
    });
  }
}

// Wide viewports keep working (the fixes must not change them).
for (const width of [768, 1280]) {
  test.describe(`cart and detail pages ${width}px`, () => {
    test.use({ viewport: { width, height: 900 } });

    test('cart with items stays inside the viewport', async ({ page }) => {
      await open(page, '/cart', { cart: true });
      await expect(page.getByRole('heading', { level: 3 }).first()).toBeVisible();
      await expectNoPageOverflow(page);
      await shot(page, `cart-${width}-es.png`);
    });

    test('product detail stays inside the viewport', async ({ page }) => {
      await open(page, `/product/${PRODUCTS[0].id}`);
      await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
      await expectNoPageOverflow(page);
      await shot(page, `product-${width}-es.png`);
    });
  });
}

// ── Dashboard ────────────────────────────────────────────────────────────────
const STAT_LABELS = {
  es: ['Total de Productos', 'Total de Combos', 'Tipos de Remesas', 'Remesas Pendientes', 'Pedidos Pendientes', 'Total de Usuarios'],
  en: ['Total Products', 'Total Combos', 'Remittance Types', 'Pending Remittances', 'Pending Orders', 'Total Users'],
};
const REFRESH = { es: 'Actualizar', en: 'Refresh' };

for (const language of LANGS) {
  for (const width of [320, 375]) {
    test.describe(`dashboard overview ${width}px ${language}`, () => {
      test.use({ viewport: { width, height: 800 } });

      test('fits, shows the whole stat labels and an in-viewport refresh button', async ({ page }) => {
        await open(page, '/dashboard', { language, role: 'super_admin' });
        const refresh = page.getByRole('button', { name: REFRESH[language] });
        await expect(refresh).toBeVisible({ timeout: 20000 });
        await expectNoPageOverflow(page);
        const rbox = await refresh.boundingBox();
        expect(rbox.x).toBeGreaterThanOrEqual(0);
        expect(rbox.x + rbox.width).toBeLessThanOrEqual(width + 0.5);
        for (const label of STAT_LABELS[language]) {
          const el = page.locator('p', { hasText: new RegExp(`^${label}$`) }).first();
          await expect(el, label).toBeVisible();
          const m = await el.evaluate((node) => ({
            clipped: node.scrollWidth > node.clientWidth + 1,
            ellipsis: getComputedStyle(node).textOverflow === 'ellipsis' && getComputedStyle(node).overflow !== 'visible',
            right: node.getBoundingClientRect().right,
          }));
          expect(m, `stat label "${label}"`).toMatchObject({ clipped: false, ellipsis: false });
          expect(m.right).toBeLessThanOrEqual(width + 0.5);
        }
        await shot(page, `dashboard-${width}-${language}.png`);
      });
    });
  }

  test.describe(`dashboard tab strip 768px ${language}`, () => {
    test.use({ viewport: { width: 768, height: 900 } });

    test('the 7 super_admin tabs stay inside the viewport', async ({ page }) => {
      await open(page, '/dashboard', { language, role: 'super_admin' });
      await expect(page.getByRole('button', { name: REFRESH[language] })).toBeVisible({ timeout: 20000 });
      const tabs = page.locator('div.md\\:flex.border-b > button');
      await expect(tabs).toHaveCount(7);
      await expectNoPageOverflow(page);
      for (let i = 0; i < 7; i += 1) {
        const box = await tabs.nth(i).boundingBox();
        expect(box.x, `tab ${i} left`).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width, `tab ${i} right`).toBeLessThanOrEqual(768 + 0.5);
      }
      await shot(page, `dashboard-tabs-768-${language}.png`);
    });
  });

  test.describe(`activity log filters 320px ${language}`, () => {
    test.use({ viewport: { width: 320, height: 800 } });

    test('the filter row fits and the controls have a name', async ({ page }) => {
      await open(page, '/dashboard', { language, role: 'super_admin' });
      await expect(page.getByRole('button', { name: REFRESH[language] })).toBeVisible({ timeout: 20000 });
      await page.locator('div.md\\:hidden > button').first().click();
      await page.locator('div.md\\:hidden div.absolute > button').nth(5).click();
      const search = page.getByRole('textbox').first();
      await expect(search).toBeVisible({ timeout: 20000 });
      await expectNoPageOverflow(page);
      const selects = page.getByRole('combobox');
      const count = await selects.count();
      expect(count).toBeGreaterThanOrEqual(2);
      for (let i = 0; i < count; i += 1) {
        const select = selects.nth(i);
        const box = await select.boundingBox();
        expect(box.x + box.width, `select ${i} right edge`).toBeLessThanOrEqual(320.5);
        const name = (await select.getAttribute('aria-label')) || '';
        expect(name.trim().length, `select ${i} accessible name`).toBeGreaterThan(0);
      }
      expect(((await search.getAttribute('aria-label')) || '').trim().length).toBeGreaterThan(0);
      await shot(page, `activity-log-320-${language}.png`);
    });
  });
}

// ── Settings tabs ────────────────────────────────────────────────────────────
for (const language of LANGS) {
  test.describe(`settings tabs 320px ${language}`, () => {
    test.use({ viewport: { width: 320, height: 800 } });

    test('every icon-only tab exposes its name', async ({ page }) => {
      await open(page, '/settings', { language, role: 'super_admin' });
      const strip = page.locator('div.overflow-x-auto').first();
      await expect(strip).toBeVisible({ timeout: 20000 });
      const tabs = strip.getByRole('button');
      expect(await tabs.count()).toBeGreaterThanOrEqual(6);
      const names = await tabs.evaluateAll((buttons) => buttons.map((b) => (b.getAttribute('aria-label') || b.innerText || '').trim()));
      names.forEach((name, i) => expect(name.length, `tab ${i} name`).toBeGreaterThan(1));
      await expectNoPageOverflow(page);
      await shot(page, `settings-320-${language}.png`);
    });
  });
}
