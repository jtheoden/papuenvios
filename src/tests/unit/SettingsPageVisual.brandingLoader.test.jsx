import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';

const imageMock = vi.hoisted(() => ({ validateAndProcessImage: vi.fn() }));

vi.mock('@/lib/supabase', () => ({ supabase: { from: vi.fn() } }));
vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (key) => key, language: 'es' }),
}));
vi.mock('@/contexts/BusinessContext', () => ({ useBusiness: () => ({}) }));
vi.mock('@/components/ui/use-toast', () => ({ toast: vi.fn() }));
vi.mock('@/hooks/useRealtimeSubscription', () => ({ useRealtimeCarouselSlides: () => {} }));
vi.mock('@/lib/imageUtils', async (importOriginal) => ({ ...(await importOriginal()), validateAndProcessImage: imageMock.validateAndProcessImage }));
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
import { toast } from '@/components/ui/use-toast';
import ES from '@/translations/ES.json';
import EN from '@/translations/EN.json';
vi.mock('@/components/ui/ConfirmDialog', () => ({ useConfirm: () => vi.fn().mockResolvedValue(true) })); // these tests do not exercise confirmations

const K = 'settings.visual.';
const PNG = 'data:image/png;base64,iVBORw0KGgo=';
const WEBP = 'data:image/webp;base64,UklGRg==';

const setup = (overrides = {}) => {
  const setVisualSettings = vi.fn();
  render(
    <SettingsPageVisual
      localVisual={{}}
      setLocalVisual={vi.fn()}
      visualSettings={{ ...DEFAULT_VISUAL_SETTINGS, companyName: 'Acme Envios', ...overrides }}
      setVisualSettings={setVisualSettings}
    />
  );
  return { setVisualSettings };
};

const save = () => fireEvent.click(screen.getByText(`${K}saveCustomization`));
const saved = (setVisualSettings) => setVisualSettings.mock.calls.at(-1)[0];
const nameCheckbox = () => screen.getByRole('checkbox', { name: `${K}showCompanyNameWithLogo` });
const section = () => screen.getByRole('region', { name: `${K}loader.title` });
const bgInput = () => within(section()).getByLabelText(`${K}loader.bgColor`);
const preview = () => within(section()).getByTestId('loader-preview');

beforeEach(() => vi.clearAllMocks());

describe('"show the name next to the logo" checkbox', () => {
  it('is checked by default (absent setting) and explains when to uncheck it', () => {
    setup({ logo: PNG });
    expect(nameCheckbox()).toBeChecked();
    expect(nameCheckbox()).toBeEnabled();
    expect(screen.getByText(`${K}showCompanyNameWithLogoHint`)).toBeInTheDocument();
  });

  it('is disabled while there is no logo (the name is always shown then)', () => {
    setup({ logo: '' });
    expect(nameCheckbox()).toBeDisabled();
  });

  it('saves false when unchecked and true again when re-checked', () => {
    const { setVisualSettings } = setup({ logo: PNG });
    fireEvent.click(nameCheckbox());
    save();
    expect(saved(setVisualSettings).showCompanyNameWithLogo).toBe(false);
    fireEvent.click(nameCheckbox());
    save();
    expect(saved(setVisualSettings).showCompanyNameWithLogo).toBe(true);
  });

  it('shows the stored false', () => {
    setup({ logo: PNG, showCompanyNameWithLogo: false });
    expect(nameCheckbox()).not.toBeChecked();
  });

  it('drives the header preview: no name beside the logo when unchecked', () => {
    setup({ logo: PNG, showCompanyNameWithLogo: true });
    const previews = () => screen.getAllByTestId('header-preview');
    previews().forEach((p) => expect(within(p).getByText('Acme Envios')).toBeInTheDocument());
    fireEvent.click(nameCheckbox());
    previews().forEach((p) => expect(within(p).queryByText('Acme Envios')).toBeNull());
  });
});

describe('initial loading screen section', () => {
  it('exists with a description and a live preview', () => {
    setup();
    expect(section()).toBeInTheDocument();
    expect(within(section()).getByText(`${K}loader.description`)).toBeInTheDocument();
    expect(preview()).toBeInTheDocument();
  });

  it('with nothing configured previews the theme tokens, never a hardcoded colour', () => {
    setup({ logo: '' });
    expect(preview().style.getPropertyValue('--ld-bg')).not.toBe('');
    expect(preview().getAttribute('data-source')).toBe('wordmark');
    expect(within(preview()).getByText('Acme Envios')).toBeInTheDocument();
    expect(within(section()).getByText(`${K}loader.usingWordmark`)).toBeInTheDocument();
  });

  it('falls back to the site logo, then shows its own image once uploaded', async () => {
    imageMock.validateAndProcessImage.mockResolvedValue({ success: true, base64: WEBP, metadata: { originalDimensions: '1x1', finalDimensions: '1x1' } });
    setup({ logo: PNG });
    expect(preview().getAttribute('data-source')).toBe('logo');
    expect(within(preview()).getByRole('img')).toHaveAttribute('src', PNG);
    expect(within(section()).getByText(`${K}loader.usingLogo`)).toBeInTheDocument();

    const file = new File(['x'], 'loader.webp', { type: 'image/webp' });
    fireEvent.change(within(section()).getByTestId('loader-image-input'), { target: { files: [file] } });
    await waitFor(() => expect(within(preview()).getByRole('img')).toHaveAttribute('src', WEBP));
    expect(imageMock.validateAndProcessImage).toHaveBeenCalledWith(file, 'logo');
    expect(preview().getAttribute('data-source')).toBe('image');
  });

  it('rejects an invalid image with the same validation as the logo and keeps the previous state', async () => {
    imageMock.validateAndProcessImage.mockResolvedValue({ success: false, errors: ['Too big'] });
    setup({ logo: PNG });
    const file = new File(['x'], 'loader.png', { type: 'image/png' });
    fireEvent.change(within(section()).getByTestId('loader-image-input'), { target: { files: [file] } });
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'destructive', description: 'Too big' })));
    expect(preview().getAttribute('data-source')).toBe('logo');
  });

  it('applies a valid hex background to the preview and saves it', () => {
    const { setVisualSettings } = setup();
    fireEvent.change(bgInput(), { target: { value: '#123456' } });
    expect(preview().style.getPropertyValue('--ld-bg')).toBe('#123456');
    save();
    expect(saved(setVisualSettings).loaderBgColor).toBe('#123456');
  });

  it.each(['red', '#12', '#12345g', 'url(x)'])('refuses %s: shows an error and keeps the previous background', (value) => {
    const { setVisualSettings } = setup({ loaderBgColor: '#abcdef' });
    fireEvent.change(bgInput(), { target: { value } });
    expect(within(section()).getByText(`${K}loader.bgColorInvalid`)).toBeInTheDocument();
    expect(preview().style.getPropertyValue('--ld-bg')).toBe('#abcdef');
    save();
    expect(saved(setVisualSettings).loaderBgColor).toBe('#abcdef');
  });

  it('"reset to theme" clears the image and the background (back to the tokens and the site logo)', () => {
    const { setVisualSettings } = setup({ logo: PNG, loaderImage: WEBP, loaderBgColor: '#123456' });
    expect(preview().getAttribute('data-source')).toBe('image');
    fireEvent.click(within(section()).getByRole('button', { name: `${K}loader.reset` }));
    expect(preview().getAttribute('data-source')).toBe('logo');
    expect(preview().style.getPropertyValue('--ld-bg')).not.toBe('#123456');
    expect(bgInput()).toHaveValue('');
    save();
    expect(saved(setVisualSettings)).toMatchObject({ loaderImage: '', loaderBgColor: '' });
  });

  it('removing its own image goes back to the site logo', () => {
    setup({ logo: PNG, loaderImage: WEBP });
    fireEvent.click(within(section()).getByRole('button', { name: `${K}loader.removeImage` }));
    expect(preview().getAttribute('data-source')).toBe('logo');
  });
});

describe('translations', () => {
  const paths = [
    'showCompanyNameWithLogo', 'showCompanyNameWithLogoHint',
    'loader.title', 'loader.description', 'loader.image', 'loader.uploadImage', 'loader.removeImage', 'loader.imageUploaded',
    'loader.imageHint', 'loader.usingLogo', 'loader.usingWordmark', 'loader.bgColor', 'loader.bgColorHint',
    'loader.bgColorInvalid', 'loader.bgColorPicker', 'loader.usingThemeBg', 'loader.preview', 'loader.reset', 'loader.resetDone',
  ];
  const get = (dict, path) => `settings.visual.${path}`.split('.').reduce((acc, k) => acc?.[k], dict);

  it.each(paths)('%s exists in ES and EN', (path) => {
    expect(typeof get(ES, path)).toBe('string');
    expect(typeof get(EN, path)).toBe('string');
    expect(get(ES, path).length).toBeGreaterThan(0);
    expect(get(EN, path)).not.toBe(get(ES, path));
  });
});
