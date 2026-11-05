import { describe, it, expect, vi, beforeEach } from 'vitest';

const singleMock = vi.fn();
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => ({ select: () => ({ limit: () => ({ single: singleMock }) }) }),
  },
}));

import {
  DEFAULT_VISUAL_SETTINGS,
  loadVisualSettings,
  applyVisualSettingsToDOM,
} from '@/lib/businessVisualSettingsService';

// Row stored in production today (blue/violet, no brand keys).
const PRODUCTION_ROW = {
  primaryColor: '#3499dc',
  secondaryColor: '#9333ea',
  accentColor: '#9333ea',
  buttonBgColor: '#2563eb',
  buttonHoverBgColor: '#1d4ed8',
  navBarActiveBgColor: '#2563eb',
  headerMenuActiveColor: '#2563eb',
  tabActiveColor: '#2563eb',
  footerLinkColor: '#2563eb',
  footerLinkHoverColor: '#9333ea',
  headerGradientColor: '#9333ea',
  pageBgColor: '#f9fafb',
  headerBgColor: '#ffffff',
  headingColor: '#1f2937',
  useGradient: true,
  useButtonGradient: true,
  useHeadingGradient: true,
};

describe('loadVisualSettings with the new brand keys', () => {
  beforeEach(() => {
    localStorage.clear();
    singleMock.mockReset();
  });

  it('fills the new keys with brand defaults when the stored row lacks them', async () => {
    singleMock.mockResolvedValue({ data: { settings: PRODUCTION_ROW }, error: null });
    const s = await loadVisualSettings();
    // legacy red badge: production must not change until the super admin applies the preset
    expect(s.cartBadgeBgColor).toBe('#dc2626');
    expect(s.cartBadgeTextColor).toBe('#ffffff');
    expect(s.carouselDotActiveColor).toBe('#FFA500');
    expect(s.mutedTextColor).toBe('#605B52');
    expect(s.softAccentColor).toBe('#FFF1CC');
    expect(s.focusRingColor).toBe('#171717');
  });

  it('keeps every stored blue/violet value: production look does not change by deploying', async () => {
    singleMock.mockResolvedValue({ data: { settings: PRODUCTION_ROW }, error: null });
    const s = await loadVisualSettings();
    for (const [key, value] of Object.entries(PRODUCTION_ROW)) {
      expect(s[key], key).toBe(value);
    }
  });

  it('does not change the border colour already read by UserPanel/styleUtils (grey fallback)', async () => {
    singleMock.mockResolvedValue({ data: { settings: PRODUCTION_ROW }, error: null });
    expect((await loadVisualSettings()).borderColor).toBe('#e5e7eb');
  });

  it('lets a stored value win over the new default', async () => {
    singleMock.mockResolvedValue({ data: { settings: { ...PRODUCTION_ROW, cartBadgeBgColor: '#123456' } }, error: null });
    expect((await loadVisualSettings()).cartBadgeBgColor).toBe('#123456');
  });
});

describe('loadVisualSettings with the selectable theme key', () => {
  beforeEach(() => {
    localStorage.clear();
    singleMock.mockReset();
  });

  it('a stored row without activeTheme loads as classic: production does not change by deploying', async () => {
    singleMock.mockResolvedValue({ data: { settings: PRODUCTION_ROW }, error: null });
    expect((await loadVisualSettings()).activeTheme).toBe('classic');
  });

  it('keeps a stored papuenvios choice and its classic snapshot', async () => {
    const classicSnapshot = { buttonBgColor: '#2563eb' };
    singleMock.mockResolvedValue({ data: { settings: { ...PRODUCTION_ROW, activeTheme: 'papuenvios', classicSnapshot } }, error: null });
    const s = await loadVisualSettings();
    expect(s.activeTheme).toBe('papuenvios');
    expect(s.classicSnapshot).toEqual(classicSnapshot);
  });
});

describe('applyVisualSettingsToDOM exposes the brand CSS variables', () => {
  const root = () => document.documentElement;

  beforeEach(() => {
    root().removeAttribute('style');
    document.body.removeAttribute('style');
  });

  it('writes the new keys from custom values', () => {
    applyVisualSettingsToDOM({
      ...DEFAULT_VISUAL_SETTINGS,
      cartBadgeBgColor: '#112233',
      cartBadgeTextColor: '#445566',
      carouselDotActiveColor: '#778899',
      borderColor: '#aabbcc',
      mutedTextColor: '#ddeeff',
      softAccentColor: '#010203',
      focusRingColor: '#040506',
      buttonBgColor: '#0a0b0c',
      buttonHoverBgColor: '#0d0e0f',
      buttonTextColor: '#102030',
      headingColor: '#405060',
    });
    const get = (n) => root().style.getPropertyValue(n);
    expect(get('--brand-cart-badge-bg')).toBe('#112233');
    expect(get('--brand-cart-badge-text')).toBe('#445566');
    expect(get('--brand-dot-active')).toBe('#778899');
    expect(get('--brand-border')).toBe('#aabbcc');
    expect(get('--brand-muted-text')).toBe('#ddeeff');
    expect(get('--brand-soft-accent')).toBe('#010203');
    expect(get('--brand-focus-ring')).toBe('#040506');
    expect(get('--brand-button-bg')).toBe('#0a0b0c');
    expect(get('--brand-button-hover-bg')).toBe('#0d0e0f');
    expect(get('--brand-button-text')).toBe('#102030');
    expect(get('--brand-ink')).toBe('#405060');
  });

  it('drops poisoned values instead of injecting them into the stylesheet', () => {
    applyVisualSettingsToDOM({ ...DEFAULT_VISUAL_SETTINGS, cartBadgeBgColor: '#112233' });
    applyVisualSettingsToDOM({
      ...DEFAULT_VISUAL_SETTINGS,
      cartBadgeBgColor: 'red; background:url(//evil.example/x)',
      borderColor: 'var(--x)',
      focusRingColor: null,
    });
    const get = (n) => root().style.getPropertyValue(n);
    expect(get('--brand-cart-badge-bg')).toBe('');
    expect(get('--brand-border')).toBe('');
    expect(get('--brand-focus-ring')).toBe('');
  });

  it('keeps the existing variables and the body background untouched', () => {
    applyVisualSettingsToDOM({ ...DEFAULT_VISUAL_SETTINGS, ...PRODUCTION_ROW });
    expect(root().style.getPropertyValue('--color-primary')).toBe('#3499dc');
    expect(root().style.getPropertyValue('--color-secondary')).toBe('#9333ea');
    expect(root().style.getPropertyValue('--color-page-bg')).toBe('#f9fafb');
    expect(document.body.style.backgroundColor).toBe('rgb(249, 250, 251)');
  });
});
