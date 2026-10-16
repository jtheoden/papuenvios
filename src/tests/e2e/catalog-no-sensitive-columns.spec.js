import { test, expect } from '@playwright/test';

// Phase 0a: the public catalog (anon visitor) must never request or receive cost/margin
// columns. Needs the app pointed at a Supabase project (VITE_SUPABASE_URL / ANON_KEY).

const SENSITIVE_FIELDS = [
  'base_price',
  'cost_price',
  'profit_margin',
  'cost_per_unit',
  'supplier_reference',
  'base_total_price',
  'transport_cost'
];

const REST_PATH = '/rest/v1/';

// A flaky retry would hide a leak that only shows on some loads.
test.describe.configure({ retries: 0 });

const findSensitiveKeys = (value, found = new Set()) => {
  if (Array.isArray(value)) {
    value.forEach((item) => findSensitiveKeys(item, found));
  } else if (value && typeof value === 'object') {
    Object.entries(value).forEach(([key, nested]) => {
      if (SENSITIVE_FIELDS.includes(key)) found.add(key);
      findSensitiveKeys(nested, found);
    });
  }
  return found;
};

const requestedSensitiveFields = (url) => {
  const decoded = decodeURIComponent(url);
  return SENSITIVE_FIELDS.filter((field) => new RegExp(`\\b${field}\\b`).test(decoded));
};

// Records every PostgREST exchange made while a public page renders.
const recordRestTraffic = (page) => {
  const exchanges = [];
  page.on('response', async (response) => {
    const url = response.url();
    if (!url.includes(REST_PATH)) return;
    let body = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    exchanges.push({ url, status: response.status(), body });
  });
  return exchanges;
};

test.describe('public catalog does not touch sensitive columns', () => {
  for (const path of ['/products', '/cart']) {
    test(`anon on ${path}: no sensitive field requested or returned`, async ({ page }) => {
      const exchanges = recordRestTraffic(page);

      await page.goto(path);
      await page.waitForLoadState('networkidle');

      expect(exchanges.length, 'the page must have queried PostgREST').toBeGreaterThan(0);

      for (const { url, body } of exchanges) {
        expect(requestedSensitiveFields(url), `request ${url}`).toEqual([]);
        expect([...findSensitiveKeys(body)], `response of ${url}`).toEqual([]);
      }
    });
  }

  test('anon catalog shows non-zero prices', async ({ page }) => {
    await page.goto('/products');
    await page.waitForLoadState('networkidle');

    const prices = await page.locator('text=/\\$\\s?\\d+\\.\\d{2}/').allTextContents();
    expect(prices.length).toBeGreaterThan(0);
    prices.forEach((text) => {
      expect(text).not.toMatch(/\$\s?0\.00\b/);
    });
  });
});

test.describe('permission denied on the catalog', () => {
  test('shows a clear message with a reload action, never a silent empty page', async ({ page }) => {
    await page.route('**/rest/v1/products*', (route) =>
      route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({ code: '42501', message: 'permission denied for table products', details: null, hint: null })
      })
    );

    await page.goto('/products');

    const alert = page.getByRole('alert');
    await expect(alert).toBeVisible();
    await expect(alert.getByRole('button')).toBeVisible();
  });
});
