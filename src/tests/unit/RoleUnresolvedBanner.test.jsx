import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const auth = { current: {} };
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => auth.current }));
vi.mock('@/contexts/LanguageContext', () => ({ useLanguage: () => ({ t: (k) => k }) }));

import RoleUnresolvedBanner from '@/components/RoleUnresolvedBanner';

describe('RoleUnresolvedBanner', () => {
  it('renders nothing while the role is resolved or no fetch failed yet', () => {
    auth.current = { user: { id: 'u' }, roleStatus: 'resolved', roleFetchFailed: false };
    const { container } = render(<RoleUnresolvedBanner />);
    expect(container.firstChild).toBeNull();
  });

  it('is an in-flow status row (not fixed) with a working retry button', () => {
    const retry = vi.fn();
    auth.current = { user: { id: 'u' }, roleStatus: 'unresolved', roleFetchFailed: true, retryRoleResolution: retry };
    render(<RoleUnresolvedBanner />);
    const status = screen.getByRole('status');
    expect(status.className).not.toMatch(/\bfixed\b/);
    fireEvent.click(screen.getByRole('button', { name: 'auth.roleRetry' }));
    expect(retry).toHaveBeenCalledTimes(1);
  });
});

describe('RoleUnresolvedBanner — session reconnecting', () => {
  it('tells a signed-in person the session is being reconnected automatically (no retry button, role is untouched)', () => {
    auth.current = { user: { id: 'u' }, roleStatus: 'resolved', roleFetchFailed: false, sessionStatus: 'reconnecting' };
    render(<RoleUnresolvedBanner />);
    expect(screen.getByRole('status').textContent).toContain('auth.sessionReconnecting');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('reconnecting wins over a stale role-failure message', () => {
    auth.current = { user: { id: 'u' }, roleStatus: 'unresolved', roleFetchFailed: true, sessionStatus: 'reconnecting', retryRoleResolution: vi.fn() };
    render(<RoleUnresolvedBanner />);
    const text = screen.getByRole('status').textContent;
    expect(text).toContain('auth.sessionReconnecting');
    expect(text).not.toContain('auth.roleUnresolved');
  });
});

describe('RoleUnresolvedBanner pushes the page content down', () => {
  it('publishes its height in --role-banner-h and resets it on unmount', async () => {
    let observerCallback = null;
    const originalRO = globalThis.ResizeObserver;
    globalThis.ResizeObserver = class {
      constructor(cb) { observerCallback = cb; }
      observe() {}
      disconnect() {}
    };
    const desc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');
    let height = 57;
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get: () => height });

    auth.current = { user: { id: 'u' }, roleStatus: 'unresolved', roleFetchFailed: true, retryRoleResolution: vi.fn() };
    const { unmount } = render(<RoleUnresolvedBanner />);
    expect(document.documentElement.style.getPropertyValue('--role-banner-h')).toBe('57px');

    height = 90;
    observerCallback([]);
    expect(document.documentElement.style.getPropertyValue('--role-banner-h')).toBe('90px');

    unmount();
    expect(document.documentElement.style.getPropertyValue('--role-banner-h')).toBe('0px');

    globalThis.ResizeObserver = originalRO;
    if (desc) Object.defineProperty(HTMLElement.prototype, 'offsetHeight', desc);
  });

  it('works without ResizeObserver (feature-detected)', () => {
    const originalRO = globalThis.ResizeObserver;
    delete globalThis.ResizeObserver;
    auth.current = { user: { id: 'u' }, roleStatus: 'unresolved', roleFetchFailed: true, retryRoleResolution: vi.fn() };
    expect(() => render(<RoleUnresolvedBanner />)).not.toThrow();
    globalThis.ResizeObserver = originalRO;
  });

  it('App pads <main> with 5rem plus the banner height (0px when there is no banner)', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('src/App.jsx', 'utf8');
    expect(src).toContain("paddingTop: 'calc(5rem + var(--role-banner-h, 0px))'");
  });
});
