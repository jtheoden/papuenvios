import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within, act, waitFor } from '@testing-library/react';
import { DEFAULT_VISUAL_SETTINGS } from '@/lib/businessVisualSettingsService';

// Row stored in production today (see Header.brandTheme.test.jsx).
const PROD = {
  ...DEFAULT_VISUAL_SETTINGS,
  useGradient: true,
  logo: '',
  primaryColor: '#3499dc',
  secondaryColor: '#9333ea',
  headerGradientColor: '#9333ea',
  headerBgColor: '#ffffff',
  headerTextColor: '#1f2937',
};

const state = vi.hoisted(() => ({ settings: {}, role: 'user', user: null }));

vi.mock('@/lib/supabase', () => ({ supabase: {} }));
vi.mock('@/lib/orderService', () => ({ getPendingOrdersCount: vi.fn(async () => 0) }));
vi.mock('@/lib/refundService', () => ({
  REFUNDS_CHANGED_EVENT: 'papuenvios:refunds-changed',
  getRefundCounts: vi.fn(async () => ({ actionable: 0, overdue: 0 })),
}));
vi.mock('@/lib/remittanceService', () => ({ getPendingRemittancesCount: vi.fn(async () => 0) }));
vi.mock('@/hooks/useRealtimeSubscription', () => ({
  useRealtimeOrders: vi.fn(() => ({ isSubscribed: true })),
  useRealtimeRemittances: vi.fn(() => ({ isSubscribed: true })),
}));
vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({ language: 'es', setLanguage: vi.fn(), t: (k) => k }),
}));
vi.mock('@/contexts/BusinessContext', () => ({
  useBusiness: () => ({ cart: [], visualSettings: state.settings }),
}));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: state.user,
    isAdmin: state.role === 'admin' || state.role === 'super_admin',
    userRole: state.role,
    userCategory: null,
    roleStatus: 'resolved',
    roleFetchFailed: false,
    retryRoleResolution: vi.fn(),
  }),
}));
vi.mock('@/components/ui/use-toast', () => ({ toast: vi.fn() }));
vi.mock('@/components/ui/user-avatar', () => ({ UserAvatar: () => <span /> }));

import Header from '@/components/Header';

const classes = (el) => el.className.split(/\s+/);
const mount = (settings = PROD, props = {}) => {
  state.settings = settings;
  const onNavigate = vi.fn();
  const view = render(<Header currentPage="home" onNavigate={onNavigate} {...props} />);
  return { ...view, onNavigate, header: view.container.querySelector('header') };
};

beforeEach(() => {
  state.settings = {};
  state.role = 'user';
  state.user = null;
  window.innerWidth = 375;
});
afterEach(() => {
  window.innerWidth = 1024;
});

describe('mobile quick-nav pills (320 px)', () => {
  it('share the row evenly and may shrink below 360 px, so a label is never cut to "Produ…"', () => {
    mount();
    const pills = within(screen.getByTestId('quick-nav')).getAllByRole('button');
    expect(pills).toHaveLength(3);
    pills.forEach((pill) => {
      const list = classes(pill);
      ['flex-1', 'min-w-0', 'text-xs', 'px-2'].forEach((c) => expect(list).toContain(c));
      // from 360 px up the pill keeps its previous (production) size
      ['min-[360px]:flex-none', 'min-[360px]:min-w-[85px]', 'min-[360px]:text-sm', 'min-[360px]:px-3'].forEach((c) => expect(list).toContain(c));
      expect(list).not.toContain('min-w-[85px]');
      expect(pill.querySelector('svg').getAttribute('class')).toContain('max-[359px]:hidden');
    });
  });
});

describe('user dropdown follows the header menu settings', () => {
  const openUserMenu = () => {
    fireEvent.click(screen.getByRole('button', { name: 'nav.userMenu' }));
    return screen.getByRole('menu');
  };

  beforeEach(() => {
    state.user = { id: 'u1', email: 'a@b.c' };
  });

  it('uses the menu colour variables instead of fixed white/gray utilities', () => {
    mount();
    const menu = openUserMenu();
    expect(classes(menu)).toContain('bg-[color:var(--hdr-menu-bg)]');
    expect(classes(menu)).toContain('text-[color:var(--hdr-menu-text)]');
    expect(classes(menu)).not.toContain('bg-white');
    within(menu).getAllByRole('menuitem').forEach((item) => {
      expect(classes(item)).not.toContain('text-gray-700');
      expect(classes(item)).not.toContain('hover:bg-gray-50');
    });
    const panel = within(menu).getAllByRole('menuitem')[0];
    expect(classes(panel)).toContain('hover:bg-[color:var(--hdr-hover-bg)]');
  });

  it('production row resolves the menu to a white surface with dark text', () => {
    const { header } = mount(PROD);
    expect(header.style.getPropertyValue('--hdr-menu-bg')).toBe('#ffffff');
    expect(header.style.getPropertyValue('--hdr-menu-text')).toBe('#1f2937');
  });

  it('a customised menu colour pair reaches the header variables; an invalid one falls back by pair', () => {
    const { header, unmount } = mount({ ...PROD, headerMenuBgColor: '#101010', headerMenuTextColor: '#fafafa' });
    expect(header.style.getPropertyValue('--hdr-menu-bg')).toBe('#101010');
    expect(header.style.getPropertyValue('--hdr-menu-text')).toBe('#fafafa');
    unmount();
    const second = mount({ ...PROD, headerMenuBgColor: '#101010', headerMenuTextColor: 'nope' });
    expect(second.header.style.getPropertyValue('--hdr-menu-bg')).toBe('#ffffff');
    expect(second.header.style.getPropertyValue('--hdr-menu-text')).toBe('#1f2937');
  });

  it('still navigates and closes from its items', async () => {
    const { onNavigate } = mount();
    const menu = openUserMenu();
    fireEvent.click(within(menu).getAllByRole('menuitem')[0]);
    expect(onNavigate).toHaveBeenCalledWith('user-panel');
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  });

  it('closes with Escape and gives focus back to its trigger', async () => {
    mount();
    const trigger = screen.getByRole('button', { name: 'nav.userMenu' });
    openUserMenu();
    fireEvent.keyDown(document.activeElement, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });
});

describe('admin dropdown accessibility', () => {
  beforeEach(() => {
    state.role = 'admin';
    state.user = { id: 'a1', email: 'admin@b.c' };
    window.innerWidth = 1280;
  });

  const trigger = () => screen.getByRole('button', { name: /Admin/ });

  it('declares its popup and the element it controls', () => {
    mount();
    expect(trigger().getAttribute('aria-haspopup')).toBe('true');
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(trigger());
    const menu = screen.getByRole('menu');
    expect(trigger().getAttribute('aria-expanded')).toBe('true');
    expect(menu.id).toBeTruthy();
    expect(trigger().getAttribute('aria-controls')).toBe(menu.id);
    expect(within(menu).getAllByRole('menuitem')).toHaveLength(4);
  });

  it('moves focus to the first item on open', () => {
    mount();
    fireEvent.click(trigger());
    expect(document.activeElement).toBe(within(screen.getByRole('menu')).getAllByRole('menuitem')[0]);
  });

  it('focuses the current page entry when it is inside the menu', () => {
    mount(PROD, { currentPage: 'settings' });
    fireEvent.click(trigger());
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'nav.settings' }));
  });

  it('closes with Escape and returns focus to the trigger', async () => {
    mount();
    fireEvent.click(trigger());
    fireEvent.keyDown(document.activeElement, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(trigger());
  });

  it('closes on a pointer press outside, without stealing focus', async () => {
    mount();
    fireEvent.click(trigger());
    fireEvent.mouseDown(document.body);
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    expect(document.activeElement).not.toBe(trigger());
  });

  it('stays open on a press inside the menu', () => {
    mount();
    fireEvent.click(trigger());
    fireEvent.mouseDown(screen.getByRole('menu'));
    expect(screen.getByRole('menu')).toBeTruthy();
  });

  it('closes when keyboard focus leaves the menu (Tab out)', async () => {
    mount();
    fireEvent.click(trigger());
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    fireEvent.blur(document.activeElement, { relatedTarget: outside });
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    outside.remove();
  });

  it('arrow keys, Home and End move focus between items (wrapping)', () => {
    mount();
    fireEvent.click(trigger());
    const items = within(screen.getByRole('menu')).getAllByRole('menuitem');
    fireEvent.keyDown(items[0], { key: 'ArrowDown' });
    expect(document.activeElement).toBe(items[1]);
    fireEvent.keyDown(items[1], { key: 'End' });
    expect(document.activeElement).toBe(items[3]);
    fireEvent.keyDown(items[3], { key: 'ArrowDown' });
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(items[0], { key: 'ArrowUp' });
    expect(document.activeElement).toBe(items[3]);
    fireEvent.keyDown(items[3], { key: 'Home' });
    expect(document.activeElement).toBe(items[0]);
  });

  it('keeps the item click behaviour (navigate and close)', async () => {
    const { onNavigate } = mount();
    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole('menuitem', { name: 'nav.dashboard' }));
    expect(onNavigate).toHaveBeenCalledWith('dashboard');
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  });
});

describe('header publishes its real height for fixed elements below it', () => {
  const originalRO = globalThis.ResizeObserver;
  const desc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');
  afterEach(() => {
    globalThis.ResizeObserver = originalRO;
    if (desc) Object.defineProperty(HTMLElement.prototype, 'offsetHeight', desc);
    else delete HTMLElement.prototype.offsetHeight;
  });

  it('writes --header-h, follows resizes and removes it on unmount', () => {
    let notify = null;
    globalThis.ResizeObserver = class {
      constructor(cb) { notify = cb; }
      observe() {}
      disconnect() {}
    };
    let height = 110;
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get: () => height });

    const { unmount } = mount();
    const root = document.documentElement;
    expect(root.style.getPropertyValue('--header-h')).toBe('110px');
    height = 64;
    act(() => notify([]));
    expect(root.style.getPropertyValue('--header-h')).toBe('64px');
    unmount();
    expect(root.style.getPropertyValue('--header-h')).toBe('');
  });
});
