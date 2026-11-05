import { test, expect } from '@playwright/test';

// Settings > Couriers > a courier's "Subscribed payment types" (phase B): subscribe, gap refusal + explicit confirmation,
// unsubscribe. Supabase is fully mocked with page.route: no network, no real data. Run with:
//   THEME_E2E_MATCH='courier-subscriptions\.spec\.js' npx playwright test -c playwright.theme.config.js

const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
const adminSession = () => {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const user = { id: '00000000-0000-4000-8000-000000000001', aud: 'authenticated', role: 'authenticated', email: 'qa-admin@example.test', app_metadata: {}, user_metadata: {} };
  return { access_token: `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: user.id, exp, role: 'authenticated' })}.sig`, token_type: 'bearer', expires_in: 3600, expires_at: exp, refresh_token: 'refresh', user };
};
const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

const COURIER = { id: 'c0000000-0000-4000-8000-000000000001', name: 'Ana QA', phone: null, notes: null, is_active: true, created_at: '2026-10-01T00:00:00Z' };
// test values only: a general tramo "up to 100" (leaves "more than 100" open for this courier)
const TYPES = [{ id: 'id-low', code: 'low', version: 1, name: 'Tramo bajo', is_active: true, valid_from: '2026-10-01T00:00:00Z', valid_to: null,
  applies_to: 'remittance', method: 'fixed_amount', fixed_amount: 5, fixed_cup: null, cup_per_usd: null, percent: null, base: null,
  currency: 'USD', courier_id: null, shipping_zone_id: null, remittance_type_id: null, amount_from: null, amount_to: 100, created_at: '2026-10-01T00:00:00Z' }];

const mockSupabase = async (page, state) => {
  await page.route(/\/(rest|auth|functions|storage)\/v1\//, async (route) => {
    const request = route.request();
    const url = request.url();
    const wantsObject = (request.headers().accept || '').includes('pgrst.object');
    if (url.includes('/auth/v1/user')) return json(route, adminSession().user);
    if (url.includes('/auth/v1/')) return json(route, { message: 'not authenticated' }, 401);
    if (url.includes('/rest/v1/user_profiles')) {
      return json(route, { role: 'admin', is_enabled: true, avatar_url: null, full_name: 'QA Admin', email: 'qa-admin@example.test' });
    }
    if (url.includes('/rest/v1/couriers')) return json(route, [COURIER]);
    if (url.includes('/rest/v1/messenger_payment_types')) return json(route, TYPES);
    if (url.includes('/rest/v1/courier_payment_type_subscriptions')) return json(route, state.subs);
    if (url.includes('/rpc/admin_subscribe_courier_payment_type')) {
      const body = JSON.parse(request.postData() || '{}');
      state.calls.push(['subscribe', body]);
      if (!body.p_accept_gaps) {
        return json(route, { code: '22023', message: 'coverage_gap: the ranges of this courier leave values without a rule; confirm to subscribe anyway',
          details: JSON.stringify({ currency: 'USD', gaps: [{ kind: 'remittance', from: 100, to: null }] }), hint: null }, 400);
      }
      state.subs = [{ id: 's1', courier_id: COURIER.id, payment_type_code: body.p_code, created_at: '2026-11-05T00:00:00Z' }];
      return json(route, 's1');
    }
    if (url.includes('/rpc/admin_unsubscribe_courier_payment_type')) {
      state.calls.push(['unsubscribe', JSON.parse(request.postData() || '{}')]);
      state.subs = [];
      return json(route, 1);
    }
    if (url.includes('/rpc/get_pending_orders_count')) return json(route, 0);
    if (request.method() === 'HEAD') return route.fulfill({ status: 200, headers: { 'content-range': '0-0/0' }, body: '' });
    return json(route, wantsObject ? {} : []);
  });
};

test.describe('courier subscriptions', () => {
  test.use({ viewport: { width: 390, height: 900 } }); // phone width: the section must fit without horizontal scroll

  test('subscribe -> gap refusal -> explicit confirmation resends with p_accept_gaps -> unsubscribe', async ({ page }) => {
    const state = { subs: [], calls: [] };
    await mockSupabase(page, state);
    await page.addInitScript((session) => {
      localStorage.setItem('preferredLanguage', 'es');
      localStorage.setItem('papuenvios-auth', JSON.stringify(session));
    }, adminSession());
    await page.goto('/settings');
    await page.getByRole('button', { name: 'Mensajería' }).click();

    const section = page.getByRole('region', { name: 'Tipos de pago suscritos Ana QA' });
    await expect(section).toBeVisible();
    await expect(section.getByText('Este mensajero no tiene tipos de pago suscritos.')).toBeVisible();

    await section.getByLabel('Tipo de pago', { exact: true }).selectOption('low');
    await section.getByRole('button', { name: 'Suscribir', exact: true }).click();
    const warning = section.getByTestId('subscription-gap-warning');
    await expect(warning).toBeVisible();
    await expect(warning).toContainText('más de 100.00 USD');
    await expect.poll(() => state.calls.length).toBe(1);
    expect(state.calls[0][1]).toEqual({ p_courier_id: COURIER.id, p_code: 'low', p_accept_gaps: false });

    await section.getByRole('checkbox', { name: 'Entiendo que esos valores quedarán sin regla y deseo suscribir igualmente.' }).check();
    await section.getByRole('button', { name: 'Suscribir', exact: true }).click();
    await expect(section.getByText('Tipo de pago suscrito.')).toBeVisible();
    expect(state.calls[1][1]).toEqual({ p_courier_id: COURIER.id, p_code: 'low', p_accept_gaps: true });
    await expect(section.getByTestId('subscription-row')).toContainText('Tramo bajo');

    await section.getByRole('button', { name: 'Quitar Tramo bajo' }).click();
    await expect(section.getByText('Suscripción quitada. Las entregas ya realizadas no cambian.')).toBeVisible();
    expect(state.calls[2]).toEqual(['unsubscribe', { p_courier_id: COURIER.id, p_code: 'low' }]);
    await expect(section.getByTestId('subscription-row')).toHaveCount(0);

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
