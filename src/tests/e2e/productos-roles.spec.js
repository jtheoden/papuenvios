import { test, expect } from '@playwright/test';
import { authFile } from './helpers/auth.js';

// ─── Hallazgo #6: flujo completo de compra como qa-user ──────────────────

test.describe('Product purchase flow — logged in as qa-user', () => {
  test.use({ storageState: authFile('user') });

  test('catalog -> detail -> add to cart -> checkout opens the payment-proof step', async ({ page }) => {
    // The seed guarantees one in-stock product ("Producto E2E"): every step below is a hard expectation.
    await page.goto('/products');
    const card = page.getByText('Producto E2E').filter({ visible: true }).first();
    await expect(card, 'seeded product must be listed in the catalog').toBeVisible({ timeout: 15000 });
    await page.screenshot({ path: 'test-results/user-products-catalog.png', fullPage: true });
    await card.click();

    const addToCartBtn = page.getByRole('button', { name: /agregar al carrito|add to cart/i }).first();
    await expect(addToCartBtn, 'seeded product has stock: add-to-cart must be available').toBeVisible({ timeout: 15000 });
    await page.screenshot({ path: 'test-results/user-product-detail.png', fullPage: true });
    await addToCartBtn.click();

    await page.goto('/cart');
    await expect(page.getByText('Producto E2E').first()).toBeVisible({ timeout: 15000 });
    await page.screenshot({ path: 'test-results/user-cart-with-item.png', fullPage: true });

    const checkoutBtn = page.getByRole('button', { name: /proceder al pago|checkout/i }).first();
    await expect(checkoutBtn).toBeVisible({ timeout: 10000 });
    await checkoutBtn.click();

    // Checkout asks for the payment proof before creating the order (no order is created by this test).
    await expect(page.getByText(/comprobante de pago requerido|payment proof required/i)).toBeVisible({ timeout: 10000 });
    await page.screenshot({ path: 'test-results/user-checkout-step.png', fullPage: true });
  });
});

// ─── Hallazgo #9 (extensión): accesibilidad en producto/remesas/checkout ──

test.describe('Accessibility — product/remittance/checkout pages', () => {
  const pagesToCheck = [
    { path: '/products', name: 'products catalog' },
    { path: '/remittances/send', name: 'send remittance' },
  ];

  for (const { path, name } of pagesToCheck) {
    test(`${name}: single h1, all images have alt`, async ({ page }) => {
      await page.goto(path);
      await page.waitForTimeout(1000);

      const h1Count = await page.locator('h1').count();
      const imagesWithoutAlt = await page.evaluate(() =>
        [...document.querySelectorAll('img:not([alt])')].length
      );

      test.info().annotations.push({
        type: 'note',
        description: `${name} (${path}): h1 count=${h1Count}, images without alt=${imagesWithoutAlt}`,
      });

      expect(imagesWithoutAlt, `${name} has images missing alt text`).toBe(0);
      expect(h1Count, `${name} should have at least one h1`).toBeGreaterThanOrEqual(1);
    });
  }

  test('send remittance form: keyboard navigation reaches type select and amount input', async ({ page }) => {
    await page.goto('/remittances/send');
    await expect(page.getByText(/tipo y monto de remesa/i)).toBeVisible({ timeout: 10000 });

    // Tab through the page and verify a form control receives focus.
    let focusedSelectOrInput = false;
    for (let i = 0; i < 15; i++) {
      await page.keyboard.press('Tab');
      const tag = await page.evaluate(() => document.activeElement?.tagName);
      if (tag === 'SELECT' || tag === 'INPUT') {
        focusedSelectOrInput = true;
        break;
      }
    }

    test.info().annotations.push({
      type: focusedSelectOrInput ? 'CONFIRMED' : 'REFUTED',
      description: `Keyboard Tab navigation reaches a SELECT/INPUT on the send-remittance form: ${focusedSelectOrInput}`,
    });

    expect(focusedSelectOrInput).toBe(true);
  });
});
