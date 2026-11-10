import { test, expect } from '@playwright/test';

// Settings > Couriers > Payment types: range operator, gap warning and explicit confirmation (phase A).
// Supabase is fully mocked with page.route: no network, no real data. Run with:
//   THEME_E2E_MATCH='courier-payment-type-ranges\.spec\.js' npx playwright test -c playwright.theme.config.js

const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
const adminSession = () => {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const user = { id: '00000000-0000-4000-8000-000000000001', aud: 'authenticated', role: 'authenticated', email: 'qa-admin@example.test', app_metadata: {}, user_metadata: {} };
  return { access_token: `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: user.id, exp, role: 'authenticated' })}.sig`, token_type: 'bearer', expires_in: 3600, expires_at: exp, refresh_token: 'refresh', user };
};
const json = (route, body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

// Current ladder in USD: R1 "up to 100", R3 "more than 200" (test values, nothing from production).
const rule = (o) => ({ id: `id-${o.code}`, version: 1, name: o.code, is_active: true, valid_from: '2026-10-01T00:00:00Z', valid_to: null,
  applies_to: 'remittance', method: 'fixed_amount', fixed_amount: 5, fixed_cup: null, cup_per_usd: null, percent: null, base: null,
  currency: 'USD', courier_id: null, shipping_zone_id: null, remittance_type_id: null, amount_from: null, amount_to: null,
  created_at: '2026-10-01T00:00:00Z', ...o });
const LADDER = [rule({ code: 'R1', amount_to: 100 }), rule({ code: 'R3', amount_from: 200 })];

const mockSupabase = async (page, calls) => {
  await page.route(/\/(rest|auth|functions|storage)\/v1\//, async (route) => {
    const request = route.request();
    const url = request.url();
    const wantsObject = (request.headers().accept || '').includes('pgrst.object');
    if (url.includes('/auth/v1/user')) return json(route, adminSession().user);
    if (url.includes('/auth/v1/')) return route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ message: 'not authenticated' }) });
    if (url.includes('/rest/v1/user_profiles')) {
      return json(route, { role: 'admin', is_enabled: true, avatar_url: null, full_name: 'QA Admin', email: 'qa-admin@example.test' });
    }
    if (url.includes('/rest/v1/messenger_payment_types')) return json(route, LADDER);
    if (url.includes('/rest/v1/courier_margin_settings')) return json(route, [{ kind: 'remittance', target_pct: null, warning_pct: null, critical_pct: null }]);
    if (url.includes('/rpc/admin_set_messenger_payment_type_v2')) {
      calls.push(JSON.parse(request.postData() || '{}'));
      return json(route, 'new-id');
    }
    if (url.includes('/rpc/get_pending_orders_count')) return json(route, 0);
    if (request.method() === 'HEAD') return route.fulfill({ status: 200, headers: { 'content-range': '0-0/0' }, body: '' });
    return json(route, wantsObject ? {} : []);
  });
};

test.describe('payment type ranges', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('operator + gap warning: saving needs the explicit confirmation and sends p_accept_gaps', async ({ page }) => {
    const calls = [];
    await mockSupabase(page, calls);
    await page.addInitScript((session) => {
      localStorage.setItem('preferredLanguage', 'es');
      localStorage.setItem('papuenvios-auth', JSON.stringify(session));
    }, adminSession());
    await page.goto('/settings');
    await page.getByRole('button', { name: 'Mensajería' }).click();
    await page.getByRole('tab', { name: 'Tipos de pago' }).click();
    await page.getByRole('button', { name: 'Agregar tipo de pago' }).click();
    const form = page.getByRole('form', { name: 'Tipo de pago' });
    await expect(form).toBeVisible();

    await form.getByLabel('Código', { exact: true }).fill('R2');
    await form.getByLabel('Nombre', { exact: true }).fill('Tramo medio');
    await form.getByLabel('Monto fijo', { exact: true }).fill('5');
    await expect(form.getByText(/Los rangos se comparan en USD con 2 decimales/)).toBeVisible();
    await form.getByLabel('Valor de la operación', { exact: true }).selectOption('between');
    await form.getByLabel('X (no incluido)', { exact: true }).fill('100.01');
    await form.getByLabel('Y (incluido)', { exact: true }).fill('200');

    const warning = form.getByTestId('range-gap-warning');
    await expect(warning).toBeVisible();
    await expect(warning).toContainText('más de 100.00 y hasta 100.01 USD');

    await form.getByRole('button', { name: 'Guardar', exact: true }).click();
    await expect(form.getByText('Confirme que acepta los huecos antes de guardar.')).toBeVisible();
    expect(calls).toHaveLength(0);

    await form.getByRole('checkbox', { name: 'Entiendo que quedan huecos y quiero guardar igualmente' }).check();
    await form.getByRole('button', { name: 'Guardar', exact: true }).click();
    await expect.poll(() => calls.length).toBe(1);
    expect(calls[0]).toMatchObject({ p_code: 'R2', p_method: 'fixed_amount', p_fixed_amount: 5, p_currency: 'USD', p_amount_from: 100.01, p_amount_to: 200, p_accept_gaps: true });
  });

  test('the reference ladder (more than 100 and up to 200) closes the gaps: no warning, no confirmation', async ({ page }) => {
    const calls = [];
    await mockSupabase(page, calls);
    await page.addInitScript((session) => {
      localStorage.setItem('preferredLanguage', 'es');
      localStorage.setItem('papuenvios-auth', JSON.stringify(session));
    }, adminSession());
    await page.goto('/settings');
    await page.getByRole('button', { name: 'Mensajería' }).click();
    await page.getByRole('tab', { name: 'Tipos de pago' }).click();
    await page.getByRole('button', { name: 'Agregar tipo de pago' }).click();
    const form = page.getByRole('form', { name: 'Tipo de pago' });
    await form.getByLabel('Código', { exact: true }).fill('R2');
    await form.getByLabel('Nombre', { exact: true }).fill('Tramo medio');
    await form.getByLabel('Monto fijo', { exact: true }).fill('5');
    await form.getByLabel('Valor de la operación', { exact: true }).selectOption('between');
    await form.getByLabel('X (no incluido)', { exact: true }).fill('100');
    await form.getByLabel('Y (incluido)', { exact: true }).fill('200');
    await expect(form.getByTestId('range-gap-warning')).toHaveCount(0);
    await form.getByRole('button', { name: 'Guardar', exact: true }).click();
    await expect.poll(() => calls.length).toBe(1);
    expect(calls[0]).toMatchObject({ p_amount_from: 100, p_amount_to: 200, p_accept_gaps: false });
  });
});
