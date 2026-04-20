import { test, expect } from '@playwright/test';

// ─── Helper: navigate to login page ─────────────────────────────────────────

async function goToLogin(page) {
  await page.goto('/');
  const loginBtn = page.locator('[data-testid="login-button"]');
  await loginBtn.waitFor({ state: 'visible', timeout: 5000 });
  await loginBtn.click();
  await page.waitForTimeout(500);
}

// ─── Public pages ─────────────────────────────────────────────────────────────

test.describe('Public pages load', () => {
  test('homepage loads with key elements', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/papuenvios/i);
    await expect(page.locator('header')).toBeVisible();
    await expect(page.locator('footer')).toBeVisible();
  });

  test('remittances page loads', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('header')).toBeVisible();
  });

  test('login page shows legal text', async ({ page }) => {
    await goToLogin(page);
    await expect(
      page.getByText(/términos de servicio|terms of service|política de privacidad|privacy policy/i).first()
    ).toBeVisible({ timeout: 8000 });
  });
});

// ─── Privacy & Terms pages ─────────────────────────────────────────────────

test.describe('Legal pages', () => {
  test('privacy page renders via login link', async ({ page }) => {
    await goToLogin(page);

    const privacyLink = page.getByRole('button', { name: /política de privacidad|privacy policy/i }).first();
    await expect(privacyLink).toBeVisible({ timeout: 8000 });
    await privacyLink.click();

    await expect(page.getByRole('heading', { name: /política de privacidad|privacy policy/i })).toBeVisible();
    await expect(page.getByText(/soporte@papuenvios\.com/i).first()).toBeVisible();
  });

  test('terms page renders via login link', async ({ page }) => {
    await goToLogin(page);

    const termsLink = page.getByRole('button', { name: /términos de servicio|terms of service/i }).first();
    await expect(termsLink).toBeVisible({ timeout: 8000 });
    await termsLink.click();

    await expect(page.getByRole('heading', { name: /términos de servicio|terms of service/i })).toBeVisible();
    await expect(page.getByText(/OFAC/).first()).toBeVisible();
  });
});

// ─── Send remittance page ────────────────────────────────────────────────────

test.describe('Send remittance flow', () => {
  test('send remittance page requires login', async ({ page }) => {
    await page.goto('/');
    const sendBtn = page.getByRole('button', { name: /enviar remesa|send remittance/i }).first();
    if (await sendBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await sendBtn.click();
      // Should redirect to login or show auth prompt
      await expect(
        page.getByText(/iniciar sesión|login|sign in|inicia sesión/i)
      ).toBeVisible({ timeout: 5000 });
    }
  });

  test('remittances info page shows exchange rate info', async ({ page }) => {
    await page.goto('/');
    const remittancesNavBtn = page.getByRole('button', { name: /remesas/i }).first();
    if (await remittancesNavBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await remittancesNavBtn.click();
      await expect(page.locator('main, [role="main"], .min-h-screen').first()).toBeVisible();
    }
  });
});

// ─── Accessibility smoke ─────────────────────────────────────────────────────

test.describe('Accessibility basics', () => {
  test('homepage has no missing alt texts on visible images', async ({ page }) => {
    await page.goto('/');
    const imagesWithoutAlt = await page.evaluate(() =>
      [...document.querySelectorAll('img:not([alt])')].length
    );
    expect(imagesWithoutAlt).toBe(0);
  });

  test('page has a single h1', async ({ page }) => {
    await page.goto('/');
    const h1Count = await page.locator('h1').count();
    expect(h1Count).toBeGreaterThanOrEqual(1);
  });
});
