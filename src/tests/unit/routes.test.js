import { describe, it, expect } from 'vitest';
import { resolvePageFromPathname, pageToPath, PAGE_PATHS, shouldShowFooterNotice } from '@/lib/routes';

describe('resolvePageFromPathname', () => {
  it('maps /terms and /privacy to their pages', () => {
    expect(resolvePageFromPathname('/terms')).toEqual({ page: 'terms' });
    expect(resolvePageFromPathname('/privacy')).toEqual({ page: 'privacy' });
  });

  it('ignores a trailing slash', () => {
    expect(resolvePageFromPathname('/terms/')).toEqual({ page: 'terms' });
    expect(resolvePageFromPathname('/privacy/')).toEqual({ page: 'privacy' });
  });

  it('keeps existing routes working', () => {
    expect(resolvePageFromPathname('/')).toEqual({ page: 'home' });
    expect(resolvePageFromPathname('/remittances/send')).toEqual({ page: 'send-remittance' });
    expect(resolvePageFromPathname('/cart')).toEqual({ page: 'cart' });
  });

  it('resolves product and combo detail routes with params', () => {
    expect(resolvePageFromPathname('/product/abc')).toEqual({
      page: 'product-detail',
      params: { itemId: 'abc', itemType: 'product' },
    });
    expect(resolvePageFromPathname('/combo/xyz')).toEqual({
      page: 'product-detail',
      params: { itemId: 'xyz', itemType: 'combo' },
    });
  });

  it('falls back to home for unknown paths', () => {
    expect(resolvePageFromPathname('/nope')).toEqual({ page: 'home' });
  });
});

describe('pageToPath', () => {
  it('maps terms and privacy to URLs', () => {
    expect(pageToPath('terms')).toBe('/terms');
    expect(pageToPath('privacy')).toBe('/privacy');
  });

  it('falls back to / for unknown pages', () => {
    expect(pageToPath('unknown')).toBe('/');
  });

  it('round-trips every known page', () => {
    for (const [page, path] of Object.entries(PAGE_PATHS)) {
      expect(pageToPath(page)).toBe(path);
      expect(resolvePageFromPathname(path).page).toBe(page);
    }
  });
});

describe('shouldShowFooterNotice', () => {
  it('hides the footer notice where a contextual notice or admin UI is shown', () => {
    for (const page of ['cart', 'send-remittance', 'admin', 'dashboard', 'settings', 'user-management']) {
      expect(shouldShowFooterNotice(page)).toBe(false);
    }
  });

  it('shows it on customer-facing pages', () => {
    for (const page of ['home', 'products', 'terms', 'privacy', 'remittances', 'my-remittances', 'login']) {
      expect(shouldShowFooterNotice(page)).toBe(true);
    }
  });
});
