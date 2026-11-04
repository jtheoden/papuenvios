import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { BRAND_PRESET, getContrastIssues } from '@/lib/brandPalette';
import { DEFAULT_VISUAL_SETTINGS } from '@/lib/businessVisualSettingsService';
import { contrastRatio } from '@/lib/contrast';

const POISON = { primaryColor: '#abcdef', secondaryColor: '#fedcba', accentColor: '#123456' };
const POISON_RGB = ['rgb(171, 205, 239)', 'rgb(254, 220, 186)', 'rgb(18, 52, 86)'];

const state = vi.hoisted(() => ({
  settings: {},
  cart: [],
  role: 'user',
  setLanguage: vi.fn(),
}));

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
  useLanguage: () => ({ language: 'es', setLanguage: state.setLanguage, t: (k) => k }),
}));
vi.mock('@/contexts/BusinessContext', () => ({
  useBusiness: () => ({ cart: state.cart, visualSettings: state.settings }),
}));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: null,
    isAdmin: state.role === 'admin',
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

const hasClass = (el, name) => el.className.split(/\s+/).includes(name);

const mount = (settings = {}, props = {}) => {
  state.settings = settings;
  const view = render(<Header currentPage="home" onNavigate={() => {}} {...props} />);
  const header = view.container.querySelector('header');
  return { ...view, header, cssVar: (name) => header.style.getPropertyValue(name) };
};

describe('Header brand theme (S1)', () => {
  beforeEach(() => {
    state.settings = {};
    state.cart = [];
    state.role = 'user';
    state.setLanguage = vi.fn();
    window.innerWidth = 1280;
  });
  afterEach(() => {
    window.innerWidth = 1024;
  });

  describe('active tab', () => {
    it('marks only the current page with aria-current and a non-colour cue (bold + underline)', () => {
      mount(BRAND_PRESET);
      const nav = screen.getAllByRole('navigation')[0];
      const home = within(nav).getByRole('button', { name: 'nav.home' });
      const products = within(nav).getByRole('button', { name: 'nav.products' });
      expect(home.getAttribute('aria-current')).toBe('page');
      expect(products.getAttribute('aria-current')).toBeNull();
      expect(hasClass(home, 'font-semibold')).toBe(true);
      expect(hasClass(home, 'underline')).toBe(true);
      expect(hasClass(products, 'underline')).toBe(false);
    });

    it('takes its colours from navBarActive* through CSS variables, not from inline styles', () => {
      const { header, cssVar } = mount(BRAND_PRESET);
      const home = within(header).getAllByRole('button', { name: 'nav.home' })[0];
      expect(cssVar('--hdr-active-bg')).toBe('#FFF1CC');
      expect(cssVar('--hdr-active-text')).toBe('#171717');
      expect(hasClass(home, '[background:var(--hdr-active-background)]')).toBe(true);
      expect(hasClass(home, 'text-[color:var(--hdr-active-text)]')).toBe(true);
      expect(home.getAttribute('style')).toBeNull();
    });

    it('does not depend on primary/secondary/accent colours (poisoned settings)', () => {
      const { header } = mount({ ...BRAND_PRESET, ...POISON });
      const html = header.outerHTML.toLowerCase();
      Object.values(POISON).forEach((hex) => expect(html).not.toContain(hex));
      POISON_RGB.forEach((rgb) => expect(html).not.toContain(rgb));
    });

    it('follows a customised active colour', () => {
      const { cssVar } = mount({ ...BRAND_PRESET, navBarActiveBgColor: '#112233', navBarActiveTextColor: '#fefefe' });
      expect(cssVar('--hdr-active-bg')).toBe('#112233');
      expect(cssVar('--hdr-active-text')).toBe('#fefefe');
    });

    it('keeps the current look with the shipped defaults (blue active tab, gradient)', () => {
      const { cssVar } = mount(DEFAULT_VISUAL_SETTINGS);
      expect(cssVar('--hdr-active-bg')).toBe('#2563eb');
      expect(cssVar('--hdr-active-text')).toBe('#ffffff');
      expect(cssVar('--hdr-active-background')).toBe('linear-gradient(135deg, #2563eb, #9333ea)');
    });

    it('uses a flat background when the gradient is off', () => {
      const { cssVar } = mount(BRAND_PRESET);
      expect(cssVar('--hdr-active-background')).toBe('#FFF1CC');
    });
  });

  describe('hover and focus', () => {
    it('hover comes from headerMenuHover* via classes and variables', () => {
      const { header, cssVar } = mount({ ...BRAND_PRESET, headerMenuHoverBgColor: '#eeeeee', headerMenuHoverTextColor: '#111111' });
      const products = within(header).getAllByRole('button', { name: 'nav.products' })[0];
      expect(cssVar('--hdr-hover-bg')).toBe('#eeeeee');
      expect(cssVar('--hdr-hover-text')).toBe('#111111');
      expect(hasClass(products, 'hover:bg-[color:var(--hdr-hover-bg)]')).toBe(true);
      expect(hasClass(products, 'hover:text-[color:var(--hdr-hover-text)]')).toBe(true);
      expect(hasClass(products, 'hover:bg-accent')).toBe(false);
      expect(products.getAttribute('style')).toBeNull();
    });

    it('does not mutate inline styles on mouse enter/leave', () => {
      const { header } = mount(BRAND_PRESET);
      const products = within(header).getAllByRole('button', { name: 'nav.products' })[0];
      fireEvent.mouseEnter(products);
      expect(products.getAttribute('style')).toBeNull();
    });

    it('focus ring comes from focusRingColor', () => {
      const { header, cssVar } = mount({ ...BRAND_PRESET, focusRingColor: '#0a0a0a' });
      const products = within(header).getAllByRole('button', { name: 'nav.products' })[0];
      expect(cssVar('--brand-focus-ring')).toBe('#0a0a0a');
      expect(hasClass(products, 'focus-visible:ring-brand-focus')).toBe(true);
      expect(hasClass(products, 'focus-visible:ring-ring')).toBe(false);
    });
  });

  describe('header surface and wordmark', () => {
    it('paints the header with headerBgColor/headerTextColor', () => {
      const { header } = mount({ ...BRAND_PRESET, headerBgColor: '#ffffff', headerTextColor: '#171717' });
      expect(header.style.backgroundColor).toBe('rgb(255, 255, 255)');
      expect(header.style.color).toBe('rgb(23, 23, 23)');
    });

    it('falls back to safe brand colours when values are missing or not a HEX colour', () => {
      const { header, cssVar } = mount({
        headerBgColor: 'red; background:url(x)',
        headerTextColor: undefined,
        navBarActiveBgColor: 'nope',
        cartBadgeBgColor: '',
        focusRingColor: null,
      });
      expect(header.style.backgroundColor).toBe('rgb(255, 255, 255)');
      expect(cssVar('--hdr-text')).toBe('#171717');
      expect(cssVar('--hdr-active-bg')).toBe('#FFF1CC');
      expect(cssVar('--brand-cart-badge-bg')).toBe('#FFA500');
      expect(cssVar('--brand-focus-ring')).toBe('#171717');
    });

    it('shows only the wordmark text when there is no logo (no icon tile, no gradient text)', () => {
      const { header } = mount({ ...BRAND_PRESET, useGradient: true });
      const mark = within(header).getByText('PapuEnvíos');
      expect(mark.getAttribute('style')).toBeNull();
      expect(header.querySelector('img')).toBeNull();
      expect(header.querySelector('.rounded-lg svg')).toBeNull();
    });

    it('keeps the configured logo image', () => {
      const { header } = mount({ ...BRAND_PRESET, logo: 'https://cdn.test/logo.png', companyName: 'PapuEnvíos' });
      expect(header.querySelector('img').getAttribute('src')).toBe('https://cdn.test/logo.png');
    });
  });

  describe('cart badge', () => {
    it('is hidden with an empty cart', () => {
      const { header } = mount(BRAND_PRESET);
      expect(header.querySelector('.bg-brand-badge')).toBeNull();
    });

    it('shows the item count with the cartBadge* colours', () => {
      state.cart = [{ quantity: 2 }, { quantity: 3 }];
      const { header, cssVar } = mount({ ...BRAND_PRESET, cartBadgeBgColor: '#ffa500', cartBadgeTextColor: '#171717' });
      const badge = within(header).getByText('5');
      expect(hasClass(badge, 'bg-brand-badge')).toBe(true);
      expect(hasClass(badge, 'text-brand-badge-foreground')).toBe(true);
      expect(hasClass(badge, 'bg-red-500')).toBe(false);
      expect(cssVar('--brand-cart-badge-bg')).toBe('#ffa500');
      expect(cssVar('--brand-cart-badge-text')).toBe('#171717');
    });
  });

  describe('language button', () => {
    it('respects buttonBgColor / buttonTextColor / buttonHoverBgColor and toggles the language', () => {
      const { header, cssVar } = mount({ ...BRAND_PRESET, buttonBgColor: '#ffa500', buttonTextColor: '#171717', buttonHoverBgColor: '#e59400' });
      const lang = within(header).getAllByRole('button', { name: /ES/ })[0];
      expect(hasClass(lang, 'bg-brand')).toBe(true);
      expect(hasClass(lang, 'hover:bg-brand-hover')).toBe(true);
      expect(lang.getAttribute('style')).toBeNull();
      expect(cssVar('--brand-button-bg')).toBe('#ffa500');
      expect(cssVar('--brand-button-text')).toBe('#171717');
      expect(cssVar('--brand-button-hover-bg')).toBe('#e59400');
      fireEvent.click(lang);
      expect(state.setLanguage).toHaveBeenCalledWith('en');
    });
  });

  describe('mobile', () => {
    it('quick-nav pills mark the current page and ignore primary colours', () => {
      window.innerWidth = 500;
      const { header } = mount({ ...BRAND_PRESET, ...POISON });
      const pills = header.querySelectorAll('button.rounded-full');
      expect(pills.length).toBe(3);
      const [home, products] = pills;
      expect(home.getAttribute('aria-current')).toBe('page');
      expect(products.getAttribute('aria-current')).toBeNull();
      expect(hasClass(home, 'underline')).toBe(true);
      const html = header.outerHTML.toLowerCase();
      Object.values(POISON).forEach((hex) => expect(html).not.toContain(hex));
      POISON_RGB.forEach((rgb) => expect(html).not.toContain(rgb));
    });

    it('hamburger menu: active item has aria-current and the language button is a brand button', () => {
      const { header } = mount({ ...BRAND_PRESET, ...POISON });
      fireEvent.click(within(header).getAllByRole('button').find((b) => b.className.includes('md:hidden')));
      const navs = screen.getAllByRole('navigation');
      const mobileNav = navs[navs.length - 1];
      expect(within(mobileNav).getByRole('button', { name: 'nav.home' }).getAttribute('aria-current')).toBe('page');
      expect(within(mobileNav).getByRole('button', { name: 'nav.products' }).getAttribute('aria-current')).toBeNull();
      const lang = within(mobileNav).getByRole('button', { name: /ES/ });
      expect(hasClass(lang, 'bg-brand')).toBe(true);
      expect(lang.getAttribute('style')).toBeNull();
      expect(mobileNav.outerHTML.toLowerCase()).not.toContain(POISON.primaryColor);
    });
  });

  describe('admin menu', () => {
    it('keeps the admin dropdown reachable and marks its current page', () => {
      state.role = 'admin';
      const { header } = mount(BRAND_PRESET, { currentPage: 'settings' });
      const trigger = within(header).getByRole('button', { name: /Admin/ });
      fireEvent.click(trigger);
      const item = within(header).getByRole('button', { name: 'nav.settings' });
      expect(item.getAttribute('aria-current')).toBe('page');
      expect(within(header).getByRole('button', { name: 'nav.dashboard' }).getAttribute('aria-current')).toBeNull();
    });
  });

  describe('contrast of the brand preset', () => {
    it('has no text/background pair below AA in the pairs the Visual screen checks', () => {
      expect(getContrastIssues(BRAND_PRESET)).toEqual([]);
    });

    it('hover and menu pairs also reach 4.5:1', () => {
      const p = BRAND_PRESET;
      const pairs = [
        [p.headerMenuHoverTextColor, p.headerMenuHoverBgColor],
        [p.headerMenuTextColor, p.headerMenuBgColor],
        [p.headerMenuActiveColor, p.headerMenuActiveBgColor],
        [p.headerTextColor, p.headerBgColor],
      ];
      pairs.forEach(([fg, bg]) => expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(4.5));
    });
  });
});
