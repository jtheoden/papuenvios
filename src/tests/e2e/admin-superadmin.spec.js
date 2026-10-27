import { test, expect } from '@playwright/test';
import { authFile } from './helpers/auth.js';

// ─── Hallazgo #7: flujo admin de gestión (qa-admin) ───────────────────────

test.describe('Admin management flow — qa-admin', () => {
  test.use({ storageState: authFile('admin') });

  test('can view Orders tab on /dashboard', async ({ page }) => {
    await page.goto('/dashboard?tab=orders');

    // Below md the tab bar is a dropdown and the desktop tab buttons are display:none, so pick a VISIBLE match
    // (the dropdown trigger shows the active tab label) instead of the first DOM match.
    await expect(page.getByText(/órdenes|orders/i).filter({ visible: true }).first()).toBeVisible({ timeout: 15000 });
    await page.screenshot({ path: 'test-results/admin-dashboard-orders.png', fullPage: true });
  });

  test('admin sees the inventory but NO bulk-selection checkboxes (bulk delete is super_admin only)', async ({ page }) => {
    await page.goto('/admin');

    // POSITIVE wait: the seeded product row rendered, so the absence below is not vacuous.
    await expect(page.getByText('Producto E2E').filter({ visible: true }).first()).toBeVisible({ timeout: 15000 });
    await page.screenshot({ path: 'test-results/admin-page-inventory.png', fullPage: true });

    await expect(page.getByRole('checkbox', { name: /seleccionar fila|select row/i })).toHaveCount(0);
  });
});

// ─── Hallazgo #8: funciones exclusivas de super_admin ─────────────────────

test.describe('Super-admin exclusive features — qa-superadmin', () => {
  test.describe('as super_admin', () => {
    test.use({ storageState: authFile('super_admin') });

    test('can view Activity Log tab (super_admin only)', async ({ page }) => {
      await page.goto('/dashboard?tab=activity-log');

      // isVisible() does not wait (its timeout option is ignored), so use a web-first assertion that retries.
      const activityLogVisible = await expect(
        page.getByText(/registro de actividad|activity log/i).filter({ visible: true }).first()
      ).toBeVisible({ timeout: 15000 }).then(() => true, () => false);

      await page.screenshot({ path: 'test-results/superadmin-activity-log.png', fullPage: true });

      test.info().annotations.push({
        type: activityLogVisible ? 'CONFIRMED' : 'REFUTED',
        description: `qa-superadmin sees Activity Log tab: ${activityLogVisible}.`,
      });

      expect(activityLogVisible).toBe(true);
    });

    test('bulk-delete selection bar appears after selecting a row (does NOT delete)', async ({ page }) => {
      await page.goto('/admin');
      await expect(page.getByText('Producto E2E').filter({ visible: true }).first()).toBeVisible({ timeout: 15000 });

      await page.getByRole('checkbox', { name: /seleccionar fila|select row/i }).filter({ visible: true }).first().check();

      await expect(page.getByText(/1\s+(seleccionad|selected)/i).filter({ visible: true }).first()).toBeVisible({ timeout: 5000 });
      await page.screenshot({ path: 'test-results/superadmin-bulk-delete-bar.png', fullPage: true });
    });

    test('can see Sistema tab in Settings', async ({ page, isMobile }) => {
      test.skip(isMobile, 'Settings tabs render icon-only below the xs breakpoint (no accessible name): desktop-only check');
      // SettingsPage.jsx does not read ?tab= from the URL (unlike
      // DashboardPage.jsx, which does) — activeTab is a plain
      // useState('financiero'), so /settings?tab=sistema always renders
      // Financiero regardless of role. Navigate to /settings and click the
      // "Sistema" tab button itself, which IS gated by isSuperAdmin in the
      // tabs array (SettingsPage.jsx ~line 395).
      await page.goto('/settings');

      const sistemaTabBtn = page.getByRole('button', { name: /^sistema$|^system$/i });
      await expect(sistemaTabBtn).toBeVisible({ timeout: 15000 });
      await sistemaTabBtn.click();

      const sistemaVisible = await expect(page.getByText(/reset de plataforma/i).first())
        .toBeVisible({ timeout: 10000 })
        .then(() => true, () => false);

      await page.screenshot({ path: 'test-results/superadmin-settings-sistema.png', fullPage: true });

      test.info().annotations.push({
        type: sistemaVisible ? 'CONFIRMED' : 'REFUTED',
        description: `qa-superadmin sees Sistema/platform-reset panel: ${sistemaVisible}.`,
      });

      expect(sistemaVisible).toBe(true);
    });

    test('platform reset button exists and requires a confirm-word — DOES NOT execute it', async ({ page, isMobile }) => {
      test.skip(isMobile, 'Settings tabs render icon-only below the xs breakpoint (no accessible name): desktop-only check');
      await page.goto('/settings');
      const sistemaTabBtn = page.getByRole('button', { name: /^sistema$|^system$/i });
      await expect(sistemaTabBtn).toBeVisible({ timeout: 15000 });
      await sistemaTabBtn.click();

      const resetBtn = page.getByRole('button', { name: /resetear plataforma|reset platform/i });
      const resetBtnVisible = await expect(resetBtn).toBeVisible({ timeout: 15000 }).then(() => true, () => false);

      test.info().annotations.push({
        type: 'note',
        description: `Platform reset button present: ${resetBtnVisible}. Button is expected to be disabled unless platform_reset_control.enabled=true in DB (per SettingsSystemTab.jsx source).`,
      });

      expect(resetBtnVisible).toBe(true);

      const isDisabled = await resetBtn.isDisabled().catch(() => true);
      await page.screenshot({ path: 'test-results/superadmin-platform-reset-button.png', fullPage: true });

      if (isDisabled) {
        test.info().annotations.push({
          type: 'CONFIRMED',
          description: 'Reset button is disabled by default (flag not enabled in this QA environment) — safe, as expected. Not clicking further.',
        });
        return;
      }

      // Only if enabled: open the confirm dialog to verify it demands a
      // confirmation word, WITHOUT typing it or confirming.
      await resetBtn.click();
      const confirmHeading = page.getByText(/confirmar reset/i);
      await expect(confirmHeading).toBeVisible({ timeout: 5000 });

      const confirmBtn = page.getByRole('button', { name: /resetear definitivamente|reset permanently/i });
      const confirmDisabled = await confirmBtn.isDisabled().catch(() => true);

      await page.screenshot({ path: 'test-results/superadmin-platform-reset-confirm-dialog.png', fullPage: true });

      expect(confirmDisabled, 'Confirm button must stay disabled until the exact confirmation word is typed').toBe(true);

      test.info().annotations.push({
        type: 'CONFIRMED',
        description: 'Platform reset confirm dialog requires a confirmation word before enabling the destructive action. Did NOT execute the reset.',
      });

      // Close without confirming.
      const cancelBtn = page.getByRole('button', { name: /cancelar|cancel/i });
      if (await cancelBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await cancelBtn.click();
      }
    });
  });

  test.describe('as admin (not super_admin)', () => {
    test.use({ storageState: authFile('admin') });

    test('qa-admin does NOT see Activity Log tab', async ({ page }) => {
      await page.goto('/dashboard?tab=activity-log');

      // POSITIVE wait first: the dashboard shell rendered for this admin (a visible match of the overview tab label:
      // desktop tab button, or the mobile dropdown trigger showing the active tab), so absence below is not vacuous.
      await expect(
        page.getByText(/resumen general|general overview|overview/i).filter({ visible: true }).first()
      ).toBeVisible({ timeout: 15000 });

      await page.screenshot({ path: 'test-results/admin-activity-log-blocked.png', fullPage: true });

      await expect(
        page.getByText(/registro de actividad|activity log/i),
        'qa-admin (not super_admin) should not see Activity Log content'
      ).toHaveCount(0);
    });
  });

  test.describe('as user', () => {
    test.use({ storageState: authFile('user') });

    test('qa-user cannot reach /settings at all', async ({ page }) => {
      await page.goto('/settings');

      await expect(
        page.getByText(/acceso restringido|access restricted|autenticación requerida/i)
      ).toBeVisible({ timeout: 15000 });

      await page.screenshot({ path: 'test-results/user-settings-blocked.png', fullPage: true });
    });
  });
});
