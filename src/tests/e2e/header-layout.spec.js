import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

// Header layout fixes (backlog batch 1): mobile pills fit, themed user menu, admin menu keyboard behaviour,
// and the Zelle alert sitting under the header. Supabase is fully mocked with page.route: no network, no real data.
// Set HEADER_SHOTS_DIR to also save screenshots (evidence only, never a gate).

const SHOTS_DIR = process.env.HEADER_SHOTS_DIR;

// Row stored in production today (the app merges it over its code defaults).
const PROD_ROW = {
  useGradient: true,
  logo: '',
  primaryColor: '#3499dc',
  secondaryColor: '#9333ea',
  headerGradientColor: '#9333ea',
  gradientDirection: '320',
  navBarActiveBgColor: '#2563eb',
  navBarActiveTextColor: '#ffffff',
  headerMenuActiveBgColor: '#eff6ff',
  headerMenuActiveColor: '#2563eb',
  buttonBgColor: '#2563eb',
  buttonTextColor: '#ffffff',
  buttonHoverBgColor: '#1d4ed8',
  headerBgColor: '#ffffff',
  headerTextColor: '#1f2937',
};

const USER_ID = '00000000-0000-4000-8000-000000000001';
const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');

const session = () => {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const user = { id: USER_ID, aud: 'authenticated', role: 'authenticated', email: 'qa-user@example.test', app_metadata: {}, user_metadata: {} };
  return { access_token: `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: user.id, exp, role: 'authenticated' })}.sig`, token_type: 'bearer', expires_in: 3600, expires_at: exp, refresh_token: 'refresh', user };
};

const ZELLE_ALERT = {
  id: 'alert-1',
  user_id: USER_ID,
  alert_type: 'zelle_account_deactivated',
  message: 'Your Zelle account was deactivated.',
  is_dismissed: false,
  is_read: false,
  created_at: '2026-01-01T00:00:00Z',
  metadata: { operationType: 'order', operationId: 'o1', amount: 25 },
};

const json = (route, body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

const mockSupabase = async (page, { settings, role, alerts = [] }) => {
  await page.route(/\/(rest|auth|functions|storage)\/v1\//, async (route) => {
    const request = route.request();
    const url = request.url();
    const wantsObject = (request.headers().accept || '').includes('pgrst.object');
    if (url.includes('/rest/v1/business_visual_settings')) return json(route, wantsObject ? { settings } : [{ settings }]);
    if (role && url.includes('/auth/v1/user')) return json(route, session().user);
    if (url.includes('/auth/v1/')) return route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ message: 'not authenticated' }) });
    if (role && url.includes('/rest/v1/user_profiles')) return json(route, { role, is_enabled: true, avatar_url: null, full_name: 'QA User', email: 'qa-user@example.test' });
    if (url.includes('/rest/v1/user_alerts')) return json(route, alerts);
    if (role === 'admin' && url.includes('/rpc/get_pending_orders_count')) return json(route, 0);
    if (role === 'admin' && url.includes('/rpc/admin_refund_counts')) return json(route, { actionable: 0, on_hold: 0, due_soon: 0, overdue: 0, pending_amount_usd: 0 });
    if (url.includes('/rest/v1/remittances') && request.method() === 'HEAD') return route.fulfill({ status: 200, headers: { 'content-range': '0-0/0' }, body: '' });
    return json(route, wantsObject ? {} : []);
  });
};

const open = async (page, { settings = PROD_ROW, language = 'es', role = null, alerts = [] } = {}) => {
  await mockSupabase(page, { settings, role, alerts });
  await page.addInitScript(({ lang, sess }) => {
    localStorage.setItem('preferredLanguage', lang);
    if (sess) localStorage.setItem('papuenvios-auth', JSON.stringify(sess));
  }, { lang: language, sess: role ? session() : null });
  const settingsLoaded = page.waitForResponse((r) => r.url().includes('/rest/v1/business_visual_settings'));
  await page.goto('/');
  await settingsLoaded;
  await expect(page.locator('header')).toBeVisible();
  // the header slides in with framer-motion; wait until it rests so geometry and screenshots are final
  await page.waitForFunction(() => document.querySelector('header')?.style.transform === 'none');
};

const shot = async (page, name) => {
  if (!SHOTS_DIR) return;
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(SHOTS_DIR, name), clip: { x: 0, y: 0, width: page.viewportSize().width, height: 520 } });
};

for (const width of [320, 340, 359, 360, 375]) {
  for (const language of ['es', 'en']) {
    test.describe(`quick-nav pills ${width}px ${language}`, () => {
      test.use({ viewport: { width, height: 800 } });

      test('every label is fully visible and the row stays inside the viewport', async ({ page }) => {
        await open(page, { language });
        const pills = page.getByTestId('quick-nav').getByRole('button');
        await expect(pills).toHaveCount(3);
        const result = await page.evaluate(() => {
          const vw = document.documentElement.clientWidth;
          return [...document.querySelectorAll('[data-testid="quick-nav"] button')].map((pill) => {
            const label = pill.querySelector('span');
            const r = pill.getBoundingClientRect();
            return { text: label.textContent, truncated: label.scrollWidth > label.clientWidth, inside: r.left >= -0.5 && r.right <= vw + 0.5 };
          });
        });
        result.forEach((p) => {
          expect(p, `label "${p.text}"`).toMatchObject({ truncated: false, inside: true });
        });
        await shot(page, `pills-${width}-${language}.png`);
      });
    });
  }
}

for (const width of [320, 768, 1280]) {
  for (const language of ['es', 'en']) {
    test.describe(`user menu ${width}px ${language} (prod row)`, () => {
      test.use({ viewport: { width, height: 800 } });

      test('paints with the header menu colours and stays on screen', async ({ page }) => {
        await open(page, { language, role: 'user' });
        await page.locator('header button[aria-haspopup="true"]').click();
        const menu = page.getByRole('menu');
        await expect(menu).toBeVisible();
        await expect(menu).toHaveCSS('background-color', 'rgb(255, 255, 255)');
        await expect(menu).toHaveCSS('color', 'rgb(31, 41, 55)');
        await expect(menu.getByRole('menuitem').first()).toBeFocused();
        const box = await menu.boundingBox();
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(width);
        await shot(page, `usermenu-${width}-${language}.png`);
      });
    });
  }
}

test.describe('user menu follows a customised menu pair', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('headerMenuBgColor/headerMenuTextColor reach the dropdown', async ({ page }) => {
    await open(page, { settings: { ...PROD_ROW, headerMenuBgColor: '#101010', headerMenuTextColor: '#fafafa' }, role: 'user' });
    await page.locator('header button[aria-haspopup="true"]').click();
    const menu = page.getByRole('menu');
    await expect(menu).toHaveCSS('background-color', 'rgb(16, 16, 16)');
    await expect(menu).toHaveCSS('color', 'rgb(250, 250, 250)');
  });
});

for (const language of ['es', 'en']) {
  test.describe(`admin menu keyboard ${language}`, () => {
    test.use({ viewport: { width: 1280, height: 800 } });

    test('focus on open, arrows, Escape returns focus, outside click closes', async ({ page }) => {
      await open(page, { language, role: 'admin' });
      const trigger = page.locator('header nav button[aria-haspopup="true"]');
      await expect(trigger).toHaveAttribute('aria-expanded', 'false');
      await trigger.click();
      const menu = page.getByRole('menu');
      await expect(menu).toBeVisible();
      await expect(trigger).toHaveAttribute('aria-controls', (await menu.getAttribute('id')) ?? '');
      const items = menu.getByRole('menuitem');
      await expect(items.first()).toBeFocused();
      await page.keyboard.press('ArrowDown');
      await expect(items.nth(1)).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(menu).toHaveCount(0);
      await expect(trigger).toBeFocused();
      await trigger.click();
      await expect(menu).toBeVisible();
      await page.mouse.click(5, 600);
      await expect(menu).toHaveCount(0);
      await shot(page, `adminmenu-${language}.png`);
    });
  });
}

// The alert must clear the header (quick-nav row included) and never cover its dropdown.
for (const width of [320, 768, 1280]) {
  for (const language of ['es', 'en']) {
    test.describe(`zelle alert ${width}px ${language} (cart)`, () => {
      test.use({ viewport: { width, height: 800 } });

      test('sits below the header and under its user menu', async ({ page }) => {
        await open(page, { language, role: 'user', alerts: [ZELLE_ALERT] });
        await page.locator('header').getByRole('button', { name: /^(Carrito|Cart)$/ }).click();
        const alert = page.locator('div.fixed.z-30', { hasText: /Zelle|zelle/ }).first();
        await expect(alert).toBeVisible();
        await page.waitForTimeout(500); // entrance animation
        const header = await page.locator('header').boundingBox();
        const box = await alert.boundingBox();
        expect(box.y).toBeGreaterThanOrEqual(header.y + header.height);
        await shot(page, `zelle-cart-${width}-${language}.png`);

        // the user menu paints above the alert wherever they overlap
        await page.locator('header button[aria-haspopup="true"]').click();
        const menu = page.getByRole('menu');
        await expect(menu).toBeVisible();
        const menuBox = await menu.boundingBox();
        const probe = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('[role="menu"]') !== null, { x: menuBox.x + menuBox.width / 2, y: menuBox.y + menuBox.height - 4 });
        expect(probe).toBe(true);
        await shot(page, `zelle-cart-menu-${width}-${language}.png`);
      });
    });
  }
}
