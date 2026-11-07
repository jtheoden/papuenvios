import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';

vi.mock('@/lib/supabase', () => ({ supabase: { from: vi.fn() } }));
vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (key) => key, language: 'es' }),
}));
vi.mock('@/contexts/BusinessContext', () => ({ useBusiness: () => ({}) }));
vi.mock('@/components/ui/use-toast', () => ({ toast: vi.fn() }));
vi.mock('@/hooks/useRealtimeSubscription', () => ({ useRealtimeCarouselSlides: () => {} }));
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

import SettingsPageVisual from '@/components/settings/SettingsPageVisual';
import { DEFAULT_VISUAL_SETTINGS } from '@/lib/businessVisualSettingsService';
import { BRAND_PRESET } from '@/lib/brandPalette';
import { buildHeaderTheme } from '@/lib/headerTheme';

const PNG = 'data:image/png;base64,iVBORw0KGgo=';
const K = 'settings.visual.';

const setup = (overrides = {}) => {
  render(
    <SettingsPageVisual
      localVisual={{}}
      setLocalVisual={vi.fn()}
      visualSettings={{ ...DEFAULT_VISUAL_SETTINGS, companyName: 'Acme Envios', ...overrides }}
      setVisualSettings={vi.fn()}
    />
  );
};

const previews = () => screen.getAllByTestId('header-preview');

beforeEach(() => vi.clearAllMocks());

describe('Header preview in the Visual settings mirrors the real Header', () => {
  it('shows the uploaded logo (capped by logoMaxHeight) and the company name', () => {
    setup({ logo: PNG, logoMaxHeight: 52 });
    for (const preview of previews()) {
      const img = within(preview).getByRole('img', { name: 'Acme Envios' });
      expect(img).toHaveAttribute('src', PNG);
      expect(img.style.maxHeight).toBe('52px');
      expect(within(preview).getByText('Acme Envios')).toBeInTheDocument();
    }
  });

  it('hides the name beside the logo when showCompanyNameWithLogo is off, and follows the checkbox live', () => {
    setup({ logo: PNG, showCompanyNameWithLogo: true });
    fireEvent.click(screen.getByRole('checkbox', { name: `${K}showCompanyNameWithLogo` }));
    for (const preview of previews()) {
      expect(within(preview).getByRole('img', { name: 'Acme Envios' })).toBeInTheDocument();
      expect(within(preview).queryByText('Acme Envios')).toBeNull();
    }
  });

  it('keeps the name without a logo even when showCompanyNameWithLogo is off', () => {
    setup({ logo: '', showCompanyNameWithLogo: false });
    for (const preview of previews()) expect(within(preview).getByText('Acme Envios')).toBeInTheDocument();
  });

  it('honours the "show company name in header" switch like Header does', () => {
    setup({ logo: PNG, showCompanyName: false });
    for (const preview of previews()) expect(within(preview).queryByText('Acme Envios')).toBeNull();
  });

  it('computes background and active tab with the very same function as Header (buildHeaderTheme)', () => {
    const settings = { ...DEFAULT_VISUAL_SETTINGS, ...BRAND_PRESET, companyName: 'Acme Envios' };
    setup({ ...BRAND_PRESET });
    const expected = buildHeaderTheme(settings);
    for (const preview of previews()) {
      expect(preview.style.backgroundColor).not.toBe('');
      expect(preview.style.getPropertyValue('--hdr-active-background')).toBe(expected['--hdr-active-background']);
      expect(preview.style.getPropertyValue('--hdr-active-text')).toBe(expected['--hdr-active-text']);
      expect(preview.style.getPropertyValue('--hdr-text')).toBe(expected['--hdr-text']);
    }
  });

  it('never invents a purple gradient end: with no headerGradientColor stored the active tab stays flat', () => {
    setup({ ...BRAND_PRESET, headerGradientColor: undefined, useHeaderGradient: true });
    for (const preview of previews()) {
      const active = preview.style.getPropertyValue('--hdr-active-background');
      expect(active).not.toMatch(/gradient/);
      expect(preview.outerHTML.toLowerCase()).not.toContain('#9333ea');
      expect(preview.outerHTML.toLowerCase()).not.toContain('rgb(147, 51, 234)');
    }
  });
});
