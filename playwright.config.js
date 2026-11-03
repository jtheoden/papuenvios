import { defineConfig, devices } from '@playwright/test';
import { assertLocalSupabaseUrl } from './src/tests/e2e/helpers/localGuard.js';

// Abort before anything starts (including the dev server) unless the env points at a LOCAL stack.
assertLocalSupabaseUrl(process.env.VITE_SUPABASE_URL);

export default defineConfig({
  testDir: './src/tests/e2e',
  fullyParallel: false,
  retries: 1,
  workers: process.env.E2E_PREVIEW ? 4 : undefined,
  timeout: 30000,
  use: {
    baseURL: 'http://localhost:5173',
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
  },
  projects: [
    // TEST-01: records one storageState file per QA role before the real
    // test projects run, so tests use `test.use({ storageState: authFile(role) })`
    // instead of logging in (REST + reload + wait) inside every test.
    { name: 'setup', testMatch: /auth\.setup\.js/ },
    { name: 'chromium', use: { ...devices['Desktop Chrome'] }, dependencies: ['setup'] },
    { name: 'mobile-chrome', use: { ...devices['Pixel 5'] }, dependencies: ['setup'] },
  ],
  // Never reuse a server already listening on :5173: it could be a dev server started with .env.local (hosted
  // project) and would bypass the local-URL guard above. If the port is busy Playwright fails with a clear message.
  // The local runner (E2E_PREVIEW=1) builds the app itself (scripts/e2e-local.sh, which also checks the bundle) and
  // only serves it, because the cold Vite dev server times out under parallel workers.
  webServer: {
    command: process.env.E2E_PREVIEW
      ? 'npx vite preview --outDir .e2e-dist --port 5173 --strictPort'
      : 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: false,
    timeout: 30000,
  },
});
