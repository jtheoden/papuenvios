import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { BRAND_PRESET, getContrastIssues } from '@/lib/brandPalette';
import { DEFAULT_VISUAL_SETTINGS } from '@/lib/businessVisualSettingsService';
import { contrastRatio } from '@/lib/contrast';

// Row stored in production today (blue/violet, gradient on, no logo), merged over the code defaults
// the same way loadVisualSettings does.
const PROD_ROW = {
  useGradient: true,
  logo: '',
  primaryColor: '#3499dc',
  secondaryColor: '#9333ea',
  headerGradientColor: '#9333ea',
  gradientDirection: '320',
  navBarActiveBgColor: '#2563eb',
  navBarActiveTextColor: '#ffffff',
  headerMenuActiveBgColor: '#eff6ff',
  headerMenuActiveColor: '#2563eb',
  buttonBgColor: '#2563eb',
  buttonTextColor: '#ffffff',
  buttonHoverBgColor: '#1d4ed8',
  headerBgColor: '#ffffff',
  headerTextColor: '#1f2937',
};
const PROD = { ...DEFAULT_VISUAL_SETTINGS, ...PROD_ROW };

const POISON = { primaryColor: '#abcdef', secondaryColor: '#fedcba', accentColor: '#123456' };
const POISON_RGB = ['rgb(171, 205, 239)', 'rgb(254, 220, 186)', 'rgb(18, 52, 86)'];

const state = vi.hoisted(() => ({
  settings: {},
  cart: [],
  role: 'user',
  user: null,
  category: null,
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
    user: state.user,
    isAdmin: state.role === 'admin' || state.role === 'super_admin',
    userRole: state.role,
    userCategory: state.category,
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
    state.user = null;
    state.category = null;
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
      const html = header.querySelector('nav').outerHTML.toLowerCase();
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
      expect(cssVar('--brand-cart-badge-bg')).toBe('#dc2626');
      expect(cssVar('--brand-focus-ring')).toBe('#171717');
    });

    it('shows only the plain wordmark text with the brand preset (gradient off): no icon tile, no gradient text', () => {
      const { header, cssVar } = mount(BRAND_PRESET);
      const mark = within(header).getByText('PapuEnvíos');
      expect(hasClass(mark, 'bg-clip-text')).toBe(false);
      expect(header.querySelector('img')).toBeNull();
      expect(header.querySelector('.rounded-lg svg')).toBeNull();
      expect(cssVar('--hdr-mark-from')).toBe('');
    });

    it('keeps the legacy look while useGradient is on and there is no logo (until S5): gradient tile + gradient name', () => {
      const { header, cssVar } = mount(PROD);
      const tile = header.querySelector('.rounded-lg');
      expect(tile.querySelector('svg')).toBeTruthy();
      expect(hasClass(tile, 'bg-[linear-gradient(to_right,var(--hdr-mark-from),var(--hdr-mark-to))]')).toBe(true);
      const mark = within(header).getByText('PapuEnvios');
      expect(hasClass(mark, 'bg-clip-text')).toBe(true);
      expect(hasClass(mark, 'text-transparent')).toBe(true);
      expect(hasClass(mark, 'bg-[linear-gradient(to_right,var(--hdr-mark-from),var(--hdr-mark-to))]')).toBe(true);
      expect(cssVar('--hdr-mark-from')).toBe('#3499dc');
      expect(cssVar('--hdr-mark-to')).toBe('#9333ea');
    });

    it('the gradient name stays with a configured logo, the icon tile does not', () => {
      const { header } = mount({ ...PROD, logo: 'https://cdn.test/logo.png' });
      expect(header.querySelector('.rounded-lg')).toBeNull();
      expect(hasClass(within(header).getByText('PapuEnvios'), 'bg-clip-text')).toBe(true);
    });

    it('mark colours fall back when the secondary colour is not a HEX value', () => {
      const { cssVar } = mount({ ...PROD, secondaryColor: 'nope' });
      expect(cssVar('--hdr-mark-from')).toBe('#3499dc');
      expect(cssVar('--hdr-mark-to')).toBe('#3499dc');
    });

    it('keeps the configured logo image', () => {
      const { header } = mount({ ...BRAND_PRESET, logo: 'https://cdn.test/logo.png', companyName: 'PapuEnvíos' });
      expect(header.querySelector('img').getAttribute('src')).toBe('https://cdn.test/logo.png');
    });

    it('a configured logo that fails to load falls back to the legacy tile, not a broken image', () => {
      const { header } = mount({ ...PROD, logo: 'https://cdn.test/broken.png' });
      fireEvent.error(header.querySelector('img'));
      expect(header.querySelector('img')).toBeNull();
      expect(header.querySelector('.rounded-lg svg')).toBeTruthy();
    });
  });

  describe('cart badge', () => {
    it('is hidden with an empty cart', () => {
      const { header } = mount(BRAND_PRESET);
      expect(header.querySelector('.bg-brand-badge')).toBeNull();
    });

    it('keeps the legacy red badge with the shipped defaults (gold only through the preset)', () => {
      state.cart = [{ quantity: 1 }];
      const { cssVar } = mount(PROD);
      expect(cssVar('--brand-cart-badge-bg')).toBe('#dc2626');
      expect(cssVar('--brand-cart-badge-text')).toBe('#ffffff');
      expect(contrastRatio('#ffffff', '#dc2626')).toBeGreaterThanOrEqual(4.5);
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
    it('is a neutral brand-outline button driven by borderColor/headingColor/softAccentColor and toggles the language', () => {
      const { header, cssVar } = mount({ ...BRAND_PRESET, borderColor: '#e8e0d2', headingColor: '#171717', softAccentColor: '#fff1cc' });
      const lang = within(header).getAllByRole('button', { name: /ES/ })[0];
      ['border-brand-border', 'text-brand-ink', 'hover:bg-brand-soft', 'focus-visible:ring-brand-focus'].forEach((c) => expect(hasClass(lang, c)).toBe(true));
      expect(hasClass(lang, 'bg-brand')).toBe(false);
      expect(lang.getAttribute('style')).toBeNull();
      expect(cssVar('--brand-border')).toBe('#e8e0d2');
      expect(cssVar('--brand-ink')).toBe('#171717');
      expect(cssVar('--brand-soft-accent')).toBe('#fff1cc');
      fireEvent.click(lang);
      expect(state.setLanguage).toHaveBeenCalledWith('en');
    });

    it('with the production row it stays neutral (grey border, dark text): nothing blue', () => {
      const { header, cssVar } = mount(PROD);
      expect(cssVar('--brand-border')).toBe('#e5e7eb');
      expect(cssVar('--brand-ink')).toBe('#1f2937');
      const lang = within(header).getAllByRole('button', { name: /ES/ })[0];
      expect(hasClass(lang, 'bg-brand')).toBe(false);
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
      const html = pills[0].parentElement.outerHTML.toLowerCase();
      Object.values(POISON).forEach((hex) => expect(html).not.toContain(hex));
      POISON_RGB.forEach((rgb) => expect(html).not.toContain(rgb));
    });

    it('hamburger menu: active item has aria-current and the language button is a brand-outline button', () => {
      const { header } = mount({ ...BRAND_PRESET, ...POISON });
      fireEvent.click(within(header).getAllByRole('button').find((b) => b.className.includes('md:hidden')));
      const navs = screen.getAllByRole('navigation');
      const mobileNav = navs[navs.length - 1];
      expect(within(mobileNav).getByRole('button', { name: 'nav.home' }).getAttribute('aria-current')).toBe('page');
      expect(within(mobileNav).getByRole('button', { name: 'nav.products' }).getAttribute('aria-current')).toBeNull();
      const lang = within(mobileNav).getByRole('button', { name: /ES/ });
      expect(hasClass(lang, 'border-brand-border')).toBe(true);
      expect(hasClass(lang, 'bg-brand')).toBe(false);
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
      const item = within(header).getByRole('menuitem', { name: 'nav.settings' });
      expect(item.getAttribute('aria-current')).toBe('page');
      expect(within(header).getByRole('menuitem', { name: 'nav.dashboard' }).getAttribute('aria-current')).toBeNull();
    });
  });

  describe('production row (blue/violet, gradient on) keeps its look', () => {
    it('resolves the same colours the previous header painted', () => {
      const { header, cssVar } = mount(PROD);
      expect(header.style.backgroundColor).toBe('rgb(255, 255, 255)');
      expect(header.style.color).toBe('rgb(31, 41, 55)');
      expect(cssVar('--hdr-active-background')).toBe('linear-gradient(320deg, #2563eb, #9333ea)');
      expect(cssVar('--hdr-active-text')).toBe('#ffffff');
      expect(cssVar('--hdr-hover-bg')).toBe('#f3f4f6');
      expect(cssVar('--hdr-hover-text')).toBe('#1f2937');
      expect(cssVar('--hdr-menu-active-bg')).toBe('#eff6ff');
      expect(cssVar('--hdr-menu-active-text')).toBe('#2563eb');
      expect(cssVar('--brand-button-bg')).toBe('#2563eb');
      expect(cssVar('--brand-button-hover-bg')).toBe('#1d4ed8');
      expect(cssVar('--brand-button-text')).toBe('#ffffff');
    });
  });

  describe('legacy mobile chrome (pills, globe, dividers) follows useGradient like the wordmark', () => {
    it('production row: pills tinted with primaryColor, white divider in the menu, globe in primaryColor', () => {
      const { cssVar } = mount(PROD);
      expect(cssVar('--hdr-pill-bg')).toBe('#3499dc12');
      expect(cssVar('--hdr-pill-border')).toBe('#3499dc30');
      expect(cssVar('--hdr-pill-text')).toBe('#3499dc');
      expect(cssVar('--hdr-pills-divider')).toBe('#3499dc20');
      expect(cssVar('--hdr-menu-divider')).toBe('rgba(255, 255, 255, 0.2)');
      expect(cssVar('--hdr-globe')).toBe('#3499dc');
    });

    it('brand preset: neutral pills (header text, brand border), no primary colour anywhere', () => {
      const { cssVar } = mount({ ...BRAND_PRESET, ...POISON });
      expect(cssVar('--hdr-pill-bg')).toBe('transparent');
      expect(cssVar('--hdr-pill-border')).toBe('#E8E0D2');
      expect(cssVar('--hdr-pill-text')).toBe('#171717');
      expect(cssVar('--hdr-pills-divider')).toBe('#E8E0D2');
      expect(cssVar('--hdr-menu-divider')).toBe('#E8E0D2');
      expect(cssVar('--hdr-globe')).toBe('#171717');
    });

    it('the pills use those variables through classes', () => {
      window.innerWidth = 500;
      const { header } = mount(PROD);
      const [home, products] = header.querySelectorAll('button.rounded-full');
      ['bg-[color:var(--hdr-pill-bg)]', 'border-[color:var(--hdr-pill-border)]', 'text-[color:var(--hdr-pill-text)]'].forEach((c) => expect(hasClass(products, c)).toBe(true));
      expect(hasClass(home, 'underline')).toBe(true);
      expect(home.getAttribute('aria-current')).toBe('page');
    });
  });

  describe('invalid colour pairs fall back together', () => {
    it.each([
      ['active', { navBarActiveBgColor: 'nope', navBarActiveTextColor: '#ffffff' }, { '--hdr-active-bg': '#FFF1CC', '--hdr-active-text': '#171717' }],
      ['hover', { headerMenuHoverBgColor: 'nope', headerMenuHoverTextColor: '#ffffff' }, { '--hdr-hover-bg': '#FFF1CC', '--hdr-hover-text': '#171717' }],
      ['menu', { headerMenuBgColor: 'nope', headerMenuTextColor: '#ffffff' }, { '--hdr-menu-bg': '#ffffff', '--hdr-menu-text': '#171717' }],
      ['menu active', { headerMenuActiveBgColor: '', headerMenuActiveColor: '#ffffff' }, { '--hdr-menu-active-bg': '#FFF1CC', '--hdr-menu-active-text': '#171717' }],
      ['cart badge', { cartBadgeBgColor: 'nope', cartBadgeTextColor: '#ffffff' }, { '--brand-cart-badge-bg': '#dc2626', '--brand-cart-badge-text': '#ffffff' }],
      ['button', { buttonBgColor: 'nope', buttonTextColor: '#ffffff' }, { '--brand-button-bg': '#FFA500', '--brand-button-text': '#171717' }],
    ])('%s: a bad background never keeps a white text chosen for another background', (_name, bad, expected) => {
      const { cssVar } = mount({ ...BRAND_PRESET, ...bad });
      Object.entries(expected).forEach(([name, value]) => expect(cssVar(name).toLowerCase()).toBe(value.toLowerCase()));
    });

    it('the header surface pair falls back together too', () => {
      const { header } = mount({ ...BRAND_PRESET, headerBgColor: 'nope', headerTextColor: '#ffffff' });
      expect(header.style.backgroundColor).toBe('rgb(255, 255, 255)');
      expect(header.style.color).toBe('rgb(23, 23, 23)');
    });
  });

  describe('gradient direction', () => {
    it.each([['abc', 135], ['', 135], [undefined, 135], ['0', 0], ['320', 320], [90, 90]])('%s -> %sdeg', (value, deg) => {
      const { cssVar } = mount({ ...PROD, gradientDirection: value });
      expect(cssVar('--hdr-active-background')).toBe(`linear-gradient(${deg}deg, #2563eb, #9333ea)`);
    });
  });

  describe('signed-in users and roles', () => {
    it('the regular-category indicator keeps reading primaryColor (legacy, not part of the brand surfaces)', () => {
      state.user = { id: 'u1', email: 'a@b.c' };
      state.category = { category_name: 'regular' };
      const { header } = mount({ ...BRAND_PRESET, ...POISON });
      const badge = header.querySelector('[title^="users.categories.current"]');
      expect(badge).toBeTruthy();
      expect(badge.style.borderColor).toBe('rgb(171, 205, 239)');
      expect(header.querySelector('nav').outerHTML.toLowerCase()).not.toContain('rgb(171, 205, 239)');
    });

    it('super_admin: admin dropdown reachable, no cart button, current admin page marked', () => {
      state.role = 'super_admin';
      state.user = { id: 'u1', email: 'a@b.c' };
      state.category = { category_name: 'vip' };
      const { header } = mount(PROD, { currentPage: 'dashboard' });
      expect(within(header).queryByRole('button', { name: /nav\.cart/ })).toBeNull();
      fireEvent.click(within(header).getByRole('button', { name: /Admin/ }));
      expect(within(header).getByRole('menuitem', { name: 'nav.dashboard' }).getAttribute('aria-current')).toBe('page');
      expect(header.querySelector('[title^="users.categories.current"]')).toBeTruthy();
    });
  });

  describe('accessible names', () => {
    it('hamburger: aria-label and aria-expanded follow the open state', () => {
      const { header } = mount(BRAND_PRESET);
      const burger = within(header).getByRole('button', { name: 'nav.openMenu' });
      expect(burger.getAttribute('aria-expanded')).toBe('false');
      fireEvent.click(burger);
      const open = within(header).getByRole('button', { name: 'nav.closeMenu' });
      expect(open.getAttribute('aria-expanded')).toBe('true');
    });

    it('cart keeps its count in the accessible name', () => {
      state.cart = [{ quantity: 2 }];
      const { header } = mount(BRAND_PRESET);
      expect(within(header).getByRole('button', { name: /nav\.cart/ }).textContent).toContain('2');
    });

    it('avatar button is named', () => {
      state.user = { id: 'u1', email: 'a@b.c' };
      const { header } = mount(BRAND_PRESET);
      expect(within(header).getByRole('button', { name: /nav\.userMenu/ })).toBeTruthy();
    });
  });

  describe('motion', () => {
    it('nav buttons do not scale on press when reduced motion is requested', () => {
      const { header } = mount(BRAND_PRESET);
      const products = within(header).getAllByRole('button', { name: 'nav.products' })[0];
      expect(hasClass(products, 'motion-reduce:active:scale-100')).toBe(true);
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
