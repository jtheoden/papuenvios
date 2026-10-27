import { describe, it, expect, vi } from 'vitest';
import { assertLocalSupabaseUrl } from '../e2e/helpers/localGuard.js';

describe('assertLocalSupabaseUrl (E2E safety guard)', () => {
  it.each([
    'http://127.0.0.1:55321',
    'http://localhost:54321',
    'http://127.0.0.1',
    'http://[::1]:55321',
  ])('accepts local plain-http URL %s', (url) => {
    expect(() => assertLocalSupabaseUrl(url)).not.toThrow();
  });

  it.each([
    ['undefined', undefined],
    ['empty', ''],
    ['not a URL', 'localhost'],
    ['production host', 'https://qcwnlbpultscerwdnzbm.supabase.co'],
    ['any supabase.co host', 'http://abc.supabase.co'],
    ['https localhost', 'https://localhost:54321'],
    ['lookalike suffix', 'http://127.0.0.1.evil.com'],
    ['userinfo trick', 'http://localhost@evil.com'],
    ['userinfo trick 2', 'http://127.0.0.1:80@evil.com'],
    ['LAN address', 'http://192.168.1.10:54321'],
  ])('rejects %s', (_label, url) => {
    expect(() => assertLocalSupabaseUrl(url)).toThrow(/Refusing/);
  });

  it('never echoes credentials from the rejected URL', () => {
    try {
      assertLocalSupabaseUrl('https://user:topsecret@prod.example.com');
    } catch (e) {
      expect(e.message).not.toContain('topsecret');
    }
  });
});

describe('playwright.config.js safety', () => {
  it('never reuses an existing server on :5173 (it could be a dev server pointing at the hosted project)', async () => {
    const prev = process.env.VITE_SUPABASE_URL;
    process.env.VITE_SUPABASE_URL = 'http://127.0.0.1:56321';
    try {
      const { default: config } = await import('../../../playwright.config.js');
      expect(config.webServer.reuseExistingServer).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.VITE_SUPABASE_URL;
      else process.env.VITE_SUPABASE_URL = prev;
    }
  });

  it('aborts at load time when the env points at a non-local Supabase', async () => {
    const prev = process.env.VITE_SUPABASE_URL;
    process.env.VITE_SUPABASE_URL = 'https://abc.supabase.co';
    try {
      vi.resetModules();
      await expect(import('../../../playwright.config.js?nonlocal')).rejects.toThrow(/Refusing/);
    } finally {
      if (prev === undefined) delete process.env.VITE_SUPABASE_URL;
      else process.env.VITE_SUPABASE_URL = prev;
    }
  });
});
