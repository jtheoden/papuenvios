// TEST-01: records one Playwright storageState file per QA role instead of
// re-running the REST password-grant login + localStorage seed + reload +
// 1500ms wait inside every single test (as `loginAs()` did). Playwright runs
// this "setup" project once before the role-scoped test projects/describes
// that declare a dependency on it, and every test that uses
// `test.use({ storageState: authFile(role) })` starts already authenticated —
// no per-test network round trip, no per-test wait.
//
// This does NOT touch production code — same REST password-grant trick as
// `helpers/auth.js`, just run once and cached to disk instead of per test.
//
// `authFile`/`ROLES` live in helpers/auth.js (a plain module), not here —
// Playwright forbids importing a test file (one that calls setup()/test())
// from another spec file.

import { test as setup } from '@playwright/test';
import { fetchSession, authFile, ROLES } from './helpers/auth.js';

const STORAGE_KEY = 'papuenvios-auth';

for (const role of ROLES) {
  setup(`authenticate as ${role}`, async ({ page }) => {
    const session = await fetchSession(page.context().request, role);

    await page.goto('/');
    await page.evaluate(
      ({ key, value }) => window.localStorage.setItem(key, JSON.stringify(value)),
      { key: STORAGE_KEY, value: session }
    );
    await page.reload();

    // AuthContext needs a moment to hydrate the profile/role after reload —
    // same wait `loginAs()` used, paid once here instead of per test.
    await page.waitForTimeout(1500);

    await page.context().storageState({ path: authFile(role) });
  });
}
