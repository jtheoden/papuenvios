import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const state = vi.hoisted(() => ({ settings: {} }));

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
  useRealtimeCarouselSlides: () => {},
}));
vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({ language: 'es', setLanguage: vi.fn(), t: (k) => k }),
}));
vi.mock('@/contexts/BusinessContext', () => ({
  useBusiness: () => ({ cart: [], visualSettings: state.settings }),
}));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: null,
    isAdmin: false,
    userRole: 'user',
    userCategory: null,
    roleStatus: 'resolved',
    roleFetchFailed: false,
    retryRoleResolution: vi.fn(),
  }),
}));
vi.mock('@/components/ui/use-toast', () => ({ toast: vi.fn() }));
vi.mock('@/components/ui/user-avatar', () => ({ UserAvatar: () => <span /> }));
vi.mock('@/lib/carouselService', () => ({
  getCarouselSlides: vi.fn().mockResolvedValue([]),
  createCarouselSlide: vi.fn(),
  updateCarouselSlide: vi.fn(),
  hardDeleteCarouselSlide: vi.fn(),
  toggleCarouselSlideActive: vi.fn(),
}));
vi.mock('@/lib/businessVisualSettingsService', async (importOriginal) => ({
  ...(await importOriginal()),
  saveVisualSettings: vi.fn().mockResolvedValue({ success: true }),
  applyVisualSettingsToDOM: vi.fn(),
  clearVisualSettingsCache: vi.fn(),
}));

import Header from '@/components/Header';
import HeaderPreview from '@/components/settings/HeaderPreview';
import SettingsPageVisual from '@/components/settings/SettingsPageVisual';
import { DEFAULT_VISUAL_SETTINGS } from '@/lib/businessVisualSettingsService';
import { BRAND_PRESET } from '@/lib/brandPalette';
import { buildHeaderTheme } from '@/lib/headerTheme';
import { CLASSIC_ROW } from '../fixtures/classicVisualRow';
vi.mock('@/components/ui/ConfirmDialog', () => ({ useConfirm: () => vi.fn().mockResolvedValue(true) })); // these tests do not exercise confirmations

// What the Header receives in production: the stored row merged over the code defaults (loadVisualSettings does the same).
// Row without headerGradientColor: its gradient end only exists through the DEFAULT merge.
const { headerGradientColor: _stored, ...CLASSIC_WITHOUT_GRADIENT_END } = CLASSIC_ROW;
const ROWS = {
  'production classic row (headerGradientColor only comes from the DEFAULT merge)': { ...DEFAULT_VISUAL_SETTINGS, ...CLASSIC_WITHOUT_GRADIENT_END },
  'brand preset': { ...DEFAULT_VISUAL_SETTINGS, ...BRAND_PRESET },
  'brand preset with the active gradient on and no stored gradient colour': { ...DEFAULT_VISUAL_SETTINGS, ...BRAND_PRESET, useHeaderGradient: true, headerGradientColor: undefined },
};

describe('HeaderPreview vs the real Header', () => {
  it('the production row really gets its gradient end from the DEFAULT merge (guards the premise of these tests)', () => {
    expect(CLASSIC_WITHOUT_GRADIENT_END.headerGradientColor).toBeUndefined();
    expect(DEFAULT_VISUAL_SETTINGS.headerGradientColor).toBeTruthy();
  });

  it.each(Object.entries(ROWS))('%s: same root background and same CSS variables', (_name, settings) => {
    state.settings = settings;
    const { container, getByTestId } = render(
      <>
        <Header currentPage="home" onNavigate={() => {}} />
        <HeaderPreview settings={settings} />
      </>
    );
    const header = container.querySelector('header');
    const preview = getByTestId('header-preview');
    const expected = buildHeaderTheme(settings);

    expect(header.style.backgroundColor).not.toBe('');
    expect(preview.style.backgroundColor).toBe(header.style.backgroundColor);
    expect(preview.style.color).toBe(header.style.color);
    for (const key of Object.keys(expected).filter((k) => k.startsWith('--'))) {
      expect(preview.style.getPropertyValue(key), key).toBe(header.style.getPropertyValue(key));
    }
  });

  it.each(Object.entries(ROWS))('%s: the Visual settings previews (form state) match the real Header too', (_name, settings) => {
    state.settings = settings;
    const { container } = render(
      <>
        <Header currentPage="home" onNavigate={() => {}} />
        <SettingsPageVisual localVisual={{}} setLocalVisual={vi.fn()} visualSettings={settings} setVisualSettings={vi.fn()} />
      </>
    );
    const header = container.querySelector('header');
    const previews = screen.getAllByTestId('header-preview');
    expect(previews).toHaveLength(2);
    for (const preview of previews) {
      expect(preview.style.backgroundColor).toBe(header.style.backgroundColor);
      for (const key of Object.keys(buildHeaderTheme(settings)).filter((k) => k.startsWith('--hdr-'))) {
        expect(preview.style.getPropertyValue(key), key).toBe(header.style.getPropertyValue(key));
      }
    }
  });
});
