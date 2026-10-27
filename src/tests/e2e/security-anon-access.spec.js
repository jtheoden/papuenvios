import { test, expect } from '@playwright/test';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './helpers/auth.js';

// ─── Hallazgo #1: /remittances/send sin protección de ruta ────────────────
// Verifica el comportamiento EXACTO al navegar directo, sin login.

test.describe('Anonymous access: /remittances/send', () => {
  test('allows anonymous users to view Step 1, but gates progression with a modal (not a route redirect)', async ({ page }) => {
    await page.goto('/remittances/send');

    // Step 1 must be reachable without login (per code: SendRemittancePage is
    // intentionally NOT wrapped in withProtectedRoute).
    await expect(
      page.getByText(/tipo y monto de remesa|remittance type and amount/i)
    ).toBeVisible({ timeout: 8000 });

    await page.screenshot({ path: 'test-results/anon-send-remittance-step1.png', fullPage: true });

    // Fill step 1 minimally and try to continue.
    const typeSelect = page.locator('select').first();
    await typeSelect.waitFor({ state: 'visible', timeout: 8000 });
    const optionCount = await typeSelect.locator('option').count();

    // The seed guarantees a remittance type: fail loudly if the data precondition is missing.
    expect(optionCount, 'seed precondition: at least one remittance type must exist').toBeGreaterThan(1);
    await typeSelect.selectOption({ index: 1 });

    const amountInput = page.locator('input[type="number"]').first();
    await expect(amountInput).toBeVisible({ timeout: 3000 });
    await amountInput.fill('50');

    await page.getByRole('button', { name: /continuar|continue/i }).first().click();

    // Per code (SendRemittancePage.jsx): an in-app modal is shown; it does NOT redirect.
    const loginModal = page.getByText(/necesitas iniciar sesión|need to log in|login required/i).first();
    await expect(loginModal, 'Expected an in-app login-required modal instead of a route-level redirect').toBeVisible({ timeout: 6000 });
    await page.screenshot({ path: 'test-results/anon-send-remittance-gate.png', fullPage: true });
  });
});

// ─── Hallazgo #4: tabla `offers` legible públicamente vía REST ────────────

// Contract (HomePage.jsx reads active offers with select('*') for anonymous visitors, so public reads are
// intentional): anon sees ONLY active offers inside their date window, only columns of the known schema
// (a new column must be reviewed before it becomes public), and can never write.
const OFFERS_PUBLIC_COLUMNS = new Set([
  'id', 'name_es', 'name_en', 'description_es', 'description_en', 'discount_type', 'discount_value',
  'min_purchase_amount', 'max_discount_amount', 'start_date', 'end_date', 'applies_to', 'free_shipping',
  'shipping_discount_percent', 'usage_limit', 'usage_count', 'user_usage_limit', 'is_active', 'created_at',
  'updated_at', 'code', 'max_usage_global', 'max_usage_per_user',
]);

test.describe('Anonymous access: Supabase REST API', () => {
  const anonHeaders = { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` };

  test('GET /rest/v1/offers as anon returns only active, in-window offers and known columns', async ({ request }) => {
    expect(SUPABASE_URL && SUPABASE_ANON_KEY, 'local Supabase env must be set').toBeTruthy();

    // APIRequestContext (no browser origin): no CORS involvement and no logged-in user's token.
    const res = await request.get(`${SUPABASE_URL}/rest/v1/offers?select=*`, { headers: anonHeaders });
    expect(res.status()).toBe(200);
    const rows = await res.json();
    expect(Array.isArray(rows)).toBe(true);

    const names = rows.map((r) => r.name_es);
    expect(names, 'seeded active offer must be visible').toContain('e2e-seed-offer-active');
    expect(names, 'inactive offers must stay hidden from anon').not.toContain('e2e-seed-offer-inactive');
    expect(names, 'expired offers must stay hidden from anon').not.toContain('e2e-seed-offer-expired');

    const now = Date.now();
    for (const row of rows) {
      expect(row.is_active, `offer ${row.id} must be active`).toBe(true);
      expect(Date.parse(row.start_date), `offer ${row.id} must have started`).toBeLessThanOrEqual(now);
      expect(Date.parse(row.end_date), `offer ${row.id} must not be expired`).toBeGreaterThanOrEqual(now);
      const unexpected = Object.keys(row).filter((k) => !OFFERS_PUBLIC_COLUMNS.has(k));
      expect(unexpected, `unreviewed columns exposed to anon on offers: ${unexpected.join(', ')}`).toEqual([]);
    }
  });

  test('anon cannot write offers', async ({ request }) => {
    const res = await request.post(`${SUPABASE_URL}/rest/v1/offers`, {
      headers: { ...anonHeaders, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      data: {
        name_es: 'e2e-anon-write', name_en: 'e2e-anon-write', discount_type: 'percentage', discount_value: 1,
        start_date: new Date().toISOString(), end_date: new Date(Date.now() + 86400000).toISOString(), applies_to: 'product',
      },
    });
    expect([401, 403], `anon INSERT must be rejected (got ${res.status()})`).toContain(res.status());
  });
});
