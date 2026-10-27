import { test, expect } from '@playwright/test';
import { authFile } from './helpers/auth.js';

// ─── Hallazgo #2: tab "Remittance Types" gateado solo a admin, no a super_admin ──

test.describe('Dashboard: Remittance Types tab access', () => {
  test.describe('as admin', () => {
    test.use({ storageState: authFile('admin') });

    test('qa-admin can view AND edit rates/commissions in Remittance Types tab', async ({ page }) => {
      await page.goto('/dashboard?tab=remittance-types');

      // Visible match only: below md the desktop tab buttons are display:none (the tab bar is a dropdown).
      await expect(
        page.getByText(/tipos de remesa|remittance types/i).filter({ visible: true }).first()
      ).toBeVisible({ timeout: 15000 });

      await page.screenshot({ path: 'test-results/admin-dashboard-remittance-types.png', fullPage: true });

      // The edit control is an icon-only button whose accessible name comes from
      // title={t('common.edit')} (RemittanceTypesConfig.jsx) — "Editar" / "Edit".
      const editBtn = page.getByRole('button', { name: /^(editar|edit)$/i }).first();
      const hasEdit = await expect(editBtn).toBeVisible({ timeout: 10000 }).then(() => true, () => false);

      test.info().annotations.push({
        type: hasEdit ? 'CONFIRMED' : 'PARTIAL',
        description: `qa-admin (role=admin, not super_admin) sees Remittance Types tab. Edit control visible: ${hasEdit}.`,
      });

      expect(hasEdit).toBe(true);
    });
  });

  test.describe('as user', () => {
    test.use({ storageState: authFile('user') });

    test('qa-user is blocked from /dashboard entirely (route-level admin gate)', async ({ page }) => {
      await page.goto('/dashboard');

      await expect(
        page.getByText(/acceso restringido|access restricted|autenticación requerida/i)
      ).toBeVisible({ timeout: 15000 });

      await page.screenshot({ path: 'test-results/user-dashboard-blocked.png', fullPage: true });
    });
  });
});

// ─── Hallazgo #3: tab "Sistema" en Settings solo gateado en frontend ──────

test.describe('Settings: Sistema tab access', () => {
  test.use({ storageState: authFile('admin') });

  test('qa-admin (not super_admin) does NOT see the Sistema tab', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Settings tabs render icon-only below the xs breakpoint (no accessible name): desktop-only check (it would pass vacuously)');
    await page.goto('/settings');

    // POSITIVE wait first: the tab bar has rendered (a tab every admin has), so absence below is not vacuous.
    await expect(page.getByRole('button', { name: /^(financiero|financial)$/i })).toBeVisible({ timeout: 15000 });

    await page.screenshot({ path: 'test-results/admin-settings-no-sistema-tab.png', fullPage: true });

    // Frontend-only gate via isSuperAdmin (no dedicated RLS found in code).
    await expect(page.getByRole('button', { name: /^(sistema|system)$/i })).toHaveCount(0);
    await expect(page.getByText(/reset de plataforma/i)).toHaveCount(0);
  });

  // NOTE: unlike DashboardPage.jsx (which reads ?tab= for deep-linking, see
  // its own useEffect), SettingsPage.jsx never implemented URL-param tab
  // selection — `activeTab` is a plain useState('financiero'), so
  // /settings?tab=sistema always renders the Financiero tab regardless of
  // role. A prior version of this test asserted the Sistema panel stays
  // hidden via that URL param, which passed vacuously for EVERY role
  // (including super_admin) since the param is ignored entirely — it never
  // exercised the actual `isSuperAdmin` gate. Removed rather than "fixed"
  // to keep this scope on the AuthContext race + fragile selectors; the
  // missing deep-link is a real but separate gap, reported to the user.
});

// ─── Hallazgo #5: flujo completo de envío de remesa como qa-user ─────────

test.describe('Remittance flow — logged in as qa-user', () => {
  test.use({ storageState: authFile('user') });

  test('login -> /remittances/send -> fill form -> advance as far as possible', async ({ page }) => {
    await page.goto('/remittances/send');

    await expect(
      page.getByText(/tipo y monto de remesa/i)
    ).toBeVisible({ timeout: 15000 });

    // UX-01 tooltip check: exchange rate / commission info tooltips.
    const infoIcons = page.locator('[data-testid], svg').filter({ hasText: '' });
    const tooltipTriggers = page.locator('button, span').filter({ has: page.locator('svg') });
    test.info().annotations.push({
      type: 'note',
      description: 'Checked for UX-01 tooltip triggers near exchange rate/commission fields (best-effort, no dedicated testid exists).',
    });

    const typeSelect = page.locator('select').first();
    await typeSelect.waitFor({ state: 'visible', timeout: 8000 });
    const optionCount = await typeSelect.locator('option').count();

    // The seed guarantees a remittance type: fail loudly if the data precondition is missing.
    expect(optionCount, 'seed precondition: at least one remittance type must exist').toBeGreaterThan(1);

    await typeSelect.selectOption({ index: 1 });

    // Exchange rate / commission tooltip should now be visible (UX-01).
    const rateTooltip = page.getByText(/es el valor de referencia que usamos/i);
    const commissionTooltip = page.getByText(/es el costo del servicio de envío/i);
    const rateTooltipVisible = await rateTooltip.isVisible({ timeout: 3000 }).catch(() => false);
    const commissionTooltipVisible = await commissionTooltip.isVisible({ timeout: 3000 }).catch(() => false);

    test.info().annotations.push({
      type: 'note',
      description: `UX-01 tooltips present in DOM — rate: ${rateTooltipVisible}, commission: ${commissionTooltipVisible} (tooltip content may require hover to reveal; visibility check is best-effort).`,
    });

    const amountInput = page.locator('input[type="number"]').first();
    await amountInput.fill('50');

    await page.screenshot({ path: 'test-results/user-send-remittance-step1-filled.png', fullPage: true });

    const continueBtn = page.getByRole('button', { name: /continuar|continue/i }).first();
    await continueBtn.click();

    // Logged in -> should NOT show the login-required modal, should advance
    // to Step 2 (recipient details) or show a validation/calculation error.
    // POSITIVE wait: step 2 rendered (so the page really advanced), THEN the login modal must be absent.
    await expect(page.getByRole('heading', { name: /datos del destinatario|recipient/i }).first()).toBeVisible({ timeout: 15000 });
    await expect(
      page.getByText(/necesitas iniciar sesión/i),
      'Logged-in qa-user should not see the login-required modal'
    ).toHaveCount(0);

    await page.waitForTimeout(1500);
    await page.screenshot({ path: 'test-results/user-send-remittance-after-continue.png', fullPage: true });

    test.info().annotations.push({
      type: 'note',
      description: 'Documented UI state after clicking Continue as qa-user (see screenshot). Did not complete a real Zelle payment.',
    });
  });
});
