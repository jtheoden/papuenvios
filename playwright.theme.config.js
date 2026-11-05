import path from 'node:path';
import { createRequire } from 'node:module';
import { defineConfig, devices } from '@playwright/test';
import { assertLocalSupabaseUrl } from './src/tests/e2e/helpers/localGuard.js';

// Fully mocked specs (no Supabase, no login): own port so it never collides with the :5173 dev server of the main config.
const PORT = Number(process.env.THEME_E2E_PORT || 5189);
const SUPABASE_URL = 'http://127.0.0.1:54321'; // placeholder; every request to it is intercepted by page.route
assertLocalSupabaseUrl(SUPABASE_URL);
// `vite/bin/vite.js` is not an exported subpath: locate the package from its package.json instead.
const vite = path.join(path.dirname(createRequire(import.meta.url).resolve('vite/package.json')), 'bin', 'vite.js');

export default defineConfig({
  testDir: './src/tests/e2e',
  // THEME_E2E_MATCH widens the run to other fully mocked specs (home-hero, header-brand, footer-brand) that the body change affects.
  testMatch: new RegExp(process.env.THEME_E2E_MATCH || 'theme-tokens\\.spec\\.js'),
  fullyParallel: false,
  retries: 0,
  timeout: 60000,
  use: { baseURL: `http://127.0.0.1:${PORT}`, headless: true },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `node "${vite}" --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: false,
    timeout: 60000,
    env: { VITE_SUPABASE_URL: SUPABASE_URL, VITE_SUPABASE_ANON_KEY: 'e2e-placeholder-key' },
  },
});
