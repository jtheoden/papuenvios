// src/tests/e2e/helpers/auth.js
//
// Programmatic login helper for role-based E2E audits.
//
// TESTABILITY FINDING (documented, not "fixed" — see final audit report):
// The app's UI has NO email/password login form. `LoginPage.jsx` only wires
// up Google OAuth (`signInWithGoogle`). An email/password `login()` function
// exists in `AuthContext.jsx` but is never called from any component. Since
// the QA credentials provided for this audit are email/password pairs, we
// cannot drive login through the real UI with Playwright without a real
// Google OAuth consent screen (out of scope / not automatable safely).
//
// Workaround: authenticate directly against Supabase's password grant REST
// endpoint (the same endpoint `supabase-js`'s `signInWithPassword` calls
// under the hood), then seed the browser's localStorage with the session
// under the exact storageKey the app's Supabase client uses
// (`papuenvios-auth`, see src/lib/supabase.js), then reload so
// `AuthContext` picks it up via `supabase.auth.getSession()`.
//
// This is standard practice for Playwright + Supabase apps that only offer
// OAuth in the UI, and it exercises the *real* RLS/session/role path (no
// mocking) — only the login screen itself is bypassed.

import path from 'path';
import { fileURLToPath } from 'url';
import { assertLocalSupabaseUrl } from './localGuard.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Credentials and URLs come ONLY from the process environment (set by
// scripts/e2e-local.sh against a local Supabase stack). No .env* file is read
// here on purpose: a developer's .env.local points at the hosted project.
export const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
assertLocalSupabaseUrl(SUPABASE_URL);
export const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;

export const ROLES = ['user', 'admin', 'super_admin'];

const AUTH_DIR = path.resolve(__dirname, '../../../../playwright/.auth');

/**
 * Path to the recorded Playwright storageState file for a QA role.
 * Recorded once by auth.setup.js; specs consume it via
 * `test.use({ storageState: authFile(role) })` instead of logging in per test.
 */
export function authFile(role) {
  return path.join(AUTH_DIR, `${role}.json`);
}

export const ROLE_CREDENTIALS = {
  user: {
    email: process.env.QA_USER_EMAIL,
    password: process.env.QA_USER_PASSWORD,
  },
  admin: {
    email: process.env.QA_ADMIN_EMAIL,
    password: process.env.QA_ADMIN_PASSWORD,
  },
  super_admin: {
    email: process.env.QA_SUPERADMIN_EMAIL,
    password: process.env.QA_SUPERADMIN_PASSWORD,
  },
};

/**
 * Fetches a real Supabase session via the password grant endpoint.
 * @param {import('@playwright/test').APIRequestContext} request
 * @param {'user'|'admin'|'super_admin'} role
 */
export async function fetchSession(request, role) {
  const creds = ROLE_CREDENTIALS[role];
  if (!creds || !creds.email || !creds.password) {
    throw new Error(
      `[auth helper] Missing QA credentials for role "${role}". Run the suite through "npm run test:e2e:local".`
    );
  }
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error(
      '[auth helper] Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. Run the suite through "npm run test:e2e:local".'
    );
  }

  const response = await request.post(
    `${SUPABASE_URL}/auth/v1/token?grant_type=password`,
    {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        'Content-Type': 'application/json',
      },
      data: { email: creds.email, password: creds.password },
    }
  );

  if (!response.ok()) {
    const body = await response.text();
    throw new Error(
      `[auth helper] Login failed for role "${role}" (${response.status()}): ${body}`
    );
  }

  const json = await response.json();

  // Shape expected by supabase-js v2 in localStorage.
  return {
    access_token: json.access_token,
    token_type: json.token_type || 'bearer',
    expires_in: json.expires_in,
    expires_at: Math.floor(Date.now() / 1000) + (json.expires_in || 3600),
    refresh_token: json.refresh_token,
    user: json.user,
  };
}

// TEST-01: per-test login (loginAs/logout) was replaced by auth.setup.js,
// which records one Playwright storageState file per role up front —
// specs now use `test.use({ storageState: authFile(role) })` instead of
// calling a login helper inside every test. `fetchSession` above is reused
// by that setup file.
